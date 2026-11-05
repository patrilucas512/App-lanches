// Fase 99F: capturas de conferência das telas principais depois da separação do CSS.
// Uso: node scripts/quality/phase99-screens.mjs http://localhost:3000 docs/phase99-screens
// Usa o dono fictício do seed do dev (.env.test-login.local). Nunca aponte para produção.
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:3000", out = "docs/phase99-screens"] = process.argv.slice(2);
if (/app-lanches-psi\.vercel\.app|app-lanches-lucas-patrick|app-lanches-git-main/.test(base)) throw new Error("Não use produção.");
try { process.loadEnvFile(".env.test-login.local"); } catch { /* opcional */ }
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const shot = async (page, name) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.screenshot({ path: `${out}/${name}.png` }); console.log(`${out}/${name}.png`); };

const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "pt-BR" });
const menu = await phone.newPage();
await menu.goto(`${base}/loja/lanchonete-teste`);
await shot(menu, "cardapio-celular");
await menu.goto(`${base}/cadastro`);
await menu.locator("input[name=name]").fill("Texto digitado visível");
await shot(menu, "cadastro-celular");
await phone.close();

const desk = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "pt-BR" });
const page = await desk.newPage();
if (process.env.DEV_OWNER_EMAIL && process.env.DEV_OWNER_PASSWORD) {
  await page.goto(`${base}/login`);
  await page.waitForLoadState("networkidle");
  await page.locator("input[name=email]").first().fill(process.env.DEV_OWNER_EMAIL);
  await page.locator("input[name=password]").first().fill(process.env.DEV_OWNER_PASSWORD);
  await page.getByRole("button", { name: /^Entrar no painel/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  // fecha o tour guiado, se aparecer
  await page.getByRole("button", { name: "Pular tour" }).click({ timeout: 5_000 }).catch(() => {});
  for (const [path, name] of [["/painel", "painel-inicio"], ["/painel/pedidos", "painel-pedidos"], ["/painel/cardapio", "painel-cardapio"], ["/painel/configuracoes", "painel-configuracoes"], ["/painel/garcom", "painel-garcom"]]) {
    await page.goto(`${base}${path}`);
    await page.getByRole("button", { name: "Pular tour" }).click({ timeout: 2_000 }).catch(() => {});
    await shot(page, name);
    if (path === "/painel/pedidos") {
      // sem entrega em andamento não há quadro: insere um de exemplo dentro de um cartão de despacho, com as mesmas classes
      const eta = await page.evaluate(() => {
        let box = document.querySelector(".dispatch-eta");
        if (!box) {
          const host = document.querySelector("#despacho-entregas") || document.querySelector(".dashboard-content") || document.body;
          const card = document.createElement("article"); card.className = "dispatch-card status-driver_assigned";
          card.innerHTML = '<div class="dispatch-eta"><small>PREVISÃO AO CLIENTE</small><b>40–55 min</b><span>Limite estimado: 20:30</span></div>';
          host.appendChild(card); box = card.querySelector(".dispatch-eta");
        }
        const b = box.querySelector("b"); const rules = [];
        const walk = (list) => { for (const r of list) { if (r.selectorText) { try { if (b.matches(r.selectorText) && r.style.color) rules.push(`${r.selectorText.slice(0, 160)} => ${r.style.color}${r.style.getPropertyPriority("color") ? " !important" : ""}`); } catch { /* seletor inválido */ } } if (r.cssRules && !r.selectorText) walk(r.cssRules); } };
        for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* outra origem */ } }
        return { colors: [...box.querySelectorAll("*")].map((el) => `${el.tagName} ${getComputedStyle(el).color} on ${getComputedStyle(box).backgroundColor}`), rules, inline: b.closest("[style]")?.getAttribute("style")?.slice(0, 200) };
      });
      console.log("previsão ao cliente:", JSON.stringify(eta));
    }
  }
}
await browser.close();
