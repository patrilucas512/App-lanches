import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Link do cardápio com o nome da loja (o domínio do MasterApp fica fixo).
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// lib/menu-link.ts importa o cliente admin; a normalização é testada copiando a mesma regra do arquivo.
const lib = read("lib/menu-link.ts");
const normalize = new Function(`${lib.slice(lib.indexOf("export function normalizeMenuSlug"), lib.indexOf("export const MENU_SLUG_ERRORS")).replace("export function", "function").replace("(raw: string)", "(raw)")}; return normalizeMenuSlug;`)();

test("nome do link sai sem acento, minúsculo e com hífen", () => {
  assert.equal(normalize("Mariah El Lanches"), "mariah-el-lanches");
  assert.equal(normalize("Açaiteria São João!"), "acaiteria-sao-joao");
  assert.equal(normalize("  --Pizza  10--  "), "pizza-10");
});

test("banco valida dono, tamanho, nomes reservados e nome em uso, e guarda o link antigo", () => {
  const sql = read("supabase/migrations/20261112120000_custom_menu_link.sql");
  assert.match(sql, /m\.role in \('owner','manager'\)/);
  assert.match(sql, /raise exception 'SLUG_LENGTH'/);
  assert.match(sql, /raise exception 'SLUG_RESERVED'/);
  assert.match(sql, /raise exception 'SLUG_TAKEN'/);
  assert.match(sql, /'painel'/);
  assert.match(sql, /insert into public\.establishment_slug_history\(slug, establishment_id\) values \(current_slug/);
  assert.match(sql, /revoke all on public\.establishment_slug_history from public, anon, authenticated/);
  assert.match(sql, /translate\(lower\(coalesce\(raw, ''\)\), 'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'\)/);
});

test("links antigos redirecionam para o nome novo", () => {
  for (const [file, path] of [["app/loja/[slug]/page.tsx", "/loja/"], ["app/conta/[slug]/page.tsx", "/conta/"], ["app/retirada/[slug]/page.tsx", "/retirada/"]]) {
    const page = read(file);
    assert.match(page, /resolveRenamedSlug\(slug\)/, file);
    assert.ok(page.includes(`permanentRedirect(\`${path}\${renamed}`), file);
  }
});

test("Configurações mostra o campo do link", () => {
  const page = read("app/painel/configuracoes/page.tsx");
  assert.match(page, /<MenuLinkSettings establishmentId=\{establishment\.id\}/);
  const ui = read("components/menu-link-settings.tsx");
  assert.match(ui, /rpc\("change_establishment_slug"/);
  assert.match(ui, /A parte do MasterApp fica fixa/);
});
