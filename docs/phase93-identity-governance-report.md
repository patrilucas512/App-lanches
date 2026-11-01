# Fase 93 — Identity Governance & Privileged Access Management

Implementada e aplicada só no `masterapp-dev`. **Nada foi aplicado em produção.**

## 1. Diagnóstico inicial
Está em `phase93-initial-diagnosis.md`. O achado que mais pesou: o briefing pressupõe um "serviço oficial de Auth/RBAC", e ele não existe. Há três camadas de permissão sem resolvedor central e cerca de 60 tabelas `*_permissions`. O ActionEngine é uma lista fechada, e `decide()` da Fase 79 não era chamado por nenhuma rota.

## 2. Arquitetura
Plano de controle assíncrono: a autorização em tempo de requisição continua no Auth/RBAC e nenhuma rota de login, pedido ou pagamento importa o módulo. O domínio está em `lib/identity-governance/`, com regras puras em `core.ts` e `rules.ts` e fluxos com o cliente admin injetado. Toda mudança real de acesso passa por `AccessProvisioningService`, que chama as RPCs `rbac_*` e relê a fonte antes de declarar sucesso.

## 3. Arquivos criados e modificados
- **Criados:** `lib/identity-governance/*`, `app/api/identity-governance/route.ts`, `app/api/identity-governance/worker/route.ts`, `app/painel/seguranca/acessos/page.tsx`, `components/identity-governance-center.tsx`, `scripts/dev/idgov-smoke.mjs` e o README dele, os dois arquivos de teste da fase, este relatório e o diagnóstico.
- **Modificados:** `app/api/security-operations/route.ts`, `components/security-operations-center.tsx`, `lib/security-operations/integrations.ts`, `components/dashboard-shell.tsx`, `components/executive-command-center.tsx`, `lib/workspace/core.ts`, `lib/reporting/core.ts`, `lib/data-platform/core.ts`, `package.json`, `.env.example`, `docs/FASES.md`.

## 4. Migrations
| Arquivo | O que cria |
|---|---|
| `20261101120000_phase93a_identity_catalog_foundation` | Identidades, catálogo, grants, achados, jobs, auditoria, fachada `rbac_*`, flags e abertura do ledger do ActionEngine |
| `20261101121000_phase93b_access_requests_lifecycle` | Pedidos, configurações, birthright, eventos de ciclo de vida, RPCs de sessão e de funcionário, trigger de desligamento |
| `20261101122000_phase93c_temporary_privileged_access` | `jit_sessions`, `privileged_sessions` |
| `20261101123000_phase93d_break_glass` | `break_glass_events` |
| `20261101124000_phase93e_segregation_of_duties` | Regras, conflitos e mitigações de SoD |
| `20261101125000_phase93f_access_reviews` | Campanhas, itens, certificações e bloqueio de autorrevisão |
| `20261101126000_phase93g_reconciliation_third_party` | Reconciliação, drift, perfis de terceiros, inventário de credenciais, extensão de `impersonation_sessions`, trigger de fim de relação |
| `20261101127000_phase93h_analytics_registry` | Fatos, flags, widgets, busca, registros de automação e notificação, bloqueio de `IDGOV_*` no Copiloto |

## 5. Identidade canônica
`governed_identities` guarda referências (`identity_ref`, `user_id`), sem nome, e-mail ou telefone. A sincronização lê membros, funcionários, `api_clients` e `ai_agents`. Identidade não humana sem dono e externa sem sponsor viram `orphan`.

## 6. Catálogo e grants
`AccessCatalogService` compõe 81 itens a partir de papéis reais de loja e organização, permissões de `soc`, `vendor` e `idgov`, escopos de API e módulos sensíveis. Só papéis (exceto `owner`) e permissões desses três módulos são provisionáveis; os demais são `read_only` e falham com `NO_OFFICIAL_PATH`. Críticos ficam em rascunho até ter dono de negócio e técnico. Nenhum item nasce pedível.

## 7. Baseline
`importBaseline` importa o acesso efetivo como `migration_baseline`, marcado para revisão, sem revogar nada, e pode ser reexecutado.

