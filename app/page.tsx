import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Outfit } from "next/font/google";
import { apresentacaoMarkup } from "@/components/landing/apresentacao-markup";
import { ApresentacaoScript } from "@/components/landing/apresentacao-script";
import "./apresentacao.css";

const sans = DM_Sans({ variable: "--f-sans", subsets: ["latin"], weight: ["400", "500", "700"] });
const display = Outfit({ variable: "--f-display", subsets: ["latin"], weight: ["500", "700", "800"] });
const mono = JetBrains_Mono({ variable: "--f-mono", subsets: ["latin"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: { absolute: "MasterApp | Um sistema para cada tipo de cozinha" },
  description: "Cardápio por link e QR Code, cozinha em tempo real, caixa, garçom, delivery e WhatsApp em um sistema só. Sem taxa por pedido e 15 dias grátis.",
  icons: { icon: "/images/favicon.png" },
  openGraph: { title: "MasterApp | Um sistema para cada tipo de cozinha", description: "Do pedido à entrega, em uma tela só. Sem taxa por pedido e 15 dias grátis.", type: "website" },
};

// A página é HTML estático (bom para busca e carregamento); a tábua giratória e os planos ganham vida depois, pelo script.
export default function Home() {
  return <>
    <div className={`ma-land ${sans.variable} ${display.variable} ${mono.variable}`} dangerouslySetInnerHTML={{ __html: apresentacaoMarkup }} />
    <ApresentacaoScript />
  </>;
}
