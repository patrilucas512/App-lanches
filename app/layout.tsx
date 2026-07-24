import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const display = Cormorant_Garamond({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });
const sans = Manrope({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const origin = `${host.includes("localhost") ? "http" : "https"}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: { default: "Mesa Viva — Cardápio, pedidos e gestão", template: "%s · Mesa Viva" },
    description: "A plataforma de cardápio digital e gestão de pedidos feita para restaurantes que querem vender mais.",
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "Mesa Viva — Seu restaurante, mais vivo.", description: "Cardápio digital, pedidos e gestão em uma única plataforma.", images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Mesa Viva" }] },
    twitter: { card: "summary_large_image", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${display.variable} ${sans.variable}`}>{children}</body></html>;
}
