# Fase 79 — Policy Engine / Business Rules / Decision Management

## 1. Objetivo

Centralizar decisões de negócio versionadas, testáveis e explicáveis sem criar um segundo executor, sistema de aprovação, RBAC, Billing ou mecanismo de automação.

## 2. Diagnóstico anterior à implementação

Foi revisado o ActionEngine, Approval Engine, Billing/Entitlements, Feature Management, Network Governance, Automation Center, RBAC e regras locais. O inventário e a estratégia de migração estão em `docs/phase79-initial-diagnosis.md`.

## 3. Arquitetura

O módulo funciona como Policy Decision Point. Domínios entregam facts tipados; o evaluator devolve decisão, explicação e obrigações; o domínio continua como Policy Enforcement Point.

## 4. Limites de responsabilidade

O Policy Engine não executa ações, não aprova solicitações, não concede permissões, não altera cobrança, não ativa features e não substitui invariantes do domínio.

## 5. ActionEngine

Decisões permitidas são revalidadas pelo domínio e encaminhadas ao ActionEngine oficial. Idempotência, preview, confirmação, undo, retry e compensação permanecem nele.

## 6. Approval Engine

`require_approval` produz uma obrigação convertida em `internal_approvals`. Quorum, responsável, SLA, escalonamento e resolução permanecem no Approval Engine.

## 7. Billing e Entitlements

Planos, limites comerciais, uso e cobrança são fatos somente leitura, resolvidos pela fonte oficial. Políticas não reimplementam entitlement.

## 8. Feature Management

Estado de feature, targeting e rollout são fatos somente leitura. Kill switch, override e fallback continuam na Fase 77.

## 9. RBAC

RBAC sempre prevalece. Uma decisão `allow` nunca transforma um usuário sem permissão em usuário autorizado.

## 10. Modelo de política

Políticas têm chave, domínio, tipo, risco, lifecycle, versão ativa, owner e metadados de governança. Tipos suportados incluem eligibility, limit, approval, routing, validation, restriction, escalation, exception e governance.

## 11. Versionamento

Versões são imutáveis por número e hash, com estados draft, review, approved, active, superseded e archived. Publicação gera documento compilado separado.

## 12. AST segura

O interpretador aceita somente fontes, operadores, grupos e efeitos registrados. JavaScript, SQL, `eval`, funções, URLs, webhooks e HTTP são proibidos na definição.

## 13. Tipos de valor

Texto, inteiro, decimal exato, boolean, data, datetime, duração, moeda e set são armazenados em colunas dedicadas. Parâmetros não usam JSON livre.

## 14. Operadores

São suportados igualdade, diferença, membership, comparação, intervalo, existência, contains, prefixo/sufixo e comparações de data.

## 15. Grupos de condição

Grupos `all`, `any` e `none` permitem composição até profundidade 6, 64 grupos e 256 condições por versão.

## 16. Efeitos

Os efeitos são allow, deny, require_approval, warn, route, set_limit, require_review e no_op.

## 17. Obrigações

Uma decisão pode carregar obrigações tipadas de approval, review, route, limit ou warning. O chamador decide como aplicá-las dentro das próprias permissões.

## 18. Facts e provedores

Facts são registrados com chave, fonte, tipo, versão, provider e classificação sensível. Resolução é em lote; não existe consulta ao banco por regra.

## 19. Escopos

São aceitos global, organização, marca, região, loja, plano, canal, papel e tipo de negócio, com precedência explícita.

## 20. Herança e precedência

Os modos inherit, override, stricter_only e blocked preservam a autoridade central. Regras bloqueadas ou mais restritivas não podem ser relaxadas localmente.

## 21. Modos de avaliação

São suportados first_match, all_match, deny_overrides, allow_overrides, priority e scoreless_decision.

## 22. Falhas seguras

Fail modes: fail_closed, fail_open, require_manual_review e default_effect. Alto/crítico não pode usar fail-open.

## 23. Decision tables

Tabelas de decisão armazenam linhas tipadas por faixa ou conjunto e detectam sobreposição antes da publicação.

## 24. Exceções

Overrides, waivers, emergências, pilotos e exceções contratuais exigem motivo, escopo, prazo e aprovação. Expiração é automática e auditada.

## 25. Testes de política

Casos de teste versionam fixtures, decisão esperada e obrigações. Publicação requer execução verde e cobertura mínima de 80%.

## 26. Simulador

O simulador executa a mesma AST sem efeitos colaterais e exibe regras correspondentes, facts ausentes, decisão, obrigações, versão e duração.

## 27. Impact analysis

Antes de publicar são calculados escopos, exceções, volume estimado, domínios afetados, conflitos, dependências e risco operacional.

## 28. Changesets e publicação

Mudanças são agrupadas em changesets. Publicação exige AST válida, testes, impacto revisado, conflitos resolvidos e aprovação humana quando o risco é alto/crítico.

## 29. Rollback

Rollback seleciona versão anterior aprovada, exige motivo/aprovação, troca o documento ativo, invalida cache e exige revalidação dos chamadores.

## 30. Auditoria

Mudanças materiais registram before/after e motivo. Decisões críticas usam log completo; alto volume usa amostragem e agregados.

## 31. Performance

Documentos ativos são pré-compilados e armazenados em cache. O evaluator usa curto-circuito, facts em lote, `evaluateMany` e comparação decimal fixa.

## 32. Offline

Somente políticas marcadas `offline_safe` podem avaliar offline. A decisão é provisória e deve ser revalidada pelo servidor antes de efeito crítico.

## 33. Segurança e RLS

Todas as tabelas usam RLS. A autorização tenant-scoped está em `private.policy_allowed`; tabelas filhas herdam acesso pelo pai. Escritas são server-side e views usam `security_invoker=true`.

## 34. Data Platform e Reporting

Foram expostas `fact_policy_evaluations`, `fact_policy_decisions`, `fact_policy_changes`, `fact_policy_exceptions`, `fact_policy_test_runs`, `fact_policy_health`, `dim_policy` e `dim_policy_version`.

## 35. Copilot

Ferramentas permitidas explicam, simulam, comparam, listam impacto, sugerem testes e criam rascunhos. O Copilot não aprova, publica ou executa.

## 36. Interface

`/superadmin/politicas` contém Políticas, Conjuntos, Regras, Simulador, Exceções, Decisões, Aprovações, Impacto, Analytics e Configurações, com layout responsivo e modo escuro.

## 37. Pilotos

Foram preparados adaptadores para aprovação de desconto, aprovação de reembolso, elegibilidade de fornecedor, aprovação de compra e override local de franquia. Nenhuma regra piloto nasce ativa.

## 38. Testes executados

`pnpm test:phase79`: 72/72 aprovados. ESLint dos arquivos da fase: sem erros ou avisos. `pnpm build`: aprovado com configuração pública de validação. O typecheck global ainda lista débitos anteriores em módulos legados; o filtro confirmou zero erro nos arquivos `policy_engine`/`policy-engine`. Docker local não estava em execução, portanto a migration não foi aplicada localmente nem em produção.

## 39. Entrega e próxima autorização

A implementação está pronta na branch `codex/masterapp-phase79-policy-engine`. A migration `20261027224848_phase79_policy_engine.sql` e a publicação do site aguardam autorização explícita. A Fase 80 não foi iniciada.
