import { NextResponse } from "next/server";
import { authenticatePublicApi, apiHeaders, PublicApiError, type ApiContext } from "@/lib/integrations/auth";
import { bodyHash, createOrder, createReservation, financeSummary, getResource, listResource, updateAvailability, updateOrderStatus, updateReservation } from "@/lib/integrations/public-api";
import type { ApiScope } from "@/lib/integrations/types";
import { sha256 } from "@/lib/integrations/security";

type Params = { params: Promise<{ path: string[] }> };
const resourceScopes: Record<string, { read: ApiScope; write?: ApiScope }> = { orders: { read: "orders:read", write: "orders:write" }, products: { read: "products:read", write: "products:write" }, customers: { read: "customers:read" }, inventory: { read: "inventory:read", write: "inventory:write" }, reservations: { read: "reservations:read", write: "reservations:write" }, finance: { read: "finance:read" } };

function response(data: unknown, status: number, context: ApiContext) { return NextResponse.json(data, { status, headers: apiHeaders(context) }); }
async function log(context: ApiContext, request: Request, status: number, started: number, errorCode?: string, storeId?: string) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  await context.admin.from("api_request_logs").insert({ organization_id: context.organizationId, api_client_id: context.apiClientId || null, partner_app_id:context.partnerAppId||null,app_installation_id:context.installationId||null, store_id: storeId || null, request_id: context.requestId, method: request.method, path: new URL(request.url).pathname, status_code: status, latency_ms: Date.now() - started, ip_hash: ip ? sha256(ip) : null, error_code: errorCode || null });
}
async function idempotent(context: ApiContext, request: Request, body: unknown, execute: (key: string) => Promise<unknown>) {
  const key = request.headers.get("idempotency-key")?.trim(); if (!key || key.length < 8 || key.length > 200) throw new PublicApiError(400, "idempotency_key_required", "Envie Idempotency-Key com 8 a 200 caracteres.");
  const hash = bodyHash(body); let existingQuery=context.admin.from("api_idempotency_keys").select("request_hash,response_status,response_body").eq("idempotency_key",key).gt("expires_at",new Date().toISOString());existingQuery=context.authType==="oauth_app"?existingQuery.eq("app_installation_id",context.installationId):existingQuery.eq("api_client_id",context.apiClientId);const { data: existing } = await existingQuery.maybeSingle();
  if (existing) { if (existing.request_hash !== hash) throw new PublicApiError(409, "idempotency_conflict", "A chave já foi usada com outro payload."); return { body: existing.response_body, status: existing.response_status || 200 }; }
  const result = await execute(key); await context.admin.from("api_idempotency_keys").insert({ api_client_id: context.apiClientId||null,app_installation_id:context.installationId||null, organization_id: context.organizationId, idempotency_key: key, request_method: request.method, request_path: new URL(request.url).pathname, request_hash: hash, response_status: 201, response_body: result }); return { body: result, status: 201 };
}

async function handle(request: Request, route: string[], method: string) {
  const started = Date.now(); let context: ApiContext | undefined;
  try {
    const resource = route[0]; const spec = resourceScopes[resource]; if (!spec) throw new PublicApiError(404, "endpoint_not_found", "Endpoint v1 não encontrado.");
    const write = method !== "GET"; const scope = write ? spec.write : spec.read; if (!scope) throw new PublicApiError(405, "method_not_allowed", "Método não permitido.");
    context = await authenticatePublicApi(request, scope); const url = new URL(request.url); let result: unknown; let status = 200;
    const { error: usageError } = await context.admin.rpc("record_saas_usage", { requested_organization_id: context.organizationId, requested_establishment_id: url.searchParams.get("store_id") || null, requested_meter: "api_requests", requested_quantity: 1, requested_idempotency_key: `api:${context.requestId}`, requested_provider_cost_micros: 0, requested_metadata: { path: url.pathname, method } });
    if (usageError) throw new PublicApiError(429, "plan_usage_limit_exceeded", "Limite mensal da API atingido. Faça upgrade ou contrate um adicional.");
    if (method === "GET" && resource === "finance" && route[1] === "summary") result = await financeSummary(context, url);
    else if (method === "GET" && route[1]) result = await getResource(context, resource as any, route[1]);
    else if (method === "GET") result = await listResource(context, resource as any, url);
    else {
      const body = await request.json().catch(() => { throw new PublicApiError(400, "invalid_json", "JSON inválido."); });
      if (method === "POST" && resource === "orders" && !route[1]) { const saved = await idempotent(context, request, body, () => createOrder(context!, body)); result = saved.body; status = saved.status; }
      else if (method === "PATCH" && resource === "orders" && route[2] === "status") result = await updateOrderStatus(context, route[1], body);
      else if (method === "PATCH" && resource === "products" && route[2] === "availability") result = await updateAvailability(context, route[1], body);
      else if (method === "POST" && resource === "reservations" && !route[1]) { const saved = await idempotent(context, request, body, key => createReservation(context!, body, key)); result = saved.body; status = saved.status; }
      else if (method === "PATCH" && resource === "reservations" && route[1]) result = await updateReservation(context, route[1], body);
      else throw new PublicApiError(405, "method_not_allowed", "Método não permitido.");
    }
    await log(context, request, status, started, undefined, url.searchParams.get("store_id") || undefined); return response({ data: result, request_id: context.requestId }, status, context);
  } catch (error) {
    const known = error instanceof PublicApiError ? error : new PublicApiError(500, "internal_error", "Erro interno da API.");
    if (context) await log(context, request, known.status, started, known.code); return NextResponse.json({ error: { code: known.code, message: known.message, details: known.details }, request_id: context?.requestId }, { status: known.status, headers: context ? apiHeaders(context) : undefined });
  }
}
export async function GET(request: Request, { params }: Params) { return handle(request, (await params).path || [], "GET"); }
export async function POST(request: Request, { params }: Params) { return handle(request, (await params).path || [], "POST"); }
export async function PATCH(request: Request, { params }: Params) { return handle(request, (await params).path || [], "PATCH"); }
