import type { PlannedAction } from "./action-types";

const clean = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.!?]+$/g, "").trim();
const originalTarget = (question: string, pattern: RegExp) => question.match(pattern)?.[1]?.trim().replace(/[.!?]+$/g, "");

export const prohibitedOperationalIntent = (question: string) => {
  const text = clean(question);
  return /(reembols|estorn|marque.*pag|alter.*pre[cç]o|exclu.*(empresa|unidade|historico)|senha|credencial|token|plano|cobranca|criar administrador|remover administrador|demit|contrat|salario|remuneracao|advertencia|punicao|folha.*(salario|pagamento)|remover.*direito|alter.*cargo.*(gerente|administrador|supervisor)|cancel.*(nota|documento fiscal)|alter.*(ncm|cfop|cest|cst|csosn|regime|tribut|imposto)|emit.*nota)/.test(text);
};

export function planManagerAction(question: string): PlannedAction | null {
  if (prohibitedOperationalIntent(question)) return null;
  const text = clean(question);
  const minutes = Number(text.match(/(\d+)\s*(?:minuto|minutos|min)/)?.[1] || 0);
  const hours = Number(text.match(/(\d+)\s*(?:hora|horas)/)?.[1] || 0);

  if (/(feche|fechar|pause|pausar).*(loja|unidade|pedidos)/.test(text)) {
    return { actionType: "STORE_TEMPORARILY_CLOSE", payload: { duration_minutes: minutes || hours * 60 || 60 }, summary: "Fechamento temporário da unidade" };
  }
  if (/(reabra|reabrir|abra).*(loja|unidade)/.test(text)) return { actionType: "STORE_REOPEN", payload: {}, summary: "Reabertura da unidade" };
  if (/(pause|pausar|desative|desativar).*(delivery|entrega)/.test(text)) return { actionType: "DELIVERY_TOGGLE", payload: { new_value: false }, summary: "Pausa do delivery" };
  if (/(ative|ativar|reative|reativar).*(delivery|entrega)/.test(text)) return { actionType: "DELIVERY_TOGGLE", payload: { new_value: true }, summary: "Reativação do delivery" };
  const eta = text.match(/(?:previsao|prazo|tempo).{0,25}?(\d+)\s*(?:minuto|minutos|min)/);
  if (eta) return { actionType: "UPDATE_DELIVERY_ESTIMATE", payload: { estimated_minutes: Number(eta[1]) }, summary: "Atualização do prazo de entrega" };

  const campaignName = originalTarget(question, /(?:campanha\s+)?(?:chamada\s+)?["“]?([\p{L}\p{N}_-]+)["”]?\s*$/u);
  if (/(pause|pausar|desative|desativar).*campanha/.test(text)) return { actionType: "CAMPAIGN_PAUSE", payload: { target_name: campaignName }, summary: "Pausa de campanha" };
  if (/(retome|retomar|reative|reativar|continue).*campanha/.test(text)) return { actionType: "CAMPAIGN_RESUME", payload: { target_name: campaignName }, summary: "Retomada de campanha" };

  if (/(desative|desativar|modo humano|somente humano).*(ia|atendente)|(ia|atendente).*(modo humano|somente humano|desative|desativar)/.test(text)) return { actionType: "AI_TOGGLE", payload: { new_value: false }, summary: "Atendimento somente humano" };
  if (/(ative|ativar|reative|reativar).*(ia|atendente)/.test(text)) return { actionType: "AI_TOGGLE", payload: { new_value: true }, summary: "Ativação da atendente IA" };
  if (/(desative|desativar|pause|pausar).*(recuperacao de carrinho|automacao do whatsapp)/.test(text)) return { actionType: "WHATSAPP_AUTOMATION_TOGGLE", payload: { new_value: false }, summary: "Pausa da automação" };
  if (/(ative|ativar|reative|reativar).*(recuperacao de carrinho|automacao do whatsapp)/.test(text)) return { actionType: "WHATSAPP_AUTOMATION_TOGGLE", payload: { new_value: true }, summary: "Ativação da automação" };

  const productTarget = question.replace(/^(?:por favor\s+)?(?:desative|desativar|ative|ativar|disponibilize|marque)\s+(?:o|a)?\s*(?:produto)?\s*/i, "").replace(/\s+(?:na|da)\s+unidade\s+.+$/i, "").replace(/[.!?]+$/g, "").trim();
  if (/(desative|desativar|indisponivel|acabou).*(produto|x-|coca|lanche|refrigerante)/.test(text)) return { actionType: "PRODUCT_SET_AVAILABILITY", payload: { target_name: productTarget, new_value: false }, summary: "Produto indisponível" };
  if (/(ative|ativar|disponibilize|volt.*disponivel).*(produto|x-|coca|lanche|refrigerante)/.test(text)) return { actionType: "PRODUCT_SET_AVAILABILITY", payload: { target_name: productTarget, new_value: true }, summary: "Produto disponível" };
  return null;
}

