# Fase 70 — Produção Central e Abastecimento de Rede

## 1. Diagnóstico inicial

O projeto já possuía Inventory/ledger e Recipes (Fase 16), reservas e Procurement (Fase 39), lotes, qualidade e uma estrutura inicial de `production_batches` (Fase 47), transferências entre estabelecimentos, Forecasting (Fase 35), Capacity (Fase 63), Finance/COGS e Data Platform. A implementação expande essas fontes oficiais, sem criar estoque, receita, lote, transferência, compra ou contabilidade paralelos.

## 2. Arquitetura Central Production

O domínio foi organizado em `central_production`, com núcleo de regras puras, API autenticada, operações críticas em funções transacionais do banco, painel responsivo e metadados para Analytics, Reporting, Workspace, Busca, Copilot e Automação.

## 3. Arquivos criados

- `lib/central-production/core.ts`
- `app/api/central-production/route.ts`
- `app/painel/producao-central/page.tsx`
- `app/painel/producao-central/central-production.css`
- `components/central-production-center.tsx`
- `supabase/migrations/20261025065849_phase70_central_production.sql`
- `tests/central-production-phase70.test.mjs`
- este relatório

## 4. Arquivos modificados

- `components/dashboard-shell.tsx`
- `lib/intelligence/copilot-tools.ts`
- `lib/automation/core.ts`
- `package.json`

## 5. Migration

A migration é incremental. Ela amplia tabelas canônicas, usa RLS, revoga acesso direto de `anon/authenticated`, concede operações internas ao `service_role`, cria índices por organização/status/data e mantém funções críticas fechadas à API autenticada.

## 6. Production units

`production_units` aceita cozinha central, comissária, fábrica interna, centro de pré-preparo, produção na loja e depósito com produção. `store_id` é opcional; `inventory_establishment_id` ancora o saldo oficial sem exigir exposição pública da unidade.

## 7. Production recipes

`production_recipe_profiles` guarda versão, rendimento, consumo, validade, etapas e controles configuráveis. Os componentes continuam em `inventory_recipes`. `production_recipe_outputs` prepara múltiplas saídas/subprodutos e a validação de ciclos bloqueia A → B → A.

## 8. Production orders

`production_orders` implementa rascunho, planejamento, liberação, execução, pausa, conclusão parcial, conclusão e cancelamento. A origem pode ser manual, requisição, previsão, reposição, campanha, estoque inicial ou contexto customizado.

## 9. Material requirements

`MaterialRequirementService` usa quantidade decimal, rendimento, conversão e desperdício configurado. A liberação compara disponível, reservado, falta e entrada prevista.

## 10. Inventory reservations/issues

`inventory_reservations` atualiza `inventory_items.reserved_quantity`. `issue_production_material` bloqueia saldo negativo, exige lote liberado e gera `inventory_movements` do tipo `production_out`.

## 11. Batch production

`production_batches` foi ampliada, não recriada. Registra ordem, número legível, versão, planejado/real, rendimento, desperdício, qualidade, lote de saída e custo fechado.

## 12. Lot traceability

O lote produzido nasce em `inventory_lots`. Os lotes de entrada permanecem em `production_batch_inputs`, ligados à baixa oficial e ao batch, permitindo rastrear produto final → intermediário → insumos.

## 13. Yield/waste

Rendimento esperado, real e variação são explícitos. Perdas exigem razão controlada e movimentação oficial; não há atribuição automática de culpa ao funcionário.

## 14. Costing

O custo é gerencial: material, embalagem e adicionais opcionais de mão de obra/overhead estimados. `production_cost_snapshots` é imutável após conclusão e não se apresenta como folha real ou contabilidade industrial.

## 15. Store requisitions

`internal_requisitions` e seus itens suportam corte configurável, aviso de atraso, aprovação, atendimento parcial e escopo estrito da loja solicitante.

## 16. Allocation

As políticas explícitas são proporcional, prioridade da loja, ordem de aprovação, manual e garantia mínima. A prévia sempre mostra solicitado, alocado e falta.

## 17. Transfers

