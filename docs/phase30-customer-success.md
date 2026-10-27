# Fase 30 — Customer Success

## Resultado

O MasterApp passa a ter um domínio interno de Customer Success, separado do CRM comercial, do suporte e do CRM dos restaurantes. A implementação reutiliza organizações, assinatura, billing, onboarding, health score, analytics de produto, CSAT, oportunidades de growth e handoff comercial.

## Entregas

1. Perfil de CS por organização, com responsável, segmento, ciclo de vida, criticidade, onboarding, renovação e valor contratual.
2. Carteira filtrável com plano, MRR, saúde, onboarding, última interação, próxima tarefa, risco e renovação.
3. Reutilização do `customer_health_scores`, exibindo componentes, justificativa e indicação de dado estimado.
4. Eventos de risco tipados, priorizados e encerrados somente com justificativa.
5. Playbooks para novo cliente, onboarding atrasado, churn, renovação, expansão, enterprise e detrator NPS.
6. Tarefas internas integradas ao `customer_success_tasks` existente.
7. Planos de sucesso com metas, baseline, valor atual, alvo e evidências.
8. Reuniões de kickoff, review, treinamento, renovação, escalada e QBR.
9. Notas internas com visibilidade de CS ou liderança.
10. Monitor de onboarding e time-to-value alimentado pelo onboarding já existente.
11. Adoção e gaps de recursos contratados, priorizando valor antes de upsell.
12. Oportunidades de expansão validadas por CS e encaminhadas ao CRM comercial, sem mudar plano.
13. Renovação com janelas configuráveis de 90, 60 e 30 dias.
14. Cancelamento não bloqueado; risco e playbook de retenção são internos.
15. NPS, CSAT, feedback de produto e consentimento explícito para advocacy.
16. Timeline consolidável pelas fontes existentes de venda, onboarding, produto, suporte e billing.
17. Dashboard de clientes ativos, MRR gerenciado, health, risco, renovação, expansão, NPS e onboarding atrasado.
18. Forecast de renovação, health distribution e funções de GRR/NRR com aviso de estimativa.
19. Permissões granulares `customer_success:*` e RLS voltada ao backoffice interno.
20. Auditoria de ownership, health override, risco, plano, renovação, expansão, nota, reunião e handoff.
21. Feature flags para CS, success plans, renewal management, copilot e expansion management.

## Copiloto

As ferramentas `getCustomerHealth`, `getCustomerAdoption`, `getCustomerRisks`, `getUpcomingRenewals`, `getCustomerGoals`, `getCustomerTimeline`, `getExpansionOpportunities` e `getPortfolioSummary` retornam contexto e rascunhos. O copiloto não envia contato externo, concede desconto, altera plano, cancela contrato, dispara mensagens ou promete funcionalidades.

## Limitações conhecidas

- O dashboard mostra os dados existentes; organizações sem assinatura, onboarding ou telemetria aparecem com estado explícito em vez de valores inventados.
- Timeline e adoção dependem dos eventos já coletados nas fases anteriores.
- Handoff de expansão exige conta comercial previamente convertida e pipeline padrão.
- Alertas de 90/60/30 criam trabalho interno; automação de contato externo não faz parte desta fase.
- Rebalanceamento de carteira é apenas sugestão e exige aprovação humana.

## Validação obrigatória

Os testes cobrem perfil, carteira, ownership, health, risco, playbook, tarefa, plano, meta, reunião, onboarding, adoção, renovação, expansão, handoff comercial, NPS, churn, permissões, auditoria, multiusuário e dashboard.

## Recomendações para a Fase 31

- Criar um event stream unificado e materializado para a timeline de conta.
- Acrescentar metas de capacidade por CSM e regras de segmentação versionadas.
- Implementar agenda de QBR exportável com aprovação antes do compartilhamento.
- Avaliar forecast de renovação com backtesting e explicabilidade, sem decisões automáticas.
- Adicionar integrações externas somente com consentimento, opt-out e trilha de auditoria.

A Fase 31 não foi iniciada.
