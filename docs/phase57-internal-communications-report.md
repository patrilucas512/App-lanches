# Fase 57 — Comunicação Interna, Mural Corporativo e Central de Comunicados

Migrations aplicadas **só no `masterapp-dev`**. Nada foi aplicado ou escrito em produção. Nada foi mesclado. A Fase 38 ainda não está na `main`, e esta branch partiu da `main`.

## 1. Diagnóstico

Está em `docs/phase57-initial-diagnosis.md`. Os achados que mudaram o desenho:

- `network_announcements` não tinha nenhum código de escrita.
- `GET /api/network-governance` mostrava os comunicados a qualquer membro da organização. Com rascunhos e crises na tabela, isso viraria vazamento.
- As ações `*_create_communication_draft` estavam só no registro: o worker da Fase 50 as marcava como concluídas sem fazer nada.
- Não existe equipe de loja no produto. `internal_teams` é da operação da plataforma.
- A decisão de aprovação em `/api/internal-work` é só para a equipe da plataforma.

## 2. Evolução da Fase 46

`network_announcements` ganhou colunas aditivas; nada foi removido ou renomeado. `acknowledgement_required` é o `requires_ack` do pedido e `created_by` é o autor. Linhas antigas mantêm o sentido: o que estava publicado continua publicado, e o escopo vira público.

A confirmação continua em `network_announcement_acknowledgements`, agora com `version`. `GET /api/network-governance` passou a devolver só o que está publicado e é destinado à loja consultada, com colunas explícitas.

- **Versões:** editar um publicado cria linha em `network_announcement_versions`, imutável no banco. Mudança relevante pede nova confirmação; número alterado sempre conta como relevante.
- **Retratação:** o texto e o histórico ficam, e quem recebeu é avisado. Não há caminho de exclusão.

## 3. Arquivos

**Criados**

- `lib/internal-communications/`: `core`, `server`, `audiences`, `announcements`, `delivery`, `acknowledgements`, `templates`, `board`, `crisis`, `integrations`, `dashboard`
- `app/api/internal-communications/route.ts` e `worker/route.ts`
- `app/painel/operacoes/comunicacao-interna/page.tsx` e `app/painel/comunicados/page.tsx`
- `components/internal-communications-center.tsx` e `components/my-announcements.tsx`
- `tests/internal-communications-phase57.test.mjs` e `scripts/dev/comms-smoke.mjs`

**Alterados**

- Rotas: `network-governance`, `incidents`, `business-continuity`, `food-quality`, `automation/worker`, `reports`, `executive-command`, `workspace`
- Lib: `automation/core`, `reporting/core`, `workspace/core`, `workspace/widget-data`, `data-platform/core`, `identity-governance/core`, `identity-governance/server`, `intelligence/copilot-tools`
- Telas: `dashboard-shell`, `incident-management-center`
- Outros: `package.json`, `.env.example`, `docs/FASES.md`, `docs/phase59-incident-management.md`, `tests/security/profiles-privileged-columns.test.mjs`

## 4. Migrations

| Arquivo | Conteúdo |
|---|---|
| `20261101194114_phase57a_canonical_announcements` | Flags, colunas, versões, permissões, configurações, fila e auditoria |
| `20261101194608_phase57b_audience_delivery` | `network_announcement_recipients` e `profiles.preferred_language` |
| `20261101194611_phase57c_acknowledgements` | Versão na confirmação |
| `20261101194614_phase57d_templates_attachments` | Modelos, anexos e bucket privado |
| `20261101194617_phase57e_board_polls` | Mural, comentários e enquetes |
| `20261101194622_phase57f_crisis` | Índices de vínculo e de crise |
| `20261101194949_phase57g_integrations` | Fase 93, `fact_comms_reach` e registros |

## 5. Públicos e entrega

`AudienceResolver` cobre rede, marca, região, grupo de lojas, franquia, unidade e equipe, com filtros de função, cargo, turno e idioma. O público é gravado na publicação, e quem entra depois recebe o que ainda vale, com prazo próprio. Ninguém é removido do registro.

A entrega passa só por `publishNotification` (Fase 52), por fila, com nova tentativa, registro de falha e prioridade para crise. O horário de descanso adia a entrega e usa o fuso da pessoa ou da loja. Só furam esse horário a publicação de emergência e o urgente, este quando a política permitir. Os canais extras seguem as preferências da Fase 52.

## 6. Confirmação de leitura

Os estados são `delivered`, `opened`, `acknowledged` e `overdue`. A pergunta de verificação é opcional: a resposta certa não vai ao navegador e um erro não fica registrado. Há lembretes antes e depois do prazo, com limite. O gestor recebe só o total da própria unidade.

## 7. Aprovação e modelos

A aprovação usa `internal_approvals` e `internal_approval_steps` (Fase 32), decidida por ação do módulo, como na Fase 93.

