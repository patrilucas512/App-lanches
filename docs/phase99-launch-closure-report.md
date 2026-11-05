# Fase 99 — Fechamento para o lançamento

Branch `claude/fase-99-fechamento-lancamento`. Sem módulos novos. Produção **só leitura** durante a fase: nada foi aplicado lá. Toda escrita em produção está na lista da seção 6, para aprovação uma a uma depois do merge.

## 1. O que mudou em cada etapa

### CI
- `error-context.md` (que traz o snapshot da página, inclusive senhas digitadas) e os `trace.zip` saíram dos artefatos do `e2e-core`. Só capturas `.png` são publicadas.
- O workflow passa as contas de garçom, cozinha, caixa e entregador e a chave do dev para os testes novos (segredos `E2E_*`; ainda não cadastrados no GitHub).

### 99A. Trava de módulo em todas as APIs
- As 27 pastas de API que faltavam checam o módulo da loja (ou da organização) e respondem `403 FEATURE_DISABLED` com o módulo desligado.
- `lib/api-module-map.ts` classifica as 95 pastas de `app/api`: 47 com módulo, 24 com checagem própria e 24 sem flag (cada uma com o motivo). Workers, webhooks e indexadores ficam fora.
- O teste varre todas as rotas: toda pasta precisa estar classificada uma vez e toda rota de módulo precisa checar a flag. Não sobrou nenhum `FORBIDDEN ? 403 : 500` que transformasse módulo desligado em erro 500.

### 99B. Leitura correta do plano
- O PostgREST devolve `subscriptions` e `plans` como objeto, não lista; o código lia `[0]` e o plano saía sempre vazio.
- `lib/plan-reading.ts` (`asList`, `firstOf`, `livePlan`, `livePlanOfStores`) foi aplicado em:
  - telas do superadmin: estabelecimentos, detalhe, pagamentos, export de relatórios;
  - APIs de integrações, marketplace e OAuth;
  - resultado da assinatura.
- Prévia: nenhuma loja, nem no dev nem em produção, usa apps, clientes de API, webhooks ou OAuth. A correção não liga nem desliga nada para ninguém.

### 99C. Alinhar loja ao plano
- Superadmin → Estabelecimentos → loja → **Alinhar loja ao plano**.
- A tela mostra primeiro a prévia, com três grupos:
  - o que some;
  - o que fica porque foi usado nos últimos 30 dias;
  - o que fica porque o plano já dá.
- Um módulo usado recentemente só sai se for marcado um a um. Aplicar exige digitar o link (slug) da loja.
- RPCs `preview_store_plan_alignment` e `align_store_to_plan`, só superadmin. O uso é medido por `private.module_usage_sources` (cerca de 44 tabelas mapeadas).

### 99D. Funções `SECURITY DEFINER` restantes
- 29 revogações:
  - as 3 do chat do site (`start_web_chat_session`, `post_web_chat_message`, `get_web_chat_history`) deixam de ser executáveis por `anon`;
  - 26 funções sem uso deixam de ser executáveis por `anon`/`authenticated`;
  - em todas, o `service_role` mantém o acesso.
- 6 ficaram como estavam, porque são chamadas por nome dinâmico.
- No dev: `anon` 20 → 17, `authenticated` 254 → 225.
- O chat do site é chamado pelo servidor como `service_role`, então o limite de frequência da 98G não vale para ele (registrado para depois do lançamento).
- Detalhe em `docs/security-definer-review.md`, seção "Fase 99D".

### 99E. Fluxos completos de ponta a ponta
Testes novos em `tests/e2e-core/staff-flows.spec.ts` e `signup.spec.ts`, rodando com as contas de verdade da equipe:
- **Garçom:** abre a mesa → lança o X-Burger → a cozinha aceita e marca pronto → o garçom fecha a conta, recebe em dinheiro e libera a mesa.
- **Caixa:** abre o turno → vende no balcão em dinheiro.
- **Entregador:**
  1. o cliente faz um pedido de delivery;
  2. a cozinha prepara;
  3. o motoboy recebe a chamada e aceita;
  4. o dono gera o código de retirada e o motoboy o confirma;
  5. o motoboy sai, chega e confirma com o PIN que o cliente vê no acompanhamento;
  6. o cliente vê "Entrega confirmada".
