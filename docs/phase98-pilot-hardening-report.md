# Fase 98: Endurecimento para a loja piloto, relatório

Data: 04/11/2026. Branch `claude/fase-98-endurecimento-piloto`. Tudo aplicado e testado só no `masterapp-dev`.
**Nada foi escrito em produção.**

## 0. Pré-requisitos (o que mudou desde a Fase 97)

Conferido em 04/11/2026, só nomes, sem valores:
- **GitHub:** nenhum segredo cadastrado (`VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD` faltam). A `main` não tem regra de proteção.
- **Vercel (Preview):** só a URL e a chave pública do dev, `MASTERAPP_ENVIRONMENT=staging` e `NEXT_PUBLIC_SITE_URL`. **Falta `SUPABASE_SECRET_KEY` do dev** e o Protection Bypass.
- **Vault do dev:** só `masterapp-phase20-worker`. **Faltam** `cx_worker_secret`, `privacy_worker_secret` e `vercel_bypass_secret`. O alerta novo de taxa de erro (98F) já acusa: 100% das chamadas dos workers do dev voltam 401.

Por isso o E2E e o Lighthouse rodaram contra o **build local** ligado ao `masterapp-dev`, não na homologação.

## 1. O que mudou em cada etapa

### 98A. Flags só dentro do plano
- `authenticated` não grava mais direto em `store_feature_flags` (políticas `store_flags_admin_*` removidas). Nenhuma tela gravava por esse caminho.
- RPC `set_store_feature_flags`: superadmin ajusta qualquer flag; dono e gerente só **ligam** o que o plano permite (mais as chaves da loja `delivery_enabled`, `whatsapp_enabled`, `ai_enabled`). Desligar é livre. Erro `FLAG_OUTSIDE_PLAN`.
- Auditoria de toda gravação (RPC, servidor, billing) em `store_feature_flag_audit`, com autor e tipo de autor.
- **Achado e corrigido:** `private.has_store_access` foi revogada de `authenticated` na Fase 7, mas é usada nas políticas de leitura de `store_feature_flags`, `channels`, `store_service_areas` e `web_chat_widget_configs`. Todo usuário logado recebia "permission denied" nessas tabelas.
- Prova: `scripts/dev/phase98a-flags-check.sql`, 15 de 15 (dono pela API recusado, por RPC fora do plano recusado, funcionário e outra loja recusados, anon sem acesso, superadmin e `service_role` aceitos, auditoria).

### 98B. Plano Piloto e limpeza dos planos
- Plano **Piloto** (`code = 'piloto'`): 18 módulos do núcleo, sem preço (0), fora da vitrine (`is_public = false`), sem limite de equipe, produtos ou pedidos, 1 unidade.
- **Dois furos fechados:** `create_establishment` escolheria o Piloto como plano padrão do cadastro em produção (escolhe por `sort_order` quando não há plano `starter`); `preview_saas_plan_change` deixaria o dono se mudar sozinho para o Piloto. Os dois exigem `is_public` (o superadmin pode).
- Itens de menu sem flag ganharam flag: Inteligência, Analytics, Unidades, CRM, Integrações, Orquestração. Caixa de Entrada usa `omnichannel_inbox_enabled`; Chamados (garçom) usa `waiter_mode_enabled`. Quatro colunas que o menu lia **sem existirem** (Digital Twin, Arquitetura, Mudanças, Process Intelligence) foram criadas. Nos planos atuais nascem ligadas (compatível).
- Linhas novas de `store_feature_flags` deixam de nascer com cerca de 165 módulos ligados (o padrão das colunas controladas pelo plano virou `false`). As linhas existentes não foram tocadas.
- Limpeza de Básico e Profissional em migration **separada** (`20261104132000`), com prévia só de leitura (`scripts/dev/phase98b-plan-preview.sql`).
- As regras do menu saíram do componente para `lib/menu-entitlements.ts` (dados testáveis).

