# Fase 84 — diagnóstico inicial

## Autoridades revisadas

- Fase 33: Executive Command Center consome somente o resumo executivo do NOC; não recebe ruído técnico.
- Fase 59: `operational_incidents`, timeline, severity, war room, recovery e postmortem continuam sendo a única autoridade de incidentes.
- Fase 52: entrega, preferências, quiet hours, deduplicação de destinatários e escalation continuam na Central de Notificações.
- Fase 26: métricas, traces, logs, latência, filas e saúde técnica permanecem em Observability.
- KDS/Orders, Fase 63 Capacity, Inventory, WMS, TMS, Delivery, Hardware/Assets, Offline, Payments/Fiscal, Qualidade e Workforce continuam donos de seus estados e thresholds.
- Fase 81: Integration Hub/iPaaS continua autoridade de execução e saúde das conexões.
- Fase 68: SOPs e runbooks continuam na Base de Conhecimento.
- Fases 76/75: contratos, lineage, ownership e identificadores seguem Data Governance/MDM.
- Fase 79: regras, corridors, autorizações e precedência continuam no Policy Engine.
- Fase 82: riscos podem abrir simulação no Digital Twin, sempre separados de indisponibilidade atual.

## Diagnóstico de duplicação

Já existem saúde e dashboards por domínio. A Fase 84 não copia métricas operacionais nem cria outro motor de incidentes, observabilidade, notificações, mapas, thresholds ou ActionEngine. Ela armazena referências normalizadas, freshness, read models explicáveis, correlação e impacto. A integração é event-driven com reconciliação periódica; a tela de rede não consulta todos os domínios sincronicamente.

## Arquitetura escolhida

`domain public health/events → adapters → normalization → dedup/noise control → correlation → store/network read models → impact/alerts → Incident bridge / official response services`.

O estado stale vira `unknown`; loja fechada por agenda não vira offline; manutenção só suprime sinais cujo escopo coincide; fator comum é apenas possível/suspeito até confirmação no Incident Management. Falha do pipeline NOC preserva ordering e os painéis de origem.

## Decisões de segurança e escala

- isolamento por organização e escopo de loja/região/rede;
- metadata sem secrets, payload bruto de webhook, cartão ou localização individual;
- ações críticas exigem permissão NOC + permissão do domínio + Policy + ActionEngine + aprovação;
- read models e índices por tenant/status/freshness; correlação incremental e retenção curta para sinais brutos;
- platform NOC permanece futuro e nunca expõe lista cross-tenant no tenant NOC.
