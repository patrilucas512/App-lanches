# Fase 41 — KDS Avançado e Orquestração de Produção

## 1. Diagnóstico inicial

O fluxo canônico já usa `orders`, `order_items`, `table_orders`, `table_order_items`, `kitchen_tickets` e `update_kitchen_ticket`. Também existem impressão direta, receitas, estoque, reservas, delivery, previsão, força de trabalho, realtime e auditoria. A Fase 41 estende essas fontes e preserva o KDS clássico; não cria outro sistema de pedidos.

## 2. Arquivos criados

- `lib/kitchen_orchestration/core.ts`
- `supabase/migrations/20261021050000_kitchen_orchestration_phase41.sql`
- `app/api/kitchen-orchestration/route.ts`
- `components/kitchen-orchestration-center.tsx`
- `app/painel/cozinha/page.tsx`
- `app/painel/cozinha/kitchen-orchestration.css`
- `tests/kitchen-orchestration-phase41.test.mjs`
- este relatório

## 3. Arquivos modificados

- `components/dashboard-shell.tsx`
- `package.json`

## 4. Migration, estações e etapas

Foram adicionadas estações customizáveis, vínculos produto–estação, etapas ordenadas, dependências validadas contra ciclo, equipamentos opcionais e regras de overflow somente entre estações compatíveis. Organização e unidade são obrigatórias em todo o domínio.

## 5. Planos e tarefas de produção

`order_production_plans` referencia `orders` ou `table_orders`. `kitchen_tasks` referencia seus itens canônicos, estação, etapa, colaborador e lote, com tempos, prioridade explicável, exceção, remake e chave idempotente. Nenhuma IA consegue marcar item pronto: a transição exige início operacional real.

## 6. Fila, sincronização e batching

`KitchenQueueService` usa idade, promessa, duração, dependências, carga, canal e prioridade manual, expondo fatores. Em falha, usa FIFO seguro. `KitchenSynchronizationService` calcula disparos com tolerância e limite de espera por qualidade. `KitchenBatchingService` agrupa somente itens compatíveis e recusa pedidos críticos.

## 7. Capacidade, expedição e delivery

Capacidade combina simultaneidade, produção por hora e equipamento. Expedição separa parcial/pronto, valida todas as tarefas e aceita checklist opcional. O snapshot incorpora motoboy, ETA e status de delivery sem alterar arbitrariamente `orders` ou `deliveries`.

## 8. Workforce, previsão e qualidade

A área mostra equipe ativa e `employee_skills`; apenas sugere reforço. A Preparação do Dia lê previsões e não produz automaticamente. Analytics mantém velocidade e qualidade juntas, sem ranking punitivo individual.

## 9. Manager Copilot e ActionEngine

Ferramentas de leitura: status, backlog, carga, atrasos, gargalos, previsão, expedição e capacidade. Ações sensíveis exigem confirmação: repriorizar, mover tarefa compatível, pausar estação, indisponibilizar equipamento, disponibilidade de produto, criar lote e ampliar ETA do canal.

## 10. Resiliência, permissões e auditoria

Realtime tem polling de 15 s como fallback; fila inteligente cai para FIFO; roteamento cai para a estação primária; impressão e KDS clássico permanecem. Eventos são idempotentes, status final não regride e outbox registra eventos críticos. Há sete permissões, RLS por unidade, grants explícitos e auditoria de mudanças manuais/automáticas.

## 11. Dados e métricas

Foram criados fatos/dimensões de tarefas, lotes, carga, exceções, produção, estações, equipamentos e etapas. Métricas: Prep Time, Station Wait Time, Late Prep Rate, Remake Rate, Kitchen Throughput, Expedition Wait Time e Station Utilization.

## 12. Testes

Trinta e quatro testes cobrem os 26 cenários obrigatórios, integração, guardrails, métricas, convivência com o KDS clássico e a garantia de não iniciar a Fase 42.

## 13. Limitações

- O setup inicial precisa ser configurado por unidade antes de gerar tarefas reais.
- Offline local com reenvio de ações depende do suporte da PWA; nesta entrega o fallback é polling e idempotência no servidor.
- Estimativas melhoram somente após histórico suficiente; não há falsa precisão nem ML obrigatório.
- Course management está preparado no modelo, mas a ação do garçom precisa ser habilitada por negócio.

## 14. Recomendações para a Fase 42

Pilotar uma unidade e calibrar tempos/capacidades por estação; medir latência do realtime; validar regras de impressão por estação; ativar fila inteligente e batching gradualmente; só então ampliar automações. A Fase 42 não foi iniciada.
