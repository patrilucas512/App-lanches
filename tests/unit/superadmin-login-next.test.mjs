import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL("../../" + name, import.meta.url), "utf8");

test("login next only accepts internal paths", async () => {
  const { safeLoginNext, withLoginNext } = await import("../../lib/login-next.ts");
  assert.equal(safeLoginNext("/superadmin/planos"), "/superadmin/planos");
  assert.equal(safeLoginNext("/painel?aba=1"), "/painel?aba=1");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", "/login", "/login?next=/x", "/auth/after-login", "/cadastro", "", null, 42]) {
    assert.equal(safeLoginNext(bad), null, String(bad));
  }
  assert.equal(withLoginNext("/auth/after-login", "/superadmin/planos"), "/auth/after-login?next=%2Fsuperadmin%2Fplanos");
  assert.equal(withLoginNext("/auth/after-login", "//evil.com"), "/auth/after-login");
});

test("superadmin login returns to the page that was asked for", async () => {
  const [login, loggedIn, form, mfa, after, guard, topbar] = await Promise.all([
    read("app/login/page.tsx"), read("components/logged-in-redirect.tsx"), read("components/auth-form.tsx"), read("app/auth/mfa/page.tsx"),
    read("app/auth/after-login/route.ts"), read("lib/superadmin.ts"), read("components/dashboard-topbar.tsx"),
  ]);
  assert.match(guard, /redirect\("\/login\?next=\/superadmin\/dashboard"\)/);
  assert.match(login, /safeLoginNext\(params\.next\)/);
  assert.match(login, /<AuthForm mode="login" notice=\{notice\} next=\{next\} \/>/);
  // Already logged in: the browser reads ?next= (vinext hands redirect-only pages empty searchParams).
  assert.match(login, /if \(data\?\.claims\?\.sub\) return <LoggedInRedirect \/>/);
  assert.match(loggedIn, /withLoginNext\("\/auth\/after-login", next\)/);
  assert.match(form, /withLoginNext\("\/auth\/after-login",next\)/);
  assert.match(form, /withLoginNext\("\/auth\/mfa",next\)/);
  assert.match(mfa, /withLoginNext\("\/auth\/after-login"/);
  // A route handler reads ?next= from the request URL itself.
  assert.match(after, /safeLoginNext\(url\.searchParams\.get\("next"\)\)/);
  // /superadmin only for superadmins; checked before the "store owners go to the store" rule.
  assert.match(after, /profile\?\.is_superadmin\)\) return go\(next\)/);
  assert.ok(after.indexOf("go(next)") < after.indexOf('go("/garcom/app")'));
  // The shortcut is shown only to superadmins.
  assert.match(topbar, /isSuperadmin && <Link[^>]*href="\/superadmin\/dashboard"/);
});
