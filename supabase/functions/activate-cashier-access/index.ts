import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const allowedOrigins = new Set(["https://mesa-viva-patrilucas.patricklucas512.chatgpt.site", "http://localhost:3000"]);
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" });
const reply = (origin: string | null, status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const phone = (value: string) => { const digits = value.replace(/\D/g, ""); if (digits.length === 10 || digits.length === 11) return `55${digits}`; return digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits : null; };

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply(origin, 405, { error: "Método não permitido." });
  try {
    const { token, password } = await request.json();
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token) || typeof password !== "string" || password.length < 8 || password.length > 72) return reply(origin, 400, { error: "Convite ou senha inválidos." });
    const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return reply(origin, 500, { error: "Serviço indisponível." });
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: link } = await admin.from("cashier_access_links").select("staff_member_id,expires_at,used_at,custom_staff_members(id,name,phone,user_id,employment_type,work_date)").eq("token", token).is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    const raw = Array.isArray(link?.custom_staff_members) ? link?.custom_staff_members[0] : link?.custom_staff_members;
    const member = raw as { id: string; name: string; phone: string; user_id: string | null; employment_type: string; work_date: string | null } | null;
    const normalizedPhone = phone(member?.phone || "");
    if (!link || !member || !normalizedPhone) return reply(origin, 400, { error: "Este acesso expirou ou o WhatsApp é inválido." });
    const loginEmail = `c.${normalizedPhone}@caixa.mesaviva.app`; let userId = member.user_id; let created = false;
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { email: loginEmail, password, email_confirm: true, app_metadata: { access_type: "cashier" } });
      if (error) return reply(origin, 400, { error: "Não foi possível atualizar a senha." });
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email: loginEmail, password, email_confirm: true, app_metadata: { access_type: "cashier" }, user_metadata: { display_name: member.name, phone: normalizedPhone } });
      if (error || !data.user) return reply(origin, 400, { error: "Não foi possível criar o acesso. Verifique se o WhatsApp já está em uso." });
      userId = data.user.id; created = true;
    }
    if (!link.used_at) {
      const { error } = await admin.rpc("claim_cashier_invite_as_user", { requested_token: token, requested_user_id: userId });
      if (error) { if (created && userId) await admin.auth.admin.deleteUser(userId); return reply(origin, 400, { error: error.message }); }
    }
    return reply(origin, 200, { login_email: loginEmail, activated: true, employment_type: member.employment_type, work_date: member.work_date });
  } catch { return reply(origin, 400, { error: "Não foi possível ativar o acesso." }); }
});
