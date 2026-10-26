import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261022060000_phase46_network_governance.sql");
const core = read("lib/network_governance/core.ts");
const api = read("app/api/network-governance/route.ts");
const ui = read("components/network-governance-center.tsx");
const nav = read("components/dashboard-shell.tsx");

const cases = [
  ["reutiliza organização e estabelecimentos", () => { assert.match(sql, /references public\.organizations/); assert.match(sql, /references public\.establishments/); }],
  ["hierarquia marca região cluster loja", () => ["network_brands", "network_regions", "network_clusters", "network_cluster_stores"].forEach(name => assert.match(sql, new RegExp(`create table public\\.${name}`)))],
  ["classificação operacional da unidade", () => assert.match(sql, /company_owned.*franchise.*partner_operated.*other/s)],
  ["doze permissões de rede", () => assert.equal((core.match(/"network:[^"]+"/g) || []).length, 12)],
  ["financeiro possui permissão separada", () => assert.match(core, /network:view_sensitive_finance/)],
  ["políticas tipadas e versionadas", () => assert.match(sql, /network_governance_policies[\s\S]*schema_version[\s\S]*version/)],
  ["herança nos cinco níveis", () => assert.match(core, /organization","brand","region","cluster","store/)],
  ["valor resolvido informa origem e autor", () => assert.match(core, /sourceId[\s\S]*changedBy[\s\S]*changedAt/)],
  ["override local respeita política", () => assert.match(core, /canOverride[\s\S]*localOverrideAllowed/)],
  ["preview obrigatório em massa", () => assert.match(api, /preview_policy/)],
  ["confirmação reforçada", () => assert.match(api, /confirmation_phrase[\s\S]*confirmation/)],
  ["rollout piloto grupo rede", () => assert.match(sql, /pilot','group','network/)],
  ["rollout idempotente por unidade", () => assert.match(sql, /unique\(rollout_id,idempotency_key\)/)],
  ["falha isolada por alvo", () => assert.match(sql, /network_rollout_targets[\s\S]*last_error/)],
  ["rollback não é prometido sempre", () => assert.match(sql, /rollback_available boolean not null default false/)],
  ["catálogo central preserva produto existente", () => assert.match(sql, /source_product_id uuid references public\.products/)],
  ["templates por segmento", () => assert.match(sql, /hamburgueria.*pizzaria.*bar.*cafe.*restaurante.*custom/s)],
  ["quatro políticas de preço", () => assert.match(sql, /fixed_central.*suggested.*min_max_range.*local_control/s)],
  ["fornecedores reutilizam base existente", () => assert.match(sql, /supplier_id uuid not null references public\.suppliers/)],
  ["compliance interno não é fiscal", () => assert.match(sql, /network_operational_standards[\s\S]*food_safety_internal/)],
  ["tarefas corretivas aceitam evidência", () => assert.match(sql, /network_corrective_actions[\s\S]*photo_evidence_path/)],
  ["detecção de drift explicável", () => assert.match(sql, /intentional_override.*unauthorized_change.*outdated_version.*sync_failure/s)],
  ["exceções possuem validade", () => assert.match(sql, /governance_exception_requests[\s\S]*valid_until/)],
  ["benchmark exige amostra privada", () => { assert.match(api, /sample_size.*3/s); assert.match(ui, /menores que 3 unidades/); }],
  ["abertura reutiliza onboarding", () => assert.match(ui, /ONBOARDING DA FASE 23/)],
  ["clone usa allowlist e denylist", () => { assert.match(core, /StoreCloneAllowlist/); assert.match(core, /StoreCloneDenylist/); }],
  ["copiloto somente leitura", () => assert.equal((core.match(/"get(?:Network|Store|Region|Configuration|Rollout|Supplier|Expansion)[^"]+"/g) || []).length, 9)],
  ["action engine requer confirmação", () => assert.match(core, /requiresConfirmation:true[\s\S]*aiCanPublish:false/)],
  ["cinco feature flags e navegação", () => { ["network_governance_enabled", "franchise_management_enabled", "central_catalog_enabled", "network_pricing_enabled", "network_benchmarking_enabled"].forEach(flag => assert.match(sql, new RegExp(flag))); assert.match(nav, /painel\/rede/); }],
  ["warehouse e métricas semânticas", () => { assert.match(sql, /fact_network_rollouts/); assert.match(sql, /fact_store_compliance/); assert.match(sql, /fact_store_benchmarks/); assert.match(sql, /analytics_metric_catalog/); }],
];

for (const [name, fn] of cases) test(name, fn);