- **Cadastro → primeiro pedido:**
  1. conta nova;
  2. onboarding completo pela tela;
  3. loja publicada;
  4. pedido de retirada no cardápio novo;
  5. o pedido aparece no painel do dono;
  6. tudo é apagado no fim.

**Os fluxos acharam 5 defeitos que bloqueavam o piloto.** Todos foram corrigidos na causa, com teste:

| # | Defeito | Desde | Em produção hoje | Correção |
|---|---|---|---|---|
| 1 | **Garçom não abre mesa**: "null value in column organization_id of table_sessions" | Fase 42 (22/10) | sim: a última mesa aberta é de 13/09 | `20261105124000`: gatilho preenche loja e organização em todo insert de `table_sessions` |
| 2 | **Cozinha, caixa, garçom e entregador não conseguem mudar o pedido** ("Sem permissão para atualizar métricas."). O gatilho de métricas do gerente checava a permissão do Copiloto de quem fazia a ação; só o dono passava | Fase 9 | sim (mesma função, mesmo hash) | `20261105126000`: a conta vira função interna; o gatilho chama a interna e a função da tela continua exigindo permissão |
| 3 | **Marcar pronto um delivery com motoboy disponível dá erro** (`driver_availability_status_check`). A Fase 40 tirou da regra os status `offered`, `collecting` e `blocked`, que o despacho ainda grava | Fase 40 (21/10) | sim: a última entrega é de 22/09 | `20261105127000`: a regra aceita os status das duas fases |
| 4 | **Loja nova não recebe delivery** ("A entrega ainda não foi configurada"). O onboarding cria a zona, mas não `delivery_settings` | sempre | a loja atual já tem a linha (0 afetadas); a loja piloto nova cairia nisso | `20261105125000`: a primeira zona cria a configuração padrão "por bairro" e completa as lojas que já estão assim |
| 5 | **Onboarding publica a loja sem mostrar a revisão**. Ao clicar em "Continuar" na etapa Produto, o React reaproveita o botão, troca o `type` para `submit` e o navegador envia o formulário | sempre | sim | `components/onboarding-form.tsx`: chaves diferentes nos dois botões |

- **Aceite automático da cozinha (defeito 2):** a loja de produção usa impressão automática (`auto_print_kitchen = true`).
  - Nesse modo, a tela da cozinha aceita o pedido sozinha, pela mesma função `update_kitchen_ticket`, e a resposta não é mostrada.
  - Com a tela logada pelo dono, funciona.
  - **Com o login de um funcionário da cozinha, o aceite falha em silêncio e o pedido fica parado.** A migration `20261105126000` corrige isso.
  - A loja de teste do dev usa o aceite manual ("Aceitar e imprimir"), que é o modo que os testes exercitam.
- Prova no dev: `scripts/dev/phase99e-flows-check.sql` (5 de 5).
- Achados que **não** foram corrigidos estão nas seções 9 e 10.
- A loja de teste não tinha terminal de caixa. O teste cria um pela API, só no dev. **A loja piloto precisa cadastrar o terminal** em Configurações → Terminais de caixa (incluído no checklist do dia 1).

### 99F. Desempenho e legibilidade do cardápio
- **CSS por área:**
  - `app/globals.css` (carregado em todas as rotas) caiu de 420 KB para 165 KB;
  - as regras usadas só no painel e no superadmin foram para `app/painel/dashboard.css` (256 KB), importado pelo `DashboardShell` e pelo `SuperadminShell`;
  - a separação foi feita por `scripts/quality/split-dashboard-css.mjs`: uma regra só sai se nenhuma classe dela aparecer em algum arquivo alcançável pelas rotas públicas, de equipe ou de login (105 arquivos);
  - `--verify` falha se uma classe exclusiva do painel passar a ser usada fora dele; isso entrou no teste unitário.
