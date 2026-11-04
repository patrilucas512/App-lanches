import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// Fase 98I. Prova na tela: tests/e2e-core/signup.spec.ts (páginas, links e aceite gravado no cadastro).
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("as quatro páginas existem e saem como rascunho", () => {
  for (const [path, kind] of [["termos", "saas-terms"], ["privacidade", "saas-privacy"], ["termos-cliente", "customer-terms"], ["privacidade-cliente", "customer-privacy"]]) {
    assert.ok(existsSync(new URL(`../../app/${path}/page.tsx`, import.meta.url)), path);
    assert.match(read(`app/${path}/page.tsx`), new RegExp(`<LegalDocument kind="${kind}" />`));
    assert.match(read(`app/${path}/page.tsx`), /robots: \{ index: false \}/);
  }
  assert.match(read("lib/legal.ts"), /export const LEGAL_DRAFT = true;/);
  const doc = read("components/legal-document.tsx");
  assert.match(doc, /RASCUNHO, NÃO DEFINITIVO\./);
  for (const marker of ["company", "cnpj", "dpo", "dpoEmail"]) assert.match(doc, new RegExp(`P\\.${marker}`), marker);
  for (const topic of ["Supabase", "Vercel", "Meta", "execução de contrato", "obrigação legal", "consentimento", "legítimo interesse", "ANPD", "controladora", "operador"]) {
    assert.ok(doc.includes(topic), topic);
  }
});

test("links no site, no cadastro, no cardápio público e no portal", () => {
  assert.match(read("app/page.tsx"), /<Link href="\/termos">Termos de uso<\/Link><Link href="\/privacidade">Privacidade<\/Link>/);
  assert.match(read("components/auth-form.tsx"), /href=\{LEGAL_LINKS\.saasTerms\}/);
  assert.match(read("components/public-menu.tsx"), /<LegalLinks audience="customer"/);
  assert.equal((read("components/customer-portal.tsx").match(/<LegalLinks audience="customer"/g) || []).length, 2);
});

test("cadastro exige o aceite e grava versão e data no servidor", () => {
  const form = read("components/auth-form.tsx");
  assert.match(form, /name="legal_accept" type="checkbox" required/);
  assert.match(form, /if \(data\.get\("legal_accept"\) !== "on"\) throw/);
  assert.match(form, /legal_terms_version: SAAS_TERMS_VERSION, legal_privacy_version: SAAS_PRIVACY_VERSION/);
  const sql = read("supabase/migrations/20261104137000_phase98i_legal_acceptance.sql");
  assert.match(sql, /create trigger on_auth_user_legal_acceptance after insert on auth\.users/);
  assert.match(sql, /accepted_at timestamptz not null default now\(\)/);
  assert.match(sql, /unique \(user_id, document, version\)/);
  assert.match(sql, /using \(user_id = \(select auth\.uid\(\)\) or \(select private\.is_superadmin\(\)\)\)/);
  assert.match(sql, /revoke all on public\.legal_acceptances from anon, authenticated;/);
});

test("confirmação automática de e-mail só no dev, dentro do teste", () => {
  const spec = read("tests/e2e-core/signup.spec.ts");
  assert.match(spec, /test\.skip\(!url\.includes\(DEV_REF\) \|\| !secret/);
  assert.match(spec, /email_confirm: true/);
  assert.match(spec, /deleteUser\(userId\)/);
});
