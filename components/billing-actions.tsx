"use client";

import { useState } from "react";

export function BillingActions() {
  const [message, setMessage] = useState("");
  async function open(path: string) {
    setMessage("Abrindo ambiente seguro...");
    const response = await fetch(path, { method: "POST" });
    const body = await response.json();
    if (!response.ok) return setMessage(body.error ?? "Cobrança ainda não configurada.");
    window.location.href = body.url;
  }
  return <div className="form"><button className="button dark wide" onClick={() => open("/api/stripe/checkout")}>Assinar plano Crescimento</button><button className="button outline wide" onClick={() => open("/api/stripe/portal")}>Gerenciar cobrança</button>{message && <div className="form-message">{message}</div>}</div>;
}
