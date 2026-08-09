import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const allowedOrigins = new Set([
  "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site",
  "http://localhost:3000",
]);

function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(origin), "Content-Type": "application/json" } });
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST") return reply(origin, 405, { error: "Método não permitido." });
  try {
    const { token, password } = await request.json();
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) return reply(origin, 400, { error: "Acesso inválido." });
    if (typeof password !== "string" || password.length < 8 || password.length > 72) return reply(origin, 400, { error: "A senha deve ter entre 8 e 72 caracteres." });
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return reply(origin, 500, { error: "Serviço de acesso indisponível." });
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: link, error: linkError } = await admin.from("kitchen_access_links")
      .select("operator_id,expires_at,used_at,kitchen_operators(id,name,phone,user_id,access_type,work_date)")
      .eq("token", token).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (linkError || !link) return reply(origin, 400, { error: "Este acesso é inválido ou expirou." });
    const value = Array.isArray(link.kitchen_operators) ? link.kitchen_operators[0] : link.kitchen_operators;
    const operator = value as { id: string; name: string; phone: string; user_id: string | null; access_type: string; work_date: string | null } | null;
    const phone = normalizePhone(operator?.phone || "");
    if (!operator || !phone) return reply(origin, 400, { error: "O WhatsApp cadastrado é inválido." });
    const loginEmail = `k.${phone}@cozinha.mesaviva.app`;
    let userId = operator.user_id;
    let created = false;
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { email: loginEmail, password, email_confirm: true });
      if (error) return reply(origin, 400, { error: "Não foi possível atualizar este acesso." });
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: loginEmail, password, email_confirm: true,
        app_metadata: { access_type: "kitchen" },
        user_metadata: { display_name: operator.name, phone },
      });
      if (error || !data.user) return reply(origin, 400, { error: "Não foi possível criar o acesso. Verifique se o WhatsApp já está em uso." });
      userId = data.user.id; created = true;
    }
    if (!link.used_at) {
      const { error } = await admin.rpc("claim_kitchen_invite_as_user", { requested_token: token, requested_user_id: userId });
      if (error) { if (created && userId) await admin.auth.admin.deleteUser(userId); return reply(origin, 400, { error: error.message }); }
    }
    return reply(origin, 200, { login_email: loginEmail, activated: true, access_type: operator.access_type, work_date: operator.work_date });
  } catch { return reply(origin, 400, { error: "Não foi possível ativar o acesso." }); }
});
