# Fase 85 — Service Reliability Management

## Arquitetura e módulos

O domínio `service-reliability` implementa Service Catalog, tiers configuráveis, dependências, jornadas críticas, SLIs tipados, SLOs versionados, exclusões auditáveis, error budgets, burn rates multi-window, alertas, impacto de incidentes, provider reliability, release guardrails, change freezes, waivers, backtests e reviews.

## Regras centrais

- `missing`, `stale` e denominador zero resultam em `unknown`, nunca em saudável;
- SLO exige janela, owner, target e versão; uma alteração fecha a versão anterior sem reescrever avaliações;
- error budget deriva de good/valid events e do target vigente;
- customer-experienced reliability não esconde falha causada por provider;
- release e feature rollout consultam policies explícitas; emergência, security patch, incident remediation e reliability fix passam por exceção aprovada;
- nenhum guardrail executa rollback automático e a operação de pedidos independe do módulo.

## Integrações

- Observability: fonte de medições agregadas e freshness;
- NOC: link entre saúde atual e confiabilidade histórica;
- Incident Management: impacto de bad events e budget sem dupla contagem por bucket;
- Feature Management: gate adicional no avanço de rollout;
- CI/CD/Release: decisão `proceed`, warning, approval, restricted ou block nonessential;
- Reporting/Data Platform/Workspace: datasets, facts, dimensions, semantic metrics, templates e widgets;
- Data Governance: lineage `SLO → SLI → metric/event` sem duplicar data SLO;
- Copilot: leitura, explicação, comparação e backtest; sem publicar SLO, congelar release ou declarar causa raiz.

## Operação e limitações

A avaliação incremental, os jobs de burn e a ponte de alertas precisam ser executados pelo backend operacional após a migration. Nesta entrega, adapters apontam para referências seguras de Observability e o dashboard consome os read models. A qualidade de disponibilidade permanece limitada pela telemetria real. Não há crédito de SLA, bloqueio físico de Git, rollback automático ou inferência causal.

## Próximos cuidados

Antes de ativar guardrails bloqueantes em produção, cadastrar owners, mapear serviços críticos, conectar os adapters oficiais, criar SLOs em rascunho, executar backtest e aprovar policies por organização. A Fase 86 não foi iniciada.
