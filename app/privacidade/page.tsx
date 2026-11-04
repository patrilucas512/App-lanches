import { LegalDocument } from "@/components/legal-document";

// Fase 98I: RASCUNHO até a aprovação (ver lib/legal.ts).
export const metadata = { title: "Política de Privacidade (rascunho)", robots: { index: false } };

export default function Page() {
  return <LegalDocument kind="saas-privacy" />;
}