### 98C. Módulo desligado com mensagem clara
- Componente padrão `ModuleUnavailable`: nome do módulo e motivo ("não faz parte do plano" ou "desligado para esta loja"). Mostra "Ver planos" para o dono e "Fale com o responsável pela loja" para os demais.
- Telas: o `DashboardShell` mostra o aviso quando a tela aberta é de um módulo desligado (cobre as 70+ telas com flag). As 36 telas que voltavam em silêncio para o painel agora vão para `/painel/modulo-indisponivel?m=<módulo>`. A Home personalizada continua caindo no `/painel`, de propósito.
- APIs: 16 rotas de módulo respondem `403 {"error":"FEATURE_DISABLED","module":...}` (antes respondiam 500 ou não travavam); as 5 que já travavam usam o mesmo código.
- **Causa raiz achada pelo E2E:** o painel lia `subscriptions[0].plans[0]`, mas o PostgREST devolve as duas relações como objeto. O plano ficava sempre nulo, e o menu e as telas ignoravam o plano, inclusive a correção de menu da Fase 97, que só tinha teste unitário.
- **Pendência:** 27 pastas de API de módulo ainda não conferem a flag quando chamadas direto (lista na seção 10). As telas delas já mostram o aviso.

### 98D. Contas de funcionário e E2E
- **Achado e corrigido (provavelmente também em produção):** o login de funcionário por nome falhava sempre. A ativação cria o usuário com o telefone normalizado (`55` + DDD), mas a busca do login montava o e-mail com os dígitos crus. Correção na migration `20261104134000`, sem mexer nas funções do Supabase.
- Seed: garçom, cozinha, caixa e entregador criados pelo caminho da tela do dono e ativados pela função de ativação real; loja de teste no plano Piloto.
- E2E novos: login de garçom, cozinha, caixa e entregador (desktop e celular); cadastro de loja nova até o onboarding, confirmando o e-mail pela API **só no dev**.
- O Supabase Auth recusa e-mails de domínio reservado (`.test`). Sem `E2E_SIGNUP_EMAIL_DOMAIN` (um domínio seu), a tela prova que o aceite é obrigatório e a conta é criada pela API do dev com os mesmos metadados do formulário; com ele, o cadastro inteiro passa pela tela.
- **Não feito:** os fluxos completos de cada papel (abrir mesa, lançar e chamar; abrir, receber e fechar caixa; despacho, coleta, rota, PIN, encerramento e repasse) e o onboarding até o primeiro pedido. Ficam para a Fase 99 (seção 11).

### 98E. Push por ambiente
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (app) e `VAPID_PUBLIC_KEY` (função `send-push-notification`). Sem a variável, a chave atual só vale quando o banco é o de produção; em dev e homologação o push fica desligado em vez de inscrever com uma chave sem par.
- Instruções do par do dev em `docs/ambientes.md`. O dev não tinha chave privada VAPID, então o push no dev já não funcionava.
- **Não feito:** o teste de inscrição na homologação depende do par VAPID do dev e do bypass. Há teste unitário da escolha da chave.

### 98F. Alertas automáticos
- `private.evaluate_pilot_alerts()` roda no banco (pg_cron a cada 5 min) e cobre pedido parado, pagamento falho, pagamento pendente, rotina parada, impressora sem sinal e taxa de erro.
- Um alerta aberto por chave; o aviso só se repete depois do cooldown da regra; o alerta se resolve sozinho quando o sinal some.
- Avisa o superadmin (central de notificações, domínio `platform`, e a tela nova `/superadmin/alertas`) e o dono (central da loja) quando a regra pede.
- Regras configuráveis em `pilot_alert_rules` (limite, janela, cooldown, avisar o dono).
- "Rotina parada" usa o intervalo real de cada job, para não alarmar jobs de hora em hora. Para os workers, 401 conta como erro.
- Limitação: os erros de servidor da Vercel não ficam no banco (plano Hobby, 1 h de log); a taxa de erro mede só as chamadas dos workers e da API pública.
- Prova: `scripts/dev/phase98f-alerts-check.sql`, 9 de 9. Agendado só no dev (`scripts/dev/pilot-alerts-cron.sql`).

