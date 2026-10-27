import { performance } from "node:perf_hooks";

const target = process.env.LOAD_TEST_URL;
const concurrency = Math.max(1, Math.min(1000, Number(process.env.LOAD_TEST_CONCURRENCY || 100)));
const requests = Math.max(concurrency, Math.min(100000, Number(process.env.LOAD_TEST_REQUESTS || concurrency * 10)));
if (!target) throw new Error("Defina LOAD_TEST_URL para um ambiente autorizado.");
const url = new URL(target);
if (url.hostname.endsWith("chatgpt.site") && process.env.ALLOW_PRODUCTION_LOAD_TEST !== "true") throw new Error("Teste contra produção bloqueado. Use ambiente isolado ou autorização explícita.");

const samples = []; let failures = 0; let cursor = 0; const started = performance.now();
async function worker() {
  while (cursor < requests) {
    cursor += 1; const before = performance.now();
    try { const response = await fetch(url, { headers: { "x-load-test-scenario": process.env.LOAD_TEST_SCENARIO || "health" }, signal: AbortSignal.timeout(10000) }); if (!response.ok) failures += 1; await response.arrayBuffer(); }
    catch { failures += 1; }
    samples.push(performance.now() - before);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker)); samples.sort((a,b)=>a-b);
const percentile = (p) => samples[Math.min(samples.length-1,Math.floor(samples.length*p))] || 0; const duration = performance.now()-started;
console.log(JSON.stringify({ scenario:process.env.LOAD_TEST_SCENARIO||"health",concurrency,requests,duration_ms:Math.round(duration),requests_per_second:Number((requests/(duration/1000)).toFixed(2)),p50_ms:Number(percentile(.50).toFixed(2)),p95_ms:Number(percentile(.95).toFixed(2)),p99_ms:Number(percentile(.99).toFixed(2)),failures,error_rate_percent:Number((100*failures/requests).toFixed(3)) },null,2));
