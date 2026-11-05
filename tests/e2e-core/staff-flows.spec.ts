import { test, expect, STORE_SLUG } from "./env";
import type { Browser, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(".env.local"); } catch { /* só existe na máquina de desenvolvimento */ }
const DEV_REF = "bfmrcvjxbmxxmdustrgo";
const devUrl = process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const devSecret = process.env.E2E_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || "";

// Fase 99E: fluxos completos da equipe, cada um com a conta de verdade da pessoa (seed do dev ou segredos E2E_*).
// garçom abre a mesa e lança → cozinha aceita e marca pronto → garçom fecha a conta, recebe em dinheiro e libera a mesa;
// caixa abre o turno e faz uma venda no balcão. Escrevem pedidos reais: só homologação ou servidor local (env.ts).
test.describe.configure({ mode: "serial" });

const who = (prefix: "WAITER" | "KITCHEN" | "CASHIER" | "DRIVER") => ({
  name: process.env[`E2E_${prefix}_NAME`] || process.env[`DEV_${prefix}_NAME`] || "",
  password: process.env[`E2E_${prefix}_PASSWORD`] || process.env[`DEV_${prefix}_PASSWORD`] || "",
});
const waiter = who("WAITER"), kitchen = who("KITCHEN"), cashier = who("CASHIER");

export async function staffLogin(browser: Browser, path: string, person: { name: string; password: string }, button: RegExp, landing: RegExp, mobile = false): Promise<Page> {
  const context = await browser.newContext(mobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {});
  // a cozinha pode imprimir por um iframe; o diálogo de impressão travaria a página sem tela
  await context.addInitScript(() => {
    const stub = (target: Window) => { target.print = () => { target.dispatchEvent(new Event("afterprint")); }; };
    stub(window);
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get() { const target = original?.get?.call(this) as Window | null; if (target) stub(target); return target; },
    });
  });
  const page = await context.newPage();
  await page.goto(path);
  // enviar antes da página ficar interativa recarrega o formulário vazio; repete até sair da tela de acesso
  await expect(async () => {
    await page.waitForLoadState("networkidle");
    await page.locator("input[name=name]").fill(person.name);
    await page.locator("input[name=password]").fill(person.password);
    await page.getByRole("button", { name: button }).click();
    await page.waitForURL(landing, { timeout: 20_000 });
  }).toPass({ timeout: 70_000 });
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error|Nome ou senha inválidos/);
  return page;
}

