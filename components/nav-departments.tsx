"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { DashboardLink } from "@/components/dashboard-shell";
import { departmentLabels, departments, type Department } from "@/lib/menu-departments";

// Departamentos do menu que abrem e fecham. O departamento da página atual abre sozinho;
// o que a pessoa abriu ou fechou fica guardado neste aparelho.
const STORAGE_KEY = "masterapp:menu-departamentos-abertos";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}
function readSaved() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function parseSaved(raw: string | null): Department[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((key): key is Department => departments.includes(key as Department)) : [];
  } catch { return []; }
}

export function NavDepartments({ links, active, storeSlug, variant, onNavigate }: { links: DashboardLink[]; active: string; storeSlug?: string; variant: "sidebar" | "mobile"; onNavigate?: () => void }) {
  const groups = departments
    .map(key => ({ key, links: links.filter(link => link.group === key) }))
    .filter(group => group.links.length > 0);
  const activeGroup = links.find(link => link.key === active)?.group;
  const saved = parseSaved(useSyncExternalStore(subscribe, readSaved, () => null));
  // O departamento da página atual fica aberto, a menos que a pessoa o feche aqui.
  const [activeClosed, setActiveClosed] = useState(false);
  const open = activeGroup && !activeClosed && !saved.includes(activeGroup) ? [...saved, activeGroup] : saved;

  function save(next: Department[]) {
    if (activeGroup) setActiveClosed(!next.includes(activeGroup));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* armazenamento indisponível */ }
    listeners.forEach(listener => listener());
  }
  const toggle = (key: Department) => save(open.includes(key) ? open.filter(item => item !== key) : [...open, key]);
  const allOpen = groups.every(group => open.includes(group.key));
  const groupClass = variant === "sidebar" ? "admin-nav-group" : "mobile-nav-group";

  return <>
    <button type="button" className="nav-departments-all" onClick={() => save(allOpen ? [] : groups.map(group => group.key))}>{allOpen ? "Fechar tudo" : "Abrir tudo"}</button>
    {groups.map(group => {
      const isOpen = open.includes(group.key);
      const panelId = `menu-${variant}-${group.key}`;
      return <div className={`${groupClass} nav-department${isOpen ? " is-open" : ""}`} key={group.key}>
        <button type="button" className="nav-department-toggle" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(group.key)}>
          <span>{departmentLabels[group.key]}</span><i aria-hidden="true">›</i>
        </button>
        {isOpen && <div className="nav-department-links" id={panelId}>
          {group.links.map(link => <Link key={link.key} className={active === link.key ? "active" : ""} href={link.href} aria-current={active === link.key ? "page" : undefined} onClick={onNavigate}><span aria-hidden="true">{link.icon}</span><b>{link.label}</b></Link>)}
          {variant === "sidebar" && group.key === "loja" && storeSlug && <Link className="admin-store-link" href={`/loja/${storeSlug}`} target="_blank"><span aria-hidden="true">↗</span><b>Ver minha loja</b></Link>}
        </div>}
      </div>;
    })}
  </>;
}
