// Real database check of Phase 38 flows on masterapp-dev. It refuses any other project and only creates fictitious data.
// Usage: node scripts/dev/cx-smoke.mjs
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { cxDashboard, experienceReportRows, runCxJob, semanticExperienceMetric, slaScan } from "../../lib/customer-experience/dashboard.ts";
import { cxCopilot } from "../../lib/customer-experience/integrations.ts";
import { decideCompensation, openCaseManually, recordRecoveryAction, setCaseStatus } from "../../lib/customer-experience/recovery.ts";
import { createDraft, decideResponse, ensureTemplates } from "../../lib/customer-experience/responses.ts";
import { logStaffFeedback, reviewRiskSignal } from "../../lib/customer-experience/server.ts";
import { createSurveyLink, hashToken, processDispatch } from "../../lib/customer-experience/surveys.ts";
import { CX_PERMISSIONS } from "../../lib/customer-experience/core.ts";
import { safeNotificationEvent } from "../../lib/notifications/core.ts";

const DEV_REF = "bfmrcvjxbmxxmdustrgo";
const env = parseEnv(readFileSync(".env.local", "utf8"));
if (!(env.NEXT_PUBLIC_SUPABASE_URL || "").includes(DEV_REF)) throw new Error("Este script só roda no masterapp-dev.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: ok ? "" : String(detail) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` :: ${detail}`}`); };
const must = ({ data, error }, step) => { if (error) throw new Error(`${step}: ${error.message}`); return data; };
const refuses = async (name, run, pattern) => { try { const r = await run(); const error = r?.error; if (error) check(name, pattern.test(error.message), error.message); else check(name, false, "não recusou"); } catch (error) { check(name, pattern.test(error.message), error.message); } };
const step = async (name, run) => { try { return await run(); } catch (error) { check(name, false, error.message); return null; } };
const notify = async (db, input) => { const { correlation_id: _unused, ...safe } = safeNotificationEvent(input); const existing = await db.from("notification_inbox_items").select("id").eq("organization_id", safe.organization_id).eq("dedup_key", safe.dedup_key).maybeSingle(); if (!existing.data) must(await db.from("notification_inbox_items").insert(safe), "notificação"); };

const store = must(await admin.from("establishments").select("id,organization_id,slug").eq("slug", "lanchonete-teste").single(), "loja");
const owner = must(await admin.from("establishment_members").select("user_id").eq("establishment_id", store.id).eq("role", "owner").limit(1).single(), "dono").user_id;
const other = (await admin.from("profiles").select("id").neq("id", owner).limit(1).maybeSingle()).data?.id || null;
const org = store.organization_id, tag = randomUUID().slice(0, 8);
const ctx = { admin, organizationId: org, storeId: store.id, storeIds: [store.id], actorId: owner, permissions: [...CX_PERMISSIONS], flags: {}, notify };

must(await admin.from("store_feature_flags").upsert({ establishment_id: store.id, customer_experience_enabled: true, cx_surveys_enabled: true, cx_external_reviews_enabled: true, cx_service_recovery_enabled: true }, { onConflict: "establishment_id" }), "flags");
must(await admin.from("cx_settings").upsert({ organization_id: org, minimum_sample: 2, updated_at: new Date().toISOString() }, { onConflict: "organization_id" }), "configurações");
await admin.from("cx_survey_definitions").update({ status: "retired" }).eq("organization_id", org).in("status", ["active"]);
const nps = must(await admin.from("cx_survey_definitions").insert({ organization_id: org, key: `smoke_${tag}`, name: "Pós-retirada", survey_type: "nps", scale: "0-10", questions: [{ id: "score", text: "De 0 a 10, o quanto você recomendaria esta loja?" }, { id: "comment", text: "Quer contar o motivo? (opcional)", optional: true }], trigger_type: "order_picked_up", delay_minutes: 0, channels: ["whatsapp", "qr_table", "receipt_link"], status: "active", created_by: owner }).select().single(), "pesquisa");

const newCustomer = async suffix => must(await admin.from("customers").insert({ establishment_id: store.id, name: `Cliente Fictício ${suffix}`, phone: `5511${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}` }).select("id").single(), "cliente").id;
const submit = (token, score, comment, source = "qr_table") => admin.rpc("cx_submit_survey_response", { requested_slug: store.slug, requested_token_hash: token ? hashToken(token) : null, requested_source: source, requested_score: score, requested_comment: comment, requested_dimensions: null, requested_items: null, requested_requester_hash: `smoke-${tag}` });
const jobsFor = async feedbackId => must(await admin.from("cx_jobs").select("*").eq("organization_id", org).eq("job_type", "analyze_feedback").contains("payload", { feedback_id: feedbackId }).eq("status", "queued"), "fila");
const runJobs = async feedbackId => { for (const job of await jobsFor(feedbackId)) { await runCxJob({ admin, notify }, job); await admin.from("cx_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job.id); } };

// Order triggers are not exercised here: orders cannot be inserted on this project while orders_saas_usage writes usage_events without event_type.
const dispatchFor = async customerId => must(await admin.from("cx_survey_dispatches").insert({ organization_id: org, store_id: store.id, definition_id: nps.id, definition_version: nps.version, customer_id: customerId, trigger_type: "manual", channel: "whatsapp", idempotency_key: `smoke:${randomUUID()}`, expires_at: new Date(Date.now() + 864e5).toISOString() }).select("*").single(), "disparo");
const customerA = await newCustomer(`A ${tag}`);
const skipped = await processDispatch({ admin, siteUrl: "https://dev.test", send: async () => { throw new Error("não deveria enviar"); } }, await dispatchFor(customerA));
check("sem contato a pesquisa é pulada", skipped.skip_reason === "no_contact", JSON.stringify(skipped));

// Consent on real rows
const customerC = await newCustomer(`C ${tag}`);
must(await admin.from("whatsapp_contacts").insert({ establishment_id: store.id, wa_id: `55119${tag}`, phone_number: `55119${tag}`, customer_id: customerC, marketing_opt_out: true, last_message_at: new Date().toISOString() }).select("id").single(), "contato");
const sent = []; await admin.from("cx_settings").update({ quiet_start_hour: 0, quiet_end_hour: 0 }).eq("organization_id", org);
const optOut = await processDispatch({ admin, siteUrl: "https://dev.test", send: async x => sent.push(x) }, await dispatchFor(customerC));
check("opt-out real bloqueia o envio", optOut.skip_reason === "opt_out" && sent.length === 0, JSON.stringify(optOut));

// Token link, risk comment, full pipeline
const customerB = await newCustomer(`B ${tag}`);
const linkA = await createSurveyLink(ctx, { definitionId: nps.id, channel: "receipt_link", customerId: customerB, siteUrl: "https://dev.test" }), token = new URL(linkA.url).searchParams.get("t");
check("link guarda só o hash do token", !JSON.stringify(must(await admin.from("cx_survey_dispatches").select("*").eq("customer_id", customerB), "disparo")).includes(token));
const portalView = must(await admin.rpc("cx_get_public_survey", { requested_slug: store.slug, requested_token_hash: hashToken(token), requested_source: "whatsapp" }), "pesquisa pública");
check("página pública lê a pesquisa", portalView?.survey?.scale === "0-10" && portalView.state === "open", JSON.stringify(portalView));
await refuses("nota fora da escala é recusada", () => submit(token, 11, ""), /CX_SCORE_INVALID/);
const answered = must(await submit(token, 2, "Passei mal depois de comer e a comida estava fria. Meu telefone é 11 91234-5678", "whatsapp"), "responder");
check("resposta identifica detrator", answered.detractor === true && answered.identified === true, JSON.stringify(answered));
const feedback = must(await admin.from("crm_feedback").select("*").eq("id", answered.feedback_id).single(), "feedback");
check("canal vem do link, não da página", feedback.source === "receipt_link" && feedback.scale === "0-10" && feedback.rating === null && Number(feedback.score) === 2, JSON.stringify({ s: feedback.source, r: feedback.rating }));
await refuses("link não responde duas vezes", () => submit(token, 9, ""), /CX_ALREADY_ANSWERED/);
check("resposta enfileira a análise", (await jobsFor(feedback.id)).length === 1);
await runJobs(feedback.id);
const [signals, topics, analysis, cases] = await Promise.all([admin.from("cx_risk_signals").select("*").eq("feedback_id", feedback.id), admin.from("cx_feedback_topics").select("*").eq("feedback_id", feedback.id), admin.from("cx_feedback_analysis").select("*").eq("feedback_id", feedback.id).maybeSingle(), admin.from("service_recovery_cases").select("*").eq("feedback_id", feedback.id)]);
const signal = signals.data?.find(x => x.signal_type === "food_poisoning");
check("sinal de risco fica aguardando revisão", signal?.status === "pending_review" && Boolean(signal?.excerpt), JSON.stringify(signals.data));
check("trecho do sinal mascara o telefone", signal && !signal.excerpt.includes("91234"), signal?.excerpt);
check("sinal abre incidente e não conformidade", Boolean(signal?.incident_id && signal?.nonconformity_id), JSON.stringify(signal));
const incident = signal?.incident_id ? must(await admin.from("operational_incidents").select("*").eq("id", signal.incident_id).single(), "incidente") : null;
check("incidente aguarda humano e não copia o telefone", incident?.status === "detected" && incident?.created_by === null && !JSON.stringify(incident).includes("91234"), JSON.stringify(incident));
check("tema tem trecho explicável", topics.data?.some(x => x.topic_key === "temperature" && x.excerpt), JSON.stringify(topics.data));
check("sentimento gravado com confiança", analysis.data?.sentiment === "negative" && analysis.data?.confidence, JSON.stringify(analysis.data));
check("detrator abre caso de recuperação", cases.data?.length === 1, JSON.stringify(cases.data));
check("nenhum reembolso nasce sozinho", must(await admin.from("service_recovery_actions").select("id").eq("case_id", cases.data?.[0]?.id), "ações").length === 0);
const events = must(await admin.from("automation_event_inbox").select("event_name,payload").eq("aggregate_id", feedback.id), "eventos");
check("eventos de automação entregues", events.some(x => x.event_name === "cx.detractor_received") && events.some(x => x.event_name === "cx.feedback_received"), JSON.stringify(events));
check("evento neutro não leva a nota", !JSON.stringify(events.find(x => x.event_name === "cx.feedback_received")?.payload || {}).includes("score"));
check("notificação registrada", must(await admin.from("notification_inbox_items").select("id").eq("organization_id", org).eq("source_id", signal?.id || "").limit(1), "notificações").length >= 1);
await step("reanálise", () => runCxJob({ admin, notify }, { job_type: "analyze_feedback", organization_id: org, payload: { feedback_id: feedback.id } }));
check("reprocessar não duplica ocorrência", must(await admin.from("operational_incidents").select("id").eq("source_type", "customer_experience").eq("source_id", signal?.id || ""), "incidentes").length === 1);

// Legacy writers still work
const customerL = await newCustomer(`L ${tag}`);
const legacy = must(await admin.from("crm_feedback").insert({ establishment_id: store.id, customer_id: customerL }).select("*").single(), "pendência antiga");
check("gatilho preenche organização e origem", legacy.organization_id === org && legacy.source === "other" && legacy.scale === "1-5", JSON.stringify(legacy));
await admin.from("crm_feedback").update({ scale: "0-10", feedback_type: "nps" }).eq("id", legacy.id);
const rated = must(await admin.from("crm_feedback").update({ rating: 4, answered_at: new Date().toISOString() }).eq("id", legacy.id).select("*").single(), "portal responde pendência NPS");
check("portal responde pendência NPS sem erro", rated.scale === "1-5" && Number(rated.score) === 4 && rated.source === "customer_portal", JSON.stringify(rated));

// Anonymous QR, no gating
const anonymous = must(await submit(null, 10, "Atendimento excelente"), "QR");
check("QR anônimo aceito sem cliente nem pedido", anonymous.identified === false, JSON.stringify(anonymous));
must(await submit(null, 1, "Horrível"), "QR 2");

// Constraints
await refuses("banco recusa nota fora da escala", () => admin.from("crm_feedback").update({ score: 9 }).eq("id", "00000000-0000-0000-0000-000000000000").then(() => admin.from("crm_feedback").insert({ establishment_id: store.id, score: 11, scale: "0-10" })), /crm_feedback_score_scale_check/);
await refuses("banco recusa publicar sem aprovador", () => admin.from("review_responses").insert({ organization_id: org, store_id: store.id, feedback_id: feedback.id, draft: "Texto de teste", author_type: "human", channel: "internal_note", status: "published", published_at: new Date().toISOString() }), /check/);
await refuses("banco recusa publicação automática de IA", () => admin.from("review_responses").insert({ organization_id: org, store_id: store.id, feedback_id: feedback.id, draft: "Texto de teste", author_type: "ai", channel: "internal_note", status: "published", published_at: new Date().toISOString(), auto_policy: true }), /check/);
const auditRow = must(await admin.from("cx_audit_events").insert({ organization_id: org, action: "smoke", resource_type: "smoke" }).select("id").single(), "auditoria");
await refuses("auditoria é imutável", () => admin.from("cx_audit_events").delete().eq("id", auditRow.id), /CX_HISTORY_IMMUTABLE/);

// Responses
await ensureTemplates(ctx);
const draft = await createDraft(ctx, { feedbackId: feedback.id, channel: "internal_note" });
check("rascunho nasce aguardando aprovação", draft.status === "pending_approval" && draft.author_type === "template", JSON.stringify(draft));
const published = await decideResponse(ctx, { responseId: draft.id, decision: "approved" });
check("aprovação publica com aprovador", published.status === "published" && published.approved_by === owner, JSON.stringify(published));
check("primeira resposta marcada na caixa", Boolean(must(await admin.from("crm_feedback").select("first_responded_at").eq("id", feedback.id).single(), "feedback").first_responded_at));
const extDraft = await createDraft(ctx, { feedbackId: feedback.id, channel: "external_api" });
const failed = await decideResponse(ctx, { responseId: extDraft.id, decision: "approved" });
check("avaliação interna não publica em provedor", failed.status === "failed" && failed.failure_reason === "NOT_AN_EXTERNAL_REVIEW", JSON.stringify(failed));

// Recovery and compensation
const recoveryCase = cases.data?.[0] || await openCaseManually(ctx, { feedbackId: feedback.id, reason: "Teste" });
const refund = await recordRecoveryAction(ctx, { caseId: recoveryCase.id, actionType: "refund_partial", amountCents: 500, notes: "Teste" });
check("reembolso exige aprovação", refund.status === "requested", JSON.stringify(refund));
await refuses("quem pede não aprova", () => decideCompensation(ctx, { actionId: refund.id, decision: "approved", reason: "Teste" }), /SELF_APPROVAL_BLOCKED/);
if (other) { const approved = await decideCompensation({ ...ctx, actorId: other }, { actionId: refund.id, decision: "approved", reason: "Teste" }); check("reembolso aprovado não move dinheiro", approved.status === "awaiting_official_flow", JSON.stringify(approved)); await refuses("banco recusa autoaprovação", () => admin.from("service_recovery_actions").insert({ case_id: recoveryCase.id, organization_id: org, action_type: "coupon", status: "approved", decided_at: new Date().toISOString(), requested_by: owner, decided_by: owner }), /check/); } else check("segundo usuário disponível para aprovar", false, "sem outro usuário no dev");
await refuses("nota não pode pressionar o cliente", () => recordRecoveryAction(ctx, { caseId: recoveryCase.id, actionType: "human_contact", notes: "Pedi para apagar a avaliação" }), /PRESSURE_TO_CHANGE_REVIEW/);
const resolved = await setCaseStatus(ctx, { caseId: recoveryCase.id, status: "resolved", outcome: "resolved_with_customer", customerResponded: true });
check("caso concluído com resultado", resolved.status === "resolved" && resolved.customer_responded_at, JSON.stringify(resolved));
const scan = await slaScan({ admin, organizationId: org, notify });
check("varredura de prazos roda no banco real", typeof scan.overdueCases === "number", JSON.stringify(scan));

// Risk review
await refuses("revisão exige motivo", () => reviewRiskSignal(ctx, { signalId: signal.id, decision: "confirmed", reason: "" }), /REASON_REQUIRED/);
await refuses("outra organização não enxerga o sinal", () => reviewRiskSignal({ ...ctx, organizationId: randomUUID() }, { signalId: signal.id, decision: "confirmed", reason: "Motivo" }), /SIGNAL_NOT_FOUND/);
const reviewed = await reviewRiskSignal(ctx, { signalId: signal.id, decision: "confirmed", reason: "Confirmado no teste" });
check("revisão humana registrada", reviewed.status === "confirmed" && reviewed.reviewed_by === owner, JSON.stringify(reviewed));
const staff = await logStaffFeedback(ctx, { type: "complaint", comment: "Cliente reclamou da demora no balcão" });
check("equipe registra reclamação sem nota", Boolean(staff.id));

// Read models on the real schema
const from = new Date(Date.now() - 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const metric = await semanticExperienceMetric(admin, { metric: "nps", organizationId: org, storeIds: [store.id], from, to });
check("meta lê NPS real com denominador", metric.status === "ok" && typeof metric.actual === "number" && metric.responses >= 2 && metric.source === "fact_cx_feedback", JSON.stringify(metric));
const report = await experienceReportRows(admin, { organizationId: org, storeIds: [store.id], from, to, limit: 100 });
check("relatório entrega NPS por loja", report.some(x => x.nps_responses > 0 && x.minimum_sample === 2), JSON.stringify(report));
await admin.from("cx_settings").update({ minimum_sample: 100000 }).eq("organization_id", org);
const blocked = await semanticExperienceMetric(admin, { metric: "nps", organizationId: org, storeIds: [store.id], from, to });
check("amostra insuficiente não vira número", blocked.status === "insufficient_sample" && blocked.actual === null, JSON.stringify(blocked));
await admin.from("cx_settings").update({ minimum_sample: 2 }).eq("organization_id", org);
const board = await step("painel", () => cxDashboard(ctx, { days: 30 }));
check("painel carrega no banco real", Boolean(board?.cards) && board.inbox.length > 0 && board.recovery.length > 0, "");
if (board) { check("painel mostra NPS com respostas", board.cards.nps.responses >= 2, JSON.stringify(board.cards.nps)); const masked = await cxDashboard({ ...ctx, permissions: ["cx:view"] }, { days: 30 }); check("sem permissão sensível, nome e telefone somem", !JSON.stringify(masked.inbox).includes("91234") && !JSON.stringify(masked.inbox).includes("Cliente Fictício"), ""); check("copiloto responde só leitura", cxCopilot("getReputationOverview", board).canPublish === false); }

const failures = results.filter(x => !x.ok);
console.log(`\n${results.length - failures.length} de ${results.length} verificações passaram.`);
if (failures.length) process.exitCode = 1;
