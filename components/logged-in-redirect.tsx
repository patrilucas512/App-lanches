"use client";

import { useEffect } from "react";
import { withLoginNext } from "@/lib/login-next";

// Quem já está logado e abre /login?next=... segue para o endereço pedido.
// Lê o ?next= no navegador: no servidor o vinext entrega os parâmetros vazios quando a página só redireciona.
export function LoggedInRedirect() {
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.replace(next ? withLoginNext("/auth/after-login", next) : "/painel");
  }, []);
  return <main className="auth-page"><section className="auth-main"><div className="auth-card"><p>Abrindo sua área...</p></div></section></main>;
}
