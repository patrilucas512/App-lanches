"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

declare global {
  interface Window {
    __masterAppInstallPrompt?: InstallPromptEvent;
  }
  interface Navigator {
    standalone?: boolean;
  }
}

const DESTINATION_KEY = "masterapp_install_destination";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function staffArea(pathname: string) {
  if (pathname.startsWith("/motoboy")) return { label: "motoboy", destination: "/motoboy" };
  if (pathname.startsWith("/cozinha")) return { label: "cozinha", destination: "/cozinha" };
  if (pathname.startsWith("/caixa")) return { label: "caixa", destination: "/caixa" };
  if (pathname.startsWith("/garcom/app") || pathname.startsWith("/garcom/login")) return { label: "garçom", destination: "/garcom/app" };
  if (pathname.startsWith("/painel")) return { label: "administração", destination: "/painel" };
  return null;
}

function useInstaller(destination: string) {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    localStorage.setItem(DESTINATION_KEY, destination);
    if (window.__masterAppInstallPrompt) setInstallEvent(window.__masterAppInstallPrompt);

    const ready = () => setInstallEvent(window.__masterAppInstallPrompt ?? null);
    const installedHandler = () => {
      setInstalled(true);
      setHelpOpen(false);
      window.__masterAppInstallPrompt = undefined;
      setInstallEvent(null);
    };
    window.addEventListener("masterappinstallready", ready);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("masterappinstallready", ready);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, [destination]);

  async function install() {
    localStorage.setItem(DESTINATION_KEY, destination);
    const event = installEvent || window.__masterAppInstallPrompt;
    if (!event) {
      setHelpOpen(true);
      return;
    }
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    window.__masterAppInstallPrompt = undefined;
    setInstallEvent(null);
  }

  return { installed, helpOpen, setHelpOpen, install };
}

function InstallHelp({ close }: { close: () => void }) {
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return <div className="app-install-backdrop" role="presentation" onClick={close}>
    <section className="app-install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-app-title" onClick={event => event.stopPropagation()}>
      <button type="button" className="app-install-close" aria-label="Fechar" onClick={close}>×</button>
      <span className="app-install-logo" aria-hidden="true">M</span>
      <small>MASTERAPP NO SEU APARELHO</small>
      <h2 id="install-app-title">Instale para abrir mais rápido</h2>
      {ios
        ? <p>No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>
        : <p>Abra o menu do navegador e escolha <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>.</p>}
      <button type="button" className="button app-install-understood" onClick={close}>Entendi</button>
    </section>
  </div>;
}

export function StaffInstallPrompt() {
  const pathname = usePathname();
  const area = useMemo(() => staffArea(pathname), [pathname]);
  const installer = useInstaller(area?.destination || "/");
  if (!area || installer.installed) return null;

  return <>
    <button type="button" className="staff-install-button" onClick={() => void installer.install()} aria-label={`Instalar aplicativo da ${area.label}`}>
      <span aria-hidden="true">⇩</span>
      <b>Instalar app</b>
    </button>
    {installer.helpOpen && <InstallHelp close={() => installer.setHelpOpen(false)} />}
  </>;
}

export function CustomerInstallCard() {
  const pathname = usePathname();
  const installer = useInstaller(pathname);
  if (installer.installed) return <div className="customer-install-card installed"><span aria-hidden="true">✓</span><div><b>MasterApp instalado</b><small>Seu cardápio está disponível na tela inicial.</small></div></div>;

  return <>
    <div className="customer-install-card">
      <span className="app-install-logo" aria-hidden="true">M</span>
      <div><b>Tenha este cardápio no celular</b><small>Instale o app para acompanhar pedidos e pedir novamente com mais rapidez.</small></div>
      <button type="button" onClick={() => void installer.install()}>Instalar app</button>
    </div>
    {installer.helpOpen && <InstallHelp close={() => installer.setHelpOpen(false)} />}
  </>;
}
