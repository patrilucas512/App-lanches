import { randomUUID } from "node:crypto";

export const RELEASE_VERSION = process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_RELEASE_VERSION || "development";

const SECRET_KEYS = /token|password|secret|authorization|cookie|otp|card|credential|signature/i;
export type LogLevel = "debug" | "info" | "warn" | "error";

export function correlationId(candidate?: string | null) {
  const safe = String(candidate || "").trim();
  return safe && safe.length <= 160 && /^[a-zA-Z0-9._:-]+$/.test(safe) ? safe : randomUUID();
}

export function sanitizeContext(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeContext(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" && value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SECRET_KEYS.test(key) ? "[redacted]" : sanitizeContext(item, depth + 1)]));
}

export function structuredLog(level: LogLevel, module: string, message: string, context: Record<string, unknown> = {}) {
  const payload = { timestamp: new Date().toISOString(), level, module, message, release: RELEASE_VERSION, ...sanitizeContext(context) as object };
  const serialized = JSON.stringify(payload);
  if (level === "error") console.error(serialized); else if (level === "warn") console.warn(serialized); else console.info(serialized);
  return payload;
}

export async function withTrace<T>(input: { service: string; operation: string; correlationId?: string | null; organizationId?: string | null; storeId?: string | null }, task: (trace: { traceId: string; spanId: string; correlationId: string }) => Promise<T>) {
  const trace = { traceId: randomUUID(), spanId: randomUUID(), correlationId: correlationId(input.correlationId) };
  const started = performance.now();
  try {
    const value = await task(trace);
    structuredLog("info", input.service, input.operation, { organization_id: input.organizationId, store_id: input.storeId, correlation_id: trace.correlationId, trace_id: trace.traceId, span_id: trace.spanId, duration_ms: Math.round(performance.now() - started), status: "ok" });
    return value;
  } catch (cause) {
    structuredLog("error", input.service, input.operation, { organization_id: input.organizationId, store_id: input.storeId, correlation_id: trace.correlationId, trace_id: trace.traceId, span_id: trace.spanId, duration_ms: Math.round(performance.now() - started), error_code: cause instanceof Error ? cause.name : "unknown", error: cause instanceof Error ? cause.message : "unknown" });
    throw cause;
  }
}

export async function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("Timeout inválido.");
  return task(AbortSignal.timeout(timeoutMs));
}

export async function withRetry<T>(task: (attempt: number) => Promise<T>, options: { attempts?: number; baseDelayMs?: number; jitterMs?: number; retryable?: (error: unknown) => boolean } = {}) {
  const attempts = Math.max(1, Math.min(10, options.attempts ?? 3));
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await task(attempt); }
    catch (error) {
      last = error;
      if (attempt === attempts || options.retryable?.(error) === false) throw error;
      const delay = Math.min(30_000, (options.baseDelayMs ?? 100) * 2 ** (attempt - 1)) + Math.floor(Math.random() * (options.jitterMs ?? 50));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(private readonly threshold = 5, private readonly resetMs = 30_000) {}
  get state(): "closed" | "open" | "half-open" { if (!this.openedAt) return "closed"; return Date.now() - this.openedAt >= this.resetMs ? "half-open" : "open"; }
  async run<T>(task: () => Promise<T>) {
    if (this.state === "open") throw new Error("Circuit breaker aberto.");
    try { const value = await task(); this.failures = 0; this.openedAt = 0; return value; }
    catch (error) { this.failures += 1; if (this.failures >= this.threshold) this.openedAt = Date.now(); throw error; }
  }
}

type CacheEntry<T> = { value: T; expiresAt: number };
export class TenantCache {
  private values = new Map<string, CacheEntry<unknown>>();
  private flights = new Map<string, Promise<unknown>>();
  key(namespace: string, organizationId: string, storeId: string | null, version: number | string, suffix = "default") { return [namespace, organizationId, storeId || "all", version, suffix].join(":"); }
  invalidate(prefix: string) { for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key); }
  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>) {
    const current = this.values.get(key) as CacheEntry<T> | undefined;
    if (current && current.expiresAt > Date.now()) return current.value;
    const active = this.flights.get(key) as Promise<T> | undefined;
    if (active) return active;
    const flight = loader().then((value) => { this.values.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) + Math.floor(Math.random() * Math.max(1, ttlMs * .1)) }); return value; }).finally(() => this.flights.delete(key));
    this.flights.set(key, flight); return flight;
  }
}

export function cursorPage<T extends { created_at: string; id: string }>(rows: T[], limit: number) {
  const page = rows.slice(0, Math.max(1, Math.min(100, limit)));
  const last = page.at(-1);
  return { data: page, nextCursor: last ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64url") : null };
}
