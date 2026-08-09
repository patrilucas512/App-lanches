import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const allowedOrigins = new Set([
  "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site",
  "http://localhost:3000",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin)
      ? origin
      : "https://mesa-viva-patrilucas.patricklucas512.chatgpt.site",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

type Candidate = {
  user_id: string;
  login_email: string;
  status: string;
  active_now: boolean;
  access_type: "fixed" | "daily";
  work_date: string | null;
  establishment_slug: string;
};

const localDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date());

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return reply(origin, 405, { error: "Método não permitido." });

  try {
    const { kind, name, password, establishment } = await request.json();
    const normalizedName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
    if (!['waiter', 'kitchen'].includes(kind) || normalizedName.split(" ").length < 2) {
      return reply(origin, 400, { error: "Informe seu nome e sobrenome." });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      return reply(origin, 400, { error: "Nome ou senha inválidos." });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) return reply(origin, 500, { error: "Serviço de acesso indisponível." });

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.rpc("get_employee_login_candidates", {
      requested_kind: kind,
      requested_name: normalizedName,
      requested_slug: typeof establishment === "string" && establishment.trim() ? establishment.trim().toLowerCase() : null,
    });
    if (error) return reply(origin, 500, { error: "Não foi possível validar este acesso." });

    const candidates = (Array.isArray(data) ? data : []) as Candidate[];
    for (const candidate of candidates.slice(0, 5)) {
      const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: signed, error: signError } = await auth.auth.signInWithPassword({
        email: candidate.login_email,
        password,
      });
      if (signError || !signed.session || signed.user.id !== candidate.user_id) continue;

      const outsideDate = candidate.access_type === "daily" && candidate.work_date !== localDate();
      const unavailable = candidate.status !== "active"
        || (kind === "waiter" && !candidate.active_now)
        || outsideDate;
      if (unavailable) {
        await auth.auth.signOut();
        return reply(origin, 403, { error: outsideDate
          ? "Seu acesso está fora da data liberada pelo administrador."
          : "Seu acesso está inativo. Fale com o administrador." });
      }

      return reply(origin, 200, {
        access_token: signed.session.access_token,
        refresh_token: signed.session.refresh_token,
        expires_at: signed.session.expires_at,
        establishment_slug: candidate.establishment_slug,
      });
    }

    return reply(origin, 401, { error: "Nome ou senha inválidos." });
  } catch {
    return reply(origin, 400, { error: "Não foi possível entrar agora." });
  }
});
