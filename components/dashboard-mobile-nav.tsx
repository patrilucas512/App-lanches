"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type DashboardLink = {
  key: string;
  href: string;
  label: string;
};

export function DashboardMobileNav({
  links,
  active,
  storeSlug,
}: {
  links: DashboardLink[];
  active: string;
  storeSlug?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const updateArrows = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    setCanGoBack(nav.scrollLeft > 4);
    setCanGoForward(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    updateArrows();
    const resizeObserver = new ResizeObserver(updateArrows);
    resizeObserver.observe(nav);
    return () => resizeObserver.disconnect();
  }, [links, storeSlug, updateArrows]);

  useEffect(() => {
    const nav = navRef.current;
    const selected = nav?.querySelector<HTMLElement>("a.active");
    selected?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    window.setTimeout(updateArrows, 350);
  }, [active, updateArrows]);

  function move(direction: -1 | 1) {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollBy({ left: direction * Math.max(180, nav.clientWidth * 0.72), behavior: "smooth" });
  }

  return <div className="mobile-dashboard-carousel">
    <button
      type="button"
      className="dashboard-carousel-arrow previous"
      aria-label="Ver opções anteriores"
      disabled={!canGoBack}
      onClick={() => move(-1)}
    >
      ‹
    </button>
    <nav
      ref={navRef}
      className="mobile-dashboard-nav"
      aria-label="Navegação do painel"
      onScroll={updateArrows}
    >
      {links.map((link) =>
        <Link key={link.key} className={active === link.key ? "active" : ""} href={link.href}>
          {link.label}
        </Link>
      )}
      {storeSlug && <Link href={`/loja/${storeSlug}`} target="_blank">Loja ↗</Link>}
    </nav>
    <button
      type="button"
      className="dashboard-carousel-arrow next"
      aria-label="Ver mais opções"
      disabled={!canGoForward}
      onClick={() => move(1)}
    >
      ›
    </button>
  </div>;
}
