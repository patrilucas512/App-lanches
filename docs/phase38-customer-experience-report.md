# Fase 38 — Reputação, Avaliações, NPS/CSAT e Experiência do Cliente

Branch `claude/fase-38-reputacao-experiencia`, a partir de `2853a22`. Produção não foi consultada nem alterada. As migrations ainda não foram aplicadas em nenhum banco.

## 1. Diagnóstico

Ver `docs/phase38-initial-diagnosis.md`. Os achados que mudaram o desenho:

- `csat` e `nps` apontavam para um "customer experience mart" que nunca existiu, e o worker de metas devolvia `semantic_metric_unavailable`.
- `crm_feedback` exigia cliente e pedido, o que impedia QR anônimo e avaliação importada.
- Não existe fluxo oficial de reembolso no repositório.
- Nenhum provedor de avaliações tem adaptador real.

## 2. Consolidação com `crm_feedback`

`crm_feedback` é a tabela canônica. Nenhuma tabela paralela foi criada.

- **Extensão aditiva:** origem, canal, tipo, `score`, escala, notas por item e por dimensão, idioma, público, consentimento, estado da caixa, responsável e prazos.
- **Cliente e pedido viraram opcionais.** `unique(order_id)` continua, então o `on conflict` do portal segue funcionando e cada pedido tem uma avaliação.
- **`rating` continua de 1 a 5.** NPS e CES ficam só em `score`, para não misturar escalas em quem já lê `rating`.
- **Gatilho de normalização:** portal, atendente e automação `post_sale` continuam gravando como antes, e o gatilho preenche o restante. Se uma pendência de NPS for respondida pelo portal, que só conhece de 1 a 5, a resposta define a escala.

## 3. Arquivos

**Novos**

- `lib/customer-experience/`: `core`, `surveys`, `external`, `sentiment`, `ai`, `server`, `responses`, `recovery`, `reputation`, `dashboard`, `integrations`
- `app/api/customer-experience/route.ts` e `worker/route.ts`
- `app/api/public/customer-experience/route.ts`
- `app/painel/clientes/experiencia/page.tsx` e `components/customer-experience-center.tsx`
- `app/avaliar/[slug]/page.tsx`, `survey.css` e `components/customer-survey.tsx`
- `tests/customer-experience-phase38.test.mjs`
- `docs/phase38-initial-diagnosis.md` e este relatório

**Alterados**

| Arquivo | Mudança |
|---|---|
| `lib/ai-attendant/order-conversation.ts` | Lê o dígito na escala da pendência; dígito fora dela segue como mensagem comum |
| `lib/ai-attendant/orchestrator.ts` | Reclamação na conversa vira feedback, sem poder derrubar a resposta |
| `app/api/customer-360/route.ts`, `components/customer-360-center.tsx` | Histórico de avaliações e recuperação; `activeRecovery` deixa de ser fixo em falso |
| `app/api/customer-journeys/worker/route.ts` | Recuperação aberta suprime jornadas |
| `app/api/reports/route.ts`, `lib/reporting/core.ts` | Dataset `customer_experience`; `csat` e `nps` com dados reais |
| `app/api/performance-management/worker/route.ts` | Metas de `csat` e `nps` calculadas |
| `app/api/executive-command/route.ts` | Só o material: risco grave, queda de NPS e avaliação pública crítica sem resposta |
| `lib/intelligence/copilot-tools.ts` | Ramo de reputação |
| `lib/marketplace-integrations/core.ts` | Capacidades `reviews_read` e `reviews_reply` |
| `components/dashboard-shell.tsx`, `lib/workspace/core.ts`, `lib/data-platform/core.ts`, `package.json`, `.env.example` | Menu, registros e configuração |
| `tests/whatsapp-crm-phase5.test.mjs` | Testes 21 e 22 comparavam o texto do código alterado; agora comparam o trecho novo, com a mesma regra para a escala de 1 a 5 |
| `docs/FASES.md`, `docs/phase37-marketing-intelligence.md` | Status |

O teste da Fase 37 que garante que a 37 não cita a 38 foi mantido, porque a migration, a API e a UI da 37 não mudaram.

## 4. Migrations

| Arquivo | Conteúdo |
|---|---|
| `20261101170000_phase38a_feedback_canonical` | Extensão de `crm_feedback`, flags, permissões, configurações, fila e auditoria imutável |
| `20261101171000_phase38b_surveys_requests` | Pesquisas versionadas, disparos, respostas, gatilhos e RPCs públicas |
| `20261101172000_phase38c_external_reviews` | Fontes e avaliações externas |
| `20261101173000_phase38d_sentiment_risk` | Análise, temas, sinais de risco e correções; `operational_incidents.created_by` passa a aceitar nulo |
| `20261101174000_phase38e_responses_recovery` | Modelos, respostas, casos e ações de recuperação |
| `20261101175000_phase38f_reputation_facts` | Sete views `fact_cx_*` |
| `20261101176000_phase38g_integrations` | Catálogo de métricas, dataset, metas, widgets, busca, automação e notificações |