- **Exigida para:** rede inteira, crise, recall, política e texto de IA. A Fase 79 (chave `comms.publish`) pode acrescentar exigência, nunca remover; se a política falhar, valem as regras do código.
- **Amarrada ao texto:** editar depois de aprovado derruba a aprovação. Em comunicado publicado, a edição fica pendente até ser aprovada.
- **Quem aprova:** o autor não aprova o próprio comunicado, salvo `self_approval_allowed`, desligado por padrão.
- **Emergência:** desligada por padrão. Quando permitida, exige motivo e permissão, fica na auditoria e cobra revisão posterior por outra pessoa. Texto de IA não usa esse caminho.

Há 6 modelos padrão: cardápio, procedimento, abertura, recall, manutenção e crise. Cada salvamento gera nova versão, com dono.

## 8. Mural e enquetes

O mural existe por unidade e por rede, com comentários moderados e opcionais. Aviso rápido para a rede inteira é recusado, para que o mural não vire atalho da aprovação. Não há curtida, ranking nem contagem por pessoa.

A enquete é anônima por padrão, com mínimo de respostas (padrão 5, nunca menos de 3); abaixo disso, não mostra nenhum número por opção. Resposta e participação ficam em tabelas separadas, sem hora, e não dá para cruzar voto e pessoa.

## 9. Crise e o que mudou na Fase 59

- `communication_draft` cria rascunho canônico e a relação `internal_communication` quando o módulo está ligado. Com ele desligado, a tarefa no Task Engine continua igual.
- Rascunho não enviado é reaproveitado. Depois de publicar, o incidente pode emitir um novo comunicado.
- A publicação grava `communication_sent` na linha do tempo do incidente.
- A ativação de plano de continuidade propõe comunicado, que fica aguardando aprovação; falha aqui não impede a ativação.
- O recall cria rascunho com prazo curto e confirmação por unidade.

## 10. Integrações

| Fase | Integração |
|---|---|
| 50, 65, 67 e 68 | O worker executa `*_create_communication_draft` e `comms_create_draft`, que criam rascunho real; também os gatilhos e ações pedidos |
| 52 e 53 | Inbox, push e widget `comms_my_mandatory`, que aparece enquanto houver confirmação em aberto |
| 54 | Quatro datasets e seis métricas com denominador explícito |
| 33 | Só crises ativas e confirmações críticas em atraso, sem o texto do comunicado |
| 51 | Navegação, comandos e índice; comunicados de crise não entram na busca |
| 93 | Módulo `comms` em `rbac_*` e no catálogo; publicar para a rede, crise, aprovar e ver status de leitura são acessos privilegiados |
| 56 e 68 | Vínculos por `related_refs`, sem segundo editor |
| Superadmin | `platform_announcements` não foi tocado |

## 11. UI

- **Operações → Comunicação Interna:** as 10 seções e os 6 cards pedidos. O editor escolhe público e vínculos por nome e mostra quantas pessoas vão receber.
- **Comunicados:** tela para qualquer funcionário, com "Li e entendi", mural, enquetes e idioma. Sem rolagem lateral em 375 px.

## 12. RBAC, privacidade e auditoria

- As 10 permissões `comms:*` pedidas. Funcionário sem permissão lê só o próprio feed.
- Todas as tabelas novas têm RLS sem acesso para cliente; só o servidor acessa. A view `fact_comms_reach` não tem coluna de pessoa.
- A lista nominal de quem não leu exige comunicado obrigatório, permissão e unidade do gestor, e cada consulta é auditada.
- CPF, cartão, e-mail e telefone bloqueiam a publicação. Salário, saúde e dados de clientes pedem confirmação.
- O anexo só abre para quem recebeu ou para quem gerencia aquele comunicado, com link de 5 minutos.
- A auditoria fica em `comms_audit_events`, imutável, e em `security_audit_logs`.
- Retenção: a coluna `retention_months` é o ponto de integração com a Fase 95. Nada é apagado automaticamente.

## 13. Testes

| Verificação | Resultado |
|---|---|
| `tests/internal-communications-phase57.test.mjs` (cobre os 17 itens pedidos) | 40 de 40 |
| Suíte `tests/*.test.mjs` | 3757 de 3757 |
| `unit`, `integration`, `contract`, `performance` | sem falhas |
| `security` | sem falhas, após o ajuste descrito abaixo |
| `scripts/dev/comms-smoke.mjs`, no banco real do dev | 51 de 51 |
| `typecheck:ci` | sem erros novos |
| Lint nos arquivos alterados | 0 erros, 2 avisos |
| Migration safety | aprovada nos 7 arquivos |
| Build de produção | aprovado |
| Rotas HTTP e telas na pré-visualização com sessão real | ver abaixo |
| CI do PR #13, incluindo `migration-dry-run` (banco sem a Fase 38) e lint completo | 11 de 11 verificações aprovadas no commit `0bbd875` |

