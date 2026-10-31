# Diagnóstico da Fase 91 — Enterprise Portfolio Management

## 1. Project e Task Management

A Fase 32 é a fonte canônica de execução. `internal_projects`, `internal_tasks`, `internal_task_dependencies`, `internal_teams`, aprovações, decisões e documentos já representam projetos, marcos operacionais, dependências e trabalho. A Fase 91 deve apenas ligar iniciativas a projetos e consumir status, progresso, custos e datas; não criará tarefas, cronograma detalhado, Gantt ou motor de execução paralelo.

## 2. Goals, OKRs e performance

A Fase 55 mantém `performance_goals`, `objectives`, key results, versões, snapshots e scorecards. Iniciativas do portfólio referenciarão metas existentes por `initiative_goal_links`. Cobertura estratégica será calculada sobre links confirmados, sem copiar metas ou alterar seus resultados.

## 3. Finance e orçamento

`operational_budgets`, `budget_versions` e snapshots financeiros são a autoridade de orçamento e realizado. Funding do portfólio armazenará pedidos e decisões com `source_budget_ref`; lançamentos, transferências e contabilidade continuarão em Finance. Valores monetários exigirão moeda e benefícios qualitativos nunca serão agregados como dinheiro.

## 4. Integrated Business Planning

A Fase 74 já oferece ciclos, cenários, premissas, restrições, reconciliação financeira e baselines de planejamento. Cenários de portfólio serão simulações de investimentos e capacidade, sem substituir cenários IBP nem publicar metas de execução automaticamente.

## 5. Enterprise Architecture

A Fase 90 é a autoridade de capabilities, aplicações, relacionamentos, target states, roadmaps e dívida técnica. O portfólio ligará iniciativas a capabilities e referências arquiteturais confirmadas; gaps, modernização e technical debt podem originar demandas, mas nunca serão convertidos automaticamente em projetos.

## 6. Enterprise Risk

A Fase 87 mantém riscos, avaliações, tratamentos, apetite, controles e decisões. `initiative_risk_links` permitirá demonstrar investimento em mitigação. Gates obrigatórios poderão ser recomendados por políticas, mas não aprovarão funding sozinhos.

## 7. Change Management

A Fase 88 permanece responsável pela governança e execução de mudanças. `initiative_change_links` somente relacionará resultados de mudança à iniciativa e ao benefício esperado. Parar uma iniciativa não cancela mudanças ou projetos automaticamente.

## 8. Capability gaps, technical debt e ideias dispersas

As fontes encontradas incluem `architecture_modernization_opportunities`, `architecture_technical_debt`, gaps arquiteturais, tratamentos de risco, melhorias de processo da Fase 89, incidentes recorrentes, continuidade, confiabilidade e `strategic_initiatives` da Fase 32. A triagem consolidará referências sem copiar payloads e marcará candidatos semelhantes para revisão humana, nunca merge automático.

## 9. Expansão

`store_opening_projects` e os marcos da Fase 65 já governam abertura de unidades. Programas e iniciativas de expansão apenas referenciarão esses projetos e seus estados.

## 10. Capacidade de equipes

`internal_teams`, estimativas de tarefas, Workforce Planning da Fase 58, Capacity Management da Fase 63 e revisões de capacidade do IBP fornecem sinais de capacidade. A primeira versão trabalhará por equipe, função, domínio, região e período, mantendo unidades compatíveis. Não haverá agendamento ou ranking de indivíduos.

## 11. Campos de portfólio existentes

`strategic_initiatives` contém uma associação simples entre iniciativa e projeto, impacto e confiança, porém é plataforma-interna e não cobre demanda, business case, funding, benefícios, cenários ou multi-tenant. A Fase 91 introduzirá um registro empresarial próprio e explícito de iniciativas, mantendo a Fase 32 como execução e permitindo referência histórica às iniciativas existentes.

## 12. Decisão de arquitetura

Será criado um control plane aditivo em `lib/enterprise-portfolio`, com dois contextos incompatíveis: `masterapp_internal_portfolio` sem tenant e `tenant_enterprise_portfolio` com `organization_id`. O módulo falhará de forma isolada, preservará baselines e decisões imutáveis, mostrará critérios e trade-offs de priorização, e produzirá apenas recomendações revisáveis. Projetos, metas, orçamento, workforce, riscos, mudanças e arquitetura continuarão canônicos em seus módulos de origem.
