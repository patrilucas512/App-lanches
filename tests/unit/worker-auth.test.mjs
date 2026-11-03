import test from "node:test";
import assert from "node:assert/strict";
import { workerAuthorized } from "../../lib/worker-auth.ts";
const req = (auth) => new Request("https://x.test/api/w", { method: "POST", headers: auth ? { authorization: auth } : {} });
const admin = (answer) => ({ calls: [], rpc(name, args) { this.calls.push({ name, args }); return Promise.resolve(answer); } });

test("environment secret wins when configured, and the database is not asked", async () => {
  const a = admin({ data: true, error: null });
  assert.equal(await workerAuthorized(a, req("Bearer certo"), { envSecret: "certo", vaultName: "cx_worker_secret" }), true);
  assert.equal(await workerAuthorized(a, req("Bearer errado"), { envSecret: "certo", vaultName: "cx_worker_secret" }), false);
  assert.equal(a.calls.length, 0);
});
test("without an environment secret, the token is checked against Vault", async () => {
  const yes = admin({ data: true, error: null });
  assert.equal(await workerAuthorized(yes, req("Bearer do-cofre"), { vaultName: "cx_worker_secret" }), true);
  assert.deepEqual(yes.calls[0], { name: "verify_worker_secret", args: { requested_name: "cx_worker_secret", requested_token: "do-cofre" } });
  assert.equal(await workerAuthorized(admin({ data: false, error: null }), req("Bearer outro"), { vaultName: "cx_worker_secret" }), false);
  assert.equal(await workerAuthorized(admin({ data: null, error: { message: "falhou" } }), req("Bearer outro"), { vaultName: "cx_worker_secret" }), false);
});
test("a missing or malformed header is refused without a database call", async () => {
  const a = admin({ data: true, error: null });
  assert.equal(await workerAuthorized(a, req(), { vaultName: "cx_worker_secret" }), false);
  assert.equal(await workerAuthorized(a, req("Basic abc"), { vaultName: "cx_worker_secret" }), false);
  assert.equal(a.calls.length, 0);
});
test("the database function only checks named secrets, only for service_role", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../supabase/migrations/20261102240000_worker_secret_from_vault.sql", import.meta.url), "utf8");
  assert.match(sql, /requested_name in\('cx_worker_secret'\)/);
  assert.match(sql, /request\.jwt\.claim\.role',true\)='service_role'/);
  assert.match(sql, /revoke all on function public\.verify_worker_secret\(text,text\) from public,anon,authenticated/);
});