### 98G. Funções SECURITY DEFINER
Tabela completa em `docs/security-definer-review.md`. Resumo no dev:

| | Antes | Depois |
|---|---|---|
| Executáveis por `anon` | 22 | 20 |
| Executáveis por usuário logado | 274 | 254 |
| Sem `search_path` fixo | 0 | 0 |

- **Lote 1:**
  - `anon` revogado de `place_public_order` (v1, sem uso) e de `set_store_open` (exige login);
  - limite de frequência no pedido público (30 por IP e 600 por loja a cada 10 min), no chat do site e nos eventos de visita.
  - Conferido que as funções públicas de leitura não devolvem nome, telefone nem endereço de cliente.
- **Lote 2:** `EXECUTE` revogado de usuário logado em 19 funções internas; o `service_role` mantém o acesso.
- 32 funções "sem chamada direta encontrada" foram só apontadas (algumas são chamadas por nome dinâmico); nada apagado.

### 98H. Desempenho do cardápio
Medido com `scripts/quality/mobile-paint-metrics.mjs` (Chromium do Playwright, Pixel 7, CPU 4×, 4G lenta), contra o build local, 3 rodadas, mediana:

| Página | Primeira pintura | CSS | JS |
|---|---|---|---|
| Cardápio público | 7,6 s | 605 KB | 606 KB |
| Portal do cliente | 6,1 s | 605 KB | 380 KB |

- O build local (`vinext`) serve sem compressão e junta todo o CSS num arquivo de 604 KB, que comprimido tem 107 KB em gzip e 85 KB em brotli. A Vercel compila com `next build` e comprime, então estes números são o **pior caso**.
- **Não feito:**
  - medir na homologação (falta o bypass);
  - separar o `app/globals.css` (419 KB) por rota;
  - corrigir contraste e fonte do cardápio (sem Lighthouse ou axe instalados, não dá para medir a nota de acessibilidade).
- Antes/depois: só o "antes" existe; não houve mudança de desempenho. A separação do CSS é a maior alavanca e fica para a Fase 99, com medição na homologação antes e depois.

### 98I. Páginas legais
- `/termos`, `/privacidade` (lojista), `/termos-cliente`, `/privacidade-cliente` (cliente final). Modelo com marcadores, coerente com as Fases 95/96. Faixa "RASCUNHO, NÃO DEFINITIVO" e fora dos buscadores.
- Links no rodapé do site, no cadastro, no cardápio público e no portal do cliente.
- O cadastro exige a caixa "Li e aceito". O banco grava versão e data do servidor em `legal_acceptances`, por um gatilho em `auth.users`.

## 2. Flags fora do plano em produção (só leitura)

**Não verificado.** A leitura de `store_feature_flags` × planos em produção foi bloqueada pelo controle de permissões desta sessão. A leitura dos planos passou: são 3, e o código não segue o nome (o Básico tem `code = 'MasterApp'`). Pela Fase 97, a única loja de produção tinha 162 flags ligadas na própria linha, a maioria fora do plano. A consulta está pronta em `scripts/dev/phase98b-plan-preview.sql`, só leitura.

## 3. Planos novos e prévia nas lojas de produção

| Nível | Módulos |
|---|---|
| Piloto | núcleo, 18 (lista em `lib/plan-tiers.ts`) |
| Básico | núcleo + cupons do cliente + repetir pedido (20) |
| Profissional | Básico + 43 (estoque, financeiro, fiscal, reservas, fidelidade, equipe, relatórios avançados, CRM, integrações, inbox, IA de cardápio etc.) |
| MasterApp (Premium) | mantém tudo e ganha as 10 flags avançadas de entrega e previsão |

