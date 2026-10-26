export const SUPPORT_CATEGORIES = [
  ["account", "Conta"], ["billing", "Cobrança"], ["whatsapp", "WhatsApp"], ["ai", "IA"],
  ["orders", "Pedidos"], ["delivery", "Delivery"], ["payments", "Pagamentos"], ["fiscal", "Fiscal"],
  ["inventory", "Estoque"], ["integrations", "Integrações"], ["technical", "Erro técnico"],
  ["question", "Dúvida"], ["security", "Segurança"], ["other", "Outro"],
] as const;
export const SUPPORT_STATUSES: Record<string, string> = { open: "Aberto", waiting_support: "Aguardando suporte", waiting_customer: "Aguardando cliente", in_progress: "Em andamento", resolved: "Resolvido", closed: "Fechado" };
export const SUPPORT_PRIORITIES: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
export const SAFE_SUPPORT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "text/csv", "application/json", "application/zip"];
export const MAX_SUPPORT_FILE_BYTES = 10 * 1024 * 1024;
export const SUPPORT_SAFE_ACTIONS = ["resend_webhook", "reprocess_job", "test_integration", "invalidate_cache", "reconnect_service", "generate_onboarding_link", "reset_nonsensitive_config"] as const;
export function supportDate(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "—"; }
export function publicStatus(value: string) { return ({ operational: "Operacional", degraded: "Instabilidade", partial_outage: "Indisponibilidade parcial", major_outage: "Indisponibilidade", maintenance: "Manutenção" } as Record<string,string>)[value] || value; }
