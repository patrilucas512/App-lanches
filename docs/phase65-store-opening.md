# Fase 65 — Expansão, implantação e abertura de novas unidades

## 1. Diagnóstico inicial

O MasterApp já possuía hierarquia de rede, projetos, tarefas, aprovações, documentos, contratos, compras, ativos, hardware, pessoas, treinamentos, catálogo, estoque, finanças e metas. A Fase 65 foi construída como uma camada de coordenação sobre esses módulos, sem criar sistemas paralelos.

## 2. Arquitetura Store Opening

O domínio `store_opening` separa pipeline, viabilidade, projeto, template, marcos, prontidão, testes, go-live, ramp-up, auditoria e analytics. A API autenticada opera com escopo da organização e o worker executa jobs idempotentes.

## 3. Arquivos criados

- `lib/store_opening/core.ts`
- `app/api/store-opening/route.ts`
- `app/api/store-opening/worker/route.ts`
- `app/painel/novas-unidades/page.tsx`
- `components/store-opening-center.tsx`
- `app/painel/novas-unidades/store-opening.css`
- `supabase/migrations/20261024233027_phase65_store_opening_management.sql`
- `tests/store-opening-phase65.test.mjs`
- este relatório.

## 4. Arquivos modificados

Foram integrados o menu e os entitlements em `components/dashboard-shell.tsx`, o Copiloto em `lib/intelligence/copilot-tools.ts`, o catálogo de automações em `lib/automation/core.ts` e o comando de teste em `package.json`.

## 5. Migrations

A migration adiciona estados `pre_opening` e `test` à unidade, tabelas operacionais, fatos e dimensões, índices, RLS, privilégios explícitos, RPCs transacionais, flags de plano, widgets, datasets, métricas, eventos, ações e comandos globais. Ela deve ser validada em homologação antes da produção.

## 6. Expansion pipeline

`expansion_opportunities` registra organização, marca, região, local, modelo de propriedade, owner, investimento e data estimada. O pipeline preserva os estágios de ideia, screening, viabilidade, aprovação, rejeição e conversão.

## 7. Feasibility

`store_feasibility_assessments` mantém versões imutáveis por oportunidade, premissas, fontes, CAPEX, OPEX, receita, break-even e riscos. Toda projeção recebe o rótulo “Estimativa — não é garantia”; aprovação usa o ActionEngine existente.

## 8. Opening projects

Uma oportunidade aprovada pode gerar um `internal_project` da Fase 32 e um `store_opening_project` vinculado. Owner, fase, prazo, marca, região e futura unidade são explícitos.

## 9. Templates

Templates continuam na entidade existente e passam a ter versões, status, tipo de negócio, propriedade e formato de loja. Requisitos são configuráveis por domínio; legislação e licenças não são codificadas de forma fixa.

## 10. Milestones

Marcos reutilizam `internal_tasks` e suas dependências. Uma dependência crítica aberta bloqueia a conclusão, salvo override formal com motivo e aprovação.

## 11. Readiness engine

`StoreReadinessService` calcula score ponderado e transparente em 15 domínios: documentos, finanças, construção, ativos, hardware, internet, fornecedores, estoque, pessoas, treinamento, catálogo, pagamentos, fiscal, operações e testes. A composição e os motivos são preservados em snapshots.

## 12. Blockers

Bloqueios possuem origem, severidade, owner, prazo e status. Bloqueios críticos abertos impedem o go-live. Override exige permissão, motivo, confirmação e aprovação auditável.

## 13. Documents/contracts integration

`opening_document_requirements` referencia diretamente `compliance_documents` e `contracts`, sem duplicar arquivos ou contratos. Requisitos e validade são definidos pelo template.

## 14. Procurement/assets

Plano de estoque inicial referencia itens e pedidos de compra existentes. Requisitos de ativos guardam quantidades e IDs do Asset Management, mantendo recebimento e prontidão separados.

## 15. Hardware/connectivity

`store_hardware_profiles` coordena perfil, pareamento, testes e conectividade, mas os equipamentos continuam pertencendo ao Hardware Hub da Fase 45.

## 16. Workforce/training

