"use client";

import { FormEvent, useState } from "react";

type Provider = { provider: "mercado_pago" | "pagarme"; label: string };

export function SaasCheckoutForm({ planCode, cycle, providers }: { planCode: string; cycle: "monthly" | "annual"; providers: Provider[] }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/saas/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planCode, cycle, provider: form.get("provider"), name: form.get("name"), email: form.get("email"), establishment_name: form.get("establishment_name") }) });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Não foi possível gerar o pagamento.");
      window.location.assign(result.url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao iniciar pagamento."); setBusy(false); }
  }
  if (!providers.length) return <div className="saas-checkout-warning"><b>Pagamento em configuração</b><p>Os dados do plano estão disponíveis, mas o Super Administrador ainda precisa ativar Mercado Pago ou Pagar.me.</p></div>;
  return <form className="saas-checkout-form" onSubmit={submit}><label>Nome completo<input name="name" required minLength={2} autoComplete="name" /></label><label>E-mail<input name="email" type="email" required autoComplete="email" /></label><label>Nome do estabelecimento<input name="establishment_name" required minLength={2} /></label><label>Forma de pagamento<select name="provider" required>{providers.map(item => <option key={item.provider} value={item.provider}>{item.label}</option>)}</select></label><button disabled={busy}>{busy ? "Gerando pagamento seguro..." : "Continuar para pagamento"}</button>{message && <p className="saas-checkout-error">{message}</p>}<small>O pagamento é processado no ambiente seguro do banco escolhido.</small></form>;
}
