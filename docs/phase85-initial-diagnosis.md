# Fase 85 — diagnóstico inicial

## Autoridades revisadas

- Fase 26 continua dona de métricas, logs, traces, filas, latência e health checks. A Fase 85 armazena somente definições e agregados de avaliação.
- Fase 84 continua dona da saúde atual, correlação operacional e alertas do NOC. Reliability adiciona o contexto histórico de SLO, budget e burn.
- Fase 59 continua dona de incidentes, timeline, war room, recuperação e postmortem. O impacto em budget é uma anotação vinculada, não um segundo incidente.
- Fase 27 continua dona de CI/CD e releases. O guardrail devolve uma decisão explicável; não executa deploy, rollback ou bloqueio fora de policy.
- Fase 77 continua dona de feature flags e rollouts. Reliability pode impedir avanço de estágio quando a policy exigir aprovação, sem criar outro rollout engine.
- Fase 76 continua dona de data quality, data contracts e SLOs de dados. A Fase 85 cobre serviços, produto e jornadas operacionais.
- Fases 52, 68, 79 e 81 permanecem autoridades de notificação, conhecimento/runbooks, policies/waivers e integrações/providers.

## Lacunas encontradas

Havia métricas técnicas e health por domínio, mas faltavam catálogo único de serviços, jornadas críticas, definição tipada de good/valid events, objetivos versionados, error budget derivado, burn multi-window, backtest e decisão de release ligada a budget. Uptime técnico não estava formalmente separado da experiência do cliente. Ausência de telemetria precisava de um contrato explícito `unknown`.

## Arquitetura escolhida

`Observability aggregates → typed SLI registry → immutable measurements → versioned SLO evaluation → error budget → multi-window burn → alerts/reviews/guardrails`.

O módulo fica fora do request path de pedidos. NOC exibe saúde atual; Reliability exibe desempenho na janela. Provider reliability e end-to-end reliability são mantidos separadamente. Exclusões afetam somente a visão declarada e são auditáveis.

## Segurança, escala e mudanças recentes do Supabase

As tabelas ficam em `public` com RLS, grants removidos de `anon`/`authenticated` e acesso somente via backend `service_role`. Isso também prepara o projeto para a alteração do Supabase que deixa de expor novas tabelas automaticamente. Agregados por bucket evitam copiar eventos brutos e índices cobrem tenant, SLO, janela, status e data. Metadados de arquitetura sensíveis permanecem restritos.
