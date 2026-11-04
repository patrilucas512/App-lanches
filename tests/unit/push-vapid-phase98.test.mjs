import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vapidPublicKey, PRODUCTION_VAPID_PUBLIC_KEY } from "../../lib/push-notifications.ts";

const PROD = "https://qjwmjwubtgqginwhmajv.supabase.co";
const DEV = "https://bfmrcvjxbmxxmdustrgo.supabase.co";

test("a chave do ambiente vence quando configurada", () => {
  assert.equal(vapidPublicKey("BDevKey123", DEV), "BDevKey123");
  assert.equal(vapidPublicKey("  BProdKey  ", PROD), "BProdKey");
});

test("produção sem a variável continua com a chave atual (fallback)", () => {
  assert.equal(vapidPublicKey(undefined, PROD), PRODUCTION_VAPID_PUBLIC_KEY);
  assert.equal(vapidPublicKey("", PROD), PRODUCTION_VAPID_PUBLIC_KEY);
});

test("dev e homologação sem a variável ficam sem push, nunca com a chave de produção", () => {
  assert.equal(vapidPublicKey(undefined, DEV), null);
  assert.equal(vapidPublicKey(undefined, undefined), null);
});

test("o app e a função leem a chave por ambiente com a mesma regra", () => {
  const lib = readFileSync(new URL("../../lib/push-notifications.ts", import.meta.url), "utf8");
  assert.match(lib, /process\.env\.NEXT_PUBLIC_VAPID_PUBLIC_KEY/);
  assert.match(lib, /vapidPublicKey\(\) !== null/);
  const fn = readFileSync(new URL("../../supabase/functions/send-push-notification/index.ts", import.meta.url), "utf8");
  assert.match(fn, /Deno\.env\.get\("VAPID_PUBLIC_KEY"\)/);
  assert.match(fn, /includes\(PRODUCTION_SUPABASE_REF\) \? PRODUCTION_VAPID_PUBLIC_KEY : ""/);
  assert.ok(fn.includes(PRODUCTION_VAPID_PUBLIC_KEY), "mesma chave de produção nos dois lados");
});
