# Fase 72 — Warehouse Management (WMS)

## 1. Diagnóstico inicial

O MasterApp já possuía o ledger `inventory_movements`, saldo materializado em `inventory_items.balance`, compras e recebimentos da Fase 16/39, transferências oficiais ampliadas na Fase 70, localizações e lotes da Fase 47, Hardware Hub da Fase 45, fila offline da Fase 44, Supply Chain da Fase 71 e Produção Central. A implementação reutiliza todos esses domínios. Não foi criado segundo estoque, fluxo paralelo de transferência nem TMS.

## 2. Arquitetura

O domínio `warehouse_management` orquestra operações físicas. `inventory_movements` continua sendo o livro oficial; `warehouse_location_inventory` é somente uma projeção incremental por endereço, item e lote. A API valida sessão, tenant, permissão e confirmação humana.

## 3. Arquivos criados

Foram criados o núcleo determinístico, API e worker, página, componente, CSS, migration, 30 testes e este relatório.

## 4. Arquivos modificados

Dashboard, catálogo de Copiloto, Automação, Reporting e scripts de teste receberam integrações da Fase 72.

## 5. Migration

`20261026022154_phase72_warehouse_management.sql` adiciona flags, hierarquia física, projeção por endereço, recebimentos, tarefas, fulfillments, ondas, unidades logísticas, packing, shipments, contagens, exceções, offline, slotting, auditoria, métricas e o RPC atômico de movimentação interna. A migration não foi aplicada em produção.

## 6. Hierarquia física

`inventory_locations` foi ampliada para depósito, zona, corredor, endereço, staging, doca e trânsito, com pai, caminho lógico, código de barras, capacidade, sequência, picking face e bloqueio temporário.

## 7. Read model por localização

`warehouse_location_inventory` deriva do ledger oficial e controla físico, reservado, disponível e versão. Restrições impedem saldo ou disponível negativos.

## 8. Recebimento

Recebimentos WMS apontam para `purchase_receipts`, aceitam ASN opcional, doca, conferência normal ou cega (desligada por padrão), parcialidade e idempotência.

## 9. Divergências

Quantidade esperada, recebida e rejeitada são separadas; divergências geram exceções e permanecem vinculadas ao documento oficial de compra.

## 10. Lotes e qualidade

Linhas usam `inventory_lots`; quarentena, bloqueio, recall, vencimento e descarte impedem picking e movimentação normal. Regras sanitárias e térmicas continuam configuráveis na Fase 47.

## 11. Putaway

O motor classifica endereços por compatibilidade, capacidade, picking face, distância e sequência. A sugestão nunca movimenta estoque automaticamente; override manual exige motivo.

## 12. Tarefas

Uma fila única cobre putaway, reposição interna, picking, packing, staging, expedição, contagem, recontagem, movimentação e cross-dock, com prioridade, vencimento, responsável e idempotência.

## 13. Reposição interna

O cálculo transfere da reserva para o picking face quando o mínimo é atingido, respeitando máximo, embalagem e saldo disponível. O resultado é uma tarefa, não uma baixa direta.

## 14. Picking

Picking simples usa FEFO, exclui lotes indisponíveis e reserva atomicamente com versão. Short pick exige motivo e abre exceção/replanejamento.

## 15. Batch, wave e zone

`PickWavePlanner` produz agrupamento determinístico por lote, onda, rota ou zona, com prioridade e sequência estáveis.

## 16. Unidades logísticas

Totes, caixas, pallets, sacolas e contêineres possuem código único, localização atual, fulfillment e estados aberto, lacrado, staging e entregue ao transporte.

## 17. Packing

Packing compara itens e quantidades esperados com os escaneados. Qualquer divergência bloqueia liberação do shipment.

## 18. Staging

Shipments exigem endereço de staging e volume conferido antes do handoff.

## 19. Expedição

A expedição referencia `inventory_transfers`; o WMS apenas prepara, confere e registra handoff. O transporte posterior continua fora do escopo.

## 20. Cross-dock

Cross-dock só é sugerido com destino confirmado e qualidade liberada. A quantidade é limitada ao menor valor entre recebido e demanda.

## 21. Contagens

Há contagem por endereço, modo cego, bloqueio com expiração, recontagem e ligação com `inventory_counts`.

## 22. Ajustes

Diferenças não editam saldo diretamente. Após recontagem, motivo e aprovação, geram movimentação oficial positiva ou negativa.

## 23. Slotting

Sugestões usam velocidade, frequência, distância, picking face, capacidade e compatibilidade. São explicáveis, revisáveis e nunca executadas automaticamente.

## 24. Mobile e scanner

O fluxo resolve códigos de localização, lote e unidade logística. Scanner, QR e balança vêm do Hardware Hub; digitação manual é sempre permitida e validada.

## 25. Offline e sincronização

Comandos usam UUID, dispositivo, tenant e horário do cliente. O servidor deduplica, revalida saldo e estado e rejeita conflito em vez de forçar a operação.

## 26. Hardware Hub

Scanners, leitores QR, balanças e impressoras de etiqueta cadastrados na Fase 45 aparecem no WMS. Nenhum driver ou credencial foi duplicado.

## 27. Compras, Transferências e Supply Chain

Compras alimentam receiving; transferências alimentam fulfillment e shipment; Supply Chain recomenda demanda, mas o WMS apenas executa tarefas físicas autorizadas.

## 28. Reporting e Workspace

Datasets e métricas cobrem recebimento, putaway, picking, packing, expedição, contagem, ocupação, divergência e tempo de ciclo. A navegação está disponível no dashboard.

## 29. Copiloto

O Copiloto pode consultar ocupação, backlog, exceções, acuracidade, throughput e slotting. Respostas informam fonte, data e confiança e nunca executam uma operação.

## 30. Data Platform

As métricas certificadas apontam para tabelas WMS e preservam o ledger como fonte de verdade. Custos continuam protegidos por permissão específica.

## 31. Segurança

Foram definidos 16 escopos WMS. As tabelas usam RLS, remoção de privilégios padrão, acesso de serviço e leituras autenticadas restritas à organização autorizada.

## 32. Auditoria

Mudanças relevantes registram ator, ação, entidade, motivo, antes/depois e correlação. Movimentos internos carregam origem, destino, tarefa e comando idempotente no ledger.

## 33. Observabilidade

O health service detecta projeção atrasada, comandos falhos, localização negativa e movimento órfão. Exceções ficam visíveis na torre de controle.

## 34. Testes

Os 30 cenários obrigatórios cobrem hierarquia, unicidade, compatibilidade, recebimento, lotes, putaway, reposição, FEFO, short pick, ondas, volumes, packing, staging, expedição, cross-dock, contagens, ajustes, offline, concorrência, permissões, auditoria e isolamento.

## 35. Limitações conhecidas

Aplicação da migration, carga inicial da projeção por localização e publicação dependem de autorização explícita. Integrações físicas reais dependem de dispositivos configurados no Hardware Hub. O worker offline mantém comandos conflitantes para tratamento humano.

## 36. Recomendações para a Fase 73

Antes da próxima fase, recomenda-se executar piloto em um depósito, reconciliar saldo global com a soma dos endereços, cadastrar códigos físicos, validar perfis de acesso e medir latência de scanner. Nenhum trabalho da Fase 73 foi iniciado.