`inventory_transfers` foi ampliada com aprovação, picking, packing, despacho, trânsito, recebimento parcial, divergência e recebimento final. Itens e lotes permanecem vinculados ao modelo oficial.

## 18. In-transit inventory

`inventory_transfer_transit_balances` e a localização virtual `IN_TRANSIT` mantêm visibilidade entre a saída da origem e a confirmação do destino.

## 19. Dispatch

O despacho valida lote, saldo, status e idempotência. A saída gera `transfer_out` com destino virtual; entrega a cliente não é confundida com `internal_transfer`.

## 20. Receiving

O destino confirma explicitamente quantidade, condição e temperatura quando configurada. A entrada `transfer_in` só ocorre após confirmação do servidor.

## 21. Discrepancies

Falta, excesso, avaria, item/lote errado, vencimento e temperatura inadequada viram registros próprios. Nada ajusta saldo silenciosamente.

## 22. Returns

Devoluções internas preservam item, lote, motivo, aprovação, despacho, recebimento e referências aos movimentos oficiais.

## 23. Shelf life/FEFO

Validade é configurada por item/receita. FEFO ignora lotes bloqueados, em quarentena, vencidos ou incapazes de chegar dentro da janela de segurança.

## 24. Forecast/Capacity integration

O planejamento consolida requisições e previsões, subtrai estoque/entradas, respeita tamanho de lote e compara com capacidade. Resultado é sugestão em dry run e nunca inicia produção automaticamente.

## 25. Procurement/Quality integration

Faltas geram recomendação revisável no Procurement; não geram compra. Retenção e liberação de lote continuam sob Quality e sua permissão separada.

## 26. Finance integration

Transferência interna não vira venda. A valorização aceita custo, custo padrão, cost plus ou preço gerencial, sempre como snapshot configurável e sem afirmar tratamento fiscal.

## 27. Reporting/Workspace

Foram registrados oito datasets, nove modelos de relatório e seis widgets: produção de hoje, faltas, requisições, trânsito, retenções e estoque vencendo.

## 28. Copilot

Foram incluídas dez ferramentas somente de leitura/simulação. A resposta separa fatos, demanda, capacidade, materiais, riscos e próximos passos, sem inventar lote ou custo.

## 29. Data Platform

As facts são views sobre tabelas canônicas. Métricas semânticas incluem aderência ao plano, rendimento, desperdício, fill rate, pontualidade, divergência, cobertura, retenção, lead times e custos.

## 30. Security/RBAC

Há 14 permissões específicas, escopo por organização/unidade/loja, custo separado, receita restrita, funções críticas internas e feature flags/entitlements por plano.

## 31. Audit

Criação/liberação/cancelamento, baixas, conclusão, rendimento, requisições, alocação, transferência, despacho, recebimento, divergência, retorno e política de custo deixam trilha. Registros operacionais não têm hard delete.

## 32. Observability

O modelo registra jobs do plano, falhas de ordem, conflitos de reserva, latência de conclusão, despacho, falhas de recebimento, divergências, rastreabilidade e consistência ledger versus projeção.

## 33. Tests

O arquivo de Fase 70 contém exatamente 30 cenários: unidade, receita, ordem, materiais, reserva, insuficiência, início, baixa, conclusão, lote, rastreabilidade, bloqueio, rendimento, perda, custo, requisição, alocação, parcial, transferência, picking, despacho, trânsito, recebimento, parcial, divergência, retorno, validade, permissões, auditoria e isolamento.

## 34. Limitações

- Integrações físicas de balança e impressora dependem do Hardware Agent configurado.
- Limites sanitários não são fornecidos pelo sistema; o cliente deve cadastrá-los.
- Otimização avançada de supply chain, contabilidade industrial e regra fiscal intercompany estão fora do escopo.
- Migrations e publicação em produção exigem autorização separada.

## 35. Recomendações para a Fase 71

Validar a operação com uma central piloto, cadastrar políticas de qualidade/validade, homologar rotas e impressão de etiquetas, medir consistência do ledger e só depois ampliar para otimização de rede. A Fase 71 não foi iniciada.

