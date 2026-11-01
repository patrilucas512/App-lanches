# Fase 88 — diagnóstico inicial

## Inventário obrigatório anterior à implementação

- CI/CD e releases: Fase 27 mantém `platform_releases`, pipelines, regressões e rollback. Change Management apenas referencia release, ambiente, commit e execução.
- Feature Management: Fase 77 é dona de flags, rollouts, canary, overrides e kill switches. A mudança governa janela, risco e validação, sem executar rollout.
- Policy Engine: Fase 79 decide elegibilidade, rotas de aprovação, exceções, freezes e overrides. Não haverá regras de pessoas hardcoded.
- Integration Orchestration: Fase 81 mantém versões de fluxo, mapping, connector e reconciliação. O registro de mudança liga essas referências.
- Data Governance: Fase 76 mantém schema diff, contratos, lineage, consumidores e compatibilidade. Mudanças de dados consomem esse impacto sem copiar o grafo.
- Incident Management: Fase 59 é o registro oficial de incidentes. Correlação com mudança é evidência temporal/de escopo, nunca declaração automática de causa.
- Service Reliability: Fase 85 mantém catálogo de serviços, SLO, error budget, guardrails e change freezes.
- Business Continuity: Fase 86 mantém BIA, RTO/RPO, restore, failover e exercícios. Mudanças críticas consultam readiness.
- Enterprise Risk: Fase 87 mantém riscos, controles, tratamentos e apetite. Mudanças podem ligar, introduzir ou mitigar riscos sem encerrá-los automaticamente.
- Aprovações e execução: infraestrutura existente de approvals, ActionEngine e Projects/Tasks continua dona da autorização e do trabalho.
- Calendário operacional: janelas e blackouts serão uma camada específica de mudança, com referências ao calendário operacional; nenhum calendário corporativo paralelo será criado.
- Checklists existentes: evidências automáticas de CI/CD, reliability, data, integrations, training e continuity substituem checkbox manual quando disponíveis.

## Decisões de arquitetura

1. `change_requests` é o registro de governança; sistemas de origem continuam executando a mudança.
2. Mudança concluída, falha, rollback ou cancelamento fica imutável; correção exige evento explícito de reabertura.
3. Standard change depende de template versionado e perde elegibilidade ao desviar de pré-condições.
4. Risco, impacto, conflitos, readiness e rollback são explicáveis, sem score opaco.
5. Emergency é um fast path auditável, com autoridade, incidente/referência e review retrospectivo obrigatório.
6. Aprovação é proporcional ao risco; CAB/advisory fica reservado a major, critical, irreversível ou multi-domínio.
7. Correlação mudança-incidente usa tempo, serviço e escopo, mas não infere causa.
8. IA redige e resume; não aprova mudança crítica, não sobrescreve freeze e não executa produção.
9. Tabelas de controle ficam service-role-only com RLS; UI acessa via rota autenticada e autorização organizacional.
10. Views usam `security_invoker=true`; dados sensíveis e arquitetura são mascarados por permissão.

## Reutilização planejada

- Release/CI-CD: `platform_releases` e referências da Fase 27.
- Feature: `feature_rollouts`, `feature_overrides`, `feature_kill_switches`.
- Policy: decisões e approval route da Fase 79.
- Data: assets/contracts/lineage/schema changes da Fase 76.
- Reliability/NOC: serviços, SLO, budgets, freezes, alertas e saúde atual.
- Continuity: restore/failover readiness e exercícios.
- ERM: riscos e candidatos ligados à mudança.
- Reporting, Workspace, Data Platform, Search, Notifications, Automation e Executive Command recebem registros derivados, sem duplicar ownership.

## Limites conhecidos antes da implementação

- Adapters reais de CI/CD, NOC, observability e providers continuarão dependentes das integrações configuradas por organização.
- Calendário grande usará índices por janela/escopo e paginação; pré-computação distribuída fica para escala comprovada.
- Auto-rollback só é permitido quando o executor oficial e a policy já oferecem essa capacidade.
- A migration será criada e testada localmente; aplicação em produção exige autorização explícita.
