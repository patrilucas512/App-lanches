import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal";
import "./legal-document.css";

// Fase 98I: links do rodapé. "saas" no site e no cadastro; "customer" no cardápio público e no portal do cliente.
export function LegalLinks({ audience, className = "legal-links" }: { audience: "saas" | "customer"; className?: string }) {
  const terms = audience === "saas" ? LEGAL_LINKS.saasTerms : LEGAL_LINKS.customerTerms;
  const privacy = audience === "saas" ? LEGAL_LINKS.saasPrivacy : LEGAL_LINKS.customerPrivacy;
  return <nav className={className} aria-label="Termos e privacidade">
    <Link href={terms}>Termos de uso</Link>
    <Link href={privacy}>Privacidade</Link>
  </nav>;
}