- **Prévia no dev:** a loja de teste passaria de 228 para 192 módulos (as linhas da própria loja seguram o resto, porque a regra é "plano OU loja").
- **Conclusão:** limpar os planos não encurta o menu das lojas que já existem. Para isso é preciso também limpar a linha de `store_feature_flags` da loja (decisão separada).
- Uma loja **nova** no Piloto, cadastrada pelo `/cadastro`, nasce sem linha e vê só os 18 itens do núcleo no menu (teste "plano Piloto mostra só o núcleo").
- Prévia de produção: pendente da mesma permissão de leitura da seção 2.

## 4. Resultado dos E2E

Rodada final (04/11/2026), contra o build local e o `masterapp-dev`, depois de todas as migrations da 98: **28 de 28** (desktop e celular). Cobre o núcleo da Fase 97, o módulo fora do plano (tela, menu e API), o login dos quatro papéis da equipe, o cadastro com aceite até o onboarding e as páginas legais.

Unitários: `tests/unit` com 93 testes passando (mais os de `legal-pages`); a bateria completa `tests/*.test.mjs` passou com os testes antigos ajustados ao novo lugar das regras do menu. Typecheck sem erros novos. Lint sem erros.

## 5. Tabela da revisão SECURITY DEFINER

Em `docs/security-definer-review.md`.

## 6. Lighthouse antes/depois

Ver 98H. Só o "antes" (medição equivalente, sem Lighthouse).

## 7. Migrations

| Arquivo | Dev (versão) | Muda o que as lojas veem? |
|---|---|---|
| `20261104130000_phase98a_flags_within_plan` | `20261104044405` e `20261104044759` (reaplicada) | não |
| `20261104131000_phase98b_pilot_plan` | `20261104045618` | não (compatível) |
| `20261104132000_phase98b_plan_cleanup` | `20261104051436` | **sim** (Básico e Profissional) |
| `20261104133000_phase98f_pilot_alerts` | `20261104060250` | não |
| `20261104134000_phase98d_employee_login_phone` | `20261104060932` | conserta o login da equipe |
| `20261104135000_phase98g_public_functions` | `20261104061429` | limite de pedidos por IP |
| `20261104136000_phase98g_internal_functions` | `20261104062108` | não |
| `20261104137000_phase98i_legal_acceptance` | `20261104063100` | não |

No dev, a função `pilot_alert_signals` e a `public_rate_allow` foram corrigidas depois de aplicadas (o arquivo já tem a versão final); o Piloto do dev recebeu os limites finais por `update`.

## 8. O que precisa de aprovação para ir a produção (em ordem, uma a uma)

**Atualização de 04/11/2026:** os itens 1, 2 e 3 foram aplicados em produção com aprovação. Versões: `20261104222401`, `20261104222503` e `20261104222612`. Cada um foi conferido logo depois, só lendo:
- as 4 contas da equipe são encontradas pelo login;
- o dono lê as flags da loja e não grava direto;
- o Piloto está fora da vitrine;
- o cadastro continua no Básico.

O próximo item da fila é o merge do PR.