O plano de staffing acompanha necessidade, contratação, onboarding, treinamento e escala de abertura. A conclusão de treinamento continua no Learning Center; a Fase 65 apenas lê a prontidão.

## 17. Catalog/inventory

O catálogo usa assignments, preços, canais, disponibilidade, imagens e publicação da Fase 62. O estoque inicial referencia os itens oficiais e não cria produtos duplicados.

## 18. Payments/fiscal

Pagamentos e fiscal são domínios obrigatórios de prontidão e de teste. O módulo coordena evidências; não cria gateway, documento fiscal ou regra tributária paralelos.

## 19. Test mode

Unidades de pré-abertura ficam inativas, marcadas como teste e fora dos relatórios de produção. Registros de teste são identificados, não cobram dinheiro real e não emitem fiscal real.

## 20. UAT/dry run

Planos e casos cobrem balcão, QR, garçom, PIX, cartão, KDS, impressão, cancelamento, delivery e fechamento de mesa. Evidência é opcional e pode ser nota, arquivo ou referência da transação. Casos críticos não aprovados bloqueiam a ativação.

## 21. GoLiveService

O serviço exige aprovação, prontidão, testes e ausência de blockers críticos. A RPC trava projeto e execução, registra etapas idempotentes e só então ativa a unidade, canais e reporting numa transação.

## 22. Rollback

Rollback devolve a unidade para `test`, desliga reporting de produção, marca o projeto em risco e compensa apenas etapas reversíveis. Pedidos reais nunca são apagados.

## 23. Opening day command center

A aba Go-Live reúne execução, estado, etapa que falhou e correlação. Falha cria blocker crítico e candidato a incidente; o fluxo reutiliza alertas, tarefas, notificações e incidentes oficiais.

## 24. Ramp-up

Planos 30/60/90 são configuráveis e vinculados às metas existentes. Reviews guardam realizado, meta, variação, tendência, problemas e ações; não modificam metas automaticamente.

## 25. Executive/Workspace integration

Foram registrados widgets de projetos, blockers, próximos go-lives, orçamento e ramp-up, respeitando escopo e permissão financeira.

## 26. Reporting

Datasets e métricas certificadas cobrem pipeline, prazo, tempo de abertura, blockers, orçamento, testes e ramp-up. Fatos sensíveis têm marcação e escopo.

## 27. Copilot

Sete tools de leitura foram adicionadas. As respostas separam fatos, hipóteses, blockers, riscos e próximos passos. O Copiloto não aprova viabilidade, override nem go-live.

## 28. Data Platform

Foram adicionadas facts para oportunidades, projetos, marcos, blockers, orçamento, testes e ramp-up, além de dimensões de estágio, status, blocker, formato e propriedade.

## 29. Security/RBAC

Existem 14 permissões específicas. O backend valida tenant, vínculo ativo e permissão. Tabelas sensíveis têm RLS, `anon` e `authenticated` revogados e uso operacional mediado pela API de serviço.

## 30. Audit

Criação, aprovação, override, prontidão, teste, ativação, rollback e ramp-up registram ator, entidade, motivo, antes/depois e correlação quando aplicável.

## 31. Observability

Jobs têm tentativas, backoff, lock, erro e dead letter. Execuções de go-live expõem o passo exato da falha e não escondem ativação parcial.

## 32. Tests

Há 30 testes obrigatórios, cobrindo oportunidade, versionamento, aprovação, integrações de prontidão, testes, blockers, modo de teste, go-live, falha parcial, rollback, automação, ramp-up, permissões e isolamento por tenant. Executar com `pnpm test:phase65`.

## 33. Limitations

A migration ainda não foi aplicada no Supabase de produção e o site ainda não foi publicado. Integrações externas continuam dependentes das credenciais e módulos oficiais. Dados históricos só aparecem após carga/uso real.

## 34. Recommendations for Phase 66

Antes de definir qualquer Fase 66, executar a migration em homologação, testar uma abertura completa com dados de teste, ensaiar falha/rollback, revisar RBAC e documentos com responsáveis humanos, medir o worker e obter aprovação formal para produção. Nenhum trabalho da Fase 66 foi iniciado.
