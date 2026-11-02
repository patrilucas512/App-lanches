# Fase 38 — Diagnóstico inicial de Reputação e Experiência do Cliente

Revisado em 2026-11-01 na branch `claude/fase-38-reputacao-experiencia`, a partir de `2853a22`. Fontes: migrations, código e consultas somente leitura ao `masterapp-dev`. Produção não foi consultada.

## 1. O que existe

| Onde | O que existe | Como a Fase 38 trata |
|---|---|---|
| Fase 5 | `crm_feedback`: nota de 1 a 5, comentário e `needs_human_attention`. `customer_id` e `order_id` são obrigatórios, e há uma linha por pedido | Vira a camada canônica, por extensão aditiva |
| Fase 5 (gatilho) | Pedido concluído com a automação `post_sale` ligada cria linha pendente em `crm_feedback` | Mantido |
| Fase 13 | `customer_portal_action('rate_order')` grava com `on conflict(order_id)` | Mantido; a restrição única continua |
| Atendente de IA | `order-conversation.ts` lê a pendência e grava `rating` quando a resposta é de 1 a 5 | Passa a respeitar a escala da pendência |
| Fase 60 | Lê `crm_feedback` por `customer_id`; há gatilho de refresh que aceita cliente nulo | Continua lendo a mesma tabela; ganha histórico de recuperação |
| Fase 54 | `csat` e `nps` no catálogo, com fonte `customer experience mart`, que nunca existiu. `executeRows` devolve zero linhas nesses datasets | Passa a ler `fact_cx_feedback` |
| Fase 55 | Meta `improve-csat`; o worker devolve `semantic_metric_unavailable` para `csat` e `nps` | Passa a calcular de verdade, respeitando amostra mínima |
| Fase 61 | Eventos em `automation_event_registry`; supressão por reclamação lê só `customer_support_requests` | Eventos `cx.*` e supressão por recuperação aberta |
| Fase 50 | `automation_event_inbox` | Os eventos `cx.*` entram por aqui |
| Fase 59 | `operational_incidents.created_by` é obrigatório, o que impede abertura pelo sistema | `created_by` passa a aceitar nulo, por ser ocorrência sem autor humano |
| Fase 47 | `quality_nonconformities` com categoria `customer_complaint`, `created_by` opcional | Sinais de alimento viram não conformidade |
| Fase 69 | Matriz de capacidades sem avaliações; nenhum adaptador real de provedor | Ganha capacidades `reviews_read` e `reviews_reply`, desligadas por padrão |
| Fase 80 | `ai_agents` e `ai_agent_runs` | A IA só roda com agente registrado e ativo na organização, e cada uso vira uma execução registrada |

## 2. Escopos que não se misturam

`customer_feedback` (Fase 30), `support_csat` (Fase 24) e `app_reviews` (Fase 21) tratam do cliente do SaaS e do marketplace de apps. A Fase 38 não lê nem escreve nessas tabelas, e há teste para isso.

## 3. Lacunas encontradas

1. **Não existe fluxo oficial de reembolso.** O código só mapeia o status `refunded` vindo do gateway, e a Fase 50 proíbe `automatic_refund`. O caso de recuperação registra o pedido e a aprovação, mas nenhum dinheiro é movimentado: o reembolso aprovado fica em `awaiting_official_flow`, com execução manual no gateway.
2. **WhatsApp fora da janela de 24 horas exige template.** O envio com link usa `sendStoredWhatsAppText`, a mensagem de sessão. Sem conversa aberta, a pesquisa é pulada com o motivo `no_open_window`, nunca forçada.
3. **Nenhum provedor de avaliações externas tem adaptador real no repositório.** A Fase 69 é neutra em relação ao provedor. A fase entrega o contrato, a importação e a resposta por adaptador, mas sem credencial nenhum provedor pode ser ativado.
4. **O comprovante impresso não é alterado.** O link de comprovante e o QR são URLs geradas no painel; a impressão térmica continua como está.
5. **`crm_feedback` guarda uma linha por pedido.** A Fase 38 mantém essa regra: um pedido recebe uma pesquisa e uma avaliação.

## 4. Decisões

1. **Sem tabela paralela.** `crm_feedback` ganha colunas e aceita cliente e pedido nulos, para anônimo e importado. A coluna `rating` só é preenchida em escala de 1 a 5; NPS fica em `score`, para não misturar escalas em quem já lê `rating`.
2. **Quem já escreve continua igual.** Um gatilho `before` normaliza as linhas gravadas pelo portal, pelo atendente e pela automação, preenchendo organização, `score`, escala, tipo e origem.
3. **Falha do módulo não bloqueia pedido.** Todo gatilho que toca pedidos e `crm_feedback` para enfileirar trabalho tem bloco de exceção próprio, e a análise roda fora da transação.
4. **Regras explicáveis por padrão.** Sentimento, temas e sinais de risco vêm de um léxico que guarda o trecho e a confiança. A IA é opcional e só acrescenta: nunca remove sinal de risco, e todo trecho precisa existir no comentário.
5. **Sem review gating, por construção.** A função que decide o convite público não recebe a nota. Detrator recebe também a oferta de contato.
6. **Publicação protegida no banco.** Uma restrição impede resposta publicada sem aprovador, salvo política de caso simples, e nunca para autoria de IA.
7. **Consentimento conservador.** Pesquisa ativa exige opt-in por padrão, com ajuste por organização. Opt-out, bloqueio, frequência e horário silencioso são checados no envio, e pular grava o motivo.
8. **Amostra mínima na origem.** O cálculo devolve `insufficient_sample` e nenhum número abaixo do mínimo, inclusive para metas.
9. **Permissões no padrão da Fase 93.** Tabelas novas ficam só com `service_role`; a rota confere tenant, flag e `cx:*`.

## 5. Plano de etapas

| Etapa | Entrega |
|---|---|
| 38A | Extensão de `crm_feedback`, permissões, configurações, auditoria, fila e flags |
| 38B | Pesquisas versionadas, disparos, gatilhos, consentimento e página pública |
| 38C | Caixa de avaliações, fontes e importação externa por adaptador oficial |
| 38D | Sentimento, temas, correções e sinais de risco ligados às Fases 47 e 59 |
| 38E | Respostas com aprovação e casos de recuperação com limite de compensação |
| 38F | Causa raiz e reputação por unidade, marca e rede |
| 38G | Reporting, metas, Customer 360, Journeys, Workspace, Executive, Copiloto e Automation |