- **Contraste**, achado pelos testes e por uma varredura WCAG feita no navegador:
  - em todas as telas de acesso (login, cadastro, onboarding, garçom, cozinha, caixa, motoboy), o texto digitado era quase branco (`#f6f7f8`) sobre o campo branco; agora é `#151515`;
  - o contador da sacola era preto sobre selo quase preto (razão 1,13); agora é branco, com 10 px;
  - "Copiar link", "Voltar" e "Ir para o painel" do onboarding estavam escuros sobre fundo escuro;
  - **checkout do cardápio no tema claro** (as cores padrão de uma loja nova): rótulos e texto digitado eram brancos sobre creme, com 17 textos abaixo do mínimo. O checkout usava as cores do tema de operação (`--op-*`), e `public-menu.tsx` fixava `--menu-surface-text` no `style`, o que vencia o `.menu-light`. Agora o checkout segue o tema do cardápio; no tema claro não sobra nenhum texto abaixo do mínimo, e no escuro só − e +, com 3,79:1 (são ícones, para os quais o mínimo é 3:1);
  - o quadro "Previsão ao cliente" do despacho tinha texto branco sobre creme, porque o tema da loja força `inherit` nos cartões de despacho;
  - o quadro "Escolher imagem da galeria" (logo, em Configurações) tinha texto claro sobre creme, por causa de `.admin-theme .field label`.
- **Fonte do cardápio:** textos de 7 a 9 px passaram a ter no mínimo 10 a 12 px:
  - descrição do produto: 12 px (11 px no celular);
  - categorias, avisos, links do topo e "Aberto agora".
- **Não feito:**
  - remover JavaScript sem uso das páginas públicas;
  - otimizar imagens (a loja de teste não tem fotos).

### 99G. Registro de erros do app
- `instrumentation.ts` (`onRequestError`) grava todo erro de rota ou API em `public.app_error_events`.
- O que é gravado:
  - rota-modelo, tipo, método, status, nome do erro;
  - mensagem mascarada: e-mail, telefone, CPF, CNPJ, chaves, `Bearer` e tokens longos;
  - impressão digital para agrupar.
- Não grava query string nem o objeto da requisição. O registro nunca derruba a resposta (2 s de limite, sem lançar erro).
- Retenção de 14 dias, apagada por `private.evaluate_pilot_alerts_and_purge()`.
- Regra nova `app_errors` na 98F: 10 erros em 15 minutos avisam só o superadmin. Prova: `scripts/dev/phase99g-errors-check.sql` (5 de 5).

### 99H. Operação da loja piloto
- **Relatar problema:** botão no canto inferior esquerdo do painel, da cozinha, do caixa e do motoboy.
  - Abre chamado na Central de Suporte com a página (sem query string e com identificadores trocados por `:id`), o horário, o navegador e o papel da pessoa.
  - Só o texto escrito vai junto; nada da tela é capturado.
  - Limite de 10 por pessoa por hora.
- **Painel do piloto** (Superadmin → Painel do piloto), só leitura. Mostra, por loja:
  - pedidos de hoje por status;
  - tempo médio de fila, preparo e entrega;
  - pedidos parados e pagamentos falhos ou pendentes;
  - impressoras;
  - alertas e relatos abertos;
  - os erros do app das últimas 24 horas.
  - Os números vêm agregados de `superadmin_pilot_overview()`, sem dado de cliente.
- `docs/loja-piloto-runbook.md` ganhou as seções 8 a 11: dia 1, primeira semana, reversão rápida e critérios de aprovação.
- Novo `docs/checklist-lancamento.md`, com ✅/⬜ e responsável por item.
- Prova: `scripts/dev/phase99h-feedback-check.sql` (10 de 10).

## 2. Resultado dos E2E

- **Homologação: não deu.** Faltam os segredos do GitHub (`E2E_*`), o `SUPABASE_SECRET_KEY` no ambiente Preview da Vercel e o bypass de proteção.
- Rodaram contra o build local (`vinext`) ligado ao `masterapp-dev`, com `E2E_BASE_URL=http://localhost:3000`.
- Com `127.0.0.1` o login da equipe falha, porque as funções de login só aceitam a origem `localhost`. Isso é configuração, não defeito.

Resultado no código final do PR:

