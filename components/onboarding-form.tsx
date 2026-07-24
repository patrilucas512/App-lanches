"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function OnboardingForm() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        window.location.assign("/login");
        return;
      }
      const { error } = await supabase.rpc("create_establishment", { establishment_name: String(data.get("name")), requested_slug: String(data.get("slug") || "") });
      if (error) throw error;
      window.location.assign("/painel");
      return;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível criar o estabelecimento."); }
    finally { setLoading(false); }
  }
  return <form className="form" onSubmit={submit}>
    <div className="field"><label>NOME DO ESTABELECIMENTO</label><input name="name" required minLength={2} placeholder="Ex.: Bistrô Aurora" /></div>
    <div className="field"><label>ENDEREÇO DO LINK (OPCIONAL)</label><input name="slug" pattern="[a-z0-9-]+" placeholder="bistro-aurora" /><small>Use letras minúsculas, números e hífens.</small></div>
    {message && <div className="form-message">{message}</div>}
    <button type="submit" className="button dark wide" disabled={loading}>{loading ? "Criando..." : "Criar meu estabelecimento →"}</button>
  </form>;
}
