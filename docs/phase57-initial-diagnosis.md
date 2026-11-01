# Fase 57 — Diagnóstico inicial

Levantado em 2026-11-01 na `main` (`2853a22`), lendo o código e o `masterapp-dev` (`bfmrcvjxbmxxmdustrgo`). Produção não foi lida nem alterada.

## Ambiente

- `.env.local` aponta para o `masterapp-dev`.
- O dev está nas migrations até `20261101180810`, que incluem a Fase 38. A `main` ainda não tem a Fase 38, então as migrations desta fase não dependem dela e têm versão posterior à dela.
- O dev tem 1 organização, 1 loja e 4 usuários. `network_announcements` e `network_announcement_acknowledgements` estão vazias.

## O que existe e como será usado

| Onde | O que existe | Decisão |
|---|---|---|
| Fase 46 | `network_announcements` (escopo, `acknowledgement_required`, `published_at`, `expires_at`) e `network_announcement_acknowledgements` (PK `announcement_id,user_id`). Sem nenhum código de escrita. | Base canônica, com colunas aditivas. `acknowledgement_required` é o `requires_ack` do pedido e `created_by` é o autor: nenhuma coluna duplicada. |
| Fase 46 | `GET /api/network-governance` devolve as 30 últimas linhas para qualquer membro da organização, sem filtro de público. | **Risco novo.** Com rascunhos e crises na tabela, isso vazaria. A rota passa a devolver só `published`. |
| Fase 52 | `publishNotification` com dedup e canais por preferência. `quietHoursActive` usa a hora do servidor, e `effectiveChannels` não aplica quiet hours ao push. | Canal único de entrega. O adiamento por quiet hours fica na fila da 57, com o fuso da loja. `lib/notifications` não muda. |
| Fase 53 | `workspace_widget_registry` e `resolveWidgetBatch`. | Widgets novos com resolvedor real. |
| Fases 18 e 58 | `establishment_members`, `organization_members`, `organization_member_store_access`, `custom_staff_members` com `user_id` e `role_id` (`staff_roles`), `work_shifts` e `work_shift_templates`. | Fontes do `AudienceResolver`. Função é o papel do membro, cargo é o `staff_roles`, turno é o modelo de turno. |
| Equipes | Só existe `internal_teams`, da Fase 32, que é da operação da plataforma. | **Não há equipe de loja.** Equipe, nesta fase, é o cargo (`staff_roles`) dentro da unidade. |
| Idioma | Nenhuma tabela guarda o idioma da pessoa. | Coluna aditiva `profiles.preferred_language`; vazio conta como `pt-BR`. |
| Fase 32 | `internal_approvals` e `internal_approval_steps`. A decisão em `/api/internal-work` é só para a equipe da plataforma. | Mesmo caminho da Fase 93: a aprovação é gravada nas tabelas da 32 e decidida por uma ação do módulo, que tem o escopo da loja. Sem segundo motor. |
| Fase 79 | `decide()` em `lib/policy_engine/services.ts`. | A chave `comms.publish` pode **acrescentar** exigência de aprovação. As regras mínimas ficam no código e a política não as remove. |
| Fase 59 | Ação `communication_draft` cria tarefa em `internal_tasks`. A relação `internal_communication` já é aceita. O teste 20 da Fase 59 confere esse caminho. | Com o módulo ligado, cria rascunho canônico e a relação. Com o módulo desligado, o contorno continua igual. `communicationPublished:false` é mantido. A timeline já aceita `communication_sent`. |
| Fases 65, 67 e 68 | `*_create_communication_draft` só em registro. O worker da Fase 50 executa de fato apenas `create_internal_task` e `send_notification`; as demais ações ficam como concluídas **sem fazer nada**. | **Lacuna real.** O worker passa a criar o rascunho nessas três ações e em `comms_create_draft`. As outras ações seguem como estão. |
| Fase 86 | `continuity_plans.communication_plan` e `activate_plan`. O evento `continuity.plan_activated` está declarado, mas não é emitido. | A ativação propõe um comunicado de crise, que segue para aprovação, e emite o evento. Falha aqui não impede a ativação. |
| Fase 47 | `quality_recalls` e `quality_recall_store_status`. | Modelo de recall com leitura obrigatória, prazo curto e confirmação por unidade. |
| Fases 56 e 68 | `learning_courses` e `knowledge_articles`. | Só vínculos em `related_refs`. Sem segundo editor. |
| Fase 93 | `rbac_read_effective_access`, `rbac_set_module_permission` e o catálogo com os módulos `soc`, `vendor` e `idgov`. | Módulo `comms` entra nos três. Publicar para a rede e crise viram acessos privilegiados governados. |
| Fases 50, 51, 54 e 33 | Registros de eventos, ações, busca, relatórios e `signals()` do Executive. | Linhas novas nos registros, sem motor paralelo. |
| Superadmin | `platform_announcements`. | Fora desta fase. Nenhum arquivo do superadmin muda. |

## Lacunas de agendamento

Os workers das fases recentes dependem de um job `pg_cron` criado fora das migrations, porque ele leva o endereço do ambiente. A 57 segue o padrão: `POST /api/internal-communications/worker`, com `INTERNAL_COMMUNICATIONS_WORKER_SECRET` ou `CRON_SECRET`.

## Decisões de modelo

1. **Destinatários:** `network_announcement_recipients` guarda o snapshot do público, o estado de entrega e o de leitura. A confirmação continua em `network_announcement_acknowledgements`, com a coluna `version`.
2. **Enquete anônima:** a resposta não guarda usuário nem hora, e a participação fica em outra tabela, sem a opção escolhida. Assim, não dá para cruzar voto e pessoa.
3. **Edição de comunicado que exigiu aprovação:** a alteração fica pendente e só vale depois de aprovada. Sem isso, editar depois de publicar contornaria a aprovação.
4. **Quem não leu:** a lista nominal existe só para comunicado obrigatório, só com `comms:view_ack_status`, só nas unidades do gestor, e cada acesso é auditado. Fora disso, só números agregados.
5. **Quem aprova:** o autor não aprova o próprio comunicado. Em conta com uma pessoa só isso travaria tudo, então existe `self_approval_allowed`, desligado por padrão e auditado.
6. **Rede com uma loja só:** escopo de rede sobre uma única unidade não conta como "rede inteira". Crise, recall, política e IA exigem aprovação do mesmo jeito.