| Grupo | Computador | Celular |
|---|---|---|
| Dono: painel, cardápio, caixa, módulo fora do plano, pedido até "pronto" (`owner.spec`) | ✅ 5 de 5 | não se aplica |
| Cardápio público: produtos, retirada com troco, mesa, portal, 404, QR, telas de acesso (`public-order.spec`) | ✅ 7 de 7 | ✅ 5 de 5 (`@mobile`) |
| Cadastro com aceite dos termos, páginas legais, **loja nova: cadastro → primeiro pedido** (`signup.spec`) | ✅ 3 de 3 | ✅ 2 de 2 |
| Login da equipe (`staff.spec`) | ✅ 4 de 4 | ✅ 4 de 4 |
| **Garçom, caixa e entregador completos** (`staff-flows.spec`) | ✅ 3 de 3 | não rodado (seção 10) |

- A suíte foi rodada várias vezes durante a fase. Cada teste passou no código final pelo menos uma vez.
- Na última rodada de dono, cardápio e cadastro nos dois projetos, ficaram 21 de 22. O que falhou foi o aceite na cozinha durante um pico do dev; depois disso o teste passou a repetir o aceite e passou (5 de 5).
- Os fluxos da equipe passaram na repetição: garçom e caixa juntos, e o entregador depois do último ajuste do teste.

Para estabilizar os testes no dev:
- Os testes repetem o clique quando a página ainda não ficou interativa.
- Uma preparação, só no dev, encerra entregas E2E deixadas por uma execução interrompida.
- Na confirmação de retirada e de entrega, o motoboy toca de novo se a primeira resposta não vier. O banco do dev estourou o tempo de 8 s sob a carga dos testes (seção 10).

## 3. Lighthouse antes/depois

**Lighthouse não foi rodado.** Ele não está instalado no projeto, e a homologação está bloqueada pelos mesmos itens da seção 2. A medição foi feita com `scripts/quality/mobile-paint-metrics.mjs`, contra o build local, 3 rodadas, mediana, no perfil celular (Pixel 7, CPU 4×, 4G lenta).

| Página | Primeira pintura antes | depois | CSS antes | depois |
|---|---|---|---|---|
| Cardápio público | 7,8 s | 9,2 s | 607 KB | 605 KB |
| Portal do cliente | 6,1 s | 7,1 s | 607 KB | 605 KB |
| Login da cozinha | 6,9 s | 8,1 s | 606 KB | 603 KB |

- **No build local, a separação não aparece.** O `vinext` junta o CSS dos componentes de servidor (inclusive o `DashboardShell`) no arquivo de entrada único.
- A variação de tempo entre as duas medições é da máquina: nada mudou no JavaScript, e o CSS baixado é o mesmo.
- **Em produção a separação vale:** a Vercel compila com `next build` e separa o CSS por rota.
  - Hoje a página inicial de produção baixa o `globals.css` inteiro: 430 KB, 82 KB comprimido.
  - Com a 99F, as rotas públicas passam a baixar cerca de 169 KB, cerca de 33 KB em gzip. É uma estimativa local com `gzip -9`.
  - O painel e o superadmin baixam os dois arquivos, como antes.
- **Metas (desempenho ≥ 80, acessibilidade ≥ 95): não verificadas.** Para medir faltam:
  - a homologação liberada, com Lighthouse no celular no cardápio, no acompanhamento e no portal;
  - remover JavaScript sem uso das páginas públicas, que é a próxima alavanca;
  - fotos reais na loja, para medir imagens.
- Na varredura de contraste do cardápio, o único texto abaixo do mínimo era o contador da sacola, já corrigido.
- **Capturas de conferência** em `docs/phase99-screens/`, geradas por `scripts/quality/phase99-screens.mjs` depois da separação:
  - cardápio e cadastro no celular;
  - painel: início, pedidos, cardápio, configurações e garçom.
  - O painel mantém o tema escuro e o layout.
  - Essas capturas acharam os dois últimos problemas de contraste (previsão do despacho e quadro do logo), corrigidos e conferidos de novo.
  - Só existe o "depois": o build anterior não foi guardado. A comparação foi feita com as capturas dos testes da rodada anterior.