Na pré-visualização foram exercidos: criar rascunho pelo editor, prévia do público, publicar pela rota real com o publicador da Fase 52, "Li e entendi" com clique real em 375 px, widget no Workspace, rascunho pela rota de incidentes e rota da Fase 46.

**Ajuste em teste existente:** `profiles-privileged-columns` ganhou `preferred_language` como coluna que o app pode gravar. A lista de grants para `authenticated` não mudou, e a coluna não dá privilégio.

Defeitos encontrados nessas verificações e já corrigidos:

- Incidente só conseguia emitir um comunicado.
- Lote ou código de barras de 13 dígitos era tomado por cartão.
- O Workspace não mostrava o widget a quem já tinha perfil.
- O editor pedia códigos internos em vez de nomes.
- O anexo não tinha botão na tela.

## 14. O que não foi verificado

- **`vinext dev`:** caiu duas vezes com erro interno do `workerd` ao carregar a entrada do Worker, antes de executar qualquer rota. O relatório da Fase 38 registra a mesma falha intermitente. A causa não foi investigada e não dá para afirmar que é anterior a esta fase. O teste de tela foi feito no build de produção.
- **Worker com segredo real:** a rota só foi testada sem segredo (401). As funções da fila rodaram direto no banco, mas não o laço completo do worker nem `?enqueue=1`.
- **Com a janela do app minimizada:** a maior parte das telas foi conferida por leitura de texto, sem revisão visual. O botão de anexo não foi clicado; o envio foi testado direto na URL assinada.
- **Duas pessoas reais na tela:** aprovação, recusa e permissões foram testadas nos serviços e no banco, não com duas sessões no navegador.
- **Push e WhatsApp reais:** não foi testado envio para aparelho. A entrega foi conferida até o inbox e o registro da Fase 52.

## 15. O que precisa de aprovação

1. Revisar e mesclar o [PR #13](https://github.com/patrilucas512/App-lanches/pull/13).
2. Decidir quando aplicar em produção. As migrations não foram aplicadas lá, por ordem do documento da fase.
3. Agendar o worker, fora das migrations: `POST /api/internal-communications/worker`, com um job frequente e outro com `?enqueue=1`. Sem ele, não há lembretes, agendados, expiração nem novos membros, e crises dependem da tentativa imediata feita na publicação.
4. Configurar `INTERNAL_COMMUNICATIONS_WORKER_SECRET` ou `CRON_SECRET`.
5. Ligar as flags, todas desligadas por padrão, e decidir se a emergência será permitida.

## 16. Limitações

- **Equipe** é o cargo (`staff_roles`) dentro da unidade, porque o produto não tem equipe de loja.
- **IA:** resumir e simplificar usam regras locais, sem modelo de linguagem. Não há tradução. O código aceita rascunho marcado como IA, com aprovação obrigatória, mas nenhuma tela nem ferramenta gera esse rascunho hoje. Ligar um modelo depende de um agente registrado na Fase 80.
- **Copiloto:** o chat geral só responde com orientação. As seis ferramentas ficam na ação `copilot` da rota do módulo.
- **`comms_notify_pending` e `comms_escalate_manager`** rodam a varredura completa da organização, não um comunicado específico.
- **Enquete identificada** existe por opção; os resultados continuam agregados.
- **Modelos:** a política `comms.publish` não vem criada; sem ela, valem só as regras do código.
- **Escala:** resumos e painéis leem até 5000 linhas, e usuário sem acesso a todas as lojas vê até 300 comunicados alcançados. Publicar lê o público inteiro.
- **Dados de teste no dev:** usuários fictícios `comms.*`, comunicados `Smoke…` e flags ligadas na loja de teste.
- **Conflito esperado:** a Fase 38 também altera `docs/FASES.md`, `lib/reporting/core.ts`, `lib/workspace/core.ts`, `lib/data-platform/core.ts`, `dashboard-shell`, `executive-command`, `reports` e `copilot-tools`. Quem entrar por último resolve os conflitos; no `executive-command`, os índices de `keys` precisam ser conferidos com atenção.

## 17. Recomendações

1. Mesclar a Fase 38 antes desta, para resolver os conflitos em um só lugar.
2. Criar uma regra de segregação de funções (Fase 93) entre publicar e aprovar comunicado de crise.
3. Investigar o erro do `workerd` no `vinext dev`, que já atrapalha duas fases.
4. Rever a busca global: `c.has` só conhece permissões `search:*` e `commands:*`, então um `required_permission` de módulo esconde o item de todos. Isso afeta os registros da Fase 38 e foi contornado aqui.
5. Corrigir, em uma tarefa própria, as demais ações do worker da Fase 50 que hoje são marcadas como concluídas sem executar nada.
