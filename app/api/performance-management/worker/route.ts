/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { calculateProgress, type GoalInput } from "@/lib/performance-management/core";
import { createAdminClient } from "@/lib/supabase/admin";

const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });

function goalInput(goal: any): GoalInput {
  return {
    metricId: goal.metric_id,
    scopeType: goal.scope_type,
    scopeId: goal.scope_id,
    periodStart: goal.period_start,
    periodEnd: goal.period_end,
    targetDirection: goal.target_direction,
    targetValue: goal.target_value == null ? null : Number(goal.target_value),
    targetMin: goal.target_min == null ? null : Number(goal.target_min),
    targetMax: goal.target_max == null ? null : Number(goal.target_max),
    baselineValue: goal.baseline_value == null ? null : Number(goal.baseline_value),
    baselineSource: goal.baseline_source,
    ownerUserId: goal.owner_user_id,
    weight: goal.weight == null ? null : Number(goal.weight),
  };
}

async function semanticActual(admin: any, goal: any) {
  if (!["revenue", "orders", "average_ticket"].includes(goal.metric_id)) {
    return { actual: null, dataAsOf: null, source: "semantic_metric_unavailable" };
  }
  let query = admin.from("analytics_daily_orders").select("approved_orders,revenue_cents,refreshed_at")
    .eq("organization_id", goal.organization_id).gte("metric_date", goal.period_start).lte("metric_date", goal.period_end);
  if (goal.scope_type === "store") query = query.eq("store_id", goal.scope_id);
  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return { actual: null, dataAsOf: null, source: "analytics_daily_orders" };
  const orders = data.reduce((sum: number, row: any) => sum + Number(row.approved_orders || 0), 0);
  const revenue = data.reduce((sum: number, row: any) => sum + Number(row.revenue_cents || 0), 0) / 100;
  const actual = goal.metric_id === "revenue" ? revenue : goal.metric_id === "orders" ? orders : orders ? revenue / orders : null;
  const dataAsOf = data.reduce((latest: string | null, row: any) => !latest || row.refreshed_at > latest ? row.refreshed_at : latest, null);
  return { actual, dataAsOf, source: "analytics_daily_orders" };
}

async function processGoal(admin: any, job: any) {
  const { data: goal, error } = await admin.from("performance_goals").select("*")
    .eq("id", job.entity_id).eq("organization_id", job.organization_id).eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!goal) throw new Error("ACTIVE_GOAL_NOT_FOUND");
  const [semantic, forecastResult, previousResult] = await Promise.all([
    semanticActual(admin, goal),
    admin.from("performance_forecasts").select("value,forecast_type,created_at").eq("goal_id", goal.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("goal_progress_snapshots").select("health").eq("goal_id", goal.id).order("snapshot_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const explicitForecast = forecastResult.data ? Number(forecastResult.data.value) : null;
  const progress = calculateProgress(goalInput(goal), semantic.actual, explicitForecast);
  const snapshotAt = new Date(); snapshotAt.setUTCMinutes(0, 0, 0);
  const { error: snapshotError } = await admin.from("goal_progress_snapshots").upsert({
    organization_id: goal.organization_id, goal_id: goal.id, goal_version: goal.version,
    snapshot_at: snapshotAt.toISOString(), actual_value: progress.actual, progress: progress.progress,
    time_progress: progress.timeProgress, health: progress.health, forecast_value: progress.forecast,
    forecast_source: forecastResult.data?.forecast_type === "system_generated" ? "predictive_model" : forecastResult.data ? "manual" : progress.forecast == null ? "none" : "run_rate",
    gap_value: progress.gap, gap_percent: progress.gapPercent, required_pace: progress.requiredPace,
    data_as_of: semantic.dataAsOf, source_freshness: { source: semantic.source, refreshed_at: semantic.dataAsOf },
    calculation_trace: { metric_id: goal.metric_id, target_direction: goal.target_direction, goal_version: goal.version, generated_by: "performance-worker-v1" },
  }, { onConflict: "goal_id,goal_version,snapshot_at" });
  if (snapshotError) throw snapshotError;
  if (goal.owner_user_id && previousResult.data?.health !== progress.health && ["at_risk", "off_track", "achieved"].includes(progress.health)) {
    await admin.from("notification_inbox_items").insert({
      domain: "tenant", organization_id: goal.organization_id, store_id: goal.scope_type === "store" ? goal.scope_id : null,
      recipient_user_id: goal.owner_user_id, source_type: "performance_goal", source_id: goal.id,
      event_type: progress.health === "achieved" ? "goal.achieved" : progress.health === "off_track" ? "goal.off_track" : "goal.at_risk",
      category: "performance", title: progress.health === "achieved" ? "Meta atingida" : "Meta precisa de atenção",
      summary: `${goal.name}: ${progress.health === "achieved" ? "objetivo alcançado" : "projeção abaixo do ritmo configurado"}.`,
      priority: progress.health === "off_track" ? "high" : progress.health === "at_risk" ? "medium" : "info",
      requires_action: progress.health !== "achieved", dedup_key: `goal:${goal.id}:${progress.health}:${goal.version}`,
      group_key: `goal:${goal.id}`, route: `/painel/metas?goal=${goal.id}`, allowed_actions: ["open", "acknowledge", "create_task"],
      metadata: { goal_id: goal.id, health: progress.health, gap: progress.gap, data_as_of: semantic.dataAsOf },
    });
  }
}

export async function POST(request: Request) {
  const secret = process.env.PERFORMANCE_WORKER_SECRET || process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return response({ error: "Unauthorized" }, 401);
  const admin = createAdminClient(), now = new Date().toISOString();
  const { data: jobs, error } = await admin.from("performance_jobs").select("*").eq("status", "pending")
    .lte("available_at", now).order("priority", { ascending: false }).order("available_at").limit(20);
  if (error) return response({ error: error.message }, 500);
  let completed = 0, failed = 0;
  for (const job of jobs || []) {
    const lease = await admin.from("performance_jobs").update({ status: "running", attempts: Number(job.attempts || 0) + 1 })
      .eq("id", job.id).eq("status", "pending").select("id").maybeSingle();
    if (!lease.data) continue;
    try {
      if (job.job_type === "goal_progress") await processGoal(admin, job);
      else throw new Error(`JOB_NOT_IMPLEMENTED:${job.job_type}`);
      await admin.from("performance_jobs").update({ status: "completed", last_error: null }).eq("id", job.id);
      completed++;
    } catch (jobError: any) {
      await admin.from("performance_jobs").update({ status: "failed", last_error: String(jobError?.message || jobError).slice(0, 500) }).eq("id", job.id);
      failed++;
    }
  }
  return response({ ok: true, processed: completed + failed, completed, failed });
}
