// Fase 99B: leitura do plano a partir de joins do PostgREST. `subscriptions` (establishment_id único) e `plans`
// (muitos-para-um) chegam como objeto, não lista; o código antigo lia `subscriptions[0].plans[0]` ou testava
// `plans?.length` e ficava sempre sem plano. Aceita os dois formatos.
// Tipo aberto de propósito: as telas leem colunas do plano direto (plan.x_enabled, plan.name).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function asList<T = Row>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value == null ? [] : [value as T];
}

export function firstOf<T = Row>(value: unknown): T | null {
  return asList<T>(value)[0] ?? null;
}

const LIVE = ["active", "trialing", "past_due"];

// Plano vigente de uma lista (ou objeto) de assinaturas: a primeira ativa, em teste ou em atraso.
export function livePlan<T = Row>(subscriptions: unknown): T | null {
  for (const subscription of asList<{ status?: string; plans?: unknown }>(subscriptions)) {
    if (LIVE.includes(String(subscription?.status ?? ""))) {
      const plan = firstOf<T>(subscription.plans);
      if (plan) return plan;
    }
  }
  return null;
}

// Primeiro plano vigente entre as lojas de uma organização.
export function livePlanOfStores<T = Row>(stores: unknown): T | null {
  for (const store of asList<{ subscriptions?: unknown }>(stores)) {
    const plan = livePlan<T>(store?.subscriptions);
    if (plan) return plan;
  }
  return null;
}

// Teste grátis vencido (ou assinatura expirada) num plano público: o painel fica fechado até a loja
// escolher um plano em /painel/escolher-plano, que chama com allowBlocked. O Piloto (não público) fica de fora.
export function isBillingBlocked(subscription: { status?: string | null; trial_ends_at?: string | null } | null | undefined, plan: { is_public?: boolean | null } | null, now = new Date()) {
  if (!subscription || plan?.is_public === false) return false;
  if (subscription.status === "expired") return true;
  return subscription.status === "trialing" && Boolean(subscription.trial_ends_at) && new Date(String(subscription.trial_ends_at)) <= now;
}
