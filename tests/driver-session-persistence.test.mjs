import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("motoboy activation opens a persistent session and only explicit logout signs out", async () => {
  const [access, activation, loginPage, recovery, consoleUi] = await Promise.all([
    read("components/driver-access.tsx"),
    read("supabase/functions/activate-driver-access/index.ts"),
    read("app/motoboy/login/page.tsx"),
    read("components/password-recovery.tsx"),
    read("components/driver-dispatch-console.tsx"),
  ]);
  assert.match(activation, /auth\.signInWithPassword/);
  assert.match(activation, /access_token: authData\.session\.access_token/);
  assert.match(access, /auth\.setSession/);
  assert.match(access, /driver-access-completed/);
  assert.match(loginPage, /redirect\("\/motoboy"\)/);
  assert.doesNotMatch(recovery, /await supabase\.auth\.signOut\(\)/);
  assert.match(recovery, /accessType === "driver" \? "\/motoboy"/);
  assert.match(consoleUi, /auth\.signOut\(\)/);
});
