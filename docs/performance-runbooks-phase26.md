# Runbooks de performance e resiliência

## Saturação do banco

1. Confirmar crescimento de conexões, sessões bloqueadas e p95.
2. Identificar a query e o tenant por correlation ID.
3. Pausar analytics e campanhas antes de afetar pedidos.
4. Não cancelar transações sem confirmar impacto.
5. Aplicar a menor correção, comparar a mesma janela e registrar incidente.

## Backlog de webhooks ou jobs

1. Verificar profundidade, idade do job mais antigo e prioridade.
2. Confirmar saúde do provedor e circuit breaker.
3. Escalar workers dentro do mínimo/máximo operacional.
4. Preservar pagamentos, pedidos, cozinha e mensagens transacionais.
5. Reprocessar DLQ somente depois de corrigir a causa; idempotência é obrigatória.

## Indisponibilidade de IA/Meta/gateway/fiscal/storage

1. Abrir o circuit breaker do provedor afetado.
2. Ativar fallback humano ou modo degradado aplicável.
3. Manter pedidos e pagamentos independentes de analytics/campanhas.
4. Registrar timeline usando correlation IDs e release.
5. Voltar por `half-open`, com probes limitados, antes de fechar o circuito.

## Deploy e rollback

1. Executar unit, integration, security e performance smoke.
2. Aplicar migrations no padrão expand → deploy → backfill → contract.
3. Parar novos leases durante shutdown e concluir o lote atual.
4. Fazer canary somente quando o provedor permitir roteamento 5% → 25% → 100%.
5. Rollback de aplicação não implica rollback destrutivo de banco.

## Alertas acionáveis

- p95 acima do SLO por janela sustentada.
- erro 5xx acima do error budget.
- fila crescendo e idade do job mais antigo aumentando.
- conexões de banco acima de 80% e acima de 90%.
- circuit breaker aberto, DLQ nova ou dependency health em outage.

Cada alerta precisa de proprietário e runbook; não criar alerta sem ação definida.
