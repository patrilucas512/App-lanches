import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Found by the Phase 97 E2E: the public menu always linked to /conta/[slug], which answers 404 when the
// store has no enabled customer_portal_configs row (every store that never configured the portal).
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the public menu shows 'Minha conta' only when the portal is enabled", () => {
  assert.match(read("components/public-menu.tsx"), /\{menu\.portal_enabled && \(\s*<a href=\{`\/conta\/\$\{menu\.establishment\.slug\}`\}/);
  const page = read("app/loja/[slug]/page.tsx");
  assert.match(page, /from\("customer_portal_configs"\)\.select\("id"\)\.eq\("establishment_id", store\.id\)\.eq\("enabled", true\)/);
  assert.match(page, /menu\.portal_enabled = slug !== "demo" && await isPortalEnabled\(slug\)/);
});

test("the portal page uses the same rule", () => {
  assert.match(read("app/conta/[slug]/page.tsx"), /from\("customer_portal_configs"\)\.select\("\*"\)\.eq\("establishment_id",store\.id\)\.eq\("enabled",true\)\.maybeSingle\(\); if\(!config\)notFound\(\)/);
});