## 5. Pesquisas e convites

- Tipos NPS, CSAT e CES, com perguntas versionadas. Salvar cria uma nova versão.
- **Gatilhos ativos:** pedido entregue, retirado, mesa fechada, reserva concluída e atendimento encerrado. `manual` funciona por link. `subscription_cycle` está no catálogo, mas sem gatilho automático.
- **Uma por pedido:** a chave `order:<id>` é única por organização. Se a automação `post_sale` já pediu avaliação, a pesquisa não dobra a mensagem.
- **Checado no envio:** opt-out, bloqueio, consentimento, frequência e horário silencioso. Horário silencioso adia; os demais pulam e gravam o motivo.
- **Canais:** WhatsApp, com resposta na conversa ou pelo link, além de QR e link de comprovante.
- **Sem review gating:** `ReviewInviteService.invite` não recebe a nota. Detrator recebe também a oferta de contato.
- **Página pública:** `/avaliar/<slug>`, leve e em 1 a 2 toques. O token é guardado só como hash, e respostas anônimas têm limite por hora com endereço em hash de sal diário.

## 6. Avaliações externas

| Provedor | Situação |
|---|---|
| Google Business Profile | Não suportado: falta adaptador oficial e credencial aprovada |
| iFood | Não suportado: depende de adaptador da Fase 69 com `reviews_read` |
| Rappi | Não suportado: depende de adaptador da Fase 69 com `reviews_read` |
| Tripadvisor | Não suportado: sem integração oficial no produto |

**Nenhum provedor está ativo hoje.** A importação, a resposta, a idempotência e o circuit breaker existem e têm testes com adaptador falso. Só falta registrar um adaptador real em `OFFICIAL_ADAPTERS`. Não há caminho de scraping, e credenciais ficam em `integrations.vault_config_secret_id`.

## 7. Sentimento e sinais de risco

- **Por regras, em português:** cada sentimento e tema guarda trecho e confiança, com negação tratada.
- **Sinais:** alergia, possível intoxicação, corpo estranho, possível contaminação, acidente, ameaça ou assédio. A detecção é ampla de propósito: negação só reduz a confiança.
- **Ocorrências:** todo sinal abre incidente da Fase 59, e os de alimento abrem também não conformidade da Fase 47. Severidade inicial `SEV2`, com revisão humana obrigatória.
- **Descartar exige motivo.** Só cancela incidente que ninguém começou a tratar.
- **IA:** opcional e só soma. Exige agente `customer_experience_assistant` ativo na Fase 80, registra cada uso em `ai_agent_runs`, recebe o comentário mascarado, tem trechos validados contra o comentário e não remove sinal de risco.
- **Correção humana** fica registrada e não é sobrescrita por nova análise.

## 8. Respostas e recuperação

- **Respostas:** rascunho de pessoa, modelo ou IA, sempre para aprovação. Restrições no banco impedem publicar sem aprovador, e autoria de IA nunca usa a política automática.
- **Publicação automática:** desligada por padrão. Quando ligada, só vale para avaliação pública de 5 estrelas, sem texto, sem sinal de risco e com modelo.
- **Proteções do texto:** resposta pública não pode ter nome, telefone, e-mail, documento ou número do pedido. IA não promete compensação, e ninguém pede para mudar a avaliação.
- **Recuperação:** detrator identificado abre caso, com a flag ligada. Ações, prazo, resultado, resposta do cliente e recompra ficam registrados.
- **Compensação:** reembolso sempre passa por outra pessoa, e o banco impede autoaprovação. Cupom passa sem aprovador só até o limite configurado, que começa em zero.
- **Reembolso aprovado não move dinheiro:** fica em `awaiting_official_flow` e é feito à mão no gateway.

## 9. Causa raiz e reputação

- **Causa raiz:** cruza avaliações com itens, preparo, entrega, turno, fornecedor do lote e incidentes. Cada achado traz volume e período, e a tela avisa que correlação não é causa. Não há campo de entregador ou funcionário na entrada, então a análise não classifica pessoas.
- **Reputação:** NPS, CSAT, nota externa e volume por unidade, marca e rede. Abaixo da amostra mínima aparece "amostra insuficiente", sem número. Avaliações importadas não entram em NPS nem CSAT.

## 10. Integrações

