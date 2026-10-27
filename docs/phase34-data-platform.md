# Fase 34 — Data Platform, BI e Analytics

## Diagnóstico inicial

O banco operacional continua sendo a fonte de verdade de pedidos, pagamentos, estoque, mensagens, autenticação e demais decisões em tempo real. A inspeção anterior à implementação encontrou volume ainda moderado: 25 pedidos, 30 itens, 1 organização, 34 trabalhos de impressão e 113 registros de auditoria; eventos de produto, mensagens normalizadas e movimentos de estoque ainda estavam sem volume relevante. Não existiam materialized views. O maior risco observado era o Centro de Comando executivo reunir mais de vinte fontes OLTP por abertura, além de relatórios e exports repetirem leituras históricas.

A decisão inicial é manter o mesmo projeto Postgres, mas separar logicamente o OLAP em tabelas `analytics_*`. Isso reduz custo e complexidade agora, preservando a abstração `WarehouseProvider` para BigQuery, ClickHouse, Snowflake, Redshift ou outro provider no futuro. O corte recomendado para reavaliar provider externo é crescimento sustentado que torne backfills, retenção ou concorrência analítica incompatíveis com o SLA operacional.

## Arquitetura

```text
OLTP (fonte operacional)
  → outbox / sync incremental por updated_at, created_at e event_id
  → raw
  → staging + contratos + validação
  → clean
  → dimensões e fatos
  → marts/agregados certificados
  → SemanticMetricsService
  → dashboards, Report Center, exports e Analytics Copilot
```

Os módulos conceituais ficam em `lib/data-platform`: ingestion, transformations, warehouse, semantic layer, metrics, dimensions, facts, quality, lineage, dashboards e exports. O `PostgresAnalyticsProvider` implementa o contrato neutro `WarehouseProvider` (`loadBatch`, `executeQuery`, `createDataset`, `healthCheck`).

## Modelo, granularidade e histórico

- `analytics_fact_orders`: uma linha por pedido.
- `analytics_fact_order_items`: uma linha por item.
- Demais fatos cobrem pagamento, estoque, mensagens, IA, delivery, suporte, assinatura SaaS, movimentos de MRR, oportunidades, customer health e eventos de produto.
- Dimensões cobrem data, hora, organização, unidade, cliente pseudonimizado, produto, plano, canal, funcionário pseudonimizado, campanha e origem.
- Dimensão de data: 2020–2035. Eventos guardam UTC, data local e timezone de origem quando aplicável.
- Dimensões historizáveis possuem `valid_from`, `valid_to` e `is_current`, preparando SCD Type 2 apenas onde o histórico tem valor.
- Agregados iniciais: pedidos, receita, suporte e IA diários; Customer 360 e Organization 360.

## Métricas e lineage

O catálogo registra nome, descrição, fórmula, fonte de verdade, grão, responsável, frequência, unidade e classificação (fato, cálculo ou estimativa). O `SemanticMetricsService` valida métricas e dimensões por whitelist e reutiliza o `RevenueMetricsService` para não redefinir MRR, NRR, churn e receita.

Lineage inicial:

| Origem | Transformação | Dataset | Métricas |
|---|---|---|---|
| orders + order_items + payments | incremental_sales_transform | sales_mart | orders, GMV, revenue, ticket, cancelamento |
| revenue_snapshots | official_revenue_snapshot_copy | saas_revenue_mart | MRR, NRR, churn |
| product_events | incremental_product_events | product_mart | conversão de IA e produto |

## Segurança, privacidade e governança

RLS e validação backend separam organizações e o BI interno do MasterApp. Permissões: `analytics:view`, `analytics:custom_dashboard`, `analytics:export`, `analytics:internal` e `analytics:advanced`. PII é minimizada; dimensões de cliente e funcionário usam pseudônimos. Export, consultas, criação de dashboard, relatórios e ações sensíveis são auditados. Exclusões LGPD entram em `data_subject_deletion_jobs` para propagação e anonimização.

Usuários comuns nunca enviam SQL. O query builder aceita métricas/dimensões aprovadas, período limitado e até 10.000 linhas. Result cache inclui métrica, filtros, intervalo, organização e unidade; validade acompanha freshness. Exports grandes e relatórios são jobs assíncronos com links temporários.

## Qualidade, reconciliação e operação

As regras iniciais validam unicidade, relacionamento, valores não negativos, freshness, anomalia de volume e reconciliação. Registros inválidos podem seguir para quarentena sem interromper todo o pipeline. Runs registram linhas processadas, duração, falha, lag e custo; DLQ preserva falhas para retry/backoff. Checkpoints garantem retomada incremental e cargas usam chaves únicas/upsert para idempotência. Backfill é limitado, tem preview e exige confirmação humana.

O Centro de Comando deve usar warehouse para histórico e continuar usando OLTP/agregados em tempo real para incidentes e as últimas 24 horas. O helper `hybridWindow` explicita esse corte.

## Retenção e custo

- Raw/staging: retenção curta e configurável por dataset.
- Clean/facts: retenção conforme necessidade legal e analítica.
- Agregados: retenção longa.
- Índices agrupam consultas por organização, unidade e data; particionamento fica preparado para quando o volume justificar.
- `analytics_cost_usage` registra storage, compute, queries, custo estimado e alerta de orçamento.

## Limitações atuais

1. O provider inicial ainda compartilha a mesma instância Postgres, embora use tabelas e acesso separados.
2. CDC físico não foi ativado; o primeiro ciclo usa incremental sync e outbox.
3. Envio por e-mail e geração binária de XLSX/PDF permanecem como jobs preparados, desativados por flag até configuração explícita.
4. Particionamento físico será aplicado somente quando o volume justificar.
5. Causas não são inferidas automaticamente; data stories descrevem variações e deixam causalidade como hipótese.

## Recomendação para a Fase 35

Medir por pelo menos um ciclo real o lag, duração, custo, volume e taxa de falhas. A próxima fase pode então automatizar o worker assíncrono, ativar CDC onde suportado, materializar marts de alto uso e avaliar provider externo com dados concretos. A Fase 35 não foi iniciada.
