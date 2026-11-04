import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Fase 98A. A prova com papéis reais (dono, funcionário, outra loja, superadmin, service_role) está em
// scripts/dev/phase98a-flags-check.sql, rodado no masterapp-dev: 15 de 15 cenários passaram em 04/11/2026.
const migration = readFileSync(new URL("../../supabase/migrations/20261104130000_phase98a_flags_within_plan.sql", import.meta.url), "utf8");
const check = readFileSync(new URL("../../scripts/dev/phase98a-flags-check.sql", import.meta.url), "utf8");

test("usuário logado não grava mais direto em store_feature_flags", () => {
  for (const policy of ["store_flags_admin_insert", "store_flags_admin_update", "store_flags_admin_delete"]) {
    assert.match(migration, new RegExp(`drop policy if exists ${policy} on public\\.store_feature_flags`));
  }
  assert.match(migration, /revoke insert, update, delete, truncate on public\.store_feature_flags from anon, authenticated/);
  assert.doesNotMatch(migration, /create policy store_flags_admin/);
});

test("a RPC recusa ligar flag fora do plano para quem não é superadmin", () => {
  const rpc = migration.slice(migration.indexOf("create or replace function public.set_store_feature_flags"));
  assert.match(rpc, /security definer set search_path = ''/);
  assert.match(rpc, /is_admin boolean := private\.is_superadmin\(\)/);
  assert.match(rpc, /private\.has_role\(requested_store_id, array\['owner'::public\.member_role,'manager'::public\.member_role\]\)/);
  assert.match(rpc, /if v = 'true'::jsonb and not is_admin then/);
  assert.match(rpc, /coalesce\(\(plan_row->>k\)::boolean, false\) = false then blocked := blocked \|\| k/);
  assert.match(rpc, /elsif not \(k = any\(private\.store_operational_flags\(\)\)\) then/);
  assert.match(rpc, /FLAG_OUTSIDE_PLAN/);
  assert.match(rpc, /UNKNOWN_FLAG/);
  assert.match(migration, /revoke all on function public\.set_store_feature_flags\(uuid, jsonb\) from public, anon;/);
});

test("desligar continua livre e as chaves operacionais seguem com o dono", () => {
  assert.match(migration, /array\['delivery_enabled','whatsapp_enabled','ai_enabled'\]/);
  assert.doesNotMatch(migration, /update public\.store_feature_flags set .*= false where/i, "a migration não desliga nada das lojas existentes");
});

test("toda gravação é auditada com autor e tipo de autor", () => {
  assert.match(migration, /create trigger store_feature_flags_audit after insert or update on public\.store_feature_flags/);
  assert.match(migration, /actor_kind text not null check \(actor_kind in \('superadmin','store_admin','server','system'\)\)/);
  assert.match(migration, /set_config\('masterapp\.flag_actor', case when is_admin then 'superadmin' else 'store_admin' end, true\)/);
});

test("leitura das flags pelo dono volta a funcionar (has_store_access)", () => {
  assert.match(migration, /grant execute on function private\.has_store_access\(uuid\) to authenticated/);
});

test("o roteiro de prova cobre abuso e fluxo legítimo", () => {
  for (const scenario of ["PATCH da API", "POST da API", "fora do plano", "funcionário", "outra loja", "anon", "superadmin liga", "service_role", "auditoria"]) {
    assert.ok(check.includes(scenario), scenario);
  }
  assert.match(check, /PHASE98A_ROLLBACK/);
});
