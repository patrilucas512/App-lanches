# Fase 93 — Diagnóstico inicial de Identity Governance

Revisado em 2026-11-01 na branch `claude/fase-93-identity-governance`, a partir de `75006fe`. Fontes: migrations, código e consultas somente leitura ao `masterapp-dev`. Produção não foi consultada.

## 1. Fontes de identidade

Não existe tabela central de funcionário ou administrador. A identidade está espalhada:

| Fonte | O que representa | Observação |
|---|---|---|
| `auth.users` + `profiles` | Conta | `profiles.status` e `profiles.is_superadmin` |
| `establishment_members` | Papel na loja (`member_role`: owner, manager, attendant, catalog_editor, kitchen) | Tem `status`, mas `private.has_role` não o considera |
| `organization_members` + `organization_member_store_access` | Papel na organização (owner, admin, supervisor, analyst, member) | Sem RPC de concessão; só RLS |
| `custom_staff_members`, `waiters`, `kitchen_operators`, `driver_profiles` | Funcionário | `termination_date` existe, mas nenhum código o lê |
| `saas_support_agents` | Suporte da plataforma | Exige superadmin; a linha só restringe |
| `api_clients`, `app_oauth_tokens`, `integration_connections` | Credenciais de máquina | Guardam hash ou referência, não segredo |
| `ai_agents` + `ai_agent_tool_permissions` | Agentes de IA | Dono é texto livre |
| `vendor_profiles`, `vendor_access_references` | Terceiros | Sem sponsor; `vendor_access_references` não tem escritor |

## 2. Modelo de permissões atual

Há três camadas sem resolvedor central: helpers SQL (`private.has_role`, `has_organization_role`, `has_store_access`), cerca de 60 tabelas `*_permissions` com formatos diferentes e checagens locais em 29 rotas.

## 3. Pontos que concedem ou removem acesso

- **Funcionários:** `manage_waiter`, `manage_kitchen_operator`, `create_*_invite`, `claim_*_invite_as_user`, `delete_waiter`, `delete_kitchen_operator`, `deactivate_driver_staff_member`, `archive_cashier_staff_member`. Todas usam `auth.uid()`, então não servem para chamadas de serviço.
- **Membros:** `create_establishment`, `create_organization_store`, escrita direta permitida por RLS e `app/api/store-opening/route.ts`.
- **Módulos:** `set_whatsapp_member_permissions`, `set_ai_member_permissions`, `set_manager_copilot_permissions`, `set_support_queue_member`. Também usam `auth.uid()`.
- **Sessões:** `POST /api/security` (`revoke_session`), que só marca `security_sessions.revoked_at`.
- **Credenciais:** `POST /api/integrations/manage` (`revoke_api_client`).
- **Plataforma:** nenhum código define `is_superadmin` nem escreve em `saas_support_agents`.

## 4. Lacunas

1. **Não existe serviço oficial de Auth/RBAC.** O briefing pressupõe um. Sem ele, "provisionar pelo serviço oficial" não tem destino.
2. **O ActionEngine é uma lista fechada.** `copilot_action_requests` aceita 12 tipos e `source='copilot'`. As Fases 88, 92 e 94 não o usam de fato.
3. **`decide()` da Fase 79 não é chamado por nenhuma rota.** Sem política publicada, o resultado é `not_applicable`.
4. **`internal_approvals` não tem `organization_id`.** A Fase 93 decide os próprios pedidos pela rota dela e confere de novo os passos antes de provisionar.
5. **Não há evento de desligamento na Fase 18** nem sponsor de terceiro na Fase 92.
6. **`impersonation_sessions` não tem nenhum uso no código.** Não há impersonação real para governar.
7. **`access_review_runs` (Fase 25) não tem uso no código.**
8. **Revogar sessão é parcial.** Não há "revogar todas as sessões do usuário", e JWTs emitidos valem até expirar.

## 5. Riscos encontrados

| Risco | Evidência | Tratamento |
|---|---|---|
| Problemas de autorização em módulos anteriores | Foram encontrados problemas de autorização em módulos anteriores. Os detalhes ficam fora do repositório, que é público, e o tratamento segue em tarefa separada. | Fora desta fase |
| `private.has_role` ignora `status` | Definição lida no dev | Revogar papel de loja exige apagar a linha, não inativar |
| `/api/security` lê `security_events` com o cliente do usuário, mas a Fase 94 revogou esse acesso | `app/api/security/route.ts:48` e a migration da Fase 94 | Registrado; fora do escopo |

## 6. Decisões de arquitetura

1. **Fachada mínima de RBAC, sem segundo RBAC.** A migração cria RPCs `rbac_*`, restritas a `service_role`, que escrevem nas tabelas reais e devolvem o estado lido depois da escrita. Não há papéis nem permissões novos fora de `idgov:*`.
2. **Só provisiona o que tem caminho seguro:** papel de loja, papel de organização e permissões por chave de `soc`, `vendor` e `idgov`. Os demais entitlements entram no catálogo como somente leitura; pedir um deles falha com `NO_OFFICIAL_PATH`, nunca com sucesso silencioso.
3. **Papel `owner` e superadmin não são provisionáveis** nem por JIT ou break-glass.
4. **ActionEngine como registro compartilhado.** Ações de alto impacto gravam em `copilot_action_requests` com `source='identity_governance'`, preview e token de confirmação. A execução fica nesta fase, e o `confirm_copilot_action` do Copiloto não executa esses tipos.
5. **Aprovação pela Fase 32.** Pedidos criam `internal_approvals` e `internal_approval_steps`. A decisão passa pela rota da Fase 93, que bloqueia autoaprovação e confere de novo os passos antes de provisionar.
6. **Policy Engine consultado, com padrão seguro.** Se a política negar, o pedido é rejeitado. Sem política ou com erro, valem as regras do catálogo, e acesso privilegiado nunca dispensa aprovação.
7. **Leaver respeita multi-tenant.** A conta só é banida no Auth se o usuário não tiver vínculo com outra organização. Credenciais de integração sem dono viram achado em vez de serem cortadas, para não derrubar a operação.
8. **Reutilização:** `security_events`, `security_audit_logs`, `security_response_actions`, `impersonation_sessions` e `vendor_access_references`. `access_review_runs` não é ampliada: cada campanha nova registra uma linha nela para manter o histórico da Fase 25 coerente.

## 7. Plano de integração com a Fase 94

- **Eventos:** concessão, elevação, JIT, break-glass, revogação, falha de revogação, vendor terminado e service account viram linhas em `security_events` (`source_domain='identity'`), usando o índice de deduplicação que já existe.
- **Contexto:** `app/api/security-operations/route.ts` passa a devolver o contexto de identidade por um adaptador real, no lugar da referência que era só um texto.
- **Pedidos do SOC:** `security_response_actions` continua sendo a fila. A Fase 93 lê os pedidos de identidade e os executa; o SOC não altera acesso.
- **Sobreposições:** `security_domain_links` (domínio `identity_governance`) e `security_soc_member_permissions` são mantidas; nenhuma tabela da 94 é duplicada.

## 8. Limites conhecidos desde o início

- Impersonação: a fase governa o registro e as regras, mas não existe tela que faça a impersonação.
- Uso real de acesso: não há telemetria por entitlement. "Dormente" usa `profiles.last_login_at` e `security_sessions`.
- Automation Center, Reporting e Data Platform seguem o padrão das Fases 92 e 94: catálogos e views, sem executor novo.
