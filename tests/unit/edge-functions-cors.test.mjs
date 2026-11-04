import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The staff screens call these functions straight from the browser. With the app's old address in the
// allow-list, the browser refused every login from app-lanches-psi.vercel.app (Phase 97F).
const STAFF_FUNCTIONS = ["employee-login", "activate-waiter-access", "activate-kitchen-access", "activate-cashier-access", "activate-driver-access"];

function allowedOrigin(name) {
  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
  const primary = source.match(/const PRIMARY_ORIGIN = "([^"]+)"/)?.[1];
  const preview = source.match(/\/(\^https:.+\$)\/\.test\(origin\)/)?.[1];
  assert.ok(primary && preview, `${name} sem a lista de origens esperada`);
  assert.doesNotMatch(source, /chatgpt\.site/);
  const previewPattern = new RegExp(preview);
  return (origin) => origin === primary || origin === "http://localhost:3000" || previewPattern.test(origin);
}

for (const name of STAFF_FUNCTIONS) {
  test(`${name} accepts production, local and homologação origins only`, () => {
    const allowed = allowedOrigin(name);
    assert.equal(allowed("https://app-lanches-psi.vercel.app"), true);
    assert.equal(allowed("http://localhost:3000"), true);
    assert.equal(allowed("https://app-lanches-git-staging-lucas-patrick.vercel.app"), true);
    assert.equal(allowed("https://app-lanches-r37sk7lit-lucas-patrick.vercel.app"), true);
    assert.equal(allowed("https://app-lanches-evil.vercel.app"), false);
    assert.equal(allowed("https://app-lanches-x-lucas-patrick.vercel.app.evil.com"), false);
    assert.equal(allowed("https://mesa-viva-patrilucas.patricklucas512.chatgpt.site"), false);
  });
}
