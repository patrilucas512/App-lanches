import type { AttendantIntent, IntentDecision } from "./types";

export function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const rules: Array<[AttendantIntent, RegExp]> = [
  ["human_handoff", /\b(atendente|humano|pessoa|gerente|falar com alguem|equipe)\b/],
  ["order_status", /\b(meu pedido|pedido.*(status|andamento|demora|atras|pronto|saiu)|acompanhar pedido|onde esta.*pedido)\b/],
  ["subscriptions", /\b(meu plano|minha assinatura|assinatura|clube vip|beneficio.*(resta|tenho|usei)|quando renova|cancelar.*plano|cancelar.*assinatura)\b/],
  ["reservations", /\b(reserva|reservar.*mesa|mesa.*(hoje|amanha|sabado|domingo|disponivel)|fila de espera|quanto falta.*mesa|reagendar|no-show|check.?in)\b/],
  ["hours", /\b(horario|hora.*abre|hora.*fecha|esta aberto|ta aberto|funciona|abre hoje|fecha hoje)\b/],
  ["contact", /\b(endereco|onde fica|localizacao|telefone|contato|instagram)\b/],
  ["payment_methods", /\b(pagamento|pagar|aceita pix|aceita cartao|dinheiro|credito|debito)\b/],
  ["delivery", /\b(entrega|delivery|taxa|frete|bairro|regiao|prazo|tempo.*chegar)\b/],
  ["pickup", /\b(retirada|retirar|buscar|pegar.*loja|viagem)\b/],
  ["promotions", /\b(promocao|oferta|desconto|cupom|promo)\b/],
  ["categories", /\b(categorias|tipos de lanche|o que vende|opcoes)\b/],
  ["menu", /\b(cardapio|menu|link.*loja|ver produtos)\b/],
  ["availability", /\b(tem|vende|disponivel|ainda tem|acabou)\b/],
  ["product_search", /\b(preco|quanto custa|valor|adicional|complemento|ingrediente|tamanho|sabores?)\b/],
  ["greeting", /^(oi+|ola+|bom dia|boa tarde|boa noite|e ai|menu)$/],
];

export function routeByRules(message: string): IntentDecision | null {
  const normalized = normalizeText(message);
  for (const [intent, pattern] of rules) {
    if (pattern.test(normalized)) return { intent, query: extractSearchQuery(normalized), confidence: 0.96, source: "rule" };
  }
  return null;
}

export function extractSearchQuery(message: string) {
  return normalizeText(message)
    .replace(/\b(oi|ola|por favor|quero saber|voces|voce|tem|vende|disponivel|preco|valor|quanto custa|ainda|ai|do|da|de|um|uma|o|a)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function isIntent(value: string): value is AttendantIntent {
  return ["greeting","hours","contact","payment_methods","delivery","pickup","menu","categories","product_search","availability","promotions","order_status","subscriptions","reservations","human_handoff","unknown"].includes(value);
}

