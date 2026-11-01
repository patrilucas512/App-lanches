import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AdminCredentialsError, createAdminClient, withAdminCredentials } from "../../lib/supabase/admin.ts";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const routes = {
  "app/api/security/login/route.ts": ["POST"],
  "app/api/saas/plans/route.ts": ["GET"],
  "app/api/stripe/webhook/route.ts": ["POST"],
  "app/api/whatsapp/webhook/route.ts": ["GET", "POST"],
  "app/api/fiscal/webhook/[provider]/route.ts": ["POST"],
  "app/api/fiscal/document/[token]/route.ts": ["GET"],
  "app/api/reports/export/[id]/route.ts": ["GET"],
  "app/api/marketplace-integrations/webhook/[provider]/route.ts": ["POST"],
  "app/api/customer-portal/[slug]/route.ts": ["GET"],
  "app/api/web-chat/messages/route.ts": ["GET"],
  "app/api/integrations/webhooks/process/route.ts": ["POST"],
  "app/api/performance/worker/route.ts": ["POST"],
};

test("missing server key answers 503 JSON", async t => {
  t.mock.method(console, "error", () => {});
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  delete process.env.SUPABASE_SECRET_KEY;
  t.after(() => {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key !== undefined) process.env.SUPABASE_SECRET_KEY = previous.key;
  });
  const response = await withAdminCredentials(async () => { createAdminClient(); return new Response("ok"); })();
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.match((await response.json()).error, /credenciais do servidor/);
});

test("response never exposes the name of the key", async t => {
  t.mock.method(console, "error", () => {});
  const response = await withAdminCredentials(async () => { throw new AdminCredentialsError(); })();
  assert.doesNotMatch(await response.text(), /SUPABASE/);
});

test("other errors keep propagating", async () => {
  await assert.rejects(withAdminCredentials(async () => { throw new Error("boom"); })(), /boom/);
});

test("handler arguments and response pass through", async () => {
  const response = await withAdminCredentials(async (value) => new Response(value))("ok");
  assert.equal(await response.text(), "ok");
});

for (const [path, methods] of Object.entries(routes)) {
  test(`${path} wraps ${methods.join(", ")}`, () => {
    const source = read(path);
    for (const method of methods) assert.match(source, new RegExp(`export const ${method}\\s*=\\s*withAdminCredentials\\(`));
  });
}

test("login form tolerates an empty preflight response", () => {
  assert.match(read("components/auth-form.tsx"), /preflight\.json\(\)\.catch\(/);
});
