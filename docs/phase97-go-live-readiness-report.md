# Fase 97: Go-Live Readiness, relatório

Data: 03–04/11/2026. Branch `claude/fase-97-go-live-readiness`.

## 1. Ambientes e o que mudou na Vercel

Detalhes em `docs/ambientes.md`.

**Mudanças na Vercel**, com o plano aprovado pelo usuário em 03/11/2026 ("Aprovo o plano"):
- `NEXT_PUBLIC_SUPABASE_URL` e `MASTERAPP_ENVIRONMENT` passaram a valer só para **Production**. Antes valiam também para Preview, então uma prévia apontaria para o banco de produção.
- Criadas para **Preview**: `NEXT_PUBLIC_SUPABASE_URL` (masterapp-dev), `MASTERAPP_ENVIRONMENT=staging` e `NEXT_PUBLIC_SITE_URL` (endereço da homologação).
- Criada para Preview a chave **pública** do masterapp-dev (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Sem ela, **todas as prévias falhavam no build** desde a criação do projeto.

**Homologação:**
- Branch `staging` criada; endereço fixo `https://app-lanches-git-staging-lucas-patrick.vercel.app`. As prévias já sobem (antes: sempre em erro).
- A integração Supabase ↔ Vercel grava as chaves só em Production e não foi alterada.

**No código:**
- **Faixa "HOMOLOGAÇÃO"** quando `MASTERAPP_ENVIRONMENT=staging`.
- **Trava no `next.config.ts`:** o build da prévia para se apontar para o banco de produção, usar chave JWT de produção, Stripe live, faltar o `staging` ou faltar as chaves públicas.

## 2. Workers no dev

- `scripts/dev/staging-workers.sql` agenda no `pg_cron` do masterapp-dev os workers das Fases 20, 38, 57, 93 e de privacidade, apontando para a homologação. Os tokens e o bypass são lidos do Vault na hora da chamada.
- Aplicado em 03/11/2026. O job da Fase 20 no dev ainda chamava o endereço antigo do app (ChatGPT Sites).
- **Pendente do usuário:** criar no Vault do dev `cx_worker_secret`, `privacy_worker_secret` e `vercel_bypass_secret` (SQL pronto em `docs/ambientes.md`). A gravação no Vault foi bloqueada para o agente. Até lá, os workers do dev recebem 401 ou a tela de login da Vercel; não foi possível validar que rodam.

## 3. Inventário do núcleo e das flags

`docs/nucleo-e-flags.md`:
- 14 fluxos essenciais com telas, rotas e o que os liga;
- 340 flags com fase e estado em produção (lido sem escrever);
- proposta de núcleo por plano.

Achados:
- **O menu do painel ignorava as flags da loja.**
- **O Básico tem 138 módulos fora do núcleo ligados.**
- `order_tracking_enabled` e `customer_portal_enabled` existem mas nenhuma tela as lê.

## 4. Testes de ponta a ponta

Playwright (`playwright.config.ts`, `tests/e2e-core/`), projetos **desktop** e **mobile** (Pixel 7).

**Onde roda:** no CI, contra a prévia de cada commit (`.github/workflows/e2e-core.yml`, disparado pelo `deployment_status` da Vercel). Localmente, contra `vite preview` do build. A guarda em `tests/e2e-core/env.ts` recusa os endereços de produção.

| Fluxo | Desktop | Mobile |
|---|---|---|
| Cardápio público (loja, produtos, preços, aberto) | ✅ | ✅ |
| Pedido de retirada em dinheiro com troco + acompanhamento | ✅ | ✅ |
| Pedido na mesa | ✅ | ✅ |
| Portal do cliente abre | ver nota | ver nota |
| QR leva ao cardápio | ✅ | — |
| Telas de acesso de garçom, cozinha, caixa e entregador | ✅ | ✅ |
| Dono entra e vê o painel | ✅ | — |
| Cardápio no painel do dono | ✅ | — |
| Caixa abre para o dono | ✅ | — |
| Pedido do cliente → aparece no painel → cozinha aceita e marca pronto → cliente vê "PRONTO!" | ✅ | — |

Resultado: 15 de 15 passaram na última rodada local (seção "Resultado da bateria").

**Falhas encontradas e corrigidas** (um commit cada, com teste):
1. **Loja nova recusava todo pedido** ("Estabelecimento indisponível").
   - Causa: sem linha em `service_modes`, que só nascia quando o dono mexia nas configurações de atendimento; o cardápio mostrava "Aberto agora" pelo valor de reserva da tela.
   - Correção: migration `20261104120000_phase97_default_service_mode` (gatilho em `establishment_settings` + preenchimento das lojas antigas), aplicada no dev.
   - Produção: aplicada com aprovação em 04/11/2026 (versão `20261104030018`); a única loja já tinha a linha, nada foi preenchido.
2. **Link "Minha conta" levava a 404** em loja sem portal configurado. Agora só aparece quando o portal abre.
3. **Login de funcionário bloqueado em produção** (achado na 97F): as funções `employee-login` e `activate-*-access` só aceitavam o endereço antigo do app. Corrigido e **publicado em produção com aprovação** em 03/11/2026.

**Seed ampliado** (`scripts/dev/seed-dev.mjs`):
- loja aberta todos os dias (o horário 18h–23h, fechado no domingo, fazia o E2E depender da hora);
- portal do cliente ligado.

Limpeza dos pedidos que o E2E deixa: `scripts/dev/clean-e2e-orders.sql`.

**Não cobertos por E2E nesta fase:**
- **Pedem contas de funcionário de teste:** garçom, caixa e entregador logados (o seed não cria essas contas; o login depende das funções do Supabase, agora publicadas no dev) e despacho, rota e repasse do entregador.
- **Pedem chaves:** Pix embutido (gateway de teste), push (VAPID do dev), WhatsApp (Meta de teste), cobrança do SaaS (Stripe de teste).
- **Exige confirmação por e-mail:** cadastro de loja nova e onboarding completo.

**Check obrigatório:**
- O workflow só roda depois de estar na `main`, porque o evento `deployment_status` usa o arquivo da branch padrão.
- Também precisa dos segredos `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_OWNER_EMAIL` e `E2E_OWNER_PASSWORD` no GitHub.
- Por isso a regra de proteção da `main` (check `e2e-core` obrigatório) fica para depois do merge e do cadastro dos segredos. Marcar antes travaria todos os PRs.

**Cuidado com o que o CI guarda:** as capturas de erro do Playwright incluem o valor digitado nos campos, inclusive a senha de teste. O CI desliga o trace e só envia as imagens (onde a senha aparece como pontos).

## 5. Checklist de integrações

`docs/integracoes-checklist.md`. O usuário precisa cadastrar:
1. `SUPABASE_SECRET_KEY` do masterapp-dev em Preview (sem ela: login por senha e rotas de servidor desligados na homologação);
2. Protection Bypass for Automation (Vercel) e os segredos do GitHub;
3. chaves de teste opcionais: Stripe, OpenAI, gateway Pix (sandbox), WhatsApp (número de teste), par VAPID do dev.

Sem chave, cada recurso fica desligado com mensagem (conferido no código: Stripe, OpenAI, gateway, portal, admin). Exceção: **push na homologação**, porque a chave pública VAPID está fixa no código e é a de produção.

## 6. Experiência do dono

**Feito:**
- O menu do painel junta as flags da loja com as do plano, como os módulos já faziam.
- Entregas, Atendente IA, Supervisão e Dados Mestres somem quando o módulo está desligado.
- O menu do atendente passou a ser filtrado (Voz aparecia com a voz desligada).
- "Minha conta" não leva mais a 404.

**Pendente** (achado, não corrigido):
- **Cozinha:**
  - o recibo de troco no cartão da cozinha tem texto claro sobre fundo creme, quase ilegível;
  - o cartão mostra "PAGAMENTO: cash" em vez de "Dinheiro";
  - o botão "Aceitar e imprimir" fica espremido em três linhas.
- **Menu do painel:**
  - continua longo para uma lanchonete, porque os planos ligam muitos módulos (seção 3);
  - itens sem flag nenhuma: Inteligência, Analytics, Unidades, Caixa de Entrada, CRM, Integrações, Chamados.
- **Telas com módulo desligado:** algumas abrem normalmente e outras voltam para `/painel` sem explicar.
- **Lighthouse:** não foi rodado. O ambiente local roda o build em modo de prévia, e a homologação pede login da Vercel; fica para quando o bypass existir.
- **Primeiro acesso completo** (cadastro → primeiro pedido): não percorrido de ponta a ponta. O cadastro exige confirmação por e-mail.

## 7. Problemas encontrados em produção (somente leitura)

- **Urgente, resolvido:** login de funcionário bloqueado pelo navegador (CORS das funções). Publicado com aprovação.
- **Antes do piloto:**
  - ligar a proteção contra senhas vazadas no Supabase Auth (advisor de segurança);
  - publicar termos de uso e política de privacidade (não existem páginas).
- **Advisors de segurança:**
  - **21 funções `SECURITY DEFINER` executáveis por `anon`.** São as rotas públicas de propósito (cardápio, pedido, impressora com token, chat). Revisar uma a uma na Fase 98.
  - **273 funções `SECURITY DEFINER` executáveis por usuários logados.**
  - **364 tabelas com RLS e sem política.** É o padrão do repositório: tabelas só para o servidor.
- **Advisors de desempenho:**
  - 2 políticas que reavaliam `auth.*()` a cada linha;
  - 42 tabelas com políticas permissivas duplicadas;
  - 3 índices duplicados;
  - 7 tabelas sem chave primária.
  - Nenhum é urgente no volume do piloto.
- **Execução:**
  - 0 erros de execução na Vercel em 7 dias;
  - todos os jobs do `pg_cron` com sucesso nas últimas 24 h;
  - as chamadas dos workers retornaram 200.
- **Logs:** o plano Hobby da Vercel guarda só 1 hora; nenhuma investigação retroativa é possível.
- **Flags da loja:** dono e gerente conseguem alterar `store_feature_flags` da própria loja pela API e ligar módulos fora do plano. A política `store_flags_admin_update` permite isso.

Nenhuma escrita em produção além das aprovadas:
- separação das variáveis da Vercel;
- publicação das 5 funções de login;
- migration `phase97_default_service_mode` (04/11/2026, versão `20261104030018`), a única entrada nova no histórico de migrations de produção.

## 8. Roteiro da loja piloto

`docs/loja-piloto-runbook.md`: pré-requisitos, configuração, teste de fumaça, alertas mínimos em SQL de leitura, reversão e suporte.

## 9. O que precisa da aprovação do usuário para o piloto começar

1. Termos de uso e política de privacidade (texto e publicação).
2. Plano do piloto (plano "Piloto" só com o núcleo ou reduzir o Básico).
3. Forma de pagamento, uso de WhatsApp e cobrança da assinatura no piloto.
4. Ligar a proteção contra senhas vazadas no Supabase Auth.
5. Depois do merge: cadastrar os segredos do GitHub e marcar o check `e2e-core` como obrigatório.

## 10. Limitações

- **E2E local, não na homologação.** A bateria rodou contra o build local ligado ao masterapp-dev. Na homologação depende do bypass e da chave secreta, que o agente não pôde gerar nem cadastrar (bloqueio de permissão).
- **Workers do dev:** agendados, mas não validados (faltam os segredos no Vault).
- **Faixa "HOMOLOGAÇÃO":** testada por teste unitário; não vista na tela da prévia (exige login da Vercel).
- **Menu do painel (97E):** coberto por testes unitários e pela bateria existente; não visto no navegador.

## 11. Recomendações para a Fase 98

**Pendências da Fase 96:**
1. Executor em massa da retenção de privacidade.
2. Prévia de impacto das demais políticas `privacy.*`.
3. Buckets de documentos de funcionário e de evidências de entrega.

**Novas, da Fase 97:**

4. Impedir que dono e gerente liguem flags fora do plano (`store_feature_flags`).
5. E2E das contas de funcionário (seed com garçom, caixa, cozinha e entregador com login) e do entregador de ponta a ponta.
6. Chave pública VAPID por ambiente (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) para push funcionar na homologação.
7. Correções de experiência da cozinha (recibo ilegível, "cash", botão espremido) e mensagem clara quando um módulo está desligado.
8. Alertas automáticos a partir das consultas do roteiro do piloto (pedidos travados, pagamento falho, worker parado).
9. Revisão das 21 funções públicas `SECURITY DEFINER` e redução das 273 expostas a usuários logados.
10. Plano "Piloto" com só o núcleo, e limpeza dos módulos ligados por padrão nos planos.
11. Lighthouse no cardápio público e no acompanhamento, no celular, depois que a homologação aceitar o bypass.

## Resultado da bateria

Última rodada em 04/11/2026, contra o build local (`vite preview`) ligado ao `masterapp-dev`: **15 testes, 15 passaram** (10 no desktop e 5 no celular, os marcados `@mobile`). Nas rodadas anteriores, as falhas eram os dois defeitos corrigidos (pedido recusado e link do portal) e ajustes dos próprios testes (seletores, impressão do navegador, tempo).
