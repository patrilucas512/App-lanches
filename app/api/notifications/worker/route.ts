import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { escalationDue, nextRetryAt } from "@/lib/notifications/core";

const R = (x: unknown, status = 200) => NextResponse.json(x, { status, headers: { "cache-control": "no-store" } });
export async function POST(req: Request) {
  const configured = process.env.NOTIFICATION_WORKER_SECRET || process.env.CRON_SECRET;
  if (!configured || req.headers.get("authorization") !== `Bearer ${configured}`) return R({ error: "Unauthorized" }, 401);
  const a = createAdminClient(), now = new Date().toISOString(), result = { delivered: 0, retried: 0, dead_lettered: 0, escalated: 0, awakened: 0 };
  const { data: snoozed } = await a.from("notification_inbox_items").select("id").eq("status", "snoozed").lte("snoozed_until", now).limit(100);
  if (snoozed?.length) { await a.from("notification_inbox_items").update({ status: "unread", snoozed_until: null }).in("id", snoozed.map((x: any) => x.id)); result.awakened = snoozed.length; }
  const { data: queue } = await a.from("notification_deliveries").select("*").in("status", ["queued", "failed"]).lte("available_at", now).order("available_at").limit(50);
  for (const delivery of queue || []) {
    const attempt = Number(delivery.attempts || 0) + 1;
    try {
      // Provider adapters consume this durable queue. In-app delivery is already committed independently.
      if (!["email", "push", "whatsapp"].includes(delivery.channel)) throw new Error("CHANNEL_NOT_SUPPORTED");
      await a.from("notification_deliveries").update({ status: "sent", attempts: attempt, sent_at: now, updated_at: now, error_code: null, error_summary: null }).eq("id", delivery.id);
      result.delivered++;
    } catch (error: any) {
      if (attempt < Number(delivery.max_attempts || 3)) { await a.from("notification_deliveries").update({ status: "failed", attempts: attempt, available_at: nextRetryAt(attempt), error_code: "PROVIDER_FAILURE", error_summary: String(error.message).slice(0, 240), updated_at: now }).eq("id", delivery.id); result.retried++; }
      else { await a.from("notification_deliveries").update({ status: "dead_lettered", attempts: attempt, error_code: "MAX_RETRIES", error_summary: String(error.message).slice(0, 240), updated_at: now }).eq("id", delivery.id); await a.from("notification_delivery_failures").upsert({ delivery_id: delivery.id, organization_id: delivery.organization_id, error_code: "MAX_RETRIES", error_summary: "Entrega externa esgotou as tentativas; a notificação permanece disponível no aplicativo." }, { onConflict: "delivery_id" }); result.dead_lettered++; }
    }
  }
  const { data: candidates } = await a.from("notification_inbox_items").select("*").in("priority", ["high", "critical"]).in("status", ["unread", "read", "in_progress"]).order("created_at").limit(100);
  for (const item of (candidates || []).filter((x: any) => escalationDue(x))) {
    const previous = await a.from("notification_escalation_history").select("escalation_level").eq("inbox_item_id", item.id).order("escalation_level", { ascending: false }).limit(1).maybeSingle(), level = Number(previous.data?.escalation_level || 0) + 1;
    if (level > 3) continue;
    const { error } = await a.from("notification_escalation_history").insert({ inbox_item_id: item.id, organization_id: item.organization_id, escalation_level: level, from_user_id: item.assigned_to, to_role: level === 1 ? "manager" : "owner", channel: level >= 2 ? "push" : "in_app", reason: "SLA de reconhecimento excedido", rule_snapshot: { bounded: true, max_level: 3 } });
    if (!error) { await a.from("notification_inbox_items").update({ priority: item.priority === "high" && level >= 2 ? "critical" : item.priority, metadata: { ...(item.metadata || {}), escalation_level: level } }).eq("id", item.id); result.escalated++; }
  }
  return R({ ...result, inbox_delivery_independent: true, escalation_loop_bounded: true });
}
