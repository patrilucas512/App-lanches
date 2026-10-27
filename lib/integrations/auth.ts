import { createAdminClient } from "@/lib/supabase/admin";
import { safeHashEquals, sha256 } from "@/lib/integrations/security";
import type { ApiScope, IntegrationEnvironment } from "@/lib/integrations/types";

export class PublicApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export type ApiContext = {
  admin: ReturnType<typeof createAdminClient>; clientId: string; organizationId: string; name: string;
  scopes: string[]; storeIds: string[]; allStores: boolean; environment: IntegrationEnvironment;
  authType: "api_key" | "oauth_app"; apiClientId?: string; partnerAppId?: string; installationId?: string;
  requestId: string; rate: { limit: number; remaining: number; reset_at: number };
};

export async function authenticatePublicApi(request: Request, requiredScope: ApiScope): Promise<ApiContext> {
  const raw = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (/^ma_oauth_[A-Za-z0-9_-]{40,}$/.test(raw)) return authenticateOAuthApp(request,raw,requiredScope);
  const match = raw.match(/^ma_(live|test)_(cli_[A-Za-z0-9]{20,64})\.([A-Za-z0-9_-]{32,})$/);
  if (!match) throw new PublicApiError(401, "invalid_api_key", "API key ausente ou inválida.");
  const environment: IntegrationEnvironment = match[1] === "test" ? "sandbox" : "production";
  const admin = createAdminClient();
  const { data: client } = await admin.from("api_clients").select("id,organization_id,name,secret_hash,previous_secret_hash,previous_secret_expires_at,status,scopes,all_stores,environment,rate_limit_per_minute,expires_at").eq("client_id", match[2]).maybeSingle();
  const digest = sha256(raw);
  const previousValid = client?.previous_secret_hash && client.previous_secret_expires_at && new Date(client.previous_secret_expires_at) > new Date() && safeHashEquals(digest, client.previous_secret_hash);
  if (!client || (!safeHashEquals(digest, client.secret_hash) && !previousValid) || client.status !== "active" || client.environment !== environment || client.expires_at && new Date(client.expires_at) <= new Date()) throw new PublicApiError(401, "invalid_api_key", "API key inválida, expirada ou revogada.");
  if (!(client.scopes || []).includes(requiredScope)) throw new PublicApiError(403, "insufficient_scope", `O scope ${requiredScope} é obrigatório.`);
  const forwardedIp = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "").split(",")[0].trim();
  const ipHash = forwardedIp ? sha256(`masterapp-api:${forwardedIp}`) : null;
  const { data: rate } = await admin.rpc("consume_api_rate_limit", { requested_client_id: client.id, requested_limit: client.rate_limit_per_minute, requested_ip_hash: ipHash });
  if (!rate?.allowed) throw new PublicApiError(429, "rate_limit_exceeded", "Limite de requisições excedido.", rate);
  const { data: access } = client.all_stores ? { data: [] } : await admin.from("api_client_store_access").select("store_id").eq("api_client_id", client.id);
  await admin.from("api_clients").update({ last_used_at: new Date().toISOString() }).eq("id", client.id);
  return { admin, clientId: client.id, apiClientId: client.id, authType:"api_key", organizationId: client.organization_id, name: client.name, scopes: client.scopes || [], storeIds: (access || []).map((item: { store_id: string }) => item.store_id), allStores: client.all_stores, environment, requestId: request.headers.get("x-request-id") || `req_${crypto.randomUUID().replaceAll("-", "")}`, rate };
}

async function authenticateOAuthApp(request:Request,raw:string,requiredScope:ApiScope):Promise<ApiContext>{
 const admin=createAdminClient();const digest=sha256(raw);const{data:token}=await admin.from("app_oauth_tokens").select("id,installation_id,app_id,organization_id,scopes,status,access_expires_at,app_installations!inner(id,status,all_stores,granted_scopes),partner_apps!inner(id,name,status,kill_switch_active)").eq("access_token_hash",digest).maybeSingle();const installation:any=Array.isArray((token as any)?.app_installations)?(token as any).app_installations[0]:(token as any)?.app_installations;const app:any=Array.isArray((token as any)?.partner_apps)?(token as any).partner_apps[0]:(token as any)?.partner_apps;
 if(!token||token.status!=="active"||new Date(token.access_expires_at)<=new Date()||installation?.status!=="active"||app?.status!=="published"||app?.kill_switch_active)throw new PublicApiError(401,"invalid_oauth_token","Token OAuth inválido, expirado ou revogado.");
 if(!(token.scopes||[]).includes(requiredScope)||!(installation.granted_scopes||[]).includes(requiredScope))throw new PublicApiError(403,"insufficient_scope",`O scope ${requiredScope} não foi consentido.`);
 const{data:rate}=await admin.rpc("consume_app_rate_limit",{requested_app_id:token.app_id,requested_installation_id:token.installation_id,requested_organization_id:token.organization_id,requested_limit:120});if(!rate?.allowed)throw new PublicApiError(429,"rate_limit_exceeded","Limite do aplicativo excedido.",rate);
 const{data:access}=installation.all_stores?{data:[]}:await admin.from("app_installation_stores").select("store_id").eq("installation_id",token.installation_id);await admin.from("app_oauth_tokens").update({last_used_at:new Date().toISOString()}).eq("id",token.id);await admin.from("app_installations").update({last_access_at:new Date().toISOString()}).eq("id",token.installation_id);
 return{admin,clientId:token.id,authType:"oauth_app",partnerAppId:token.app_id,installationId:token.installation_id,organizationId:token.organization_id,name:app.name,scopes:token.scopes||[],storeIds:(access||[]).map((x:{store_id:string})=>x.store_id),allStores:Boolean(installation.all_stores),environment:"production",requestId:request.headers.get("x-request-id")||`req_${crypto.randomUUID().replaceAll("-","")}`,rate};
}

export async function assertStoreAccess(context: ApiContext, requestedStoreId: string) {
  const { data: store } = await context.admin.from("establishments").select("id,organization_id").eq("id", requestedStoreId).eq("organization_id", context.organizationId).maybeSingle();
  if (!store || !context.allStores && !context.storeIds.includes(requestedStoreId)) throw new PublicApiError(403, "store_forbidden", "A credencial não possui acesso a esta unidade.");
  return store;
}

export function apiHeaders(context: ApiContext) {
  return { "X-Request-Id": context.requestId, "X-RateLimit-Limit": String(context.rate.limit), "X-RateLimit-Remaining": String(context.rate.remaining), "X-RateLimit-Reset": String(context.rate.reset_at) };
}
