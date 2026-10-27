"use client";

import { useEffect, useState } from "react";

type StaffAccessActionsProps = {
  name: string;
  phone?: string | null;
  areaLabel: string;
  loginPath: string;
  activated: boolean;
  busy?: boolean;
  onCreateAccess: () => void | Promise<void>;
  onResetPassword?: () => void | Promise<void>;
};

function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function StaffAccessActions({ name, phone, areaLabel, loginPath, activated, busy, onCreateAccess, onResetPassword }: StaffAccessActionsProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const permanentLink = `${origin}${loginPath}`;
  const number = whatsappNumber(phone || "");
  const message = `Olá, ${name}! Este é seu acesso permanente à área de ${areaLabel} no MasterApp: ${permanentLink}\n\nEntre com seu nome e senha. No celular, toque em “Instalar app” para deixar o acesso na tela inicial.`;

  async function copy() {
    await navigator.clipboard.writeText(permanentLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!activated) return <button type="button" disabled={busy} onClick={() => void onCreateAccess()}>{busy ? "Gerando..." : "Gerar acesso"}</button>;

  return <div className="staff-access-action-wrap">
    <button type="button" className="staff-access-share-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Fechar acesso" : "Enviar acesso"}</button>
    {onResetPassword && <button type="button" disabled={busy} onClick={() => void onResetPassword()}>{busy ? "Gerando..." : "Redefinir senha"}</button>}
    {open && <div className="staff-permanent-access" role="status">
      <div><small>ACESSO PERMANENTE · {areaLabel.toUpperCase()}</small><b>{name}</b><p>Este link pode ser enviado novamente sempre que o funcionário trocar de aparelho, perder o atalho ou ainda não tiver instalado o app.</p></div>
      <div className="invite-link-box"><span>{permanentLink}</span><button type="button" onClick={() => void copy()}>{copied ? "Copiado ✓" : "Copiar link"}</button></div>
      <div className="invite-ready-actions">
        {number ? <a className="button whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}>Enviar pelo WhatsApp</a> : <span className="invite-phone-warning">Cadastre um telefone para enviar pelo WhatsApp.</span>}
        <a className="button outline" target="_blank" rel="noreferrer" href={loginPath}>Abrir acesso ↗</a>
      </div>
    </div>}
  </div>;
}
