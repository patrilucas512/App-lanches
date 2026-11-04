import { LegalDocument } from "@/components/legal-document";

// Fase 98I: RASCUNHO até a aprovação (ver lib/legal.ts).
export const metadata = { title: "Termos para clientes das lojas (rascunho)", robots: { index: false } };

export default function Page() {
  return <LegalDocument kind="customer-terms" />;
}
