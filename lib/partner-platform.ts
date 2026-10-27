import { createHash,randomBytes } from "node:crypto";
import { API_SCOPES } from "@/lib/integrations/types";
import { validateWebhookUrl } from "@/lib/integrations/security";

export const PARTNER_SCOPES=[...API_SCOPES,"customers:export"] as const;
export const RESTRICTED_SCOPES=new Set(["orders:write","products:write","customers:read","customers:export","inventory:write","reservations:write","finance:read","webhooks:manage"]);
export function secureId(prefix:string,bytes=24){return `${prefix}${randomBytes(bytes).toString("base64url")}`}
export function tokenHash(value:string){return createHash("sha256").update(value).digest("hex")}
export function pkceChallenge(verifier:string){return createHash("sha256").update(verifier).digest("base64url")}
export function scopes(value:unknown){return[...new Set((Array.isArray(value)?value:[]).map(String).filter(x=>(PARTNER_SCOPES as readonly string[]).includes(x)))]}
export function exactHttpsUrl(value:unknown){return validateWebhookUrl(String(value||""))}
export function callbackUrls(value:unknown){const list=[...new Set((Array.isArray(value)?value:[]).map(exactHttpsUrl))];if(!list.length||list.length>10)throw new Error("Cadastre de 1 a 10 URLs HTTPS de callback.");return list}
export function validSemver(value:unknown){const version=String(value||"").trim();if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version))throw new Error("Use versão semântica, por exemplo 1.0.0.");return version}
