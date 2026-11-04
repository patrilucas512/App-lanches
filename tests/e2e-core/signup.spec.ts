import { test, expect } from "./env";
import { createClient } from "@supabase/supabase-js";

// Fase 98D/98I: cadastro de loja nova com aceite dos termos, até o onboarding.
// A confirmação de e-mail é feita pela API administrativa, e SÓ quando o banco é o masterapp-dev (a produção
// continua exigindo o e-mail). O Supabase Auth recusa domínios reservados (.test, example.com); para o cadastro
// completo pela tela, defina E2E_SIGNUP_EMAIL_DOMAIN com um domínio seu. Sem ele, a conta é criada pela API do
// dev com os mesmos metadados que o formulário envia (prova o gatilho do aceite) e a tela prova que o aceite é
// obrigatório. Sem a chave secreta do dev (local: .env.local; CI: E2E_SUPABASE_SECRET_KEY), o teste é pulado.
const DEV_REF = "bfmrcvjxbmxxmdustrgo";
try { process.loadEnvFile(".env.local"); } catch { /* só existe na máquina de desenvolvimento */ }
const url = process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const secret = process.env.E2E_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || "";
const signupDomain = process.env.E2E_SIGNUP_EMAIL_DOMAIN || "";

test("cadastro de loja nova exige e registra o aceite dos termos e chega ao onboarding @mobile", async ({ page }) => {
  test.skip(!url.includes(DEV_REF) || !secret, "Sem a chave secreta do masterapp-dev para confirmar o e-mail de teste.");
  test.setTimeout(120_000);
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const stamp = Date.now().toString(36);
  const email = signupDomain ? `e2e.cadastro.${stamp}@${signupDomain}` : `e2e.cadastro.${stamp}@masterapp-dev.test`;
  const password = `E2e-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
  let userId = "";
  try {
    await page.goto("/cadastro");
    await page.locator("input[name=name]").fill("Cadastro E2E");
    await page.locator("input[name=phone]").fill("(11) 90000-0099");
    await page.locator("input[name=email]").fill(email);
    await page.locator("input[name=email_confirmation]").fill(email);
    await page.locator("input[name=password]").fill(password);
    // sem marcar o aceite, o formulário não envia
    await page.getByRole("button", { name: /Criar conta grátis/ }).click();
    await expect(page).toHaveURL(/\/cadastro/);
    expect(await page.locator("input[name=legal_accept]").evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    await expect(page.getByRole("link", { name: "Termos de Uso" })).toHaveAttribute("href", "/termos");
    await page.locator("input[name=legal_accept]").check();

    if (signupDomain) {
      await page.getByRole("button", { name: /Criar conta grátis/ }).click();
      await expect(page.getByText(/Enviamos a confirmação|Primeiros passos/i).first()).toBeVisible({ timeout: 30_000 });
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
      userId = list.users.find((u) => u.email === email)?.id ?? "";
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: false,
        user_metadata: { full_name: "Cadastro E2E", phone: "(11) 90000-0099", legal_terms_version: "2026-11-04-rascunho", legal_privacy_version: "2026-11-04-rascunho" } });
      expect(error).toBeNull();
      userId = data.user!.id;
    }
    expect(userId, "usuário criado").toBeTruthy();
    const { data: accepted } = await admin.from("legal_acceptances").select("document,version,accepted_at").eq("user_id", userId);
    expect((accepted ?? []).map((a) => a.document).sort()).toEqual(["saas_privacy", "saas_terms"]);
    expect(accepted!.every((a) => /rascunho/.test(a.version) && a.accepted_at)).toBe(true);

    // confirmação de e-mail só no dev
    await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    await page.goto("/login");
    await page.locator("input[name=email]").first().fill(email);
    await page.locator("input[name=password]").first().fill(password);
    await page.getByRole("button", { name: /^Entrar no painel/ }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});

test("páginas legais abrem como rascunho e estão linkadas no cardápio e no site", async ({ page }) => {
  for (const [path, title] of [["/termos", "Termos de Uso do MasterApp"], ["/privacidade", "Política de Privacidade do MasterApp"], ["/termos-cliente", "Termos de uso para clientes das lojas"], ["/privacidade-cliente", "Privacidade para clientes das lojas"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("RASCUNHO, NÃO DEFINITIVO.")).toBeVisible();
  }
  await page.goto("/loja/lanchonete-teste");
  await expect(page.getByRole("navigation", { name: "Termos e privacidade" }).getByRole("link", { name: "Privacidade" })).toHaveAttribute("href", "/privacidade-cliente");
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: "Termos de uso" })).toHaveAttribute("href", "/termos");
});
