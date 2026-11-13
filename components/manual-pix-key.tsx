"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type OrderPix = { pix_key: string; receiver_name: string; total_cents: number };

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Pix do estabelecimento (sem provedor): mostra a chave cadastrada em Pagamentos para o cliente
// pagar e apresentar o comprovante. Sem chave cadastrada, orienta a pedir no balcão.
export function ManualPixKey({ trackingToken }: { trackingToken: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [pix, setPix] = useState<OrderPix | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.rpc("get_public_order_pix", { requested_tracking_token: trackingToken }).then(({ data }) => {
      if (!active) return;
      setPix(data && typeof data === "object" ? data as OrderPix : null);
      setLoaded(true);
    });
    return () => { active = false; };
  }, [supabase, trackingToken]);

  if (!loaded) return null;
  if (!pix) return <div className="tracking-delivery-update warning"><b>Pagamento com Pix</b><span>Peça a chave Pix ao estabelecimento e apresente o comprovante na retirada ou na entrega.</span></div>;

  async function copy() {
    try { await navigator.clipboard.writeText(pix!.pix_key); setCopied(true); } catch { setCopied(false); }
  }

  return <div className="tracking-delivery-update warning">
    <b>Pague {money(pix.total_cents)} com Pix</b>
    <span>Chave: <strong>{pix.pix_key}</strong> · {pix.receiver_name}</span>
    <span>Depois de pagar, apresente o comprovante na retirada ou na entrega.</span>
    <button type="button" onClick={() => void copy()}>{copied ? "Chave copiada" : "Copiar chave Pix"}</button>
  </div>;
}