## 4. Prévias de produção (só leitura)

| Item | Situação em 05/11/2026 |
|---|---|
| Lojas | 1 (no Básico, `code='MasterApp'`) |
| Limpeza do plano (`20261104132000_phase98b_plan_cleanup`) | não aplicada; a prévia da 98 mostrava 216 → 180 flags no plano |
| Alinhar a única loja ao plano (99C) | 55 flags sairiam (estão ligadas na linha da loja e fora do Básico); 161 ficam pelo plano; o único uso nos últimos 30 dias é `financial_entries` (24 registros), cujo módulo já está no Básico e fica |
| APIs de marketplace e integrações (99B) | nenhuma loja usa apps, clientes de API, webhooks ou OAuth: nada muda |
| Funções executáveis | `anon` 20, `authenticated` 254 (a 99D leva a 17 e 225) |
| Alertas do piloto | job 18 a cada 5 minutos chamando `private.evaluate_pilot_alerts()`; 0 alertas abertos |
| Última migration aplicada | `20261104235451` (98F) |
| Mesas | 7 sessões, a última de 13/09 (defeito 1 da 99E) |
| Entregas | 4, a última de 22/09 (defeito 3 da 99E) |

## 5. Migrations (todas aplicadas só no `masterapp-dev`)

| Arquivo | O que faz |
|---|---|
| `20261105120000_phase99d_remaining_definer.sql` | 29 revogações, com o `service_role` mantido |
| `20261105121000_phase99c_align_store_plan.sql` | mapa de uso, prévia e alinhamento da loja ao plano |
| `20261105122000_phase99g_app_error_log.sql` | `app_error_events`, retenção de 14 dias e regra `app_errors` |
| `20261105123000_phase99h_pilot_feedback.sql` | `report_pilot_problem` e `superadmin_pilot_overview` |
| `20261105124000_phase99e_table_session_scope.sql` | defeito 1 (abrir mesa) |
| `20261105125000_phase99e_delivery_settings_default.sql` | defeito 4 (delivery em loja nova); completa as lojas sem a linha (produção: 0) |
| `20261105126000_phase99e_order_metrics_trigger.sql` | defeito 2 (equipe muda o pedido) |
| `20261105127000_phase99e_driver_availability_status.sql` | defeito 3 (despacho do motoboy) |

As 8 passam no `scripts/quality/migration-safety.mjs`.

## 6. O que precisa de aprovação para ir a produção, em ordem

**Situação em 05/11/2026:** os itens 2 a 13 foram aprovados pelo dono ("Autorizo 2 a 12, plano piloto"; depois "Aplicar os 161") e aplicados na produção um a um. Cada um foi conferido em seguida, em transações desfeitas no fim, sem gravar pedido, mesa ou relato de teste. As migrations foram aplicadas antes do merge porque só mexem no banco e funcionam com o código que já estava no ar.

| Item | Versão em produção | Conferência |
|---|---|---|
| 2 `phase99e_order_metrics_trigger` | `20261105074702` | cozinha muda o pedido; a tela de métricas continua exigindo permissão |
| 3 `phase99e_table_session_scope` | `20261105074749` | mesa abre com loja e organização |
| 4 `phase99e_driver_availability_status` | `20261105074817` | `offered` e `collecting` aceitos |
| 5 `phase99e_delivery_settings_default` | `20261105074840` | gatilho ativo; entrega da loja intacta (taxa fixa) |
| 7 `phase99g_app_error_log` | `20261105074941` | tabela só do servidor; 7 regras |
| 6 `phase99h_pilot_feedback` | `20261105075035` | painel e relato funcionando (aplicada depois da 7, porque o painel lê a tabela de erros) |
| 8 job `masterapp-pilot-alerts` (18) | `evaluate_pilot_alerts_and_purge()` | execução das 07:55 UTC com sucesso |
| 9 `phase99c_align_store_plan` | `20261105075155` | prévia funcionando |
| 10 `phase99d_remaining_definer` | `20261105075258` | `anon` 20 → 17, `authenticated` 254 → 229 (com as 4 funções novas da 99C e da 99H) |
| 11 `phase98b_plan_cleanup` | `20261105075337` | Piloto 18, Básico 20, Profissional 63, MasterApp 178 módulos |
| 13 MARIAH EL no plano Piloto | `subscriptions.plan_id` | `trialing` mantido |
| 12 alinhar a MARIAH EL ao Piloto | `align_store_to_plan` | 161 desligados, financeiro mantido por uso; núcleo ligado |

