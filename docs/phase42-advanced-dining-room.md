# Fase 42 — Gestão avançada de salão

## 1. Diagnóstico inicial

O projeto já possuía `dining_areas`, `restaurant_tables`, `table_sessions`, `table_orders`, `table_order_items`, `table_payments`, reservas, fila de espera, garçons, KDS, PIX, caixa, comprovantes, auditoria e Realtime. A fase expande essas fontes oficiais e não cria sistemas paralelos de pedidos ou mesas.

## 2–4. Arquivos e migrations

- Criados: `lib/dining_room/core.ts`, `components/advanced-dining-room.tsx`, CSS responsivo, migration e testes da Fase 42.
- Modificados: página `/painel/salao`, navegação/entitlements e scripts de teste.
- Migration: `20261022010000_phase42_advanced_dining_room.sql`.

## 5–10. Áreas, mapa, sessões, comandas, garçom e QR

- Áreas e mesas existentes são reutilizadas; posição visual é persistida sem alterar status.
- Sessões agora ligam organização, unidade, reserva, cliente e garçom responsável.
- Comandas coletivas e individuais usam `dining_tabs`; itens continuam em `table_order_items` e podem apontar para comanda/assento.
- O modo garçom existente permanece como canal de lançamento; a visão de salão adiciona carga, atribuição e handoff auditável.
- QR usa a mesa e sessão existentes; o modo direto/aprovação é configurável por unidade.

## 11–18. Atendimento, conta, pagamentos e integrações

- `dining_service_requests` trata garçom, conta, água, ajuda e outros pedidos com escalonamento configurável.
- Conta suporta taxa de serviço configurável, gorjeta separada, descontos e ajustes rastreáveis.
- Divisão igual usa centavos inteiros; divisão por comanda/item é preparada por vínculos de alocação.
- `dining_payment_allocations` permite PIX, cartão e dinheiro em pagamentos parciais/múltiplos com idempotência e lock da sessão.
- PIX só confirma com identificador válido do provedor; comprovantes existentes não foram duplicados.
- Transferências de mesa, comanda e garçom preservam histórico.
- Cozinha continua recebendo `table_orders`/`table_order_items`; reservas e workforce são reutilizados.

## 19–23. Analytics, Copilot, ações, permissões e auditoria

- Facts: sessões, comandas, pedidos, solicitações e pagamentos; dimensions: área, mesa e garçom.
- Métricas semânticas: ocupação, giro, permanência, primeiro pedido, fechamento, gasto por mesa/pessoa e resposta.
- O Manager Copilot expõe oito consultas somente leitura.
- ActionEngine exige confirmação em transferência, atribuição, junção, reabertura, desconto e bloqueio.
- Dez permissões `dining:*`; todas as novas tabelas têm RLS por unidade/organização.
- Auditoria registra abertura, conta, pagamento, transferência, reabertura e demais ações sensíveis.

## 24. Testes

37 testes cobrem os 30 cenários obrigatórios, acessibilidade, responsividade, Copilot, ActionEngine e garantia de que a Fase 43 não foi iniciada.

## 25. Limitações

- Distribuição trabalhista de gorjetas e crédito informal não foram implementados.
- Arrastar mesas fica restrito ao modo de edição; persistência de posições deve passar por permissão de configuração.
- Analytics históricos dependem do processo de carga da plataforma de dados.

## 26. Recomendações para a Fase 43

Validar o volume real de eventos Realtime, habilitar Broadcast quando a escala justificar e ampliar testes E2E com dispositivos móveis e gateways reais. A Fase 43 não foi iniciada.
