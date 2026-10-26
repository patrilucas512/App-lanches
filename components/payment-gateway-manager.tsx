"use client";

import { FormEvent, useState } from "react";

type Provider = "mercado_pago" | "pagarme";
type GatewayAccount = {
  id: string;
  provider: Provider;
  active: boolean;
  environment: "test" | "production";
  merchant_account_id?: string | null;
  configured_at?: string | null;
};

const definitions: Record<Provider, { name: string; credential: string; help: string }> = {
  mercado_pago: {
    name: "Mercado Pago",
    credential: "Access Token",
    help: "Aceita Pix e cartão no checkout seguro do Mercado Pago.",
  },
  pagarme: {
    name: "Pagar.me",
    credential: "Secret key",
    help: "Aceita Pix e cartão no checkout seguro do Pagar.me.",
  },
};

export function PaymentGatewayManager({ establishmentId, initialAccounts }: {
  establishmentId: string;
  initialAccounts: GatewayAccount[];
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [message, setMessage] = useState("");

  async function save(provider: Provider, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(provider);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/order-payments/configure", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        establishment_id: establishmentId, provider,
        active: data.get("active") === "on",
        environment: data.get("environment"),
        secret: data.get("secret"), webhook_secret: data.get("webhook_secret"),
        merchant_account_id: data.get("merchant_account_id"),
      }),
    });
    const result = await response.json() as { account?: GatewayAccount; error?: string };
    if (response.ok && result.account) {
      setAccounts((current) => [...current.filter((item) => item.provider !== provider), result.account!]);
      (event.currentTarget.elements.namedItem("secret") as HTMLInputElement).value = "";
      (event.currentTarget.elements.namedItem("webhook_secret") as HTMLInputElement).value = "";
      setMessage(`${definitions[provider].name} salvo com segurança.`);
    } else setMessage(result.error || "Não foi possível salvar.");
    setBusy(null);
  }

  return <section className="panel payment-gateways-panel" id="pagamentos-online">
    <header className="delivery-settings-head">
      <div><small>PEDIDOS · PAGAMENTOS ONLINE</small><h2>Receba com segurança.</h2><p>Ative um ou os dois provedores. O cartão é digitado somente no checkout protegido da empresa escolhida.</p></div>
      <span className="status-pill active">Multi-gateway</span>
    </header>
    <div className="payment-gateway-grid">
      {(["mercado_pago", "pagarme"] as Provider[]).map((provider) => {
        const account = accounts.find((item) => item.provider === provider);
        const definition = definitions[provider];
        return <form key={provider} className="payment-gateway-card" onSubmit={(event) => save(provider, event)}>
          <div className="payment-gateway-title"><div><small>{account?.configured_at ? "CREDENCIAL PROTEGIDA" : "AINDA NÃO CONECTADO"}</small><h3>{definition.name}</h3><p>{definition.help}</p></div><label className="gateway-switch"><input name="active" type="checkbox" defaultChecked={account?.active} /><span>Ativo</span></label></div>
          <div className="field"><label>AMBIENTE</label><select name="environment" defaultValue={account?.environment || "test"}><option value="test">Teste</option><option value="production">Produção</option></select></div>
          <div className="field"><label>{definition.credential.toUpperCase()}</label><input name="secret" type="password" autoComplete="new-password" placeholder={account?.configured_at ? "Deixe vazio para manter a credencial atual" : "Cole a credencial secreta"} required={!account?.configured_at} /></div>
          <div className="field"><label>SEGREDO DO WEBHOOK (RECOMENDADO)</label><input name="webhook_secret" type="password" autoComplete="new-password" placeholder="Usado para validar notificações" /></div>
          <div className="field"><label>ID DA CONTA/RECEBEDOR (OPCIONAL)</label><input name="merchant_account_id" defaultValue={account?.merchant_account_id || ""} /></div>
          <button className="button dark" disabled={busy === provider}>{busy === provider ? "Salvando..." : `Salvar ${definition.name}`}</button>
          <small className="gateway-security-note">A chave privada fica criptografada no cofre do banco e nunca aparece no cardápio.</small>
        </form>;
      })}
    </div>
    {message && <div className="form-message" aria-live="polite">{message}</div>}
  </section>;
}