Itens que continuam pendentes: o 14 (chaves VAPID), além dos que só o dono pode fazer (seção 8).

Lista original de aprovação:

Cada item é uma aprovação separada. Só depois do merge do PR (o merge publica o código).

1. **Merge do PR da Fase 99** (publica o código na Vercel).
   - Até o item 5, o botão "Relatar problema" mostra erro ao enviar.
   - Até o item 8, a tela "Alinhar loja ao plano" e o painel do piloto mostram erro ao carregar.
   - O registro de erros falha em silêncio até o item 6.
2. `20261105126000_phase99e_order_metrics_trigger`: sem ela, a equipe não muda pedido.
3. `20261105124000_phase99e_table_session_scope`: sem ela, o garçom não abre mesa.
4. `20261105127000_phase99e_driver_availability_status`: sem ela, o despacho do motoboy quebra ao marcar pronto.
5. `20261105125000_phase99e_delivery_settings_default`: delivery em loja nova; 0 linhas completadas em produção.
6. `20261105123000_phase99h_pilot_feedback`: "Relatar problema" e painel do piloto.
7. `20261105122000_phase99g_app_error_log`: registro de erros e regra `app_errors`.
8. Trocar o job `masterapp-pilot-alerts` para `private.evaluate_pilot_alerts_and_purge()` (`scripts/dev/pilot-alerts-cron.sql`). Só depois do item 7.
9. `20261105121000_phase99c_align_store_plan`: tela "Alinhar loja ao plano".
10. `20261105120000_phase99d_remaining_definer`: as 29 revogações.
11. Limpeza dos planos `20261104132000_phase98b_plan_cleanup`. O controle de permissões da sessão bloqueou na 98; rodar no SQL Editor de produção ou liberar.
12. Alinhar a MARIAH EL LANCHES (loja piloto) ao plano, pela tela do item 9, depois de ver a prévia. Prévia de hoje: 55 flags saem, nenhum módulo usado recentemente sai.
13. Vincular a MARIAH EL LANCHES ao plano Piloto, se essa for a escolha, ou mantê-la no Básico alinhado (Superadmin → Estabelecimentos).
14. Par de chaves VAPID do push, nas variáveis da Vercel.

## 7. Checklist de lançamento

Status atual em `docs/checklist-lancamento.md`. Resumo:
- **Código:** ✅ 99A a 99H no PR; ⬜ revisão e merge.
- **Produção:** ✅ Fase 98, exceto a limpeza de planos; ⬜ itens 2 a 14 da seção 6.
- **Homologação:** ⬜ segredos do GitHub, `SUPABASE_SECRET_KEY` no Preview, bypass, Vault do dev.
- **Antes do dia 1:** ⬜ termos e política publicados, canal do titular, forma de pagamento, cadastro da loja com terminal de caixa e zona de entrega, teste de fumaça.
- **Depois do lançamento:** ⬜ privacidade da 96, limite do chat do site, critérios de aprovação do piloto.

## 8. O que você precisa fazer antes do primeiro dia do piloto

**Loja piloto escolhida em 05/11/2026: MARIAH EL LANCHES**, a loja que já está em produção (`app-lanches`, nome interno "App Lanches", plano Básico em período de teste). Hoje ela já tem 1 zona de entrega, 1 terminal de caixa, 6 produtos ativos e a configuração de entrega. A impressão automática da cozinha está ligada, então a tela da cozinha precisa da migration `20261105126000` (item 2 da seção 6) para funcionar com o login de um funcionário.

