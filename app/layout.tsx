import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { headers } from "next/headers";
import { StaffInstallPrompt } from "@/components/app-install-prompt";
import { ConnectivityBanner } from "@/components/connectivity-banner";
import "./globals.css";
import "./continuity.css";
import "./hardware.css";
import "./network-governance.css";
import "./food-quality.css";

const display = Cormorant_Garamond({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });
const sans = Manrope({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const origin = `${host.includes("localhost") ? "http" : "https"}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: { default: "MasterApp — Cardápio, pedidos e gestão", template: "%s · MasterApp" },
    description: "A plataforma de cardápio digital e gestão de pedidos feita para restaurantes que querem vender mais.",
    applicationName: "MasterApp",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MasterApp" },
    formatDetection: { telephone: false },
    other: { "masterapp-design-revision": "2026-09-14" },
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "MasterApp — Seu negócio no controle.", description: "Cardápio digital, pedidos e gestão em uma única plataforma.", images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "MasterApp" }] },
    twitter: { card: "summary_large_image", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" data-design-revision="2026-09-15">
    <head>
      <meta name="theme-color" content="#080806" />
      <script dangerouslySetInnerHTML={{ __html: `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__masterAppInstallPrompt=e;window.dispatchEvent(new Event("masterappinstallready"));});if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/push-sw.js");});}` }} />
    </head>
    <body className={`${display.variable} ${sans.variable}`}><ConnectivityBanner />{children}<StaffInstallPrompt /></body>
  </html>;
}
