import { createClient } from "@supabase/supabase-js";

export class AdminCredentialsError extends Error {
  constructor() {
    super("Credenciais administrativas do Supabase não configuradas");
    this.name = "AdminCredentialsError";
  }
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new AdminCredentialsError();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Sem isto o vinext transforma a exceção de createAdminClient em 500 sem corpo. Outros erros seguem propagando.
export function withAdminCredentials<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (!(error instanceof AdminCredentialsError)) throw error;
      console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente do servidor.");
      return Response.json({ error: "Serviço indisponível: credenciais do servidor não configuradas." }, { status: 503 });
    }
  };
}
