# Fase 82 — Digital Twin Operacional

## Resultado

A Fase 82 implementa snapshots imutáveis, topologia derivada, cenários tipados, assumptions versionadas, DAG de adapters, projeção de estoque isolada, impactos operacionais/financeiros, constraints, stress tests, breakpoints, comparações, recomendações draft, RBAC, auditoria e observabilidade. Nenhum adapter grava nos módulos oficiais.

## Arquitetura

`Snapshot → Assumptions → Adapters oficiais → Resultados simulados → Constraints → Recomendações draft`

O `DigitalTwinRunOrchestrator` executa demanda, supply, estoque, capacidade, produção, workforce, transporte e finanças. Cada etapa registra versão, input hash, warnings e qualidade. Falha não crítica produz resultado parcial; o snapshot nunca consulta dados vivos durante a execução.

## Arquivos principais

- `lib/digital_twin/core.ts`: domínio, adapters, DAG, stress, breakpoints e governança.
- `app/api/digital-twin/route.ts`: snapshot, cenário e execução por tenant.
- `components/digital-twin-center.tsx`: builder seguro e visão executiva.
- `app/painel/planejamento/digital-twin/*`: rota e design responsivo.
- `supabase/migrations/20261028082337_phase82_digital_twin.sql`: persistência, RLS e grants explícitos.
- `tests/digital-twin-phase82.test.mjs`: não-mutação, reprodutibilidade, isolamento e integrações.

## Segurança e isolamento

Todas as tabelas têm RLS, acesso revogado para `public`, `anon` e `authenticated`, e grant explícito somente ao `service_role`. A API valida usuário, organização, unidade e permissão. Topologia, cache e resultados são tenant-scoped. Payloads não contêm PII de clientes nem detalhe individual de pessoas.

## Dados e reporting

Foram registrados facts, dimensions, métricas semânticas, datasets e templates específicos. Todos os indicadores usam o prefixo `simulated_` e não podem ser misturados com actuals. A linhagem liga cenário, snapshot, adapter e versão.

## Limitações

O primeiro release é determinístico. Monte Carlo, distribuições e granularidade WMS detalhada permanecem sob feature flag para evolução posterior. Sem migration aplicada, a interface publicada não deve ser ativada. O worker distribuído deve usar a fila de produção após homologação.

## Recomendação para a Fase 83

Primeiro homologar a Fase 82 com uma rede-piloto, calibrar baselines e capacidades, validar tempo/custo das execuções, ensaiar falha parcial e confirmar que os ledgers oficiais não mudam. Não iniciar a Fase 83 automaticamente.
