import type { Metadata } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import { LandingPage } from "@/components/landing/landing-page";
import "./landing.css";

const landingSans = DM_Sans({ variable: "--font-landing-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const landingDisplay = Outfit({ variable: "--font-landing-display", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { absolute: "MasterApp | Seu delivery em um só lugar" },
  description: "Conheça o MasterApp: gestão de pedidos, operação e entregas para negócios de delivery.",
  icons: { icon: "/images/favicon.png" },
  openGraph: { title: "MasterApp | Seu delivery em um só lugar", description: "Mais clareza para organizar pedidos, operação e entregas do seu delivery.", type: "website" },
};

export default function Home() {
  return <div className={`masterapp-landing ${landingSans.variable} ${landingDisplay.variable}`}><LandingPage /></div>;
}
