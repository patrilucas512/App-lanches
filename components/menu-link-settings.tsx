"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MENU_SLUG_ERRORS, normalizeMenuSlug } from "@/lib/menu-link";

// Link do cardápio com o nome da loja. O dono edita só o nome; o endereço do MasterApp fica fixo.
export function MenuLinkSettings({ establishmentId, currentSlug, baseUrl }: { establishmentId: string; currentSlug: string; baseUrl: string }) {
  const router = useRouter();
  const [slug, setSlug] = useState(currentSlug);
  const [value, setValue] = useState(currentSlug);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const preview = normalizeMenuSlug(value);
  const prefix = `${baseUrl.replace(/^https?:\/\//, "")}/loja/`;
  const link = `${baseUrl}/loja/${slug}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (preview === slug) { setMessage("Esse já é o link atual da sua loja."); return; }
    setBusy(true); setMessage("");
    const { data, error } = await createClient().rpc("change_establishment_slug", { requested_establishment_id: establishmentId, requested_slug: value });
    setBusy(false);
    if (error) {
      const code = Object.keys(MENU_SLUG_ERRORS).find(key => error.message.includes(key));
      setMessage(code ? MENU_SLUG_ERRORS[code] : "Não foi possível salvar o link agora. Tente de novo.");
      return;
    }
    const saved = String(data || preview);
    setSlug(saved); setValue(saved);
    setMessage("Link atualizado. O link antigo continua funcionando e leva para o novo.");
    router.refresh();
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); setMessage("Link copiado. É só colar no WhatsApp."); }
    catch { setMessage(link); }
  }

  return <section className="panel cardapio-link-settings" id="link-do-cardapio">
    <div className="section-heading">
      <div><small>LINK DO CARDÁPIO</small><h2>O endereço da sua loja</h2><p>Escolha o nome que aparece no link que você manda no WhatsApp e nas redes. A parte do MasterApp fica fixa; você muda só o nome da loja.</p></div>
      <span className="status-pill">No ar</span>
    </div>
    <div className="cardapio-link-current">
      <span>Seu link hoje</span>
      <a href={link} target="_blank" rel="noreferrer">{link.replace(/^https?:\/\//, "")}</a>
      <div className="cardapio-link-actions"><button type="button" className="button outline" onClick={copy}>Copiar link</button><a className="button outline" href={link} target="_blank" rel="noreferrer">Abrir cardápio</a></div>
    </div>
    <form className="cardapio-link-form" onSubmit={save}>
      <div className="field">
        <label htmlFor="menu-slug">NOME NO LINK</label>
        <div className="cardapio-link-input"><span aria-hidden="true">{prefix}</span><input id="menu-slug" value={value} onChange={event => setValue(event.target.value)} maxLength={60} autoComplete="off" spellCheck={false} placeholder="nome-da-sua-loja" aria-describedby="menu-slug-help" /></div>
        <small id="menu-slug-help">Vai ficar assim: <b>{prefix}{preview || "…"}</b>. Letras sem acento, números e hífen; de 3 a 40 caracteres.</small>
      </div>
      <button className="button dark" disabled={busy || preview.length < 3}>{busy ? "Salvando..." : "Salvar link"}</button>
      {message && <p className="form-message" role="status">{message}</p>}
    </form>
  </section>;
}