1. **Migration `20261104134000_phase98d_employee_login_phone`.** Urgente: sem ela, ninguém da equipe entra pelo nome. Só troca a função de busca.
2. **Migration `20261104130000_phase98a_flags_within_plan`.** Trava as flags e conserta a leitura das políticas.
3. **Migration `20261104131000_phase98b_pilot_plan`.** Cria o Piloto e as flags do menu; compatível.
4. **Merge do PR.** Publica o código; precisa das migrations 2 e 3 antes, por causa das colunas novas do menu.
5. **Migration `20261104135000_phase98g_public_functions`.**
6. **Migration `20261104136000_phase98g_internal_functions`.**
7. **Migration `20261104137000_phase98i_legal_acceptance`.** Só depois de aprovar o texto dos termos, ou mantendo o rascunho visível.
8. **Migration `20261104133000_phase98f_pilot_alerts`** e depois o **agendamento** (`scripts/dev/pilot-alerts-cron.sql` no SQL de produção).
9. **Variáveis em Production:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` com a chave atual, e o segredo `VAPID_PUBLIC_KEY` na função `send-push-notification`, que precisa ser republicada.
10. **Migration `20261104132000_phase98b_plan_cleanup`.** Muda o Básico e o Profissional. Rodar antes a prévia de produção.
11. **Vincular a loja piloto ao plano Piloto** (Superadmin) e decidir se a linha de `store_feature_flags` dela começa limpa.

## 9. O que você ainda precisa decidir ou cadastrar

- **Liberar a leitura de produção** para as seções 2 e 3, ou rodar você mesmo `scripts/dev/phase98b-plan-preview.sql` no SQL Editor de produção (só leitura).
- **Cadastrar** (`docs/ambientes.md`):
  - `SUPABASE_SECRET_KEY` do dev em Preview;
  - Protection Bypass;
  - os segredos do Vault do dev;
  - no GitHub: `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_OWNER_*`, `E2E_WAITER/KITCHEN/CASHIER/DRIVER_NAME/PASSWORD` e `E2E_SUPABASE_SECRET_KEY` (a chave secreta **do dev**);
  - o par VAPID do dev.
- **Textos legais:** aprovar ou mandar ao jurídico; preencher os marcadores (razão social, CNPJ, encarregado).
- **Planos:**
  - os níveis da seção 3;
  - o Piloto sem limites;
  - o atendente de IA continuar como chave da loja (hoje aparece para o Piloto quando a loja não desliga).
- **Preço** do Piloto (ficou 0 e fora da vitrine).

## 10. Limitações

- E2E e medição contra o build local, não a homologação.
- 98C: 27 pastas de API de módulo ainda não conferem a flag quando chamadas direto:
  - `app/api/asset-management`, `app/api/customer-journeys`, `app/api/customer-subscriptions`
  - `app/api/document-compliance`, `app/api/enterprise-architecture`, `app/api/enterprise-portfolio`
  - `app/api/fiscal`, `app/api/food-quality`, `app/api/forecasting`, `app/api/franchise-finance`
  - `app/api/hardware-hub`, `app/api/incidents`, `app/api/integrated-business-planning`, `app/api/knowledge`
  - `app/api/learning`, `app/api/marketing-intelligence`, `app/api/marketplace-integrations`, `app/api/master-data`
  - `app/api/network-governance`, `app/api/offline`, `app/api/performance-management`, `app/api/process-intelligence`
  - `app/api/procurement-intelligence`, `app/api/profitability`, `app/api/transport-management`, `app/api/vendor-management`
  - `app/api/workforce-planning`
- Mesmo padrão `subscriptions[0]`/`plans[0]` ainda em telas do superadmin (`estabelecimentos`, export de relatórios) e em `app/api/marketplace/manage` e `app/api/integrations/manage` (`plans?.length` num objeto, que provavelmente sempre nega). Não corrigi: nas duas APIs a correção **ligaria** recursos.
- As capturas de erro do Playwright (`error-context.md`) guardam o valor digitado nos campos, inclusive a senha de teste. O CI precisa não publicar esse arquivo como artefato.
- 98D e 98H parciais (fluxos completos e CSS).

## 11. Recomendações para a Fase 99

Pendências da Fase 96:
1. Executor em massa da retenção de privacidade.
2. Prévia de impacto das políticas `privacy.*`.
3. Buckets de documentos de funcionário e de evidências de entrega.

Da Fase 98:

4. Separar o `app/globals.css` por rota, medindo na homologação antes e depois; contraste e fonte do cardápio com Lighthouse.
5. E2E dos fluxos completos de garçom, caixa, cozinha e entregador, e do onboarding até o primeiro pedido.
6. Trava de flag nas 27 APIs restantes.
7. Corrigir a leitura de plano no superadmin e nas APIs de marketplace e integrações (com prévia do que liga).
8. Revisar as 32 funções sem chamada direta e revogar `anon` do chat do site (o app chama pelo servidor).
9. Limpeza das linhas de `store_feature_flags` das lojas existentes, com prévia, para o menu refletir o plano.
10. Log de erros do app no banco ou log drain, para o alerta de taxa de erro cobrir as rotas da Vercel.
