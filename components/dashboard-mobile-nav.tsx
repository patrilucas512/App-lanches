"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/ui";
import type { DashboardLink } from "@/components/dashboard-shell";

export function DashboardMobileNav({ links, active, storeSlug, currentLabel, roleLabel, brandName = "MasterApp", brandLogo }: { links: DashboardLink[]; active: string; storeSlug?: string; currentLabel: string; roleLabel: string; brandName?: string; brandLogo?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", close); };
  }, [open]);

  return <>
    <header className="mobile-dashboard-header">
      <button type="button" className="mobile-menu-trigger" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}><span /><span /><span /></button>
      <div><small>PAINEL ADMINISTRATIVO</small><b>{currentLabel}</b></div>
      <span className="mobile-user-avatar">{brandLogo ? <img src={brandLogo} alt={`Logo de ${brandName}`} /> : brandName.slice(0, 2).toUpperCase()}</span>
    </header>
    {open && <div className="mobile-nav-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && setOpen(false)}>
      <aside className="mobile-nav-drawer" aria-label="Menu do painel">
        <header><Brand href="/painel" name={brandName} logo={brandLogo} /><button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)}>×</button></header>
        <nav>{links.map(link => <Link key={link.key} className={active === link.key ? "active" : ""} href={link.href} aria-current={active === link.key ? "page" : undefined} onClick={() => setOpen(false)}><span aria-hidden="true">{link.icon}</span><b>{link.label}</b></Link>)}</nav>
        <footer>
          {storeSlug && <Link href={`/loja/${storeSlug}`} target="_blank">Ver minha loja <span aria-hidden="true">↗</span></Link>}
          <div><span>MA</span><p><b>Administrador</b><small>{roleLabel}</small></p></div>
          <Link href="/">Sair do painel</Link>
        </footer>
      </aside>
    </div>}
  </>;
}