test("garçom abre a mesa, lança o pedido, a cozinha prepara e o garçom recebe em dinheiro e libera a mesa", async ({ browser, isMobile }) => {
  test.skip(!waiter.name || !kitchen.name, "Sem as contas de garçom e cozinha.");
  test.setTimeout(240_000);
  const table = `E2E ${Date.now().toString().slice(-5)}`;
  const garcom = await staffLogin(browser, "/garcom/login", waiter, /^Entrar/, /\/(garcom\/app|painel\/garcom)/, isMobile);
  await expect(garcom.getByRole("heading", { name: /Mesas e pedidos/ })).toBeVisible();

  // o botão existe antes da página ficar interativa; repete até o formulário abrir
  await expect(async () => {
    await garcom.locator(".waiter-operation-heading").getByRole("button", { name: "Abrir atendimento" }).click();
    await expect(garcom.locator("input[name=table_label]")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await garcom.locator("input[name=table_label]").fill(table);
  await garcom.locator("input[name=customer]").fill("Mesa Teste E2E");
  await garcom.locator("form.waiter-modal").getByRole("button", { name: /Abrir atendimento/ }).click();
  const account = garcom.getByLabel(`Conta da mesa ${table}`);
  await expect(garcom.getByText("Atendimento aberto.")).toBeVisible({ timeout: 30_000 });
  // a conta abre sozinha; se a tela demorar, o garçom toca na mesa
  if (!(await account.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false))) {
    await garcom.locator(".operation-table").filter({ hasText: table }).click();
  }
  await expect(account).toBeVisible({ timeout: 30_000 });

  await account.getByPlaceholder("Buscar produto...").fill("X-Burger Teste");
  await account.locator(".internal-product-grid article").filter({ hasText: "X-Burger Teste" }).getByRole("button", { name: "Adicionar" }).click();
  await garcom.locator("form.product-customizer").getByRole("button", { name: "Adicionar ao pedido" }).click();
  await expect(account.locator(".waiter-cart")).toContainText("1× X-Burger Teste");
  await account.getByRole("button", { name: "Enviar para cozinha" }).click();
  await expect(account.locator(".waiter-cart")).toContainText("Adicione itens do cardápio.");

  const cozinha = await staffLogin(browser, "/cozinha/login", kitchen, /Abrir tela da cozinha/, /\/cozinha(\?|$)/, isMobile);
  const card = cozinha.locator("article.kitchen-ticket").filter({ hasText: table });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("X-Burger Teste");
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: /^Aceitar/ }).click();
  await card.getByRole("button", { name: "Marcar como pronto" }).click();
  await expect(card).not.toContainText("Marcar como pronto");
  await cozinha.context().close();

  await garcom.reload();
  await garcom.locator(".operation-table").filter({ hasText: table }).click();
  await account.locator("form.close-account").getByRole("button", { name: "Fechar conta" }).click();
  // ao fechar a conta o pagamento já abre; o botão "Abrir pagamento" fica atrás do modal
  const cash = garcom.getByRole("button", { name: "Pagar em dinheiro e calcular troco" });
  if (!(await cash.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false))) await account.getByRole("button", { name: "Abrir pagamento" }).click();
  await cash.click();
  await garcom.locator(".cash-received-field input").fill("50,00");
  await garcom.getByRole("button", { name: "Confirmar pagamento e troco" }).click();
  await expect(garcom.getByText("Pagamento confirmado")).toBeVisible({ timeout: 30_000 });
  await garcom.getByRole("button", { name: "Fechar e liberar mesa" }).click();
  await expect(garcom.locator(".operation-table").filter({ hasText: table })).toHaveCount(0, { timeout: 30_000 });
  await garcom.context().close();
});