1. Revisar e fazer o merge do PR. Depois aprovar, uma a uma, as migrations dos itens 2 a 7 da seção 6. As quatro da 99E são as que destravam garçom, cozinha, caixa e entregador.
2. Decidir o plano da loja piloto (Piloto ou Básico alinhado) e aprovar os itens 11 a 13.
3. Publicar os textos definitivos dos termos e da política de privacidade. Hoje são rascunho, com a faixa "RASCUNHO".
4. Definir a forma de pagamento do piloto. Para Pix online, a loja cadastra a credencial de produção.
5. Com a loja:
   - cadastro e cardápio;
   - **zona de entrega**;
   - **terminal de caixa** (Configurações → Terminais de caixa);
   - equipe com acesso ativado;
   - impressora;
   - teste de fumaça (runbook, seções 2, 3 e 8).
6. Opcional, mas recomendado: cadastrar os segredos `E2E_*` no GitHub, o `SUPABASE_SECRET_KEY` no Preview e o bypass. Assim os fluxos desta fase rodam na homologação a cada PR.

## 9. Depois do lançamento

- **Privacidade (Fase 96), não bloqueia, porque o módulo está desligado:**
  - executor em massa da retenção;
  - prévia das políticas `privacy.*`;
  - buckets;
  - nomear o encarregado.
- **Chat do site:** limite de frequência na rota, porque o da 98G não vale quando o servidor chama como `service_role`.
- **Remover JavaScript sem uso das páginas públicas** e medir o Lighthouse na homologação (seção 3).
- **Desempenho do banco:**
  - espalhar os horários dos jobs do `pg_cron`, que hoje disparam juntos a cada minuto e a cada 5 minutos;
  - investigar as funções de painel mais pesadas, `get_manager_copilot_snapshot*` e `update_kitchen_ticket`, que no dev chegaram a 7 a 8 s (seção 10).
- **Erro de hidratação do React (#418)** na tela de mesas do garçom: texto diferente entre servidor e navegador, provavelmente data ou hora. Não quebra o fluxo.
- **Mensagem "Sem permissão para atualizar métricas."** que aparecia na cozinha: some com a 99E. Se voltar, aparece nos erros do app.
- Critérios de aprovação do piloto: runbook, seção 11.

## 10. Limitações

- E2E e medições só contra o build local + `masterapp-dev`; nada na homologação (seção 2). Lighthouse não foi rodado (seção 3).
- Os fluxos completos rodaram no **computador**. No celular rodaram os testes marcados `@mobile`, incluindo cadastro → primeiro pedido e os de cardápio e login. Os fluxos longos de garçom, caixa e entregador não foram repetidos no celular, porque juntos passam de 10 minutos por execução no dev. Para rodá-los também no celular, basta marcar os testes com `@mobile` quando a homologação estiver liberada.
- **O banco do dev para por alguns segundos a cada 5 minutos.** Cerca de 15 jobs do `pg_cron` disparam juntos; vários chamam a homologação e falham. Nas últimas 3 horas, todos tiveram picos de cerca de 18 s, e o de alertas do piloto chegou a 40 s (média de 4,6 s). Quem cai nessa janela estoura o limite de 8 s: a cotação de entrega, o envio do pedido e a confirmação de retirada estouraram uma vez cada nos testes. Isoladas, essas funções levam 0,1 a 0,5 s (alertas 0,14 s, cotação 0,44 s, pedido 0,5 s em média). Um estouro desfaz a transação e a tela mostra o erro; nos testes, o cliente e o motoboy tocam de novo. Em produção há menos jobs, mas o mesmo desenho (muitos jobs no mesmo minuto). Vale espalhar os horários e acompanhar pelo registro de erros da 99G no piloto (seção 9).
- **Ordem do CSS no painel:** as regras que foram para o `dashboard.css` passam a vir depois das que ficaram no `globals.css`. Quando duas regras de mesma força se aplicam ao mesmo elemento do painel, a ordem pode mudar o resultado. As capturas da seção 3 conferem as telas principais; outras telas do painel podem ter diferenças pequenas.
- O superadmin não foi conferido na tela: o dev não tem conta superadmin. As provas SQL marcam um perfil temporário e desfazem.
- A separação do CSS é feita por um script e por análise estática. Uma classe montada em tempo de execução, fora do padrão `` `prefixo-${x}` ``, não é detectada.
