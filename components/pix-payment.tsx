"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { PixPayment as Payment } from "@/lib/order-payments/pix";

export function PixPayment({ trackingToken, tableSessionId, onConfirmed, onDismiss }: {
  trackingToken?: string; tableSessionId?: string; onConfirmed?: () => void; onDismiss?: () => void;
}) {
  const endpoint = tableSessionId ? "/api/table-payments/pix" : "/api/order-payments/pix";
  const identity = tableSessionId ? { session_id: tableSessionId } : { tracking_token: trackingToken };
  const callback = useRef(onConfirmed);
  callback.current = onConfirmed;
  const confirmed = useRef(false);
  const retryRequested = useRef(false);
  const [pix, setPix] = useState<Payment | null>(null);
  const [status, setStatus] = useState("pending");
  const [needsPayer, setNeedsPayer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hostedUrl, setHostedUrl] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status === "approved" && !confirmed.current) { confirmed.current = true; callback.current?.(); }
  }, [status]);
  useEffect(() => {
    let active = true;
    let running = false;
    async function refresh() {
      if (running || document.hidden || retryRequested.current) return;
      running = true;
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tableSessionId ? { session_id: tableSessionId } : { tracking_token: trackingToken }) });
        const result = await response.json();
        if (!active) return;
        setNow(Date.now());
        if (result.error) setMessage(result.error);
        else { setPix(result.pix || null); setNeedsPayer(!!result.needsPayer); setStatus(result.status || "pending"); setHostedUrl(result.hostedUrl || ""); }
      } catch { if (active) setMessage("Sem conexão. Tentaremos consultar novamente."); }
      finally { running = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [trackingToken, tableSessionId, endpoint]);
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, create: true, email: data.get("email"), cpf: String(data.get("cpf") || "").replace(/\D/g, "") }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Não foi possível gerar o Pix.");
      retryRequested.current = false;
      setPix(result.pix || null); setStatus(result.status || "pending"); setNeedsPayer(false); form.reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Tente novamente."); }
    finally { setBusy(false); }
  }
  async function cancelCharge() {
    if (busy || !confirm("Cancelar este Pix no Mercado Pago antes de escolher outra forma?")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, cancel: true }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Cancelamento não confirmado.");
      setStatus(result.status || "pending");
      if (["canceled", "declined"].includes(result.status)) onDismiss?.();
      else if (result.status !== "approved") setMessage("Aguarde a confirmação do cancelamento. Não receba novamente.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível cancelar."); }
    finally { setBusy(false); }
  }
  const expired = !!pix?.expiresAt && Date.parse(pix.expiresAt) <= now;
  return <section className="inline-pix" aria-label="Pagamento Pix" aria-live="polite">
    <h3>{status === "approved" ? "Pagamento confirmado ✓" : "Pague com Pix"}</h3>
    {status === "approved" ? <p>{tableSessionId ? "Mercado Pago confirmou o pagamento. A conta foi baixada automaticamente no financeiro." : "Recebemos a confirmação do Mercado Pago. Seu pedido seguirá para preparo."}</p> : status !== "pending" || expired ? <><p>Esta cobrança foi encerrada ou expirou. Não pague este código. Consulte o estabelecimento antes de fazer outro pedido.</p>{tableSessionId && ["canceled", "declined", "error"].includes(status) && <><button className="button outline" onClick={onDismiss}>Escolher outra forma</button><button className="button dark" onClick={() => { retryRequested.current = true; setPix(null); setStatus("pending"); setNeedsPayer(true); }}>Gerar novo Pix</button></>}{tableSessionId && status === "pending" && <button className="button outline" disabled={busy} onClick={cancelCharge}>Confirmar encerramento no Mercado Pago</button>}</> : <>
      {needsPayer && <form onSubmit={generate} className="form"><p>Informe os dados do pagador para gerar o QR Code. Eles serão enviados com segurança ao Mercado Pago.</p><label>E-mail<input name="email" type="email" autoComplete="email" required maxLength={254} /></label><label>CPF do pagador<input name="cpf" inputMode="numeric" autoComplete="off" required minLength={11} maxLength={14} /></label><button className="button dark" disabled={busy}>{busy ? "Gerando Pix..." : "Gerar QR Code Pix"}</button></form>}
      {pix && <><strong>{(pix.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong><img src={pix.qrImage} width={256} height={256} alt="QR Code Pix deste pedido" /><p>Escaneie com seu banco ou copie o código abaixo.</p><textarea readOnly aria-label="Pix Copia e Cola" value={pix.qrCode} onFocus={event => event.currentTarget.select()} /><button className="button dark" onClick={async () => { try { await navigator.clipboard.writeText(pix.qrCode); setMessage("Código Pix copiado."); } catch { setMessage("Selecione o código acima e copie manualmente."); } }}>Copiar código Pix</button><small>Válido até {new Date(pix.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. A confirmação é automática; não é necessário enviar comprovante.</small></>}
      {hostedUrl && <a className="button dark" href={hostedUrl}>Continuar pagamento no Mercado Pago</a>}
      {tableSessionId && pix && <button className="button outline" disabled={busy} onClick={cancelCharge}>Cancelar Pix para trocar a forma de pagamento</button>}
      {tableSessionId && needsPayer && !pix && <p>Depois de gerar, aguarde a confirmação automática. Gerar ou copiar o código não significa pagamento recebido.</p>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
