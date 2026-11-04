import { test, expect } from "./env";
import type { Page } from "@playwright/test";

// Fase 98D: equipe da loja com login de verdade (contas criadas pelo seed via convite + função de ativação).
// Nome e sobrenome + senha, como na loja. Senhas no .env.test-login.local (local) ou nos segredos do CI.
const staff = {
  waiter: { name: process.env.E2E_WAITER_NAME || process.env.DEV_WAITER_NAME || "", password: process.env.E2E_WAITER_PASSWORD || process.env.DEV_WAITER_PASSWORD || "" },
  kitchen: { name: process.env.E2E_KITCHEN_NAME || process.env.DEV_KITCHEN_NAME || "", password: process.env.E2E_KITCHEN_PASSWORD || process.env.DEV_KITCHEN_PASSWORD || "" },
  cashier: { name: process.env.E2E_CASHIER_NAME || process.env.DEV_CASHIER_NAME || "", password: process.env.E2E_CASHIER_PASSWORD || process.env.DEV_CASHIER_PASSWORD || "" },
  driver: { name: process.env.E2E_DRIVER_NAME || process.env.DEV_DRIVER_NAME || "", password: process.env.E2E_DRIVER_PASSWORD || process.env.DEV_DRIVER_PASSWORD || "" },
};

async function login(page: Page, path: string, who: { name: string; password: string }, button: RegExp, landing: RegExp) {
  test.skip(!who.name || !who.password, "Sem as contas da equipe (rode o seed do dev ou defina os segredos E2E_*).");
  await page.goto(path);
  await page.locator("input[name=name]").fill(who.name);
  await page.locator("input[name=password]").fill(who.password);
  await page.getByRole("button", { name: button }).click();
  await page.waitForURL(landing, { timeout: 60_000 });
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error|Nome ou senha inválidos/);
}

test("garçom entra pelo nome e senha @mobile", async ({ page }) => {
  await login(page, "/garcom/login", staff.waiter, /^Entrar/, /\/(garcom\/app|painel\/garcom)/);
  // o garçom também é membro da loja: cai na tela de mesas do painel
  await expect(page.getByRole("heading", { name: /Mesas e pedidos/ })).toBeVisible();
});

test("cozinha entra pelo nome e senha @mobile", async ({ page }) => {
  await login(page, "/cozinha/login", staff.kitchen, /Abrir tela da cozinha/, /\/cozinha(\?|$)/);
  await expect(page.locator("main")).toBeVisible();
});

test("caixa entra pelo nome e senha @mobile", async ({ page }) => {
  await login(page, "/caixa/login", staff.cashier, /Entrar e abrir o caixa/, /\/caixa(\?|$)/);
  await expect(page.locator("main")).toBeVisible();
});

test("entregador entra pelo nome e senha @mobile", async ({ page }) => {
  await login(page, "/motoboy/login", staff.driver, /Entrar nas entregas/, /\/motoboy(\?|$)/);
  await expect(page.locator("main")).toBeVisible();
});
