# Fase 50 — Central de Automação

## 1. Diagnóstico inicial

O projeto já possuía eventos de integração (`integration_events`), webhooks registrados, ActionEngine controlado (`copilot_action_requests`), aprovações, tarefas e notificações internas, jobs persistentes em vários domínios, auditoria e governança de rede. Também existiam automações hardcoded específicas (restauração temporária do Copilot, entregas de webhook, regras internas e rotinas preventivas). Elas não foram migradas cegamente: continuam como autoridades dos seus domínios. A Fase 50 cria uma camada genérica secundária e não bloqueante por cima desses serviços.

## 2. Event catalog

`automation_event_registry` registra eventos versionados, schema, whitelist de campos, módulo, sensibilidade e depreciação. A versão inicial inclui pedidos, estoque, pagamentos, CRM, CS, suporte, qualidade, manutenção, documentos, vendas, segurança, releases, entrega, cozinha e reservas. Texto livre não é aceito.

## 3. Action catalog

`automation_action_registry` declara schema de entrada, permissão, risco, idempotência, retry e obrigação de ActionEngine. As ações seguras criam notificações, tarefas, tickets e rascunhos. Ações operacionais de risco alto nunca são aplicadas diretamente; seguem para aprovação/ActionEngine. Webhooks usam somente `integration_id` já registrado.

## 4. Arquivos criados

- `supabase/migrations/20261022214213_phase50_automation_center.sql`
- `lib/automation/core.ts`
- `app/api/automation/route.ts`
- `app/api/automation/worker/route.ts`
- `app/painel/automacao/page.tsx`
- `app/painel/automacao/automation.css`
- `components/automation-center.tsx`
- `tests/automation-phase50.test.mjs`
- `docs/phase50-automation-center.md`

## 5. Arquivos modificados

- `components/dashboard-shell.tsx`: feature flags e navegação “Automação”.

## 6. Migrations

A migration adiciona cinco entitlements e 25 estruturas operacionais com RLS, revogação explícita de `anon`/`authenticated`, índices de fila, execução, schedule, auditoria e escopo. Todas as operações da interface passam pela API autenticada e pelo cliente administrativo no servidor.

## 7. Workflow model

`automation_workflows` guarda identidade, escopo, owner, estado, limites e ponteiros de versão. `automation_workflow_versions` é imutável depois da publicação. `automation_nodes` suporta trigger, condition, action, delay, approval, branch e stop; `automation_edges` forma o DAG. Não existem loops genéricos.

## 8. Builder

A tela `/painel/automacao` oferece Workflows, Builder visual, Templates, Histórico, Catálogos e Analytics. A criação começa em draft/dry-run, com preview “Quando / Se / Então”. A publicação segue Draft → Validate → Simulate → Publish e falha diante de trigger inválido, nó órfão, edge inválida ou ciclo.

## 9. Conditions

Operadores tipados: equals, not_equals, greater_than, less_than, contains, in, not_in, exists, boolean, date_before, date_after e time_window. Grupos AND/OR são avaliados sem `eval` e somente sobre campos permitidos pelo evento/context resolver.

## 10. Branches

Edges possuem `branch_key`. O modelo aceita ramos true/false ou chaves tipadas. A primeira versão do worker percorre o caminho persistido; o editor avançado de múltiplos ramos fica preparado no schema.

## 11. Delays

`automation_delays` persiste `resume_at`, condição opcional de recheck e estado. Nada depende de timer em memória. Schedules preservam timezone e política de atraso (`run_once`, `skip`, `catch_up_limited`).

## 12. Approvals

Nodes de aprovação reutilizam `internal_approvals`. Expiração nunca aprova automaticamente. Ações high/critical e publicação crítica são desviadas para aprovação humana.

## 13. Execution engine

O worker dedicado consome `automation_jobs`, cria execução/steps, redige payloads e registra timeline. A fila tem lease, prioridade, tentativas e idempotency key. O worker é protegido por segredo de servidor e não compartilha recursos síncronos com pedidos.

## 14. Simulation

`automation_simulations` registra teste com evento único ou histórico, conditions, ações que seriam executadas, preview de impacto e custo. Simulação executa zero ações.

## 15. Dry-run

Workflow ativo pode usar `execution_mode=dry_run`: o worker registra `would_execute`, mas não chama ações externas.

## 16. Retries e DLQ

Retry é limitado, exponencial e por node/job. Falhas não retryable ou esgotadas entram em `automation_dead_letters`; nada é descartado. O painel expõe contagem e o backend permite retry apenas do step seguro que falhou.

## 17. Recursion protection

Eventos carregam `origin_workflow_id`, `origin_execution_id` e `chain_depth`. A engine bloqueia autorrecursão e profundidade acima do limite da organização.

## 18. Rate limits

Existem limites por hora/dia, cooldown por entidade e dedup key. Circuit breaker pausa o workflow em storm ou taxa de falha excessiva e marca `paused_by_system`.

## 19. Network governance

Workflows têm escopo organization/brand/region/store e herança locked/inherited/editable/disable_allowed. Rollouts persistem piloto, região e rede, com impact preview e aprovação opcional. Não há ativação silenciosa em massa.

## 20. AI workflow assistant

A IA mapeia linguagem natural somente para eventos/actions registrados e salva em `automation_ai_drafts`. A proposta contém provenance, validação e revisão humana obrigatória. Ela não gera código, não executa e não publica.

## 21. Observability

Executions, steps, jobs, DLQ, health e `automation_metrics_hourly` suportam executions, failures, duration, action failures, queue lag, active/paused workflows e custos reais quando disponíveis. Execution ID é o correlation ID.

## 22. Security/RBAC

Permissões separadas para view/create/edit/publish/pause/manual/history/critical/templates/network. Não há JavaScript, SQL, HTTP direto, secret plaintext ou variável secreta visível. Tenant e store são derivados da sessão; todo dado é filtrado por `organization_id` e RLS é defesa adicional.

## 23. Audit

`automation_audit_events` registra criação, publicação, pausa, retomada, simulação, execução, retry, aprovação e overrides, sempre com payload redigido e motivo.

## 24. Tests

`tests/automation-phase50.test.mjs` contém 32 verificações cobrindo os 30 cenários obrigatórios, webhooks seguros e UI/navegação.

## 25. Limitações

- O canvas inicial é propositalmente simples; edição gráfica de múltiplos ramos e reposition persistente pode evoluir.
- Execução de integrações externas depende de conexões e providers já configurados.
- Custos aparecem como indisponíveis quando o provedor não informa valor; não são estimados sem fonte.
- O worker exige `AUTOMATION_WORKER_SECRET` ou `CRON_SECRET` e um agendador externo/cron para polling.
- O engine não substitui invariantes de pagamento, estoque, segurança, qualidade ou pedidos.

## 26. Recomendações para a Fase 51

Manter a próxima fase isolada. Antes de ampliar a engine, observar fila, taxa de falhas e circuit breakers em produção; depois priorizar editor visual de branches, schedule runner, adapters de ActionEngine por domínio e testes de carga com batches. A Fase 51 não foi iniciada.
