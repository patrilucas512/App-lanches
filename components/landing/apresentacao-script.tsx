"use client";

import { useEffect } from "react";

// Carrega o comportamento da landing só depois que a página já está na tela (e uma vez só).
export function ApresentacaoScript() {
  useEffect(() => {
    if (document.getElementById("ma-land-js")) return;
    const script = document.createElement("script");
    script.id = "ma-land-js";
    script.src = "/landing/apresentacao.js";
    document.body.appendChild(script);
  }, []);
  return null;
}
