# Fase 71 — Supply Chain Planning

## 1. Diagnóstico inicial

O estoque oficial já era controlado por `inventory_items` e `inventory_movements`; lotes e FEFO por `inventory_lots`; compras por `purchase_orders`; transferências e produção pela Fase 70; forecast pela Fase 35. A Fase 71 foi implementada como camada de planejamento e recomendação, sem criar ledger, saldo, pedido de compra, transferência, produção ou forecast paralelo.

## 2. Arquitetura Supply Chain Planning

A arquitetura separa OLTP oficial, snapshots analíticos, motor determinístico, fila particionada, recomendações explicáveis e ponte de execução. Snapshots nunca são fonte transacional. Toda execução real permanece nos serviços de domínio oficiais e depende de confirmação humana.

## 3. Arquivos criados

- `lib/supply-chain-planning/core.ts`
- `app/api/supply-chain-planning/route.ts`
- `app/api/supply-chain-planning/worker/route.ts`
- `components/supply-chain-center.tsx`
- `app/painel/supply-chain/page.tsx`
- `app/painel/supply-chain/supply-chain.css`
- `supabase/migrations/20261025224723_phase71_supply_chain_planning.sql`
- `tests/supply-chain-planning-phase71.test.mjs`
- este relatório

## 4. Arquivos modificados

Foram ampliados `components/dashboard-shell.tsx`, `lib/automation/core.ts`, `lib/intelligence/copilot-tools.ts`, `lib/reporting/core.ts` e `package.json`.

## 5. Migrations

A migration adiciona flags de plano, nós, links, perfis de transporte/lead time, políticas, calendários, execuções, jobs, snapshots, recomendações, cenários, riscos, níveis de serviço, substituições, fatos/dimensões e auditoria. RLS, revogação de privilégios públicos e acesso de serviço foram definidos. A migration está somente no repositório e não foi aplicada em produção.

## 6. Supply nodes

Fornecedores, centros de distribuição, cozinhas centrais, armazéns, lojas e nós virtuais são referências às entidades existentes, com região, entidade legal, fuso e metadados.

## 7. Supply links

As rotas autorizadas têm origem, destino, escopo de item, prioridade, lead time, transporte, política intercompany e vigência. Sem link válido, uma fonte não deve ser sugerida.

## 8. Network inventory

O serviço calcula físico, reservado, comprometido, disponível, trânsito, quarentena, vencimento, projetado e cobertura. A fonte declarada é `inventory_movements`; `inventory_items.balance` é somente a materialização oficial atual.

## 9. Projected inventory

Os buckets mantêm separados eventos confirmados, planejados e previstos. Cada linha registra confiança e exposição a falta, sem apresentar forecast como compromisso.

## 10. Coverage

Cobertura em horas e dias escolhe forecast apenas quando sua confiança é suficiente; caso contrário usa consumo recente ou baseline configurado, sempre expondo a base escolhida.

## 11. Safety stock

Há métodos fixo, dias de cobertura, variabilidade de demanda, variabilidade de lead time e manual. Recomendações dinâmicas não alteram políticas automaticamente.

## 12. Reorder point

O ponto de reposição é calculado por demanda no lead time mais safety stock menos inbound confirmado, com fórmula e entradas retornadas para auditoria.

## 13. Replenishment

O motor reaproveita `ReplenishmentService` e `roundOrderQuantity` da Fase 39, considera saldo, reservas, compromissos, inbound, forecast, lead time, safety stock, MOQ, múltiplos e máximo.

## 14. Redistribuição

O rebalanceamento faz transfer-before-buy e respeita piso da origem, necessidade/capacidade do destino, link, entidade legal, custo, distância, transporte e validade. O resultado é somente sugestão.

## 15. Expiry/excess

Validade compara vida útil restante, consumo previsto e buffer de chegada. Excesso mede quantidade acima do alvo e capital estimado; lote bloqueado, em quarentena, recalled ou vencido não é fonte elegível.

## 16. Stockout risk

Ruptura projetada é diferenciada de ruptura já ocorrida. O risco explica esgotamento antes do inbound, atraso, pico de demanda, déficit de produção e atraso de transferência.

## 17. Lead time

O serviço usa mediana histórica com remoção robusta de outliers e fallback para configuração ou provedor. Fonte, amostra, variabilidade e confiança acompanham o valor.

## 18. Source selection

