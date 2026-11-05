// Fase 99G: registro de erros do app (rotas e APIs) no banco, sem dados pessoais nem segredos.
// Chamado por instrumentation.ts (onRequestError). Nunca lança: se o registro falhar, o erro original segue.
import { createHash } from "node:crypto";

const MAX = 500;

// Mascara e-mail, telefone, CPF/CNPJ, tokens e chaves antes de qualquer coisa ir para o banco.
export function redact(text: unknown): string {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(sk|pk|rk|sb_secret|sb_publishable|whsec|eyJ)[A-Za-z0-9_\-.]{8,}/g, "[segredo]")
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [segredo]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj]")
    .replace(/(\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/g, "[telefone]")
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "[token]")
    .slice(0, MAX);
}

// Só o caminho, sem query string; segmentos com cara de identificador viram ":id".
export function safePath(path: unknown): string {
  return String(path ?? "").split("?")[0]
    .split("/").map((s) => (/^[0-9a-f-]{20,}$/i.test(s) || /^\d{4,}$/.test(s) || s.length > 40 ? ":id" : s)).join("/")
    .slice(0, 200);
}

export type AppErrorInput = { error: unknown; method?: string; path?: string; routePath?: string; routeType?: string; status?: number };

export function appErrorRow(input: AppErrorInput) {
  const err = input.error as { name?: string; message?: string; digest?: string } | undefined;
  const route = input.routePath ? String(input.routePath).slice(0, 200) : safePath(input.path);
  const name = String(err?.name || "Error").slice(0, 80);
  const message = redact(err?.message);
  return {
    environment: process.env.MASTERAPP_ENVIRONMENT || process.env.VERCEL_ENV || "development",
    release: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || null,
    route,
    route_type: input.routeType ? String(input.routeType).slice(0, 20) : null,
    method: input.method ? String(input.method).slice(0, 10) : null,
    status: input.status ?? 500,
    error_name: name,
    message,
    digest: err?.digest ? String(err.digest).slice(0, 80) : null,
    fingerprint: createHash("sha256").update(`${route}|${name}|${message.replace(/\d+/g, "#")}`).digest("hex").slice(0, 32),
  };
}

export async function recordAppError(input: AppErrorInput) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/app_error_events`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(appErrorRow(input)),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // o registro de erro nunca derruba a resposta
  }
}
