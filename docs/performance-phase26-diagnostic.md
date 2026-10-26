# Fase 26 — diagnóstico inicial e baseline

Data da medição: 2026-10-12. Janela: últimas 24 horas. Fontes: Supabase Logs, `pg_stat_statements`, `pg_stat_activity`, `pg_statio_user_*` e Performance Advisor.

## Infraestrutura encontrada

- Aplicação monolítica modular em Vinext/Next, implantada em Cloudflare Workers.
- Supabase/Postgres como banco, Auth, Storage e Realtime.
- 364 tabelas públicas e 972 índices públicos.
- `pg_stat_statements`, `pg_cron`, `pg_net`, `pgcrypto` e Vault disponíveis.
- Filas especializadas já existentes para fiscal, integrações, impressão, migração e webhooks; faltava uma abstração comum com prioridade, fairness, lease e DLQ.
- Backend já majoritariamente stateless; estado crítico permanece no Postgres/Storage.

## Baseline medida

| Indicador | Antes da Fase 26 |
| --- | ---: |
| Requisições | 23.225/24h |
| p50 API | 24 ms |
| p95 API | 62 ms |
| p99 API | 229,45 ms |
| Erros 5xx | 7 (0,03%) |
| Cache de índices | 99,97% |
| Cache de tabelas | 100% |
| Conexões | 7/60 |
| Sessões bloqueadas | 0 |

CPU, memória, throughput de workers e conexões WebSocket não estavam expostos à aplicação; permanecem como métricas a coletar pelo provedor, sem valores inventados.

## Gargalos encontrados

1. O fanout do Realtime é o maior consumidor acumulado do banco: aproximadamente 624 mil chamadas, média de 9,74 ms. Deve-se preferir canais agregados/Broadcast nos fluxos de maior volume.
2. Consultas de cozinha têm média observada de 19,46 ms e polling frequente. O índice composto adequado já existe; a próxima melhoria é reduzir polling e consolidar subscriptions.
3. Rotinas periódicas de suporte e comércio WhatsApp consomem mais tempo total do que consultas transacionais individuais.
4. `printer_jobs` apresenta muitas leituras/polling para poucas linhas; os índices de fila já são adequados, portanto adicionar outro índice não resolveria o padrão.
5. O Advisor reporta muitos FKs sem índice, mas o banco ainda é pequeno. Criar todos agora aumentaria custo de escrita sem evidência. A Fase 26 indexa as novas consultas críticas e mantém revisão guiada por uso.
6. Faltavam correlação ponta a ponta, release tagging, baseline persistida, SLOs, DLQ geral, cache versionado e custo por tenant.

## Single points of failure

- Banco primário e região do projeto.
- Provedores externos de WhatsApp, pagamentos, fiscal, voz e IA.
- Agendador/worker que aciona processamento assíncrono.
- Realtime concentrado no mesmo projeto.

As mitigações desta fase são filas persistentes, timeouts, retries, circuit breaker, bulkhead lógico por filas, modos de degradação e runbooks. Multi-region e Kafka não foram introduzidos sem necessidade medida.

## Critério antes/depois

“Antes” está persistido em `performance_baselines`. “Depois” deve usar a mesma janela e fonte após tráfego suficiente da nova release. Não se declara ganho de latência com tráfego sintético ou amostra curta.