| Módulo | Como |
|---|---|
| Reporting (54) | `csat` e `nps` leem `fact_cx_feedback`; dataset novo e seis métricas com denominador explícito |
| Metas (55) | Valor real, ou nulo quando a amostra não basta; modelo `improve-nps` |
| Customer 360 (60) | Avaliações e recuperação no perfil |
| Journeys (61) e Marketing (37) | Eventos `cx.*`. `cx.feedback_received` não leva a nota, então convite não é filtrado. Recuperação aberta suprime jornadas |
| Atendente e Omnichannel | Resposta na conversa e reclamação viram feedback |
| Incidentes (59) e Qualidade (47) | Sinal de risco abre ocorrência |
| Marketplace (69) | Capacidades novas, desligadas por padrão |
| Workspace (53) | Quatro widgets registrados |
| Executive (33) | Só itens materiais, sem comentário de cliente |
| Copiloto | Oito ferramentas de leitura, com situação, números, temas, causas e ações |
| Automation (50) | Seis gatilhos e três ações no registro |
| Notifications (52) | Quatro fontes registradas |

## 11. UI

**Clientes · Experiência & Reputação**, em `/painel/clientes/experiencia`, com as nove subseções pedidas e os oito cards da visão geral.

## 12. RBAC, privacidade e auditoria

- Nove permissões `cx:*`. Dono e administrador têm todas; gerente vê, responde e cuida da recuperação, mas não aprova.
- Tabelas novas só com `service_role`; a rota confere tenant, loja, flag e permissão.
- Comentário mascarado sem `cx:view_sensitive`; nome do cliente e trecho de risco restritos.
- Ponto de integração para a Fase 95: `cx_settings.retention_days`. A retenção ainda não é aplicada.
- Auditoria imutável em `cx_audit_events`, espelhada em `security_audit_logs`, cobrindo respostas, compensações, pesquisas, correções e configurações.

## 13. Testes e resultados

Os testes rodam sem banco real, com um cliente Supabase em memória. Os 17 cenários obrigatórios estão em `tests/customer-experience-phase38.test.mjs`.

| Verificação | Resultado |
|---|---|
| Testes da Fase 38 | 50 de 50 |
| Suíte completa (`tests/*.test.mjs`) | 3.767 de 3.767 |
| Typecheck contra a linha de base | Sem erro novo (41 diagnósticos antigos aceitos) |
| ESLint nos arquivos tocados | 0 erros, 2 avisos |
| Build de produção | Passou |
| Segurança de migrations | Passou nos 7 arquivos |
| Varredura de segredos | Passou |
| Rotas sem login, no servidor local | API e worker respondem 401; origem inválida, 404; painel redireciona para o login |

## 14. O que não foi verificado

- **O SQL nunca rodou em um banco.** A aplicação no `masterapp-dev` foi bloqueada pela permissão do ambiente de execução, e o Docker não iniciou nesta máquina, então o `db reset` local também não rodou. O `migration-dry-run` do CI só roda no PR. Gatilhos, restrições, views e RPCs foram verificados apenas por leitura do texto.
- **Nenhuma tela foi vista com dados.** Sem as migrations, a página pública responde 404 e o envio responde 500. O painel exige login, que não foi feito.
- **O fluxo ponta a ponta não rodou:** pedido concluído, pesquisa, resposta, análise e ocorrência.
- **Nada foi testado com provedor real:** WhatsApp, modelo de IA e provedores de avaliação.
- **O worker não foi agendado.** Sem ele, pesquisas, análises e prazos não andam.

## 15. O que precisa de aprovação

1. Aplicar as 7 migrations no `masterapp-dev` e testar as telas.
2. Abrir o PR e fazer o merge depois da confirmação do dono do projeto.
3. Aplicar em produção, o que esta fase proíbe sem nova instrução.
4. Agendar o worker e definir `CUSTOMER_EXPERIENCE_WORKER_SECRET`, ou usar `CRON_SECRET`.
5. Ligar as flags por plano ou loja. Todas nascem desligadas.
6. Registrar o agente `customer_experience_assistant` na Fase 80, caso queira usar IA.

## 16. Limitações

- WhatsApp fora da janela de 24 horas não recebe pesquisa, porque não há template aprovado ligado a este fluxo.
- O envio de e-mail está no catálogo de origens, mas não foi implementado; a pesquisa é pulada com `channel_not_supported`.
- A impressão térmica do comprovante não mudou: o link é gerado no painel.
- Anônimo por QR não recebe contato, porque a página não pede telefone.
- Widgets, ações de automação e relatórios seguem o padrão das Fases 92 a 94: ficam no registro, sem executor novo. O dataset `delivery` continua sem coluna de `csat`.
- O léxico é de português e não pega ironia nem erro de digitação grave. O campo `language` é guardado, mas não muda a análise.
- Cada pedido aceita uma avaliação, por causa de `unique(order_id)`.

## 17. Recomendações

1. Ligar um adaptador oficial do Google Business Profile, que é a fonte de maior valor para reputação pública.
2. Criar template aprovado na Meta para pesquisa fora da janela de 24 horas.
3. Implantar o fluxo oficial de reembolso antes de divulgar a compensação por reembolso.
4. Agendar o worker com `?enqueue=1` de hora em hora e, sem parâmetro, a cada poucos minutos.
