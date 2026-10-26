"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Account = { id: string; provider: "mercado_pago" | "pagarme"; active: boolean; environment: "test" | "production"; merchant_account_id?: string | null; configured_at?: string | null };
const providers = [
  { key: "mercado_pago" as const, name: "Mercado Pago", credential: "Access Token", webhook: "Assinatura secreta do webhook" },
  { key: "pagarme" as const, name: "Pagar.me", credential: "Secret Key (sk_...)", webhook: "Segredo do webhook (opcional)" },
];

export function PlatformPaymentManager({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<Record<string,string>>({});
  const [copied, setCopied] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>, provider: Account["provider"]) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(value => ({ ...value, [provider]: "Salvando com segurança..." }));
    const { error } = await createClient().rpc("configure_platform_payment_gateway", {
      requested_provider: provider,
      requested_active: form.get("active") === "on",
      requested_environment: provider === "mercado_pago" ? "production" : String(form.get("environment")),
      requested_secret: String(form.get("credential") || "") || null,
      requested_webhook_secret: String(form.get("webhook_secret") || "") || null,
      requested_merchant_account_id: String(form.get(provider === "mercado_pago" ? "public_key" : "merchant_account_id") || "") || null,
    });
    setMessage(value => ({ ...value, [provider]: error?.message ?? "Conta salva e protegida no cofre." }));
    if (!error) { event.currentTarget.reset(); router.refresh(); }
  }
  return <div className="sa-payment-grid">{providers.map(definition => {
    const account = accounts.find(item => item.provider === definition.key);
    return <form className="sa-panel sa-gateway-card" key={definition.key} onSubmit={event => submit(event, definition.key)}>
      <header><div><small>{account?.configured_at ? "CREDENCIAL PROTEGIDA" : "CONFIGURAR RECEBIMENTO"}</small><h2>{definition.name}</h2></div><span className={`sa-badge ${account?.active ? "status-Ativo" : "status-Inativo"}`}>{account?.active ? "Ativo" : "Inativo"}</span></header>
      <p>{definition.key === "mercado_pago" ? "Configure sua conta com a Public Key e o Access Token. O Access Token permanece protegido e não volta a aparecer." : "Receba as contratações dos planos diretamente nesta conta. A chave secreta nunca aparece novamente."}</p>
      {definition.key === "mercado_pago" ? <div className="sa-form-grid"><label>Public Key<input name="public_key" defaultValue={account?.merchant_account_id || ""} placeholder="APP_USR-..." required /></label><label>Access Token<input name="credential" type="password" autoComplete="new-password" placeholder={account ? "Deixe vazio para manter o token atual" : "APP_USR-..."} required={!account?.configured_at} /></label><label>{definition.webhook}<input name="webhook_secret" type="password" autoComplete="new-password" placeholder="Deixe vazio para manter o segredo atual" /></label></div> : <div className="sa-form-grid"><label>Ambiente<select name="environment" defaultValue={account?.environment || "production"}><option value="production">Produção</option><option value="test">Teste</option></select></label><label>ID da conta/recebedor<input name="merchant_account_id" defaultValue={account?.merchant_account_id || ""} placeholder="Opcional" /></label><label>{definition.credential}<input name="credential" type="password" autoComplete="new-password" placeholder={account ? "Deixe vazio para manter a chave atual" : "Cole a credencial secreta"} /></label><label>{definition.webhook}<input name="webhook_secret" type="password" autoComplete="new-password" placeholder="Deixe vazio para manter o atual" /></label></div>}
      <label className="sa-check"><input name="active" type="checkbox" defaultChecked={account?.active} /> Ativar para os links dos planos</label>
      {account?.id && <div className="sa-webhook-box"><small>URL do webhook para cadastrar no banco</small><code>{`/api/saas/webhook/${definition.key === "mercado_pago" ? "mercado-pago" : "pagarme"}?account=${account.id}`}</code><button type="button" className="sa-link-button" onClick={async () => { const url = `${window.location.origin}/api/saas/webhook/${definition.key === "mercado_pago" ? "mercado-pago" : "pagarme"}?account=${account.id}`; await navigator.clipboard.writeText(url); setCopied(definition.key); }}>{copied === definition.key ? "URL copiada" : "Copiar URL completa"}</button></div>}
      <button className="sa-button">Salvar {definition.name}</button>{message[definition.key] && <small>{message[definition.key]}</small>}
    </form>;
  })}</div>;
}
