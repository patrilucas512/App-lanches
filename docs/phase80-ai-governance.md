# Fase 80 — AI Agent Orchestration e AI Governance

## 1. Diagnóstico inicial

O diagnóstico está documentado em `docs/phase80-initial-diagnosis.md`. O sistema já possuía agentes úteis e control planes canônicos; a implementação adiciona governança transversal, sem substituir os módulos existentes.

## 2. Inventário existente

Foram catalogados dez agentes/copilots: WhatsApp, voz, manager, executivo, suporte, operações, forecast, Data Governance, FinOps e Policy Copilot. O catálogo está em `EXISTING_AGENT_INVENTORY` e aponta para as implementações originais.

## 3. Arquitetura AI Governance

A arquitetura possui control plane (cadastros, versões, políticas de autonomia e memória), runtime guards (autorização, budget, loop, contexto e output), integração com os planos de controle existentes e data plane analítico. A indisponibilidade da governança aciona fallback seguro e não derruba operações centrais.

## 4. Arquivos criados

- `lib/ai_governance/core.ts`, `integrations.ts` e `services.ts`.
- `app/api/ai-governance/route.ts` e `worker/route.ts`.
- `app/superadmin/ia-agentes/page.tsx`.
- `components/ai-governance-center.tsx` e seu CSS module.
- migration `20261028032005_phase80_ai_governance.sql`.
- diagnóstico, relatório e testes da Fase 80.

## 5. Arquivos modificados

`components/superadmin-shell.tsx` recebeu a navegação “IA e Agentes”; `package.json` recebeu `test:phase80`.

## 6. Migration

A migration cria os registros, relações de runtime, avaliações, changesets, incidentes, auditoria, índices, RLS, grants explícitos e facts/dimensions. Ela não cria agentes ativos nem permissões liberadas e não foi aplicada em produção nesta etapa.

## 7. Agent Registry

`ai_agents` representa identidade, domínio, tipo, dono, risco, lifecycle, customer-facing e teto de autonomia. `AgentRegistryService` valida chaves, tipos e níveis e sempre cria em `draft`.

## 8. Agent versions

`ai_agent_versions` liga prompt, modelo, toolset, memória e guardrail em versão imutável. Alterações materiais geram nova versão e changeset; rollout malsucedido preserva a versão aprovada anterior.

## 9. Prompt Registry

`ai_prompt_definitions` armazena tipo, versão, template e schema de variáveis. `PromptRenderService` valida variáveis, rejeita segredos, escapa conteúdo e separa instruções de conteúdo recuperado.

## 10. Model profiles

`ai_model_profiles` registra provider, modelo, capacidades, custo, latência, classificações e regiões. `AIModelRoutingService` seleciona deterministicamente apenas perfis compatíveis e não aceita escolha arbitrária do agente.

## 11. Tool Registry

`ai_tool_definitions`, `ai_toolsets` e `ai_toolset_members` formam catálogo versionado com risco, dono e modo de execução. Raw DB, HTTP arbitrário e ferramentas não registradas não fazem parte do runtime.

## 12. Tool schemas

Input e output usam contratos JSON tipados. O runtime rejeita campos extras, tipos inválidos e parâmetros inventados; output estruturado passa por validação independente.

## 13. Permissions

`ai_agent_tool_permissions` concede tools explicitamente, com escopo, condições e limite por run. O default é deny. Service identities são explícitas e nunca recebem superadmin por padrão.

## 14. Effective authorization

`AIToolAuthorizationService` calcula a interseção de permissões do agente, ator iniciador, tenant, Policy Engine e tool; também verifica feature, budget, schema, autonomia e organização.

## 15. Autonomy levels

São suportados os níveis 0 Answer Only, 1 Recommend, 2 Draft, 3 Controlled Execute e 4 Autonomous Bounded. Não existe nível 5. A autonomia é teto do agente e cada ação pode exigir nível menor, ActionEngine ou aprovação.

## 16. ActionEngine integration

Tools de escrita produzem `ai_action_requests` e `actionIntentFromTool`; o agente não executa a escrita. O ActionEngine revalida, aplica idempotência e registra o resultado.

## 17. Policy Engine integration

A Fase 79 continua sendo o decision point. A governança consome allow, deny, require approval/review e referências de decisão; não implementa uma segunda DSL.

## 18. Human review

`AIHumanReviewService` produz preview com objetos afetados, resultado esperado, efeitos, políticas, custo e rollback. O fluxo usa `internal_approvals`/ActionEngine e não guarda raciocínio privado.

## 19. Agent runs

`ai_agent_runs`, tool calls e action requests guardam estado, versão, ator, tenant, trace, limites, custo e métricas. Status contemplam espera humana, timeout, budget e safety block.

## 20. Budgets e limites

Budget por run/dia, tools, models, runtime, steps, handoffs e filhos são obrigatórios. Ao exceder, o comportamento é stop, modelo compatível mais econômico, aprovação ou resultado parcial — nunca retry ilimitado.

## 21. Context Builder

`AIContextBuilderService` aceita fontes etiquetadas por origem, timestamp, sensibilidade e confiança, minimiza contexto, redige segredos, limita fontes e impede conteúdo não confiável de virar instrução.

