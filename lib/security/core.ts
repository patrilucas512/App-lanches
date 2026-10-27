import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export class SecurityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function secureDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function secureEqual(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function recoveryCode() {
  return randomBytes(9).toString("base64url").toUpperCase().match(/.{1,4}/g)!.join("-");
}

export function requestIp(request: Request) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

export function requestRegion(request: Request) {
  const value = request.headers.get("cf-ipcountry") || request.headers.get("x-vercel-ip-country") || "";
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expectedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
  if (new URL(origin).host !== expectedHost) throw new SecurityError(403, "Origem da requisição não autorizada.");
}

export function deviceLabel(userAgent: string) {
  const os = /android/i.test(userAgent) ? "Android" : /iphone|ipad/i.test(userAgent) ? "iPhone/iPad" : /windows/i.test(userAgent) ? "Windows" : /macintosh/i.test(userAgent) ? "macOS" : /linux/i.test(userAgent) ? "Linux" : "Dispositivo";
  const browser = /edg/i.test(userAgent) ? "Edge" : /chrome/i.test(userAgent) ? "Chrome" : /firefox/i.test(userAgent) ? "Firefox" : /safari/i.test(userAgent) ? "Safari" : "Navegador";
  return { device: os, browser, label: `${os} · ${browser}` };
}

export async function requireSecurityUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = String(data?.claims?.sub || "");
  if (!userId) throw new SecurityError(401, "Sessão não autenticada.");
  return { supabase, userId, claims: data.claims };
}

export async function assertOrganizationAccess(userId: string, organizationId: string, adminOnly = false) {
  const admin = createAdminClient();
  const [{ data: profile }, { data: member }] = await Promise.all([
    admin.from("profiles").select("is_superadmin").eq("id", userId).maybeSingle(),
    admin.from("organization_members").select("role,active").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle(),
  ]);
  const isSuperadmin = Boolean(profile?.is_superadmin);
  const allowed = isSuperadmin || Boolean(member?.active && (!adminOnly || ["owner", "admin"].includes(member.role)));
  if (!allowed) throw new SecurityError(403, "Você não possui permissão de segurança para esta empresa.");
  return { admin, member, isSuperadmin };
}

export async function assertSecurityEntitlement(admin: ReturnType<typeof createAdminClient>, organizationId: string, feature: string) {
  const { data } = await admin.from("subscriptions").select(`plans(${feature})`).eq("organization_id", organizationId).in("status", ["active", "trialing"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const plans = data?.plans as unknown as Array<Record<string, unknown>> | Record<string, unknown> | null;
  const plan = Array.isArray(plans) ? plans[0] : plans;
  if (!plan || plan[feature] !== true) throw new SecurityError(403, "Este recurso de segurança não está incluído no plano atual.");
}

export async function enforceOrganizationIpPolicy(admin: ReturnType<typeof createAdminClient>, organizationId: string, userId: string, request: Request) {
  const { data: settings } = await admin.from("organization_security_settings").select("admin_ip_allowlist,break_glass_user_id").eq("organization_id", organizationId).maybeSingle();
  if (!settings?.admin_ip_allowlist?.length || settings.break_glass_user_id === userId) return;
  const { data: allowed, error } = await admin.rpc("security_ip_allowed", { requested_organization_id: organizationId, requested_ip: requestIp(request) });
  if (error || !allowed) throw new SecurityError(403, "Acesso administrativo fora da faixa de IP autorizada.");
}

export async function securityAudit(input: {
  admin: ReturnType<typeof createAdminClient>; userId: string; organizationId: string | null;
  action: string; targetType?: string; targetId?: string | null; before?: unknown; after?: unknown;
  request?: Request; correlationId?: string;
}) {
  const userAgent = input.request?.headers.get("user-agent")?.slice(0, 500) || null;
  const ip = input.request ? requestIp(input.request) : null;
  await input.admin.from("security_audit_logs").insert({
    actor_user_id: input.userId,
    organization_id: input.organizationId,
    action: input.action,
    target_type: input.targetType || null,
    target_id: input.targetId || null,
    ip_hash: ip ? secureDigest(`security-ip:${ip}`) : null,
    user_agent: userAgent,
    before_state: input.before || {},
    after_state: input.after || {},
    correlation_id: input.correlationId || crypto.randomUUID(),
  });
}

export function validatePasswordPolicy(password: string) {
  if (password.length < 10) return "Use pelo menos 10 caracteres.";
  if (/^(password|senha|123456|qwerty|masterapp)/i.test(password)) return "Esta senha é muito previsível.";
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Combine letras e números.";
  return null;
}

export function validateSecurityUpload(file: { name: string; type: string; size: number }) {
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "text/csv", "application/json"]);
  const extension = file.name.toLowerCase().split(".").pop() || "";
  const allowedExtensions = new Set(["pdf", "png", "jpg", "jpeg", "csv", "json"]);
  if (!allowed.has(file.type) || !allowedExtensions.has(extension)) throw new SecurityError(415, "Tipo de arquivo não permitido.");
  if (file.size > 10 * 1024 * 1024) throw new SecurityError(413, "O arquivo excede 10 MB.");
  if (/[/\\]|\.\./.test(file.name)) throw new SecurityError(400, "Nome de arquivo inválido.");
  return true;
}
