"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import type { DashboardLink } from "@/components/dashboard-shell";

export function DashboardTopbar({ links, currentLabel, dateLabel, roleLabel, storeSlug }: { links: DashboardLink[]; currentLabel: string; dateLabel: string; roleLabel: string; storeSlug?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const results = useMemo(() => query.trim().length ? links.filter(link => link.label.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))).slice(0, 5) : [], [links, query]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (results[0]) { router.push(results[0].href); setQuery(""); }
  }

  return <header className="dashboard-topbar">
    <div className="dashboard-topbar-title"><small>{dateLabel}</small><b>{currentLabel}</b></div>
    <form className="dashboard-quick-search" role="search" onSubmit={submit}>
      <span aria-hidden="true">⌕</span>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar uma área..." aria-label="Buscar uma área do painel" />
      {results.length > 0 && <div className="dashboard-search-results">{results.map(result => <Link key={result.key} href={result.href} onClick={() => setQuery("")}><span aria-hidden="true">{result.icon}</span>{result.label}</Link>)}</div>}
    </form>
    <div className="dashboard-topbar-actions">
      {storeSlug && <Link className="topbar-store-button" href={`/loja/${storeSlug}`} target="_blank">Ver loja <span aria-hidden="true">↗</span></Link>}
      <Link className="topbar-notification" href="/painel/chamados" aria-label="Abrir chamados"><span aria-hidden="true">●</span></Link>
      <div className="topbar-user"><span>MA</span><div><b>Administrador</b><small>{roleLabel}</small></div></div>
    </div>
  </header>;
}