## 8. Pedidos, aprovações e provisionamento
Pedido → política (F79) → SoD → aprovação (`internal_approvals`, F32) → prévia e confirmação quando crítico → fachada RBAC → verificação → auditoria e evento no SOC. Autoaprovação é bloqueada, e crítico exige dois aprovadores diferentes. Só contam passos de quem pode decidir aquele pedido. Sem política ou com erro, valem as regras do catálogo e privilegiado continua exigindo aprovação.

## 9. Ciclo de vida
- **Joiner:** regras `birthright_rules` configuráveis.
- **Mover:** mostra a prévia e, ao aplicar, revoga o que a nova função não inclui.
- **Leaver:** trigger em `custom_staff_members` ou ação manual com prévia. Revoga grants e acesso não governado, encerra registros de funcionário e sessões, bloqueia a conta só se nenhuma outra organização a usa e confirma cada passo.

## 10. Temporário e JIT
Acesso privilegiado novo exige duração. A varredura expira o vencido, restaura o papel anterior, avisa antes do fim e recupera o atraso depois de uma queda. JIT segue `requested → approved → active → expired/revoked`; pré-aprovação por configuração nunca vale para crítico, e só o beneficiário ativa.

## 11. Privilegiados
Marcação explícita no catálogo, MFA checado pelo `aal` da sessão, sessão registrada com início, fim, escopo e ações-chave ligadas ao grant, sem gravação de tela.

## 12. Break-glass
Motivo, janela limitada, incidente quando configurado, prévia, aviso aos administradores e revisão obrigatória por outra pessoa, garantida também no banco. Achado da revisão vira finding; uso fora do escopo vira sinal ao SOC, sem declarar abuso.

## 13. SoD
Regras citam entitlements, nunca cargos. Checagem preventiva no pedido e detectiva sob demanda ou pelo worker. Mitigação tem dono, motivo e validade, e ao vencer reabre o conflito. Aceite crítico exige dois aprovadores. Quatro modelos entram como rascunho.

## 14. Revisões e certificações
Campanhas com contexto de decisão sem dados pessoais. "Revogar" executa a revogação e confirma. Certificar exige todas as decisões e nenhuma revogação falha; gera resumo com hash, imutável. Em lote, "manter" é recusado para itens críticos. Cada campanha também registra uma linha em `access_review_runs`.

## 15. Terceiros, suporte e service accounts
- **Terceiros:** perfil com sponsor e validade. O fim da relação abre campanha e achado, sem revogar sozinho.
- **Suporte:** `impersonation_sessions` foi ampliada com caso, modo e validade. Exige JIT ativo, começa em leitura, e escrita exige aprovação de outra pessoa.
- **Máquina:** inventário sem segredo. Revogar funciona só para `api_clients`.

## 16. Reconciliação e drift
Compara acesso efetivo e grants: `matched`, `ungoverned_access`, `missing_access`, `expired_but_active`. Gera achados e não corrige nada.

## 17. Integração com a Fase 94 (o que mudou no SOC)
- Eventos canônicos em `security_events`, com a deduplicação e a redação da 94. Falha ao emitir não interrompe o fluxo de acesso.
- `/api/security-operations` devolve `identityContext`, e a aba Identidades mostra esses números.
- O adaptador deixou de ser só um nome (`Phase93IdentityGovernanceAdapter`).
- A fila continua em `security_response_actions`: o SOC pede, a Fase 93 executa `revoke_session`, `revoke_temporary_access`, `disable_identity`, `revoke_api_token` e `request_access_review`, e devolve a verificação.
- Nenhuma tabela da 94 foi duplicada. Os 93 testes da 94 continuam passando sem alteração.
- **Consolidação proposta, não feita:** a resolução de permissão do SOC deveria seguir o padrão explícito da Fase 93.

## 18. Demais integrações
Policy Engine, aprovações, ActionEngine (ledger compartilhado; `confirm`, `cancel` e `undo` do Copiloto recusam `IDGOV_*`), Change (`production_access_requires_change`), Incidentes (vínculo no break-glass e no JIT), Notifications, Automation (eventos registrados) e Vendor. Risk, Continuity, Data Governance, Architecture e Service Catalog **não têm ligação funcional** (ver item 26).

## 19. UI
`/painel/seguranca/acessos`, com as 15 abas, cards, prévia com confirmação e fila do revisor. Menu, comandos, busca de navegação e link no Executive foram incluídos.

