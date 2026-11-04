import { test, expect, STORE_SLUG } from "./env";
import type { Page } from "@playwright/test";

// Customer side of the core: public menu, bag, pickup with cash change, table order, tracking and QR.

async function openBagWith(page: Page, product: string) {
  await page.goto(`/loja/${STORE_SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: `Aumentar quantidade de ${product}` }).click();
  await page.getByRole("button", { name: /Sacola|Ver sacola/ }).first().click();
  await expect(page.getByRole("heading", { name: "Revise seu pedido" })).toBeVisible();
  await page.getByRole("button", { name: /^Continuar/ }).click();
  await expect(page.getByRole("heading", { name: "Finalizar pedido" })).toBeVisible();
}

// After sending, the menu shows the tracking card with the order number and the first step.
async function expectTracking(page: Page) {
  await expect(page.getByRole("heading", { name: /^Pedido #\d+$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/ACOMPANHE SEU PEDIDO/)).toBeVisible();
}

test("cardápio público mostra a loja, os produtos e os preços @mobile", async ({ page }) => {
  await page.goto(`/loja/${STORE_SLUG}`);
  await expect(page.getByText("Aberto agora")).toBeVisible();
  await expect(page.getByRole("heading", { name: "X-Burger Teste" })).toBeVisible();
  await expect(page.getByText("R$ 24,90")).toBeVisible();
  await expect(page.getByRole("link", { name: "Minha conta" })).toHaveAttribute("href", `/conta/${STORE_SLUG}`);
});

test("pedido de retirada pago em dinheiro calcula o troco e abre o acompanhamento @mobile", async ({ page }) => {
  await openBagWith(page, "Refrigerante Teste");
  await page.getByPlaceholder("Ex.: Maria Oliveira").fill("Cliente E2E Retirada");
  await page.getByRole("button", { name: /^Retirada/ }).click();
  await page.getByPlaceholder("Ex.: 100,00").fill("10,00");
  await expect(page.getByText("R$ 3,10")).toBeVisible();
  await page.getByRole("button", { name: /Enviar para a cozinha/ }).click();
  await expectTracking(page);
});

test("pedido na mesa vai para a cozinha @mobile", async ({ page }) => {
  await openBagWith(page, "Batata Frita Teste");
  await page.getByPlaceholder("Ex.: Maria Oliveira").fill("Cliente E2E Mesa");
  await page.getByRole("button", { name: /^Consumir no local/ }).click();
  await page.getByPlaceholder("Ex.: 12 ou Varanda 3").fill("1");
  await page.getByPlaceholder("Ex.: 100,00").fill("20,00");
  await page.getByRole("button", { name: /Enviar para a cozinha/ }).click();
  await expectTracking(page);
});

test("portal do cliente abre a tela de acesso @mobile", async ({ page }) => {
  await page.goto(`/conta/${STORE_SLUG}`);
  await expect(page.locator("input").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
});

test("QR da loja leva ao cardápio público", async ({ page }) => {
  await page.goto(`/q/${STORE_SLUG}`);
  await expect(page).toHaveURL(new RegExp(`/loja/${STORE_SLUG}`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("telas de acesso da equipe abrem no celular @mobile", async ({ page }) => {
  for (const path of ["/garcom/login", "/cozinha/login", "/caixa/login", "/motoboy/login"]) {
    await page.goto(path);
    await expect(page.locator("input[type=password]").first(), path).toBeVisible();
  }
});
