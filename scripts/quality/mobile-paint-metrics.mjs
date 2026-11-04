// Fase 98H: primeira pintura, LCP e bytes de CSS/JS no celular, sem Lighthouse (usa o Chromium do Playwright).
// Perfil parecido com o "mobile" do Lighthouse: Pixel 7, CPU 4x mais lenta, rede 4G lenta (1,6 Mbps, 150 ms).
// Uso: node scripts/quality/mobile-paint-metrics.mjs http://127.0.0.1:3000 /loja/lanchonete-teste /conta/lanchonete-teste
// Nunca aponte para produção: o cardápio grava eventos de visita.
import { chromium, devices } from "@playwright/test";

const [base, ...paths] = process.argv.slice(2);
if (!base || /app-lanches-psi\.vercel\.app/.test(base)) throw new Error("Informe um endereço que não seja produção.");
const runs = Number(process.env.RUNS || 3);
const browser = await chromium.launch();
const results = [];
for (const path of paths) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ ...devices["Pixel 7"], extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : undefined });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const bytes = { css: 0, js: 0, img: 0, total: 0 };
    cdp.on("Network.loadingFinished", (e) => { bytes.total += e.encodedDataLength; });
    const types = new Map();
    cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
    cdp.on("Network.loadingFinished", (e) => { const t = types.get(e.requestId); if (t === "Stylesheet") bytes.css += e.encodedDataLength; if (t === "Script") bytes.js += e.encodedDataLength; if (t === "Image") bytes.img += e.encodedDataLength; });
    await page.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.goto(base + path, { waitUntil: "load", timeout: 120_000 });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      lcp: window.__lcp || null,
      cssFiles: performance.getEntriesByType("resource").filter((r) => r.initiatorType === "link" && r.name.includes(".css")).length,
    }));
    samples.push({ ...m, ...bytes });
    await context.close();
  }
  const median = (k) => { const v = samples.map((s) => s[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  results.push({ path, fcp_ms: Math.round(median("fcp")), lcp_ms: Math.round(median("lcp")), css_kb: Math.round(median("css") / 1024), js_kb: Math.round(median("js") / 1024), total_kb: Math.round(median("total") / 1024), css_files: median("cssFiles"), runs });
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
