import { test, expect, owner, STORE_SLUG } from "./env";
import type { BrowserContext, Page } from "@playwright/test";

// Owner side of the core: login, panel, menu admin, cashier, orders, kitchen and the customer seeing "ready".
test.describe.configure({ mode: "serial" });
test.skip(!owner.email || !owner.password, "Sem E2E_OWNER_EMAIL/E2E_OWNER_PASSWORD (ou o .env.test-login.local do seed).");

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  context = await browser.newContext();
  // "Aceitar e imprimir" prints from a hidden iframe; the print dialog blocks a headless page. Every window the page
  // reaches (its own and the iframe's contentWindow) pretends the print finished.
  await context.addInitScript(() => {
    const stub = (target: Window) => { target.print = () => { target.dispatchEvent(new Event("afterprint")); }; };
    stub(window);
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get() { const target = original?.get?.call(this) as Window | null; if (target) stub(target); return target; },
    });
  });
  page = await context.newPage();
  await page.goto("/login");
  await page.locator("input[name=email]").first().fill(owner.email);
  await page.locator("input[name=password]").first().fill(owner.password);
  await page.getByRole("button", { name: /^Entrar no painel/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/auth/"), { timeout: 90_000 });
});

test.afterAll(async () => { await context?.close(); });

test("dono entra e vê o painel com o resumo de vendas", async () => {
  await page.goto("/painel");
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(page.locator("main")).toContainText(/Pedidos|Vendas|Faturamento/);
});

test("cardápio aparece no painel do dono", async () => {
  await page.goto("/painel/cardapio");
  await expect(page.getByText("X-Burger Teste").first()).toBeVisible();
});

test("caixa abre para o dono", async () => {
  await page.goto("/painel/caixa");
  await expect(page.locator("main")).toContainText(/Caixa/);
});

// Fase 98C: módulo desligado (Digital Twin fica fora do Básico e do Piloto) mostra o aviso padrão, some do menu
// e a API responde 403 FEATURE_DISABLED.
test("módulo fora do plano mostra o aviso padrão, some do menu e a API recusa", async () => {
  await page.goto("/painel/planejamento/digital-twin");
  await expect(page).toHaveURL(/\/painel\/modulo-indisponivel\?m=digital-twin/);
  const notice = page.locator("section.module-unavailable");
  await expect(notice).toContainText("Módulo não disponível");
  await expect(notice).toContainText("Digital Twin não faz parte do plano desta loja.");
  await expect(notice.getByRole("link", { name: "Ver planos" })).toHaveAttribute("href", "/painel/assinatura");
  await expect(page.getByRole("navigation").first().getByRole("link", { name: "Digital Twin" })).toHaveCount(0);
  await notice.screenshot({ path: test.info().outputPath("modulo-indisponivel.png") });

  const html = await (await page.request.get("/painel")).text();
  const storeId = html.match(/storeId\\?":\\?"([0-9a-f-]{36})/)?.[1];
  expect(storeId, "id da loja no painel").toBeTruthy();
  const api = await page.request.get(`/api/digital-twin?store_id=${storeId}`);
  expect(api.status()).toBe(403);
  expect(await api.json()).toMatchObject({ error: "FEATURE_DISABLED" });
});

test("pedido feito no cardápio aparece para o dono e na cozinha, e o cliente vê quando fica pronto", async ({ browser }) => {
  test.setTimeout(150_000);
  const customerName = `Cliente E2E ${Date.now().toString().slice(-6)}`;
  const customer = await browser.newPage();
  await customer.goto(`/loja/${STORE_SLUG}`);
  await expect(async () => {
    await customer.getByRole("button", { name: "Aumentar quantidade de Brownie Teste" }).click();
    await expect(customer.getByRole("button", { name: "Diminuir quantidade de Brownie Teste" })).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await customer.getByRole("button", { name: /Sacola|Ver sacola/ }).first().click();
  await customer.getByRole("button", { name: /^Continuar/ }).click();
  await customer.getByPlaceholder("Ex.: Maria Oliveira").fill(customerName);
  await customer.getByRole("button", { name: /^Retirada/ }).click();
  await customer.getByPlaceholder("Ex.: 100,00").fill("20,00");
  await customer.getByRole("button", { name: /Enviar para a cozinha/ }).click();
  await expect(customer.getByRole("heading", { name: /^Pedido #\d+$/ })).toBeVisible({ timeout: 30_000 });

  await page.goto("/painel/pedidos");
  await expect(page.getByText(customerName).first()).toBeVisible();

  await page.goto("/cozinha");
  const card = page.locator("article.kitchen-ticket").filter({ hasText: customerName });
  await expect(card).toBeVisible();
  await expect(card).toContainText("TROCO: R$ 8,10");
  await expect(card).toContainText("PAGAMENTO: Dinheiro");
  await card.screenshot({ path: test.info().outputPath("comanda-cozinha.png") });
  // The kitchen accepts the order ("Aceitar pedido" or "Aceitar e imprimir") and marks it ready.
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: /^Aceitar/ }).click();
  await card.getByRole("button", { name: "Marcar como pronto" }).click();
  await expect(card).toContainText("Aguardando retirada do cliente.");
  await expect(customer.getByText(/PRONTO!/)).toBeVisible({ timeout: 45_000 });
  await customer.close();
});