## 20. Reporting e analytics
Datasets, 10 modelos, 7 views de fato, 11 métricas com denominadores explícitos, 6 widgets registrados. As dimensões são só catálogo.

## 21. Copilot
`identityCopilot` tem as 10 ferramentas somente em lista, classifica fato, regra e sugestão e não tem ferramenta que conceda, revogue, aprove ou feche. A rota entrega dados reais só para explicar origem de acesso.

## 22. RBAC, audit e privacidade
13 permissões `idgov:*`, explícitas; dono e admin as recebem, e membro comum não recebe nenhuma. Elas nunca incluem o acesso-alvo. RLS ligada e acesso direto revogado em todas as tabelas. Auditoria dupla (`identity_governance_audit_events`, imutável, e `security_audit_logs`).

## 23. Testes executados e resultado
| Verificação | Resultado |
|---|---|
| `node --test tests/*.test.mjs` | 3.686 de 3.686 (antes da fase: 3.551); depois dos ajustes de lint, os testes das Fases 93 e 94 foram repetidos: 228 de 228 |
| Testes da fase | 135, incluindo os 26 obrigatórios e os 6 adicionais |
| `scripts/dev/idgov-smoke.mjs` no banco real do dev | 38 de 38, repetido sobre o código final |
| `typecheck:ci` | Sem erros novos (41 diagnósticos antigos aceitos) |
| ESLint nos arquivos da fase | Limpo |
| `lint` do repositório inteiro | Não executado |
| Migration safety e secret scan | Passaram |
| Build e tela no preview com o usuário do seed | 15 abas, API 200, prévia e token validados, 403 em loja de outro tenant, sem rolagem horizontal em 375 px |

Os testes de fluxo usam um banco em memória. O smoke é o que exercita SQL, triggers e RLS reais.

## 24. O que NÃO foi verificado
- `migration-dry-run` do CI: só roda no PR, e as migrations foram aplicadas no dev em blocos.
- Worker por HTTP e o agendamento dele: nenhum cron foi criado.
- Notificação entregue de fato e as views de fato com dados reais.
- MFA com sessão `aal2` real (só testado com valor simulado).
- Acesso a outro tenant no banco real: o dev tem uma organização só; a recusa foi testada em memória e com loja inexistente.
- Impersonação pela tela: não há tela que a realize.
- Nada em produção.

## 25. O que precisa da sua aprovação
1. Feito: Fases 83, 94 e 93 aplicadas em produção. As versões de produção diferem dos arquivos, então não use `supabase db push` lá.
2. Feito: correções de autorização concluídas (PRs #9 e #10).
3. Definir `IDENTITY_GOVERNANCE_WORKER_SECRET` e agendar `POST /api/identity-governance/worker`. Sem isso, nada expira sozinho.
4. Decidir como os planos ligam as flags; todas nascem desligadas.

## 26. Dívida técnica e limitações
- **Sem agendamento, a expiração automática não roda em ambiente nenhum.**
- A varredura restaura o papel de loja, mas JWTs emitidos valem até expirar; não há `auth.admin.signOut` no repositório.
- `private.has_role` passou a exigir vínculo ativo; a fachada continua apagando a linha ao revogar.
- A maioria dos módulos não tem caminho oficial de concessão.
- Formulários de dono do entitlement, regra e tratamento de SoD, perfil de terceiro, Identity 360 e prévia em lote entregues depois da fase; ainda sem publicar no app.
- A busca global cobre só navegação e comandos; não indexa identidade, grant, pedido, campanha nem achado.
- Sem ligação funcional: candidato de risco (F87), DR Access Test (F86), classificação de dados (F76), mapa de serviços (F85/F90). `SensitiveActionService` e `IDGOV_PLAN_ENTITLEMENTS` existem, mas nenhuma rota os usa.
- Widgets estão só registrados; dados dinâmicos no Workspace e no Executive não foram ligados, exceto o link e a lista `executive` da API.
- Automation: eventos registrados, mas o módulo não os publica no Automation Center.
- Dormência usa `security_sessions`, que só cobre sessões que enviaram ping; sem dado de uso, não aponta dormência.
- Os commits separam os arquivos por etapa, mas o código só compila no último, porque os fluxos dependem uns dos outros.

## 27. Recomendações para a Fase 95
Antes dela: publicar o app, agendar o worker e fechar os itens acima. A Fase 95 não foi iniciada.