Fontes são ranqueadas por disponibilidade, prazo, custo, validade, nível de serviço e prioridade. Qualidade, transporte e compatibilidade legal são filtros obrigatórios.

## 19. Allocation

São suportadas alocações proporcional, nível mínimo, loja prioritária, prioridade contratual, manual e ponderada por demanda. Falta não é escondida e fica explicitamente registrada.

## 20. Service levels

O módulo calcula fill rate, OTIF, shortage rate, tempo de ciclo, duração e taxa de ruptura com definição semântica explícita.

## 21. Multi-echelon demand

A demanda das lojas é propagada por links para centros e cozinhas, com safety stock por estágio e detecção de ciclos na malha.

## 22. Planning runs

Execuções guardam horizonte, cenário, versão do snapshot, fontes e estratégia de partição. Jobs são agrupados por região, categoria e criticidade, com prioridade para itens críticos e idempotência.

## 23. Scenario simulation

Cenários de demanda alta e atraso de fornecedor retornam impacto, premissas, nós afetados e `dryRun=true`; não gravam saldo nem geram ação operacional.

## 24. Procurement integration

Recomendações de compra reutilizam regras da Fase 39. Após revisão e revalidação, a ponte aponta para `draft_po`; envio e aprovação continuam no fluxo oficial de Procurement.

## 25. Central Production integration

Recomendações de produção apontam para `create_order` da Fase 70 e exigem os dados obrigatórios do domínio. Materiais, capacidade, receita, lote e qualidade continuam validados pela Produção Central.

## 26. Transfers integration

Recomendações de transferência apontam para `create_transfer` da Fase 70. A escolha de lotes, FEFO, aprovação, despacho, recebimento e divergências permanecem no fluxo oficial.

## 27. Finance/Geo integration

Custos são protegidos por permissão específica; distância, região, transporte e entidade legal compõem seleção e redistribuição. A Fase 71 não lança contas ou contabilidade.

## 28. Reporting/Workspace

Foram registrados cinco datasets, sete métricas, sete relatórios e seis widgets para inventário, cobertura, ruptura, excesso, recomendações, serviço e lead time.

## 29. Copilot

Nove ferramentas somente leitura foram adicionadas. Respostas separam fatos, projeções, riscos, fontes, alternativas e confiança e afirmam que não há execução automática.

## 30. Data Platform

Há fatos para inventory snapshots, projected inventory, recommendations, service levels, risks, actions e lead time, além de dimensões de nós, links e taxonomias. São read models reconstruíveis.

## 31. Security/RBAC

Dez permissões cobrem visualização, rede, custos, políticas, safety stock, revisão, aprovação, simulação, fontes e override. API valida identidade, vínculo, organização, escopo e permissão; RLS mantém isolamento por tenant.

## 32. Audit

Criação de fonte/link, alteração de política, planejamento, revisão, aprovação e preparação de execução registram ator, motivo, antes/depois e correlação. Cálculos puros não poluem o audit trail.

## 33. Observability

Runs e jobs expõem fila, lease, tentativas, erro, dead letter, conclusão e versão de entrada. O worker informa explicitamente zero compras, transferências, produções ou movimentos automáticos.

## 34. Tests

Os 30 testes obrigatórios da Fase 71 passaram. O build de produção também passou com configuração pública de validação. A suíte ampla executou 2.213 testes: 2.212 passaram e um teste legado da Fase 26 falhou porque `/api/health` não contém o texto `liveness`, sem relação com a Fase 71. O typecheck geral segue bloqueado apenas por débitos anteriores em módulos legados; não reportou erro da Fase 71.

## 35. Limitations

A migration ainda precisa ser validada/aplicada no Supabase de produção mediante autorização explícita. A ponte de execução prepara e revalida o payload, mas dados obrigatórios ausentes — fornecedor aceito, receita/unidade produtiva ou lotes — devem ser completados no módulo oficial antes da criação do rascunho. O worker inicial gera riscos determinísticos; materialização completa de todos os fatos depende da migration e de agendamento operacional.

## 36. Recommendations for Phase 72

Não iniciar automaticamente. Quando autorizada, a próxima fase deve primeiro observar dados reais da Fase 71, calibrar thresholds por categoria e região, validar qualidade dos históricos de lead time/forecast e só então ampliar otimização. Não é recomendável introduzir execução autônoma de compras, produção ou transferências.
