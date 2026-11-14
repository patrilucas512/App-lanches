"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { DashboardLink } from "@/components/dashboard-shell";
import { createClient } from "@/lib/supabase/client";

export function DashboardTopbar({ links, currentLabel, dateLabel, roleLabel, storeSlug }: { links: DashboardLink[]; currentLabel: string; dateLabel: string; roleLabel: string; storeSlug?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // A mesma conta pode ser dona de loja e superadmin: mostra o atalho só para quem é superadmin.
  // O botão é só atalho; quem protege /superadmin é o servidor (requireSuperadmin).
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return;
      const { data } = await supabase.from("profiles").select("is_superadmin").eq("id", userId).maybeSingle();
      if (alive) setIsSuperadmin(Boolean(data?.is_superadmin));
    })().catch(() => {});
    return () => { alive = false; };
  }, []);
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
      {isSuperadmin && <Link className="topbar-store-button topbar-superadmin-button" href="/superadmin/dashboard" title="Área de administração da plataforma (planos, lojas, assinaturas)">Superadmin</Link>}
      {storeSlug && <Link className="topbar-store-button" href={`/loja/${storeSlug}`} target="_blank">Ver loja <span aria-hidden="true">↗</span></Link>}
      <Link className="topbar-notification" href="/painel/chamados" aria-label="Abrir chamados"><span aria-hidden="true">●</span></Link>
      <div className="topbar-user"><span>MA</span><div><b>Administrador</b><small>{roleLabel}</small></div></div>
    </div>
  </header>;
}
