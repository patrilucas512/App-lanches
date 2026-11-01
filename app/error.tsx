"use client";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return <main role="alert" style={{ maxWidth: 560, margin: "15vh auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
    <h1 style={{ fontSize: 24, marginBottom: 8 }}>Esta página não está disponível agora</h1>
    <p>O restante do MasterApp continua funcionando. Tente novamente ou volte para a página inicial.</p>
    {process.env.NODE_ENV === "development" && <p style={{ padding: 12, background: "#fef3c7", color: "#78350f", borderRadius: 6 }}>{error.message}. Veja as variáveis no README.</p>}
    <p style={{ display: "flex", gap: 16, marginTop: 16 }}><button type="button" onClick={reset}>Tentar novamente</button><Link href="/">Página inicial</Link></p>
  </main>;
}
