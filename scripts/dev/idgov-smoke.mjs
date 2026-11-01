// Real database check of Phase 93 flows on masterapp-dev. It refuses any other project and only touches fictitious users.
// Usage: node scripts/dev/idgov-smoke.mjs
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { activateBreakGlass, closeBreakGlass, requestBreakGlass, reviewBreakGlass } from "../../lib/identity-governance/break-glass.ts";
import { governanceDashboard } from "../../lib/identity-governance/dashboard.ts";
import { executeSocRequest, reconcileAccess, refreshGovernanceInventory, scanFindings } from "../../lib/identity-governance/reconciliation.ts";
import { createAccessRequest, decideAccessRequest, processLeaver, revokeGrant } from "../../lib/identity-governance/requests.ts";
import { certifyCampaign, createReviewCampaign, decideReviewItem } from "../../lib/identity-governance/reviews.ts";
import { importBaseline, syncCatalog, syncIdentities } from "../../lib/identity-governance/server.ts";
import { identityContextForSoc } from "../../lib/identity-governance/soc-events.ts";
import { runDetectiveSod, seedSodRuleDrafts } from "../../lib/identity-governance/sod.ts";
import { activateJit, approveJit, requestJit, sweepExpirations } from "../../lib/identity-governance/temporary.ts";

