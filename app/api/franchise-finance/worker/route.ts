/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FranchiseCloseService, FranchiseFeeBasisService, FranchiseFeeCalculator, FranchiseRevenueForecastService } from "@/lib/franchise_finance/core";

const workerId = () => `franchise-${randomUUID()}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const adjustmentSign = (type: string) => ["debit", "correction", "prior_period_adjustment", "opening_balance"].includes(type) ? 1 : -1;
function exemptionAmount(total: number, exemption: any) { if (!exemption) return 0; if (["full", "grace_period"].includes(exemption.exemption_type)) return total; if (exemption.exemption_type === "percentage") return Math.min(total, Math.round(total * Number(exemption.percentage || 0))); return Math.min(total, Number(exemption.amount_cents || 0)); }

async function calculate(admin: any, job: any) {
  const payload = job.payload || {};
  const { data: profile, error: profileError } = await admin.from("franchise_financial_profiles").select("*,establishments!franchise_financial_profiles_franchisee_entity_id_fkey(timezone,ownership_type)").eq("id", job.profile_id).single();
  if (profileError) throw profileError;
  const [{ data: rules }, { data: orders }, { data: exemptions }, { data: adjustments }, { data: funds }] = await Promise.all([
    admin.from("franchise_fee_rules").select("*,fee_basis_policies(*),franchise_fee_tiers(*)").eq("financial_profile_id", profile.id).eq("active", true).lte("effective_from", payload.period_end).or(`effective_until.is.null,effective_until.gte.${payload.period_start}`),
    admin.from("analytics_fact_orders").select("total_cents,delivery_fee_cents,discount_cents,is_cancelled,status,channel_code,local_date").eq("store_id", profile.franchisee_entity_id).gte("local_date", payload.period_start).lte("local_date", payload.period_end),
    admin.from("franchise_fee_exemptions").select("*").eq("profile_id", profile.id).eq("status", "approved").lte("start_date", payload.period_end).gte("end_date", payload.period_start),
    admin.from("franchise_adjustments").select("*").eq("profile_id", profile.id).eq("status", "approved"),
    admin.from("marketing_fund_accounts").select("*").eq("organization_id", job.organization_id).eq("active", true),
  ]);
  const quality = new FranchiseCloseService().quality({ ordersSynced: Array.isArray(orders), refundsSynced: true, paymentComplete: true, metricFresh: true });
  const { data: period, error: periodError } = await admin.from("franchise_assessment_periods").upsert({ organization_id: job.organization_id, profile_id: profile.id, period_start: payload.period_start, period_end: payload.period_end, status: "calculating", quality_status: quality.status, quality_snapshot: quality }, { onConflict: "profile_id,period_start,period_end,version" }).select().single();
  if (periodError) throw periodError;
  if (quality.status === "blocked") throw new Error(`close blocked: ${quality.blockers.join(",")}`);
  const created: any[] = [];
  for (const rule of rules || []) {
    const policy = rule.fee_basis_policies || {};
    const components = [{ key: "completed_order_revenue", amountCents: (orders || []).filter((order: any) => !order.is_cancelled).reduce((sum: number, order: any) => sum + Number(order.total_cents || 0), 0) }, { key: "cancelled_orders", amountCents: 0 }, { key: "delivery_fee", amountCents: (orders || []).reduce((sum: number, order: any) => sum + Number(order.delivery_fee_cents || 0), 0) }, { key: "discounts", amountCents: (orders || []).reduce((sum: number, order: any) => sum - Number(order.discount_cents || 0), 0) }];
    const basis = new FranchiseFeeBasisService().calculate({ metric: policy.metric_id || "completed_order_revenue", components, includedComponents: policy.included_components, excludedComponents: policy.excluded_components, excludedChannels: policy.excluded_channels, roundingPolicy: policy.rounding_policy });
    const tiers = (rule.franchise_fee_tiers || []).map((tier: any) => ({ fromValue: tier.from_value_cents, toValue: tier.to_value_cents, rate: Number(tier.rate), fixedComponent: tier.fixed_component_cents }));
    const calculation = new FranchiseFeeCalculator().calculate(basis.basisAmount, { method: rule.calculation_method, rate: Number(rule.rate || 0), fixedAmount: rule.fixed_amount_cents, minimumAmount: rule.minimum_amount_cents, maximumAmount: rule.maximum_amount_cents, tiers, safeFormulaKey: rule.safe_formula_key });
    const exemption = (exemptions || []).find((item: any) => !item.rule_id || item.rule_id === rule.id), exempted = exemptionAmount(calculation.finalAmount, exemption), finalAmount = Math.max(0, calculation.finalAmount - exempted);
    const snapshot = { ruleVersion: rule.version, basisPolicyVersion: policy.version, metric: policy.metric_id, components: basis, calculation, exemption: exemption ? { id: exemption.id, type: exemption.exemption_type, amountCents: exempted } : null, timezone: policy.timezone || profile.establishments.timezone, recognitionPolicy: policy.recognition_policy }, calculationHash = hash(snapshot);
    const { data: assessment, error } = await admin.from("franchise_fee_assessments").upsert({ organization_id: job.organization_id, assessment_period_id: period.id, fee_rule_id: rule.id, basis_amount_cents: calculation.basisAmount, rate: rule.rate, calculated_amount_cents: calculation.calculatedAmount, adjustment_amount_cents: -exempted, final_amount_cents: finalAmount, calculation_snapshot: snapshot, calculation_hash: calculationHash, status: "review" }, { onConflict: "assessment_period_id,fee_rule_id,calculation_hash" }).select().single();
    if (error) throw error;
    created.push({ ...assessment, fee_type: rule.fee_type });
    if (rule.fee_type === "marketing_fund") { const fund = (funds || []).sort((a: any, b: any) => Number(b.region_id === profile.region_id) - Number(a.region_id === profile.region_id) || Number(b.brand_id === profile.brand_id) - Number(a.brand_id === profile.brand_id))[0]; if (fund) await admin.from("marketing_fund_contributions").upsert({ organization_id: job.organization_id, fund_id: fund.id, profile_id: profile.id, assessment_id: assessment.id, amount_cents: finalAmount, period_start: payload.period_start, period_end: payload.period_end, status: "assessed" }, { onConflict: "fund_id,assessment_id" }); }
  }
  const standalone = (adjustments || []).filter((item: any) => !item.assessment_id), adjustmentNet = standalone.reduce((sum: number, item: any) => sum + adjustmentSign(item.adjustment_type) * Number(item.amount_cents || 0), 0), assessedTotal = created.reduce((sum: number, item: any) => sum + Number(item.final_amount_cents), 0), netDue = Math.max(0, assessedTotal + adjustmentNet);
  await admin.from("franchise_assessment_periods").update({ status: "review", calculated_at: new Date().toISOString(), calculation_hash: hash(created.map((item: any) => item.calculation_hash)), updated_at: new Date().toISOString() }).eq("id", period.id);
  await admin.from("franchise_settlements").upsert({ organization_id: job.organization_id, profile_id: profile.id, assessment_period_id: period.id, total_due_cents: assessedTotal + Math.max(0, adjustmentNet), credits_cents: Math.max(0, -adjustmentNet), net_due_cents: netDue, due_date: new Date(Date.parse(payload.period_end) + Number(profile.settlement_terms?.due_days || 10) * 86_400_000).toISOString().slice(0, 10), status: "draft" }, { onConflict: "assessment_period_id" });
  if (standalone.length) await admin.from("franchise_adjustments").update({ status: "applied" }).in("id", standalone.map((item: any) => item.id));
  return { period_id: period.id, assessments: created.length, total_due_cents: netDue, adjustments_cents: adjustmentNet, quality };
}

async function processJob(admin: any, job: any) {
  if (job.job_type === "calculate_period") return calculate(admin, job);
  if (job.job_type === "network_close") { const ids = job.payload.profile_ids?.length ? job.payload.profile_ids : (await admin.from("franchise_financial_profiles").select("id").eq("organization_id", job.organization_id).eq("status", "active")).data?.map((item: any) => item.id) || []; await admin.from("franchise_finance_jobs").upsert(ids.map((id: string) => ({ organization_id: job.organization_id, profile_id: id, job_type: "calculate_period", payload: { period_start: job.payload.period_start, period_end: job.payload.period_end }, idempotency_key: `calculate:${id}:${job.payload.period_start}:${job.payload.period_end}` })), { onConflict: "organization_id,idempotency_key" }); return { queued: ids.length, closePerStore: true }; }
  if (job.job_type === "generate_statement") { const [{ data: period }, { data: assessments }, { data: settlement }, { data: ledger }, { data: last }] = await Promise.all([admin.from("franchise_assessment_periods").select("*").eq("id", job.period_id).single(), admin.from("franchise_fee_assessments").select("*,franchise_fee_rules(fee_type,calculation_method)").eq("assessment_period_id", job.period_id), admin.from("franchise_settlements").select("*").eq("assessment_period_id", job.period_id).maybeSingle(), admin.from("franchise_financial_ledger").select("*").eq("profile_id", job.profile_id).order("occurred_at"), admin.from("franchise_statements").select("version").eq("profile_id", job.profile_id).eq("period_id", job.period_id).order("version", { ascending: false }).limit(1).maybeSingle()]), snapshot = { period, assessments, settlement, ledger, documentLabel: "Extrato de Fechamento — controle gerencial", fiscalDocument: false }, { data: statement } = await admin.from("franchise_statements").insert({ organization_id: job.organization_id, profile_id: job.profile_id, period_id: job.period_id, version: Number(last?.version || 0) + 1, status: "generated", snapshot }).select().single(); return { statement_id: statement.id, version: statement.version }; }
  if (job.job_type === "forecast") { const { data: rows } = await admin.from("forecast_predictions").select("final_operational_forecast,confidence_level").eq("organization_id", job.organization_id); return { forecast: new FranchiseRevenueForecastService().project((rows || []).map((item: any) => ({ basisForecastCents: Number(item.final_operational_forecast || 0), rate: Number(job.payload.rate || 0), confidence: item.confidence_level || "low" }))), recognizedRevenue: false }; }
  return { skipped: true };
}

export async function POST(request: Request) {
  const secret = process.env.FRANCHISE_FINANCE_WORKER_SECRET || process.env.AUTOMATION_WORKER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const worker = workerId();
  const admin = createAdminClient(), { data: jobs, error } = await admin.rpc("claim_franchise_finance_jobs", { requested_worker: worker, requested_limit: 10 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const result = [];
  for (const job of jobs || []) try { const value = await processJob(admin, job); await admin.from("franchise_finance_jobs").update({ status: "completed", result: value, completed_at: new Date().toISOString(), locked_at: null, locked_by: null }).eq("id", job.id); result.push({ id: job.id, status: "completed" }); } catch (caught: any) { const dead = Number(job.attempts) >= Number(job.max_attempts); await admin.from("franchise_finance_jobs").update({ status: dead ? "dead_letter" : "retrying", error_message: String(caught?.message || caught).slice(0, 1000), available_at: new Date(Date.now() + Math.min(60, 2 ** Number(job.attempts || 1)) * 60_000).toISOString(), locked_at: null, locked_by: null }).eq("id", job.id); result.push({ id: job.id, status: dead ? "dead_letter" : "retrying" }); }
  return NextResponse.json({ processed: result.length, result });
}
