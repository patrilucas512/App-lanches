import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Fase 99D. Prova com o banco: contagens no masterapp-dev (anon 17, authenticated 225, service_role com todas) e o
// E2E do núcleo depois da revogação.
const root = fileURLToPath(new URL("../../", import.meta.url));
const sql = readFileSync(join(root, "supabase/migrations/20261105120000_phase99d_remaining_definer.sql"), "utf8");
const revoked = [...sql.matchAll(/^revoke execute on function public\.([a-z_0-9]+)\(/gm)].map((m) => m[1]);
const granted = [...sql.matchAll(/^grant execute on function public\.([a-z_0-9]+)\([^;]*\) to service_role;/gm)].map((m) => m[1]);
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : [p]; });
const code = ["app", "lib", "components", "supabase/functions", "public"].flatMap((d) => walk(join(root, d)))
  .filter((p) => /\.(tsx?|m?js|ps1)$/.test(p)).map((p) => [p.slice(root.length).replaceAll("\\", "/"), readFileSync(p, "utf8")]);

test("29 revogações, todas com service_role mantido", () => {
  assert.equal(revoked.length, 29);
  assert.deepEqual(granted, revoked);
  assert.doesNotMatch(sql, /drop function/i);
});

test("o chat do site só é chamado pelo servidor", () => {
  for (const fn of ["start_web_chat_session", "get_web_chat_history", "post_web_chat_message"]) {
    assert.ok(revoked.includes(fn), fn);
    for (const [file, text] of code) {
      for (const m of text.matchAll(new RegExp(`([\\w.()]+)\\.rpc\\(\\s*"${fn}"`, "g"))) {
        assert.ok(file.startsWith("app/api/web-chat/"), `${fn} chamada em ${file}`);
        assert.match(m[1], /admin|createAdminClient\(\)/, `${file}: ${fn} sem cliente administrativo`);
      }
    }
  }
});

test("nenhuma das 26 sem uso aparece no código", () => {
  const unused = revoked.filter((n) => !n.includes("web_chat"));
  assert.equal(unused.length, 26);
  for (const name of unused) {
    const hit = code.find(([, text]) => new RegExp(`\\b${name}\\b`).test(text));
    assert.equal(hit, undefined, `${name} aparece em ${hit?.[0]}`);
  }
});

test("as 6 usadas por nome dinâmico continuam executáveis", () => {
  for (const name of ["configure_platform_payment_gateway", "configure_voice_connection", "register_driver_push_subscription",
    "register_operations_push_subscription", "superadmin_extend_trial", "update_driver_location"]) {
    assert.ok(!revoked.includes(name), name);
    assert.ok(code.some(([, text]) => text.includes(name)), `${name} usada no código`);
  }
});
