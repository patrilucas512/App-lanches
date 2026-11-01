// Real database check of Phase 57 flows on masterapp-dev. It refuses any other project and only touches fictitious users.
// Usage: node scripts/dev/comms-smoke.mjs
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { acknowledge, acknowledgementSummary, markOpened, myFeed, pendingPeople } from "../../lib/internal-communications/acknowledgements.ts";
import { completeEmergencyReview, createDraft, decideApproval, editAnnouncement, publishAnnouncement, publishDueAnnouncements, retractAnnouncement, scheduleAnnouncement, submitForApproval } from "../../lib/internal-communications/announcements.ts";
import { boardFor, createBoardPost, createPoll, pollsFor, vote } from "../../lib/internal-communications/board.ts";
import { COMMS_FLAGS, COMMS_PERMISSIONS } from "../../lib/internal-communications/core.ts";
import { draftFromAutomation, draftFromIncident, draftFromRecall, linkPublishedToIncidents, proposeFromContinuity } from "../../lib/internal-communications/crisis.ts";
import { commsDashboard } from "../../lib/internal-communications/dashboard.ts";
import { reconcileLateJoiners, runDelivery, scanAcknowledgements } from "../../lib/internal-communications/delivery.ts";
import { commsReportRows } from "../../lib/internal-communications/integrations.ts";
import { attachmentLink, requestAttachmentUpload } from "../../lib/internal-communications/templates.ts";
import { safeNotificationEvent } from "../../lib/notifications/core.ts";