const DEV_REF = "bfmrcvjxbmxxmdustrgo";
const env = parseEnv(readFileSync(".env.local", "utf8"));
if (!(env.NEXT_PUBLIC_SUPABASE_URL || "").includes(DEV_REF)) throw new Error("Este script só roda no masterapp-dev.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: ok ? "" : String(detail) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` :: ${detail}`}`); };
const must = ({ data, error }, step) => { if (error) throw new Error(`${step}: ${error.message}`); return data; };
const refuses = async (name, run, pattern) => { try { await run(); check(name, false, "não recusou"); } catch (error) { check(name, pattern.test(error.message), error.message); } };

const { id: store, organization_id: org } = must(await admin.from("establishments").select("id,organization_id").eq("slug", "lanchonete-teste").single(), "ler loja");
const { users } = must(await admin.auth.admin.listUsers(), "listar usuários");
const owner = users.find((x) => x.email === "dono.teste@masterapp-dev.test").id;
async function ensureUser(label) {
  const email = `idgov.${label}@masterapp-dev.test`, found = users.find((x) => x.email === email);
  if (found) { await admin.auth.admin.updateUserById(found.id, { ban_duration: "none" }); return found.id; }
  return must(await admin.auth.admin.createUser({ email, password: `Dev-${randomBytes(18).toString("base64url")}`, email_confirm: true }), `criar ${label}`).user.id;
}
const [approver, approver2, worker] = [await ensureUser("aprovador"), await ensureUser("aprovador2"), await ensureUser("funcionario")];
// Starts each run from the same place.
await admin.from("organization_members").upsert([{ organization_id: org, user_id: approver, role: "admin", active: true }, { organization_id: org, user_id: approver2, role: "admin", active: true }, { organization_id: org, user_id: worker, role: "member", active: true }], { onConflict: "organization_id,user_id" });
await admin.from("establishment_members").upsert({ establishment_id: store, user_id: worker, role: "attendant", status: "active" }, { onConflict: "establishment_id,user_id" });
await admin.from("store_feature_flags").upsert({ establishment_id: store, identity_governance_enabled: true, identity_jit_enabled: true, identity_break_glass_enabled: true, identity_sod_enabled: true, identity_access_reviews_enabled: true, identity_reconciliation_enabled: true, identity_ai_assistance_enabled: true }, { onConflict: "establishment_id" });
must(await admin.from("identity_governance_settings").upsert({ organization_id: org, require_mfa_for_privileged: false, break_glass_requires_incident: false }, { onConflict: "organization_id" }), "configurar");
const ctx = (actorId) => ({ admin, organizationId: org, storeId: store, actorId, aal: "aal1" });
const role = async () => (await admin.from("establishment_members").select("role").eq("establishment_id", store).eq("user_id", worker).maybeSingle()).data?.role;

const catalog = await syncCatalog(admin, org);
check("catálogo composto do RBAC real", catalog.total > 40, catalog.total);
const sync = await syncIdentities(admin, org);
check("identidades sem duplicar usuário", sync.users >= 4 && sync.duplicatedPersonalData === false, JSON.stringify(sync));
await refreshGovernanceInventory(ctx(owner));
await seedSodRuleDrafts(ctx(owner));
const membersBefore = must(await admin.from("establishment_members").select("id", { count: "exact", head: false }).eq("establishment_id", store), "contar").length;
const baseline = await importBaseline(admin, org, owner);
check("linha de base não revoga", baseline.revocations === 0 && must(await admin.from("establishment_members").select("id").eq("establishment_id", store), "contar").length === membersBefore);
await importBaseline(admin, org, owner);
const { data: duplicates } = await admin.from("access_grants").select("identity_id,entitlement_id,scope_key,status").eq("organization_id", org).in("status", ["active", "expiring"]);
check("linha de base idempotente", new Set(duplicates.map((x) => `${x.identity_id}|${x.entitlement_id}|${x.scope_key}`)).size === duplicates.length);
const first = await reconcileAccess(ctx(owner));
check("reconciliação sem diferença depois da linha de base", first.counts.ungoverned_access === 0 && first.counts.missing_access === 0, JSON.stringify(first.counts));

const entitlement = async (key) => must(await admin.from("access_entitlements").select("*").eq("organization_id", org).eq("key", key).single(), key);
const identity = async (user) => must(await admin.from("governed_identities").select("*").eq("organization_id", org).eq("user_id", user).single(), "identidade");
const manager = await entitlement("store_role:manager");
must(await admin.from("access_entitlements").update({ requestable: true, status: "active" }).eq("id", manager.id), "liberar pedido");
const me = await identity(worker), ask = (requester) => createAccessRequest(ctx(requester), { identityId: me.id, entitlementId: manager.id, scope: { establishment_id: store }, justification: "Cobertura da gerência no teste.", durationHours: 24, idempotencyKey: randomUUID() });

const { request } = await ask(worker);
check("pedido vira aprovação da Fase 32", request.status === "pending_approval" && request.approval_id);
await refuses("autoaprovação bloqueada", () => decideAccessRequest(ctx(worker), { requestId: request.id, decision: "approved", reason: "eu" }), /SELF_APPROVAL_BLOCKED/);
const { request: done } = await decideAccessRequest(ctx(approver), { requestId: request.id, decision: "approved", reason: "ok" });
check("provisiona pelo RBAC real", done.status === "completed" && (await role()) === "manager", `${done.status} ${done.failure_reason} ${await role()}`);
const reconciled = await reconcileAccess(ctx(owner));
check("elevação não aparece como drift", reconciled.counts.missing_access === 0 && reconciled.counts.ungoverned_access === 0, JSON.stringify(reconciled.counts));
must(await admin.from("access_grants").update({ valid_until: new Date(Date.now() - 1000).toISOString() }).eq("id", done.grant_id), "vencer");
const swept = await sweepExpirations(ctx(null));
check("expiração restaura o papel base e confirma", swept.expired >= 1 && (await role()) === "attendant", JSON.stringify(swept));

const jit = await requestJit(ctx(worker), { identityId: me.id, entitlementId: manager.id, minutes: 15, justification: "Fechamento de caixa no teste.", scope: { establishment_id: store } });
await approveJit(ctx(approver), { sessionId: jit.id });
const active = await activateJit(ctx(worker), { sessionId: jit.id });
check("JIT ativa janela curta", active.status === "active" && (await role()) === "manager");
must(await admin.from("access_grants").update({ valid_until: new Date(Date.now() - 1000).toISOString() }).eq("id", active.grant_id), "vencer JIT");
await sweepExpirations(ctx(null));
check("JIT expira", must(await admin.from("jit_sessions").select("status").eq("id", jit.id).single(), "ler").status === "expired" && (await role()) === "attendant");

const { event } = await requestBreakGlass(ctx(worker), { identityId: me.id, entitlementId: manager.id, reason: "Teste de queda do caixa no horário de pico.", minutes: 10, scope: { establishment_id: store } });
const bg = await activateBreakGlass(ctx(worker), { eventId: event.id });
check("break-glass ativa com prazo de revisão", bg.status === "active" && bg.review_due_at && (await role()) === "manager");
await closeBreakGlass(ctx(worker), { eventId: event.id, reason: "Fim do teste." });
check("break-glass encerra e restaura", (await role()) === "attendant");
await refuses("quem usou não revisa o break-glass", () => reviewBreakGlass(ctx(worker), { eventId: event.id, outcome: "appropriate", notes: "eu" }), /REVIEWER_MUST_DIFFER/);
check("revisor diferente conclui", (await reviewBreakGlass(ctx(approver), { eventId: event.id, outcome: "appropriate", notes: "Uso adequado." })).status === "reviewed");
const directBadReview = await admin.from("break_glass_events").update({ reviewer_id: worker }).eq("id", event.id);
check("banco também recusa revisor igual a quem usou", Boolean(directBadReview.error), "update aceito");

const rule = must(await admin.from("sod_rule_definitions").upsert({ organization_id: org, key: "smoke_rule", name: "Regra de teste", rule_type: "custom", conflicting_entitlement_refs: ["store_role:attendant", "store_role:manager"], severity: "high", status: "active" }, { onConflict: "organization_id,key" }).select().single(), "regra");
const blocked = await ask(worker);
check("SoD preventivo bloqueia", blocked.blocked === "SOD_CONFLICT_BLOCKED", JSON.stringify(blocked.blocked));
must(await admin.from("sod_rule_definitions").update({ conflicting_entitlement_refs: ["org_role:member", "store_role:attendant"] }).eq("id", rule.id), "ajustar regra");
const detective = await runDetectiveSod(ctx(owner));
check("SoD detectivo encontra conflito", detective.found >= 1, JSON.stringify(detective));
must(await admin.from("sod_rule_definitions").update({ status: "draft" }).eq("id", rule.id), "desativar regra");

const { campaign } = await createReviewCampaign(ctx(approver), { name: `Teste ${Date.now()}`, reviewType: "manager_review", filters: { identityIds: [me.id] }, reviewerId: approver });
const items = must(await admin.from("access_review_items").select("*").eq("campaign_id", campaign.id), "itens");
check("campanha cria itens", items.length >= 1);
await refuses("revisor não revisa o próprio acesso", () => decideReviewItem(ctx(worker), { itemId: items[0].id, decision: "keep", reason: "é meu" }), /REVIEWER_CANNOT_REVIEW_OWN_ACCESS/);
const directSelf = await admin.from("access_review_items").update({ reviewer_id: worker }).eq("id", items[0].id);
check("trigger do banco também recusa", /REVIEWER_CANNOT_REVIEW_OWN_ACCESS/.test(directSelf.error?.message || ""), directSelf.error?.message);
for (const item of items) await decideReviewItem(ctx(approver), { itemId: item.id, decision: "keep", reason: "Necessário." });
const certification = await certifyCampaign(ctx(approver), { campaignId: campaign.id });
check("certificação gera evidência", /^[0-9a-f]{64}$/.test(certification.evidence_hash));
const rewrite = await admin.from("access_certifications").update({ evidence_hash: "x" }).eq("id", certification.id);
check("certificação é imutável", /IMMUTABLE/.test(rewrite.error?.message || ""), rewrite.error?.message);
const rewriteAudit = await admin.from("identity_governance_audit_events").delete().eq("organization_id", org);
check("auditoria é imutável", /IMMUTABLE/.test(rewriteAudit.error?.message || ""), rewriteAudit.error?.message);

const ownerGrant = must(await admin.from("access_grants").select("id,access_entitlements!inner(key)").eq("organization_id", org).eq("access_entitlements.key", "store_role:owner").in("status", ["active", "expiring"]).limit(1).single(), "grant do dono");
const ownerRevoke = await revokeGrant(ctx(approver), { grantId: ownerGrant.id, reason: "Tentativa de remover dono." });
check("dono não é revogável pelo módulo", ownerRevoke.ok === false && ownerRevoke.reason === "NO_OFFICIAL_PATH", JSON.stringify(ownerRevoke.reason));
must(await admin.from("access_grants").update({ status: "active", failure_reason: null, revocation_reason: null }).eq("id", ownerGrant.id), "restaurar registro");
const rpcOwner = await admin.rpc("rbac_revoke_establishment_role", { requested_organization_id: org, requested_establishment_id: store, requested_user_id: owner, requested_role: "owner" });
check("fachada também protege o dono", /RBAC_OWNER_PROTECTED/.test(rpcOwner.error?.message || ""), rpcOwner.error?.message);
const anonClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const anonRpc = await anonClient.rpc("rbac_apply_establishment_role", { requested_organization_id: org, requested_establishment_id: store, requested_user_id: worker, requested_role: "manager" });
check("anônimo não chama a fachada", Boolean(anonRpc.error), "chamada aceita");
const anonRead = await anonClient.from("access_grants").select("id").limit(1);
check("anônimo não lê concessões", Boolean(anonRead.error) || !anonRead.data?.length, "leitura aceita");

const socInvestigation = must(await admin.from("security_investigations").insert({ context: "tenant_soc", organization_id: org, title: "Teste Fase 93", severity: "low", owner_ref: owner, investigation_type: "identity" }).select("id").single(), "investigação");
const socRequest = must(await admin.from("security_response_actions").insert({ context: "tenant_soc", organization_id: org, investigation_id: socInvestigation.id, response_type: "request_access_review", target_ref: me.id, state: "proposed", reason: "Teste de pedido do SOC.", evidence_refs: ["teste"], requested_by: owner }).select("id").single(), "pedido do SOC");
const socDone = await executeSocRequest(ctx(approver), { responseId: socRequest.id });
check("SOC pede, Fase 93 executa e verifica", socDone.state === "completed" && socDone.verification_state === "verified", socDone.state);
const { data: socEvents } = await admin.from("security_events").select("source_ref").eq("organization_id", org).eq("source_domain", "identity");
check("SOC recebe eventos canônicos", ["elevation", "revocation", "break_glass"].every((x) => socEvents.some((e) => e.source_ref === x)), [...new Set(socEvents.map((e) => e.source_ref))].join(","));
const socContext = await identityContextForSoc(admin, org);
check("SOC lê o contexto de identidade", socContext.available === true, JSON.stringify(socContext.available));
await scanFindings(ctx(owner));
const dashboard = await governanceDashboard(ctx(owner), ["idgov:view"]);
check("painel monta com dados reais", dashboard.grants.length > 0 && dashboard.identities.length > 0);
check("campo sensível mascarado sem permissão", dashboard.identities.every((x) => !x.owner_ref || x.owner_ref === "[restrito]"));

const copilotConfirm = await admin.from("copilot_action_requests").select("id").eq("source", "identity_governance").limit(1);
check("registro do ActionEngine aceita a nova origem", !copilotConfirm.error, copilotConfirm.error?.message);
const leaver = await processLeaver(ctx(approver), { userId: worker, reason: "Desligamento de teste." });
check("leaver confirma revogação de tudo", leaver.status === "confirmed" && leaver.accountDisabled === true, JSON.stringify(leaver));
check("leaver removeu acesso real", (await role()) === undefined && must(await admin.from("organization_members").select("user_id").eq("organization_id", org).eq("user_id", worker), "ler").length === 0);
const banned = must(await admin.auth.admin.getUserById(worker), "ler conta");
check("conta bloqueada no Auth", Boolean(banned.user.banned_until));

const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
