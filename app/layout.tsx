import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  return {
    title: "Mesa Viva — Cardápio Digital",
    description: "Uma experiência sofisticada de cardápio digital para restaurantes que querem vender mais.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Mesa Viva — Cardápios que vendem",
      description: "Experiências digitais que transformam visitantes em clientes.",
      images: [{ url: `${origin}/og.png`, width: 1734, height: 908, alt: "Mesa Viva — Cardápios que vendem" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Mesa Viva — Cardápios que vendem",
      description: "Experiências digitais que transformam visitantes em clientes.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${display.variable} ${sans.variable}`}>{children}</body>
    </html>
  );
}
