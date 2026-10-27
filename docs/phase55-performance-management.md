# Fase 55 — Metas, OKRs, Orçamento e Performance

## Diagnóstico e arquitetura

O MasterApp já possuía Metric Catalog/SemanticMetricsService, Forecasting, Revenue Operations, Financeiro, Executive Command Center, Reporting, Workspace, Network Governance, ActionEngine e Internal Tasks. A Fase 55 foi criada como camada gerencial sobre esses serviços: não recalcula métricas oficiais, não cria task engine, não altera metas por IA ou automação e não introduz score de funcionário.

Fluxo: Metric Catalog → Goal/OKR/Budget definition → job de snapshot → semantic actual/forecast → progresso versionado → scorecard/attention/report/widget. Histórico sempre referencia a versão da meta ou orçamento usada naquele momento.

## Arquivos e migration

- `lib/performance-management/core.ts`: validação, progresso, pace, gap, alocação, budget variance, score e forecast override.
- `app/api/performance-management/route.ts`: API autenticada com escopo de tenant/unidade e auditoria.
- `app/api/performance-management/worker/route.ts`: processador protegido para snapshots horários, leitura semântica e alertas de mudança de saúde.
- `components/performance-management-center.tsx`: visão geral, metas, OKRs, scorecards, budget, forecast, ações, histórico e configurações.
- `app/painel/metas/*`: rota e visual responsivo.
- `supabase/migrations/20261023063000_phase55_performance_management.sql`: modelo completo e integrações.
- `tests/performance-management-phase55.test.mjs`: cálculos, RBAC e isolamento.

## Goal model e progresso

`performance_goals` suporta increase, decrease e maintain_range, scopes, owner, baseline, thresholds e parent goal. `goal_versions` torna mudanças auditáveis; meta ativa exige adjustment request. `GoalProgressService` é representado pelas funções puras de progresso: actual, time progress, forecast, gap, projected completion e required pace. `no_data` nunca vira off-track automaticamente. Métricas não aditivas não usam soma; run-rate só é fallback para métricas aditivas e não é chamado de IA.

## Cascata e alocações

`goal_allocations` suporta manual, equal, historical_share, capacity_weighted e custom. Toda distribuição é preview e reconcilia arredondamento com o target pai. A hierarquia impede tenant diferente ou filho acima do pai. Sazonalidade exige pelo menos doze meses de histórico.

## Scorecards e OKRs

Scorecards usam semáforo; score numérico é opcional e mostra fórmula e contribuição de cada item. Não há punição automática. Objetivos possuem KRs metric-based, calculados por métrica semântica, ou milestone-based, ligados a tarefas/marcos. Check-ins guardam confiança e bloqueios sem substituir o status calculado.

## Orçamento e forecast

O orçamento usa categorias do domínio financeiro, sem plano de contas paralelo. Revenue e expense têm regras opostas de favorabilidade. Versões aprovadas/locked não são sobrescritas; reforecast cria versão/cenário. Forecast system, manager override e consensus coexistem. Override exige motivo, autor e horário e preserva o forecast do sistema.

## Ações, Copilot e integrações

Planos de ação agrupam `internal_tasks`; recomendações nunca executam sozinhas. Goal Copilot oferece `getGoalProgress`, `getGoalsAtRisk`, `getBudgetVariance`, `getForecastVsTarget`, `getOKRProgress`, `getScorecard` e `getGoalDrivers`. Driver decomposition separa fatos de hipóteses e não afirma causalidade. Eventos seguros alimentam Automation e Notification Center. Workspace recebe cinco widgets; Reporting recebe quatro datasets e quatro modelos oficiais. Busca global recebe Metas e Performance.

## Data Platform, segurança e observabilidade

O Metric Catalog existente recebe métricas de attainment, risk, gap, budget variance, OKR completion e scorecard health. Facts conceituais são materializados por snapshots/versionamento, não por recálculo no page load. RLS backend/service, organization_id obrigatório, store scope e permissions específicas protegem metas financeiras e de rede. Auditoria cobre publicação, mudanças, budgets, overrides, approvals, scorecards e OKRs. Jobs e métricas horárias registram falhas e latências.

## Testes, limitações e recomendações

Os testes cobrem os 30 cenários obrigatórios, além de no-data e ausência de score secreto. Limitações: não é FP&A completo; não cria plano de contas; forecast corporativo ainda depende do processo de aprovação configurado; heatmap avançado e editor visual de cascata ficam para evolução baseada em uso real. Offline é leitura do último snapshot; edição exige conexão.

Para a próxima fase, recomenda-se primeiro medir adoção, calibrar thresholds por métrica, validar políticas de aprovação e observar custo dos jobs. A Fase 56 não foi iniciada.
