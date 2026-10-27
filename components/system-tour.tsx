"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const tour = [
  { title: "Seu painel", body: "Acompanhe vendas, operação e alertas em um só lugar." },
  { title: "Primeiros passos", body: "Retome a configuração da unidade sem perder o que já foi preenchido." },
  { title: "Ajuda contextual", body: "Encontre orientações rápidas e os caminhos de cada módulo." },
];

export function SystemTour() {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (window.localStorage.getItem("masterapp_tour_v1") !== "done") setStep(0);
  }, []);
  if (step < 0) return null;
  function close() { window.localStorage.setItem("masterapp_tour_v1", "done"); setStep(-1); }
  const current = tour[step];
  return <aside className="system-tour" role="dialog" aria-label="Tour do MasterApp">
    <small>GUIA {step + 1} DE {tour.length}</small>
    <h2>{current.title}</h2><p>{current.body}</p>
    <div><button className="quiet" onClick={close}>Pular tour</button>{step === tour.length - 1 ? <Link href="/onboarding" onClick={close}>Abrir primeiros passos</Link> : <button onClick={() => setStep(value => value + 1)}>Próximo</button>}</div>
  </aside>;
}
