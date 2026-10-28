# Fase 83 — Revenue Management

## Entrega

A fase adiciona planejamento comercial, registro/versionamento de ofertas, economics com break-even uplift, leitura por canal, oportunidades de estoque, janelas de demanda, guardrails de capacidade, recomendações, cenários, conflitos/stacking, performance, governança, RBAC, auditoria e Copilot.

## Integrações

Pricing Fase 36, Marketing/Campaigns Fase 37, Forecast Fase 35, Customer 360/Journeys, Catalog Fase 62, Capacity Fase 63, Marketplace Fase 69, IBP Fase 74, Policy Fase 79 e Digital Twin Fase 82 permanecem fontes oficiais. `CommercialExecutionBridgeService` cria apenas drafts nos domínios oficiais.

## Economics

`OfferEconomicsService` calcula receita bruta/líquida, margem bruta, margem de contribuição, percentual, receita/margem incremental e break-even uplift. Se COGS faltar, a qualidade é `partial` e margem precisa fica nula. Se a contribuição promocional for zero ou negativa, break-even fica nulo e o risco é destacado. Uplift e canibalização ausentes não são inferidos.

## Runtime

`EffectiveOfferResolver` resolve ofertas ativas por canal, período, produto, offline safety e stacking. Regras publicadas são versionadas e imutáveis. O pedido guarda offer/version/price snapshot em `commercial_offer_redemptions`; reembolso usa o snapshot original.

## Segurança e governança

Todas as tabelas possuem RLS e grants explícitos. Clientes não recebem economics internos. A migration impede targeting protegido e hidden individualized base pricing. Ativação exige permissão, aprovação, confirmação e economics revisado. Eventos de governança são auditados; redenções permanecem dados transacionais.

## Limitações deliberadas

Não há black-box price optimizer, publicação automática de preços/campanhas, micropricing individual, suposição automática de elasticidade, engine A/B paralelo ou substituição dos módulos existentes. Recomendação “manter” é válida.

## Dívida técnica e recomendação futura

Executores assíncronos de scenario/recommendation, materialização de effective offers por grandes redes e conectores reais de marketplaces dependem do volume/infra de produção. Uma próxima fase deve priorizar operação assistida e observabilidade dos jobs, sem criar motores paralelos. A Fase 84 não foi iniciada.
