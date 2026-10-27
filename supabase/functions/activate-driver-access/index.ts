import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const allowedOrigins = new Set(["https://mesa-viva-patrilucas.patricklucas512.chatgpt.site", "http://localhost:3000"]);
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" });
const reply = (origin: string | null, status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const normalizePhone = (value: string) => { const digits = value.replace(/\D/g, ""); if (digits.length === 10 || digits.length === 11) return `55${digits}`; return digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits : null; };

type Invite = { name: string; phone: string; user_id: string | null; employment_type: "fixed" | "daily"; work_date: string | null };

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply(origin, 405, { error: "Método não permitido." });
  try {
    const { token, password } = await request.json();
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token) || typeof password !== "string" || password.length < 8 || password.length > 72) return reply(origin, 400, { error: "Convite ou senha inválidos." });
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !key || !publicKey) return reply(origin, 500, { error: "Serviço indisponível." });
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error: inviteError } = await admin.rpc("get_driver_invite_for_activation", { requested_token: token });
    const invite = data as Invite | null;
    const phone = normalizePhone(invite?.phone || "");
    if (inviteError || !invite || !phone) return reply(origin, 400, { error: "Este acesso expirou ou o WhatsApp é inválido." });
    const loginEmail = `d.${phone}@motoboy.masterapp.app`;
    let userId = invite.user_id; let created = false;
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { email: loginEmail, password, email_confirm: true, app_metadata: { access_type: "driver" } });
      if (error) return reply(origin, 400, { error: "Não foi possível atualizar a senha." });
    } else {
      const { data: createdUser, error } = await admin.auth.admin.createUser({ email: loginEmail, password, email_confirm: true, app_metadata: { access_type: "driver" }, user_metadata: { display_name: invite.name, phone } });
      if (error || !createdUser.user) return reply(origin, 400, { error: "Não foi possível criar o acesso. Verifique se o WhatsApp já está em uso." });
      userId = createdUser.user.id; created = true;
    }
    const auth = createClient(url, publicKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: authData, error: authError } = await auth.auth.signInWithPassword({ email: loginEmail, password });
    if (authError || !authData.session) {
      if (created && userId) await admin.auth.admin.deleteUser(userId);
      return reply(origin, 400, { error: "Senha salva, mas não foi possível abrir a sessão. Use o mesmo link para tentar novamente." });
    }
    const { error: claimError } = await admin.rpc("claim_driver_invite_as_user", { requested_token: token, requested_user_id: userId });
    if (claimError) { if (created && userId) await admin.auth.admin.deleteUser(userId); return reply(origin, 400, { error: claimError.message }); }
    return reply(origin, 200, {
      login_email: loginEmail,
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      activated: true,
      employment_type: invite.employment_type,
      work_date: invite.work_date,
    });
  } catch { return reply(origin, 400, { error: "Não foi possível ativar o acesso." }); }
});
