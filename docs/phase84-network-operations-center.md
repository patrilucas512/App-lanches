# Fase 84 — Network Operations Center

## Entrega

A Central da Rede agrega sinais oficiais de pedidos, KDS, capacidade, estoque, WMS, TMS, delivery, hardware, integrações, pagamentos, fiscal e offline. A entrega inclui contratos/adapters, normalização, freshness, saúde explicável por unidade e rede, correlação, deduplicação, hysteresis, prioridade, impacto, alertas, incident bridge, resposta governada, riscos projetados, analytics, Reporting, Data Platform, Workspace, busca global e Copilot.

## Signal model e adapters

`network_operation_signals` preserva source domain/type/id, severity original normalizada, status, timestamps, freshness e correlation key. Os adapters usam serviços públicos dos domínios e não tabelas privadas quando evitável. Metadata sensível é removida. Sinais atuais e riscos projetados são entidades diferentes.

## Health, freshness e correlação

`StoreOperationalHealthService` retorna status e razões explícitas. Loja fechada conforme agenda não é tratada como falha e leitura expirada vira `unknown`. `NetworkOperationalHealthService` mostra contagens e impacto, não uma média opaca. Correlação rules-first agrupa provider/shared-service/region e nunca confirma root cause automaticamente.

## Alertas, incidentes e resposta

Alertas representam eventos correlacionados e reconhecer não resolve a fonte. Supressão exige motivo e, quando aplicável, expiração. `NOCIncidentBridgeService` cria candidato e link; a Fase 59 continua dona do incidente. `NOCResponseActionService` só oferece catálogo permitido e solicita execução aos serviços oficiais/ActionEngine. Ações de alto risco exigem preview, confirmação e aprovação.

## UI e integrações

A rota `/painel/operacoes/central-da-rede` possui overview, command view com alternativa em lista, unidades, alertas, incidentes, domínios, histórico, analytics e configurações. O refresh é incremental e mostra freshness. Reporting, semantic metrics, Workspace widgets, busca/command palette e Copilot foram registrados. Executive Command Center pode consumir apenas network availability, lojas críticas, SEV, pedidos em risco e provider outage material.

## Segurança, observabilidade e resiliência

Tabelas novas têm RLS, grants restritos e índices de tenant/status/freshness. NOC mede ingestion lag, processing failures, correlation latency, alert count, ack/recovery e stale health. Se o NOC falhar, ordering e painéis de domínio continuam disponíveis; o fallback é alerta crítico bruto de origem, marcado com freshness.

## Limitações deliberadas e dívida técnica

Não há root-cause ML, remediação crítica automática, leitura cross-tenant, cópia integral de métricas, mapa geográfico novo ou polling agressivo. Produção ainda precisa conectar os adapters aos event streams/health services reais, calibrar retenção e thresholds por tenant, executar carga com milhares de lojas e publicar gradualmente via feature flags.

## Recomendação futura

A próxima fase deve partir de evidência de operação real, sem substituir os domínios oficiais e sem iniciar automaticamente qualquer novo módulo. A Fase 85 não foi iniciada.