test("caixa abre o turno e registra uma venda no balcão em dinheiro", async ({ browser, isMobile }) => {
  test.skip(!cashier.name, "Sem a conta de caixa.");
  test.setTimeout(180_000);
  // preparação: a loja precisa de um terminal de caixa (Configurações → Terminais de caixa). Só no dev.
  if (devUrl.includes(DEV_REF) && devSecret) {
    const admin = createClient(devUrl, devSecret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: store } = await admin.from("establishments").select("id").eq("slug", STORE_SLUG).single();
    const { count } = await admin.from("cash_registers").select("id", { count: "exact", head: true }).eq("establishment_id", store!.id).eq("active", true);
    if (!count) await admin.from("cash_registers").insert({ establishment_id: store!.id, name: "Caixa E2E" });
  }
  const caixa = await staffLogin(browser, "/caixa/login", cashier, /Entrar e abrir o caixa/, /\/caixa(\?|$)/, isMobile);
  const open = caixa.getByRole("button", { name: /Abrir meu caixa/ });
  if (await open.isVisible().catch(() => false)) {
    await caixa.locator("select[name=register]").selectOption({ index: 1 });
    await caixa.locator("input[name=opening]").fill("100,00");
    await open.click();
  }
  await expect(caixa.getByRole("button", { name: /Fechar e gerar relatório/ })).toBeVisible({ timeout: 30_000 });
  await caixa.locator("button").filter({ hasText: "Refrigerante Teste" }).first().click();
  await caixa.getByRole("button", { name: "Finalizar e registrar venda" }).click();
  await expect(caixa.locator("body")).toContainText(/Venda #\d+ concluída por /, { timeout: 30_000 });
  await caixa.context().close();
});

const driver = who("DRIVER");
const ownerAccount = {
  email: process.env.E2E_OWNER_EMAIL || process.env.DEV_OWNER_EMAIL || "",
  password: process.env.E2E_OWNER_PASSWORD || process.env.DEV_OWNER_PASSWORD || "",
};

// pedido de delivery: cliente pede → cozinha prepara → dono despacha → entregador aceita, retira com o código da loja,
// sai, chega e confirma com o PIN que o cliente vê no acompanhamento.
test("entregador recebe a chamada, retira com o código e entrega com o PIN do cliente", async ({ browser, isMobile }) => {
  test.skip(!driver.name || !kitchen.name || !ownerAccount.email, "Sem as contas de entregador, cozinha e dono.");
  test.setTimeout(300_000);
  const customerName = `Entrega E2E ${Date.now().toString().slice(-6)}`;
  // preparação só no dev: uma execução interrompida deixa o motoboy preso numa entrega E2E antiga
  if (devUrl.includes(DEV_REF) && devSecret) {
    const admin = createClient(devUrl, devSecret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: stale } = await admin.from("deliveries").select("id,orders!inner(customer_name)")
      .like("orders.customer_name", "Entrega E2E %").not("status", "in", "(delivered,canceled,failed)");
    const ids = (stale ?? []).map((row) => row.id);
    if (ids.length) {
      await admin.from("delivery_assignments").update({ status: "canceled" }).in("delivery_id", ids).in("status", ["offered", "accepted"]);
      await admin.from("deliveries").update({ status: "canceled", canceled_at: new Date().toISOString() }).in("id", ids);
      await admin.from("driver_availability").update({ status: "offline", active_delivery_count: 0 }).gt("active_delivery_count", 0);
    }
  }

  const moto = await staffLogin(browser, "/motoboy/login", driver, /Entrar nas entregas/, /\/motoboy(\?|$)/, isMobile);
  const available = moto.getByRole("button", { name: /Ficar disponível|Ativar turno/ });
  if (await available.isEnabled().catch(() => false)) await available.click();
  await expect(moto.locator(".driver-status")).toContainText(/Disponível|Ativo/, { timeout: 20_000 });

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/loja/${STORE_SLUG}`);
  await expect(customer.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(async () => {
    await customer.getByRole("button", { name: "Aumentar quantidade de X-Burger Teste" }).click();
    await expect(customer.getByRole("button", { name: "Diminuir quantidade de X-Burger Teste" })).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await customer.getByRole("button", { name: /Sacola|Ver sacola/ }).first().click();
  await customer.getByRole("button", { name: /^Continuar/ }).click();
  await customer.getByPlaceholder("Ex.: Maria Oliveira").fill(customerName);
  await customer.getByRole("button", { name: /^Entrega/ }).click();
  await customer.getByPlaceholder("(21) 99999-9999").fill("(11) 90000-0097");
  await customer.getByPlaceholder("Ex.: Rua das Flores").fill("Rua de Teste");
  await customer.getByPlaceholder("Ex.: 125").fill("10");
  await customer.getByPlaceholder("Ex.: Centro").fill(process.env.E2E_DELIVERY_NEIGHBORHOOD || "Centro (teste)");
  await customer.getByPlaceholder("Ex.: 100,00").fill("50,00");
  // se o banco estourar o tempo (dev sob a rajada de jobs), nada é gravado e o cliente toca de novo
  await expect(async () => {
    const send = customer.getByRole("button", { name: /Enviar para a cozinha|Enviar pedido|Confirmar pedido/ });
    if (await send.count()) await send.click({ timeout: 5_000 });
    await expect(customer.getByRole("heading", { name: /^Pedido #\d+$/ })).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 90_000 });

  // o dono entra antes: a chamada ao motoboy tem prazo curto depois que a cozinha marca pronto
  const dono = await (await browser.newContext()).newPage();
  await dono.goto("/login");
  await dono.locator("input[name=email]").first().fill(ownerAccount.email);
  await dono.locator("input[name=password]").first().fill(ownerAccount.password);
  await dono.getByRole("button", { name: /^Entrar no painel/ }).click();
  await dono.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth/"), { timeout: 90_000 });

  const cozinha = await staffLogin(browser, "/cozinha/login", kitchen, /Abrir tela da cozinha/, /\/cozinha(\?|$)/);
  const card = cozinha.locator("article.kitchen-ticket").filter({ hasText: customerName });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: /^Aceitar/ }).click();
  await card.getByRole("button", { name: "Marcar como pronto" }).click();
  await expect(card.getByRole("button", { name: "Marcar como pronto" })).toHaveCount(0, { timeout: 30_000 });
  await cozinha.context().close();

  // com motoboy disponível, marcar pronto já chama o próximo da fila; se a chamada não chegou ou expirou,
  // o dono chama de novo pelo despacho
  await dono.goto("/painel/pedidos#despacho-entregas");
  const dispatch = dono.locator("article.dispatch-card").filter({ hasText: customerName });
  await expect(dispatch).toBeVisible({ timeout: 30_000 });
  const accept = moto.getByRole("button", { name: /^Aceitar entrega/ });
  await expect(async () => {
    if (!(await accept.waitFor({ state: "visible", timeout: 8_000 }).then(() => accept.isEnabled(), () => false))) {
      await dono.goto("/painel/pedidos#despacho-entregas", { waitUntil: "domcontentloaded" });
      await dispatch.getByRole("button", { name: /Iniciar despacho|Chamar próximo|Encerrar chamada e avançar/ }).first().click({ timeout: 5_000 });
      throw new Error("chamada reenviada");
    }
    await accept.click();
  }).toPass({ timeout: 90_000 });
  await moto.getByRole("button", { name: /Cheguei na loja/ }).click();
  await expect(moto.getByLabel(/Código de r/)).toBeVisible({ timeout: 30_000 });
  await dono.goto("/painel/pedidos#despacho-entregas", { waitUntil: "domcontentloaded" });
  // um clique só: cada clique gera um código novo e invalida o anterior; repetir criava corrida entre respostas
  await dono.waitForLoadState("networkidle");
  await dispatch.getByRole("button", { name: /Gerar (novo )?código/ }).click();
  await expect(dispatch.locator("[aria-live=polite] strong")).toHaveText(/^\s*(\d\s*){6}$/, { timeout: 45_000 });
  const code = (await dispatch.locator("[aria-live=polite] strong").innerText()).replace(/\D/g, "");
  expect(code).toMatch(/^\d{6}$/);
  await moto.getByLabel(/Código de r/).fill(code);
  // no banco do dev a confirmação já estourou o tempo sob carga (relatório da 99E); o motoboy toca de novo
  await expect(async () => {
    await moto.getByRole("button", { name: "Confirmar retirada" }).click({ timeout: 5_000 });
    await expect(moto.getByRole("button", { name: "Iniciar rota de entrega" })).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 60_000 });
  await moto.getByRole("button", { name: "Iniciar rota de entrega" }).click();
  await moto.getByRole("button", { name: "Cheguei ao endereço" }).click();

  const pin = customer.locator(".delivery-pin-card strong");
  await expect(pin).toBeVisible({ timeout: 45_000 });
  await moto.getByLabel("PIN de entrega").fill((await pin.innerText()).trim());
  await expect(async () => {
    const confirm = moto.getByRole("button", { name: "Confirmar entrega" });
    if (await confirm.count()) await confirm.click({ timeout: 5_000 });
    await expect(moto.getByRole("button", { name: "Confirmar entrega" })).toHaveCount(0, { timeout: 15_000 });
  }).toPass({ timeout: 60_000 });
  await expect(customer.getByText(/Entrega confirmada/)).toBeVisible({ timeout: 45_000 });

  await moto.getByRole("button", { name: "Encerrar turno" }).click().catch(() => undefined);
  await Promise.all([moto.context().close(), customer.context().close(), dono.context().close()]);
});
