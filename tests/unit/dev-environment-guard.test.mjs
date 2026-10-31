import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeDevEnvironment, findDevEnvironmentProblems, findMissingDevFeatures } from "../../build/dev-environment-guard.ts";

const PRODUCTION_REF = "qjwmjwubtgqginwhmajv";
const jwt = (ref) => `header.${Buffer.from(JSON.stringify({ ref })).toString("base64url")}.signature`;

test("production Supabase URL is refused", () => {
  assert.equal(findDevEnvironmentProblems({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }).length, 1);
  assert.equal(findDevEnvironmentProblems({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF.toUpperCase()}.supabase.co` }).length, 1);
});

test("production JWT keys are refused and other projects are accepted", () => {
  assert.equal(findDevEnvironmentProblems({ SUPABASE_SERVICE_ROLE_KEY: jwt(PRODUCTION_REF) }).length, 1);
  assert.deepEqual(findDevEnvironmentProblems({ SUPABASE_SERVICE_ROLE_KEY: jwt("devproject"), SUPABASE_SECRET_KEY: "sb_secret_example", NEXT_PUBLIC_SUPABASE_URL: "https://devproject.supabase.co" }), []);
});

test("live Stripe keys and production modes are refused", () => {
  assert.equal(findDevEnvironmentProblems({ STRIPE_SECRET_KEY: "sk_live_example" }).length, 1);
  assert.deepEqual(findDevEnvironmentProblems({ STRIPE_SECRET_KEY: "sk_test_example" }), []);
  assert.equal(findDevEnvironmentProblems({ MASTERAPP_ENVIRONMENT: "production" }).length, 1);
});

test("missing optional keys are reported with the feature they disable", () => {
  assert.match(findMissingDevFeatures({}).join("\n"), /STRIPE_SECRET_KEY: assinaturas/);
  assert.equal(findMissingDevFeatures({ OPENAI_API_KEY: "sk-test" }).some((item) => item.startsWith("OPENAI_API_KEY")), false);
});

test("env files are checked even when the process environment looks safe", (t) => {
  const root = mkdtempSync(join(tmpdir(), "masterapp-guard-"));
  const runtime = process.env.MASTERAPP_ENVIRONMENT;
  delete process.env.MASTERAPP_ENVIRONMENT;
  t.mock.method(console, "warn", () => {});
  try {
    assert.throws(() => assertSafeDevEnvironment(root), /MASTERAPP_ENVIRONMENT está ausente/);
    writeFileSync(join(root, ".env.local"), `MASTERAPP_ENVIRONMENT=development\n# NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co\n`);
    assert.doesNotThrow(() => assertSafeDevEnvironment(root));
    writeFileSync(join(root, ".env.local"), `MASTERAPP_ENVIRONMENT=development\nNEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co\n`);
    assert.throws(() => assertSafeDevEnvironment(root), /PRODUÇÃO/);
  } finally {
    if (runtime !== undefined) process.env.MASTERAPP_ENVIRONMENT = runtime;
    rmSync(root, { recursive: true, force: true });
  }
});
