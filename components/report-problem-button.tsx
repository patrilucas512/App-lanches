"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "@/app/report-problem.css";

// Fase 99H: "Relatar problema" do piloto. Abre um chamado na Central de Suporte (Fase 24) com a página (sem query
// string), o horário e o navegador. Nada da tela é capturado: só o texto que a pessoa escreve.
export function ReportProblemButton({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim().length < 10) return setMessage("Descreva o problema em pelo menos 10 caracteres.");
    setBusy(true); setMessage("");
    const { error } = await createClient().rpc("report_pilot_problem", {
      requested_store_id: storeId,
      requested_description: text.trim(),
      requested_page: window.location.pathname,
      requested_browser: navigator.userAgent,
    });
    setBusy(false);
    if (error) return setMessage(error.message === "FORBIDDEN" ? "Sua conta não tem acesso a esta loja." : error.message);
    setDone(true); setText("");
  }

  function close() { setOpen(false); setDone(false); setMessage(""); }

  return <>
    <button type="button" className="report-problem-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">Relatar problema</button>
    {open && <div className="report-problem-backdrop" onClick={close}>
      <form className="report-problem-dialog" role="dialog" aria-modal="true" aria-labelledby="report-problem-title" onSubmit={send} onClick={(e) => e.stopPropagation()}>
        <h2 id="report-problem-title">Relatar problema</h2>
        {done ? <>
          <p role="status">Recebemos seu relato. O suporte responde pela Central de Suporte.</p>
          <div className="report-problem-actions"><button type="button" onClick={close}>Fechar</button></div>
        </> : <>
          <p>Conte o que aconteceu. Enviamos junto só a página, o horário e o navegador. Não escreva dados de clientes.</p>
          <label htmlFor="report-problem-text">O que aconteceu?</label>
          <textarea id="report-problem-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5} required autoFocus />
          {message && <p className="report-problem-error" role="alert">{message}</p>}
          <div className="report-problem-actions">
            <button type="button" onClick={close}>Cancelar</button>
            <button type="submit" disabled={busy}>{busy ? "Enviando..." : "Enviar relato"}</button>
          </div>
        </>}
      </form>
    </div>}
  </>;
}