const DEV_REF = "bfmrcvjxbmxxmdustrgo";
const env = parseEnv(readFileSync(".env.local", "utf8"));
if (!(env.NEXT_PUBLIC_SUPABASE_URL || "").includes(DEV_REF)) throw new Error("Este script só roda no masterapp-dev.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` :: ${detail}`}`); };
const must = ({ data, error }, step) => { if (error) throw new Error(`${step}: ${error.message}`); return data; };
const refuses = async (name, run, pattern) => { try { await run(); check(name, false, "não recusou"); } catch (error) { check(name, pattern.test(error.message), error.message); } };

const { id: store, organization_id: org } = must(await admin.from("establishments").select("id,organization_id").eq("slug", "lanchonete-teste").single(), "ler loja");
const { users } = must(await admin.auth.admin.listUsers(), "listar usuários");
const owner = users.find((x) => x.email === "dono.teste@masterapp-dev.test").id;
async function ensureUser(label) {
  const email = `comms.${label}@masterapp-dev.test`, found = users.find((x) => x.email === email);
  if (found) return found.id;
  return must(await admin.auth.admin.createUser({ email, password: `Dev-${randomBytes(18).toString("base64url")}`, email_confirm: true }), `criar ${label}`).user.id;
}
const [approver, worker, late] = [await ensureUser("aprovador"), await ensureUser("funcionario"), await ensureUser("novato")];
// Starts each run without the novato: the late joiner path really runs, and the plan limit on staff stays free.
await admin.from("establishment_members").delete().eq("establishment_id", store).eq("user_id", late);
must(await admin.from("organization_members").upsert({ organization_id: org, user_id: approver, role: "admin", active: true }, { onConflict: "organization_id,user_id" }), "aprovador");
must(await admin.from("establishment_members").upsert({ establishment_id: store, user_id: worker, role: "attendant", status: "active" }, { onConflict: "establishment_id,user_id" }), "funcionário");
must(await admin.from("store_feature_flags").upsert({ establishment_id: store, ...Object.fromEntries(COMMS_FLAGS.map((x) => [x, true])) }, { onConflict: "establishment_id" }), "flags");
must(await admin.from("comms_settings").upsert({ organization_id: org, emergency_publish_allowed: true, board_comments_enabled: true, poll_minimum_responses: 3 }, { onConflict: "organization_id" }), "configurar");

const notify = async (client, input) => {
  const safe = safeNotificationEvent(input); delete safe.correlation_id;
  const { data: existing } = await client.from("notification_inbox_items").select("id").eq("organization_id", safe.organization_id).eq("dedup_key", safe.dedup_key).not("status", "in", '("resolved","dismissed","expired")').maybeSingle();
  if (existing) return { item: existing };
  return { item: must(await client.from("notification_inbox_items").insert(safe).select("id").single(), "inbox") };
};
const ctx = (actorId, permissions = [...COMMS_PERMISSIONS]) => ({ admin, organizationId: org, storeId: store, storeIds: [store], allStores: true, actorId, permissions, flags: Object.fromEntries(COMMS_FLAGS.map((x) => [x, true])), notify });
const STORE = { scope: { type: "store", ids: [store] } }, ORG = { scope: { type: "organization", ids: [] } };
const stamp = Date.now(), title = (x) => `Smoke ${stamp} ${x}`;

const plain = (await createDraft(ctx(owner), { title: title("simples"), body: "Texto do comunicado da loja.", audience: STORE, priority: "mandatory" })).announcement;
check("rascunho grava na tabela da Fase 46", plain.status === "draft" && plain.scope_type === "store" && plain.acknowledgement_required === true, JSON.stringify(plain));
const published = await publishAnnouncement(ctx(owner), { id: plain.id });
check("publicar resolve o público real", published.recipients >= 2, published.recipients);
const snapshot = must(await admin.from("network_announcement_recipients").select("user_id,state,delivery_status").eq("announcement_id", plain.id), "ler público");
check("o público inclui o funcionário", snapshot.some((x) => x.user_id === worker));
const delivered = await runDelivery({ admin, notify }, plain.id);
check("entrega pela Fase 52", delivered.sent >= 2 && delivered.failed === 0, JSON.stringify(delivered));
const inbox = must(await admin.from("notification_inbox_items").select("id,priority,requires_action,route,status").eq("source_id", plain.id).eq("recipient_user_id", worker).maybeSingle(), "ler inbox");
check("item real no inbox, com ação obrigatória", inbox?.requires_action === true && inbox.priority === "high" && inbox.route.includes(plain.id), JSON.stringify(inbox));
const feed = await myFeed(ctx(worker, []));
check("aparece no feed do funcionário", feed.items.some((x) => x.id === plain.id) && feed.mandatoryPending >= 1);
await markOpened(ctx(worker, []), { id: plain.id });
await acknowledge(ctx(worker, []), { id: plain.id });
const ack = must(await admin.from("network_announcement_acknowledgements").select("version,store_id").eq("announcement_id", plain.id).eq("user_id", worker).single(), "ler confirmação");
check("confirmação grava na tabela da Fase 46, com versão", ack.version === 1 && ack.store_id === store, JSON.stringify(ack));
const resolved = must(await admin.from("notification_inbox_items").select("status").eq("id", inbox.id).single(), "ler inbox");
check("confirmar resolve o item do inbox", resolved.status === "resolved", resolved.status);
const reach = must(await admin.from("fact_comms_reach").select("*").eq("announcement_id", plain.id), "ler alcance");
check("view agregada responde e não tem coluna de pessoa", reach.length === 1 && reach[0].acknowledged === 1 && !("user_id" in reach[0]), JSON.stringify(reach));
const pending = await pendingPeople(ctx(owner), { id: plain.id });
check("lista nominal só de quem falta", pending.pending.length >= 1 && pending.pending.every((x) => "name" in x && !("user_id" in x)));
const trail = must(await admin.from("comms_audit_events").select("action").eq("resource_id", plain.id), "ler auditoria").map((x) => x.action);
check("auditoria registra publicação e consulta nominal", trail.includes("published") && trail.includes("ack_status_viewed"), trail.join(","));
const summary = await acknowledgementSummary(ctx(owner), { id: plain.id });
check("resumo por unidade", summary.units.length === 1 && summary.units[0].acknowledged === 1);

const edited = await editAnnouncement(ctx(owner), { id: plain.id, body: "Texto mudou para valer a partir das 18 horas.", note: "Novo horário" });
check("edição relevante gera versão e pede nova confirmação", edited.version === 2 && edited.requiresNewAck === true, JSON.stringify(edited));
const again = must(await admin.from("network_announcement_recipients").select("state,required_version").eq("announcement_id", plain.id).eq("user_id", worker).single(), "ler recibo");
check("recibo volta a esperar a confirmação", again.state === "delivered" && again.required_version === 2, JSON.stringify(again));
const { error: rewrite } = await admin.from("network_announcement_versions").update({ title: "adulterado" }).eq("announcement_id", plain.id);
check("histórico de versões é imutável no banco", /COMMS_HISTORY_IMMUTABLE/.test(rewrite?.message || ""), rewrite?.message);
const { error: rewriteAudit } = await admin.from("comms_audit_events").delete().eq("resource_id", plain.id);
check("auditoria é imutável no banco", /COMMS_HISTORY_IMMUTABLE/.test(rewriteAudit?.message || ""), rewriteAudit?.message);

must(await admin.from("establishment_members").insert({ establishment_id: store, user_id: late, role: "kitchen", status: "active" }), "novato");
const added = await reconcileLateJoiners({ admin }, org);
const lateRow = must(await admin.from("network_announcement_recipients").select("source,ack_due_at").eq("announcement_id", plain.id).eq("user_id", late).maybeSingle(), "ler novato");
check("quem entra depois recebe o que ainda vale", added >= 1 && lateRow?.source === "late_joiner" && Boolean(lateRow.ack_due_at), JSON.stringify(lateRow));

const network = (await createDraft(ctx(owner), { title: title("política"), body: "Nova política para a rede inteira.", audience: ORG, type: "policy", priority: "important" })).announcement;
await refuses("política não publica sem aprovação", () => publishAnnouncement(ctx(owner), { id: network.id }), /APPROVAL_REQUIRED/);
const submitted = await submitForApproval(ctx(owner), { id: network.id });
const approval = must(await admin.from("internal_approvals").select("status,source_type,approval_type").eq("id", submitted.announcement.approval_id).single(), "ler aprovação");
check("aprovação nas tabelas da Fase 32", approval.status === "pending" && approval.source_type === "network_announcement", JSON.stringify(approval));
await refuses("autor não aprova o próprio comunicado", () => decideApproval(ctx(owner), { id: network.id, decision: "approved", reason: "Tentativa" }), /SELF_APPROVAL_BLOCKED/);
const decided = await decideApproval(ctx(approver), { id: network.id, decision: "approved", reason: "Conferido no teste" });
check("aprovado por outra pessoa", decided.announcement.status === "approved", decided.announcement.status);
const networkOut = await publishAnnouncement(ctx(owner), { id: network.id });
check("publica depois de aprovado", networkOut.announcement.status === "published");
await runDelivery({ admin, notify }, network.id);
const retracted = await retractAnnouncement(ctx(owner), { id: network.id, reason: "Texto errado no teste", correction: "Vale o texto anterior." });
check("retratação mantém o texto", retracted.announcement.status === "retracted" && retracted.announcement.body.includes("Nova política"));
const notice = await runDelivery({ admin, notify }, network.id);
check("retratação avisa quem recebeu", notice.sent >= 1, JSON.stringify(notice));

const due = (await createDraft(ctx(owner), { title: title("agendado"), body: "Texto agendado para a loja.", audience: STORE })).announcement;
await scheduleAnnouncement(ctx(owner), { id: due.id, publishAt: new Date(Date.now() + 36e5).toISOString() });
const later = await publishDueAnnouncements(ctx(owner), new Date(Date.now() + 72e5));
check("agendado publica pelo mesmo caminho", later.some((x) => x.id === due.id && x.ok), JSON.stringify(later));

const incident = must(await admin.from("operational_incidents").insert({ organization_id: org, store_id: store, incident_number: `INC-SMOKE-${stamp}`, title: "Queda de energia de teste", summary: "Teste", category: "system", severity: "SEV3", status: "detected", visibility: "operational", source_type: "manual", idempotency_key: `smoke:${stamp}`, owner_user_id: owner, created_by: owner, detected_at: new Date().toISOString() }).select().single(), "criar incidente");
const fromIncident = await draftFromIncident({ admin, organizationId: org, actorId: owner, storeId: store, incident });
const relation = must(await admin.from("incident_relations").select("entity_id").eq("incident_id", incident.id).eq("entity_type", "internal_communication"), "ler relação");
check("incidente cria rascunho canônico com a relação da Fase 59", fromIncident.announcement.status === "draft" && relation[0]?.entity_id === fromIncident.announcement.id, JSON.stringify(relation));
const crisis = await publishAnnouncement(ctx(owner), { id: fromIncident.announcement.id, emergency: true, reason: "Risco imediato para as equipes no teste" });
check("emergência publica e deixa revisão pendente", crisis.emergency === true && Boolean(crisis.announcement.review_due_at));
const job = must(await admin.from("comms_jobs").select("priority").eq("announcement_id", fromIncident.announcement.id).single(), "ler fila");
check("crise entra com prioridade na fila", job.priority === 100, job.priority);
await new Promise((resolve) => setTimeout(resolve, 500));
const timeline = must(await admin.from("incident_timeline_events").select("event_type,source_id").eq("incident_id", incident.id).eq("event_type", "communication_sent"), "ler timeline");
check("linha do tempo do incidente mostra o comunicado", timeline.some((x) => x.source_id === fromIncident.announcement.id), JSON.stringify(timeline));
await refuses("quem publicou não revisa a própria emergência", () => completeEmergencyReview(ctx(owner), { id: fromIncident.announcement.id, notes: "Revisão" }), /SELF_APPROVAL_BLOCKED/);
check("outra pessoa revisa a emergência", Boolean((await completeEmergencyReview(ctx(approver), { id: fromIncident.announcement.id, notes: "Revisado no teste" })).announcement.reviewed_at));
void linkPublishedToIncidents;

const proposal = await proposeFromContinuity({ admin, organizationId: org, actorId: owner, storeId: store, notify, activation: { id: `11111111-1111-4111-8111-${String(stamp).slice(-12).padStart(12, "0")}`, plan_id: "22222222-2222-4222-8222-222222222222", activation_reason: "Teste" }, plan: { name: "Plano de teste", communication_plan: {} } });
check("plano de continuidade só propõe, e fica em aprovação", proposal.announcement.status === "pending_approval", proposal.announcement.status);
const recall = await draftFromRecall({ admin, organizationId: org, actorId: owner, storeId: store, recall: { id: `33333333-3333-4333-8333-${String(stamp).slice(-12).padStart(12, "0")}`, title: "Molho de teste" }, storeIds: [store] });
check("recall cria rascunho com prazo curto", recall.announcement.announcement_type === "recall_food_safety" && Date.parse(recall.announcement.ack_deadline) - Date.now() <= 864e5);
const automated = await draftFromAutomation({ admin, organizationId: org, storeId: store, ownerUserId: owner, actionType: "knowledge_create_communication_draft", executionId: `ex-${stamp}`, nodeId: "n1", inputs: { title: title("automação"), body: "Rascunho da base de conhecimento.", source_id: "artigo" } });
check("ação de copiloto cria rascunho real", automated.status === "draft" && automated.related_refs.sop[0] === "artigo", JSON.stringify(automated.related_refs));

const { poll } = await createPoll(ctx(owner), { question: title("Enquete?"), options: ["Sim", "Não"], audience: STORE });
const options = must(await admin.from("comms_poll_options").select("id").eq("poll_id", poll.id).order("position"), "ler opções");
await vote(ctx(worker, []), { pollId: poll.id, optionId: options[0].id });
await refuses("voto não repete", () => vote(ctx(worker, []), { pollId: poll.id, optionId: options[0].id }), /ALREADY_VOTED/);
const row = must(await admin.from("comms_poll_responses").select("*").eq("poll_id", poll.id), "ler respostas")[0];
check("resposta anônima não guarda pessoa nem hora", row.identified_user_id === null && !("created_at" in row), JSON.stringify(row));
const shown = (await pollsFor(ctx(owner))).find((x) => x.id === poll.id);
check("abaixo do mínimo não mostra resultado", shown.results.status === "insufficient_responses" && shown.results.options.every((x) => x.count === null), JSON.stringify(shown.results));

const withFile = (await createDraft(ctx(owner), { title: title("anexo"), body: "Comunicado com anexo.", audience: STORE })).announcement;
const upload = await requestAttachmentUpload(ctx(owner), { id: withFile.id, fileName: "aviso.pdf", mimeType: "application/pdf", sizeBytes: 5 });
const put = await fetch(upload.uploadUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: "%PDF-" });
check("anexo sobe para o bucket privado", put.ok, put.status);
await publishAnnouncement(ctx(owner), { id: withFile.id });
const link = await attachmentLink(ctx(worker, []), { attachmentId: upload.attachment.id });
check("quem recebeu abre o anexo", (await fetch(link.url)).ok);
await refuses("quem está fora do público não abre o anexo", () => attachmentLink({ ...ctx(approver, []), allStores: false, storeIds: [] }, { attachmentId: upload.attachment.id }), /ATTACHMENT_NOT_FOUND/);
await createBoardPost(ctx(owner), { title: title("aviso"), body: "Aviso rápido no mural.", post_type: "quick_notice" });
const board = await boardFor(ctx(worker, []));
check("mural mostra o aviso da unidade", board.some((x) => x.title === title("aviso")));
const dashboard = await commsDashboard(ctx(owner));
check("painel responde com os cards", dashboard.cards.active >= 1 && dashboard.templates.length >= 6, JSON.stringify(dashboard.cards));
const report = await commsReportRows({ a: admin, organizationId: org, storeIds: [store] }, { datasetId: "announcement_acknowledgements" }, { from: "2026-01-01", to: "2027-12-31" }, 100);
check("relatório sem nomes", report.rows.length >= 1 && !JSON.stringify(report.rows).includes(worker), report.rows.length);
const scan = await scanAcknowledgements({ admin, notify }, org);
check("varredura de lembretes roda no banco real", typeof scan.reminded === "number", JSON.stringify(scan));
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
for (const table of ["network_announcements", "network_announcement_recipients", "comms_settings", "comms_poll_responses", "comms_audit_events", "fact_comms_reach"]) {
  const { data, error } = await anon.from(table).select("*").limit(1);
  check(`${table} fechado para cliente`, Boolean(error) || !(data || []).length, JSON.stringify(data));
}
const access = must(await admin.rpc("rbac_set_module_permission", { requested_organization_id: org, requested_user_id: worker, requested_module: "comms", requested_permission_key: "comms:view_ack_status", requested_active: true }), "conceder");
const effective = must(await admin.rpc("rbac_read_effective_access", { requested_organization_id: org, requested_user_id: worker }), "ler acesso");
check("Fase 93 concede e lê a permissão comms", access.active === true && effective.module_permissions.some((x) => x.module === "comms"), JSON.stringify(effective.module_permissions));
must(await admin.rpc("rbac_set_module_permission", { requested_organization_id: org, requested_user_id: worker, requested_module: "comms", requested_permission_key: "comms:view_ack_status", requested_active: false }), "revogar");
await admin.from("establishment_members").delete().eq("establishment_id", store).eq("user_id", late);
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length} de ${results.length} verificações passaram.`);
process.exit(failed.length ? 1 : 0);
