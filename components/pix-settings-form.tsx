"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type PixInitial = {
  pix_key_type?: string; pix_key?: string; receiver_name?: string;
  receiver_document_masked?: string; receiver_city?: string; institution_name?: string;
};

export function PixSettingsForm({ establishmentId, initial }: { establishmentId: string; initial?: PixInitial | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const password = String(form.get("password") || "");
    if (!user?.email || !password) { setMessage("Informe sua senha para confirmar."); setBusy(false); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (authError) { setMessage("Senha incorreta. A alteração não foi realizada."); setBusy(false); return; }
    const { error } = await supabase.rpc("update_pix_settings", {
      requested_establishment_id: establishmentId,
      requested_key_type: String(form.get("keyType")),
      requested_key: String(form.get("key")),
      requested_receiver_name: String(form.get("receiver")),
      requested_receiver_document: String(form.get("document") || ""),
      requested_receiver_city: String(form.get("city")),
      requested_institution_name: String(form.get("institution") || "") || null,
    });
    setMessage(error ? error.message : "Pix oficial salvo. A alteração foi registrada no histórico de segurança.");
    setBusy(false);
  }
  return <form className="panel form settings-form pix-settings" onSubmit={submit}>
    <div className="panel-title-row"><div><h2>Dados Pix do estabelecimento</h2><p>Somente proprietário e gerente podem alterar. O garçom apenas gera cobranças com estes dados.</p></div><span className="security-badge">Protegido</span></div>
    <div className="form-grid">
      <div className="field"><label>TIPO DE CHAVE</label><select name="keyType" defaultValue={initial?.pix_key_type || "random"}><option value="random">Aleatória</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="phone">Telefone</option></select></div>
      <div className="field"><label>CHAVE PIX OFICIAL</label><input name="key" required defaultValue={initial?.pix_key || ""} autoComplete="off" /></div>
      <div className="field"><label>NOME DO RECEBEDOR</label><input name="receiver" required defaultValue={initial?.receiver_name || ""} /></div>
      <div className="field"><label>CPF OU CNPJ</label><input name="document" placeholder={initial?.receiver_document_masked || "Somente números"} /></div>
      <div className="field"><label>CIDADE</label><input name="city" required defaultValue={initial?.receiver_city || ""} /></div>
      <div className="field"><label>INSTITUIÇÃO (OPCIONAL)</label><input name="institution" defaultValue={initial?.institution_name || ""} /></div>
      <div className="field field-wide"><label>CONFIRME COM SUA SENHA</label><input name="password" type="password" required autoComplete="current-password" /><small>A senha é validada antes de salvar. A chave anterior e a nova alteração ficam registradas de forma segura.</small></div>
    </div>
    {message && <div className={message.includes("salvo") ? "form-message form-success" : "form-message"}>{message}</div>}
    <button className="button dark" disabled={busy}>{busy ? "Validando..." : "Salvar Pix oficial"}</button>
  </form>;
}
