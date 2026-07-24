import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const allowedOrigins = new Set([
  "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site",
  "http://localhost:3000",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function normalizeBrazilianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return `+${digits}`;
  if (value.startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return json(origin, 405, { error: "Método não permitido." });

  try {
    const { token, password } = await request.json();
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) {
      return json(origin, 400, { error: "Convite inválido." });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return json(origin, 400, { error: "A senha deve ter entre 8 e 72 caracteres." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json(origin, 500, { error: "Serviço de acesso indisponível." });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: link, error: linkError } = await admin
      .from("waiter_access_links")
      .select("waiter_id,expires_at,used_at,waiters(id,name,phone,user_id)")
      .eq("token", token)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (linkError || !link) return json(origin, 400, { error: "Convite inválido ou expirado." });
    const waiterValue = Array.isArray(link.waiters) ? link.waiters[0] : link.waiters;
    const waiter = waiterValue as { id: string; name: string; phone: string | null; user_id: string | null } | null;
    const phone = normalizeBrazilianPhone(waiter?.phone || "");
    if (!waiter || !phone) return json(origin, 400, { error: "O WhatsApp do garçom está inválido." });

    let userId = waiter.user_id;
    let createdUser = false;
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        phone, password, phone_confirm: true,
      });
      if (error) return json(origin, 400, { error: "Não foi possível atualizar este acesso." });
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        phone,
        password,
        phone_confirm: true,
        app_metadata: { access_type: "waiter" },
        user_metadata: { display_name: waiter.name },
      });
      if (error || !data.user) {
        const alreadyExists = error?.message.toLowerCase().includes("already") || error?.message.toLowerCase().includes("registered");
        return json(origin, 400, {
          error: alreadyExists
            ? "Este WhatsApp já possui acesso. Entre com sua senha ou peça ao administrador para revisar o cadastro."
            : "Não foi possível criar o acesso pelo WhatsApp.",
        });
      }
      userId = data.user.id;
      createdUser = true;
    }

    const { error: claimError } = await admin.rpc("claim_waiter_invite_as_user", {
      requested_token: token,
      requested_user_id: userId,
    });
    if (claimError) {
      if (createdUser && userId) await admin.auth.admin.deleteUser(userId);
      return json(origin, 400, { error: claimError.message });
    }

    return json(origin, 200, { phone, activated: true });
  } catch {
    return json(origin, 400, { error: "Não foi possível ativar o acesso." });
  }
});
