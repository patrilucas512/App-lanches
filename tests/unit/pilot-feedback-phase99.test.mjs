import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Fase 99H. Prova no dev: scripts/dev/phase99h-feedback-check.sql (10 de 10 em 05/11/2026).
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261105123000_phase99h_pilot_feedback.sql");

test("relato abre chamado na Central de Suporte, com página limpa e sem dados de cliente", () => {
  assert.match(sql, /insert into public\.support_tickets\(/);
  assert.match(sql, /'technical', 'normal', 'open', 'pilot_feedback'/);
  assert.match(sql, /split_part\(left\(coalesce\(requested_page, ''\), 300\), '\?', 1\)/);
  assert.match(sql, /jsonb_build_object\('page', page, 'browser', left\(coalesce\(requested_browser, ''\), 300\), 'reported_at', now\(\), 'role'/);
  assert.match(sql, /recent >= 10/);
  assert.match(sql, /revoke all on function public\.report_pilot_problem\(uuid, text, text, text\) from public, anon;/);
});

test("botão envia só texto, caminho e navegador", () => {
  const button = read("components/report-problem-button.tsx");
  assert.match(button, /requested_page: window\.location\.pathname,/);
  assert.match(button, /requested_browser: navigator\.userAgent,/);
  assert.doesNotMatch(button, /location\.href|location\.search|document\.body|innerText|localStorage/);
});

test("botão aparece no painel do dono e nas telas da equipe", () => {
  assert.match(read("components/dashboard-shell.tsx"), /\{brand\?\.id && <ReportProblemButton storeId=\{brand\.id\} \/>\}/);
  for (const page of ["app/cozinha/page.tsx", "app/caixa/page.tsx", "app/motoboy/page.tsx"]) {
    assert.match(read(page), /<ReportProblemButton storeId=\{/, page);
  }
});

test("painel do piloto é só leitura, só superadmin e sem dados de clientes", () => {
  assert.match(sql, /function public\.superadmin_pilot_overview\(requested_now timestamptz default now\(\)\)\s+returns jsonb language plpgsql stable security definer/);
  assert.match(sql, /if not private\.is_superadmin\(\) then raise exception 'FORBIDDEN'/);
  const overview = sql.slice(sql.indexOf("superadmin_pilot_overview"));
  assert.doesNotMatch(overview, /customer_name|customer_phone|address|\binsert\b|\bupdate\b|\bdelete\b/i);
  const page = read("app/superadmin/piloto/page.tsx");
  assert.match(page, /supabase\.rpc\("superadmin_pilot_overview"\)/);
  assert.doesNotMatch(page, /\.insert\(|\.update\(|\.delete\(|"use client"/);
  assert.match(read("components/superadmin-shell.tsx"), /\["\/superadmin\/piloto", "◎", "Painel do piloto"\]/);
});