## 22. Memory

Memória é estruturada e escopada por user/store/tenant/agent/task/conversation. Session/task/operational exigem TTL; perfil e domínio persistentes exigem aprovação. Senhas, tokens, cartões e transcrição sensível indiscriminada são rejeitados.

## 23. Knowledge Base

O KnowledgeAnswerService da Fase 68 permanece canônico. ACL é aplicada antes da busca, customer-facing usa conteúdo customer-safe, fontes aprovadas são preservadas e não existe vector search irrestrita.

## 24. Prompt-injection defenses

Sistema, developer, pedido do usuário, conteúdo recuperado e tool output são compartimentos distintos. Documentos, websites, emails e tool outputs são dados não confiáveis; padrões de override são marcados e nunca executados.

## 25. Workflows

`ai_workflow_definitions` descreve estados seguros de contexto, retrieval, tool, modelo, validação, draft e human wait. Scripts, SQL, shell e HTTP arbitrário são bloqueados.

## 26. Multi-agent handoffs

Handoffs usam contrato estruturado, contexto mínimo, permissões próprias do alvo, budget compartilhado, limite de profundidade/filhos e detecção de ciclos. Conflitos de especialistas permanecem visíveis.

## 27. Evaluations

Suites cobrem correctness, tools, grounding, safety, policy, latency, cost, completion, CX e red team. Checks determinísticos são primários; LLM judge é complementar e identificado.

## 28. Red-team tests

Casos cobrem injection de prompt/tool/knowledge, fake approval/ID, cross-tenant, escalada, exfiltração, loops, recursão cara, schema inválido e modelo incompatível.

## 29. Rollout e version management

Changesets agrupam componentes compatíveis, passam por avaliação, security tests e aprovação, e são distribuídos pelo Feature Management: internal, pilot, 5%, 20%, 100%, monitor. Rollback reaponta a versão; não a muta.

## 30. FinOps integration

A Fase 78 é a autoridade de custos. Runs e tool calls registram estimativas/usage para atribuição por agente, modelo, tenant e tarefa, custo por sucesso e detecção de anomalias.

## 31. Degraded modes

Perfis incluem handoff humano, FAQ estático, ordering por regras, analytics read-only, proactive off e fallback de modelo aprovado. Sem fallback seguro, a IA para; pedidos, pagamentos, cozinha e atendimento humano continuam.

## 32. Incidents

`ai_governance_incidents` registra candidatos redigidos e liga ao Incident Management existente. Provider outage, runaway cost, cross-tenant, unsafe path e rollout regressivo compõem a timeline.

## 33. Reporting e Workspace

Foram definidos datasets, doze templates de relatório e sete widgets, incluindo saúde, revisões pendentes, custo, falhas, policy blocks, regressões e incidentes.

## 34. Data Platform e Data Governance

Sete facts e seis dimensions com `security_invoker` expõem métricas por tarefa, sem score universal. Contratos de tool/model e lineage são integráveis à Fase 76.

## 35. Segurança, privacidade e RBAC

RLS e função privada aplicam tenant e permissões. Conteúdo sensível é redigido, memória respeita escopo/TTL, provider precisa aceitar classificação/região e agentes internos não ficam visíveis ao tenant.

## 36. Audit

Eventos materiais — versão, prompt, modelo, tool, autonomia, memória, guardrail, budget, waiver, rollout e ação — são auditados com razão e estado redigido. Tokens e chain-of-thought não são auditados.

## 37. Observability

Telemetria inclui runs, sucesso/falha, tool success/timeout, latência, cost, fallback, policy blocks, human reviews e evaluation pass. `AIGovernanceHealthService` reporta degradação e mantém core operacional.

## 38. Performance

Índices cobrem tenant, agente, status e tempo. Contexto é limitado, telemetria de tokens é agregada, retries são pequenos, chamadas têm backpressure e não há consulta por regra/tool no modelo puro.

## 39. Tests

`tests/ai-governance-phase80.test.mjs` cobre requisitos obrigatórios e adicionais: registry/versioning, prompts, tools, least privilege, tenant isolation, autonomia, ActionEngine, Policy Engine, budgets, loops, modelos, memória, KB, injection, handoffs, avaliações, rollout, FinOps, RBAC, audit, fallback e regressões arquiteturais.

## 40. Technical debt

Ainda é necessário adaptar cada orquestrador legado ao registry em rollout controlado, conectar telemetria real de providers ao FinOps e enriquecer o catálogo de tools domínio a domínio. Isso não deve ser feito por migração em massa.

## 41. Limitações

Esta entrega fornece schema, serviços determinísticos, API administrativa, worker de manutenção e UI. Ela não ativa automaticamente agentes, não aplica migration em produção, não publica o site e não introduz provider/model secrets. As integrações de runtime entram por agente após avaliação.

## 42. Recomendações para uma futura fase

Após estabilização, recomenda-se onboarding progressivo dos agentes existentes, golden datasets por domínio, testes de provider em ambiente isolado, dashboards SLO por tarefa e exercícios red-team recorrentes. Nenhuma fase seguinte foi iniciada automaticamente.
