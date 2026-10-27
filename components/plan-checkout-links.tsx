"use client";

import { useState } from "react";

export function PlanCheckoutLinks({ code, active }: { code: string; active: boolean }) {
  const [copied, setCopied] = useState("");
  async function copy(cycle: "monthly" | "annual") {
    const url = `${window.location.origin}/assinar/${encodeURIComponent(code)}?ciclo=${cycle}`;
    await navigator.clipboard.writeText(url);
    setCopied(cycle);
    window.setTimeout(() => setCopied(""), 1800);
  }
  return <div className="sa-plan-links"><b>Links para sua landing page</b><p>O cliente abre o plano, informa os dados e paga na conta bancária ativa no Super Admin.</p><div><button type="button" className="sa-button secondary" disabled={!active} onClick={() => copy("monthly")}>{copied === "monthly" ? "Link mensal copiado" : "Copiar link mensal"}</button><button type="button" className="sa-button secondary" disabled={!active} onClick={() => copy("annual")}>{copied === "annual" ? "Link anual copiado" : "Copiar link anual"}</button></div></div>;
}
