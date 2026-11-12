import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Found by the Phase 97 E2E: the public menu always linked to /conta/[slug], which answers 404 when the
// store has no enabled customer_portal_configs row (every store that never configured the portal).
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the public menu shows 'Minha conta' only when the portal is enabled", () => {
  assert.match(read("components/public-menu.tsx"), /\{menu\.portal_enabled && \(\s*<a href=\{`\/conta\/\$\{menu\.establishment\.slug\}`\}/);
  const page = read("app/loja/[slug]/page.tsx");
  assert.match(page, /from\("customer_portal_configs"\)\.select\("establishment_id"\)\.eq\("establishment_id", store\.id\)\.eq\("enabled", true\)/);
  assert.match(page, /menu\.portal_enabled = slug !== "demo" && await isPortalEnabled\(slug\)/);
});

test("the portal page uses the same rule", () => {
  assert.match(read("app/conta/[slug]/page.tsx"), /from\("customer_portal_configs"\)\.select\("\*"\)\.eq\("establishment_id",store\.id\)\.eq\("enabled",true\)\.maybeSingle\(\); if\(!config\)notFound\(\)/);
});

test("an unknown store slug is a 404, not a 500", () => {
  // Seen in production on 2026-11-04: get_public_menu returns null and the page set service_mode on it.
  const page = read("app/loja/[slug]/page.tsx");
  assert.match(page, /const menu = published \|\| await menuResponse\.json\(\) as PublicMenu \| null;\s*if \(!menu\) return null;/);
  // Antes do 404, um nome antigo da loja (link trocado em Configurações) redireciona para o atual.
  assert.match(page, /const menu = await getMenu\(slug\);\s*if \(!menu\) \{[\s\S]*?resolveRenamedSlug\(slug\)[\s\S]*?notFound\(\);\s*\}/);
});
