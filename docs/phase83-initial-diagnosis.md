# Fase 83 — diagnóstico inicial

## Autoridades existentes revisadas

- Fase 35 (`lib/forecasting`): previsão, qualidade, intervalos, backtest e ausência explícita de certeza artificial.
- Fase 36 (`lib/profitability`): Smart Pricing/Menu Engineering, custos, margem, price preview, histórico e ActionEngine. Continua sendo o único motor de recomendação/publicação de preço.
- Fase 37 (`lib/marketing-intelligence`): campanhas, promoção, audiência, frequência, experimento, atribuição e incrementalidade. Continua sendo o Campaign Manager oficial.
- Fases 5, 60 e 61: CRM/Customer 360/Journeys, consentimento, segmentos comportamentais, supressão e frequência.
- Fase 62: catálogo, preço efetivo, disponibilidade, mudanças versionadas e publicação.
- Fase 63: capacidade, carga, slots, promessa e guardrails operacionais.
- Fases 16/17: COGS/Finance. Custos ausentes permanecem ausentes; nenhuma margem precisa é inventada.
- Fase 69: contratos, capabilities e operação de marketplace.
- Fase 74: IBP; Revenue Management só referencia metas e assumptions comerciais.
- Fase 79: Policy Engine, precedência, corridors, limites e decisões auditáveis.
- Fase 82: Digital Twin; cenários comerciais podem encaminhar impactos operacionais, sempre em dry-run.

## Duplicações encontradas e decisão

Há simulação promocional na Fase 37 e simulação de preço na Fase 36. Elas não serão copiadas. A Fase 83 apenas compõe seus resultados com canal, estoque e capacidade. Campaigns comunica uma oferta; `commercial_offers` define valor e termos. O calendário comercial é um read model de referências, não um novo calendário operacional. Eligibility e stacking referenciam o Policy Engine.

## Arquitetura escolhida

`revenue-management` é um control plane comercial multi-tenant com planos, ofertas imutáveis por versão, snapshots de economics, oportunidades, recomendações explicáveis, cenários, conflitos, performance e bridges que criam somente rascunhos. Checkout usa `EffectiveOfferResolver` determinístico e enxuto; cálculo complexo permanece assíncrono. Nenhuma recomendação de alto impacto é publicada automaticamente.

## Guardrails inegociáveis

- sem preço-base individual secreto;
- sem atributos sensíveis/protegidos;
- sem uplift, elasticidade, COGS ou causalidade inventados;
- sem oferta de item bloqueado pela Qualidade;
- sem desconto abaixo do piso ou stacking silencioso;
- sem campanha geradora de demanda sobre capacidade saturada sem bloqueio explícito;
- sem escrita direta em Pricing, Campaign, Catalog ou Marketplace;
- recommendation `accepted` cria draft, nunca publicação.
