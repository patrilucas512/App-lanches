// Fase 98I: termos de uso e política de privacidade. RASCUNHO até a aprovação do dono do MasterApp e a revisão
// do jurídico/encarregado. O cadastro grava a versão aceita (public.legal_acceptances); ao publicar uma versão
// nova, mude a versão aqui e o texto em components/legal-document.tsx.
export const LEGAL_DRAFT = true;
export const SAAS_TERMS_VERSION = "2026-11-04-rascunho";
export const SAAS_PRIVACY_VERSION = "2026-11-04-rascunho";
export const CUSTOMER_TERMS_VERSION = "2026-11-04-rascunho";
export const CUSTOMER_PRIVACY_VERSION = "2026-11-04-rascunho";

export const LEGAL_LINKS = {
  saasTerms: "/termos",
  saasPrivacy: "/privacidade",
  customerTerms: "/termos-cliente",
  customerPrivacy: "/privacidade-cliente",
} as const;

// Marcadores que o jurídico preenche antes de publicar.
export const LEGAL_PLACEHOLDERS = {
  company: "[RAZÃO SOCIAL DO MASTERAPP]",
  cnpj: "[CNPJ]",
  address: "[ENDEREÇO]",
  dpo: "[NOME DO ENCARREGADO]",
  dpoEmail: "[E-MAIL DO ENCARREGADO]",
  forum: "[COMARCA]",
} as const;
