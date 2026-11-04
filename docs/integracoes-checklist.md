# Checklist de integrações (Fase 97D)

Regra: em dev e homologação, **só chaves de teste**. Nenhuma chave vai para arquivo versionado. Situação conferida em 03/11/2026, só pela lista de nomes (nenhum valor foi lido).

Onde cadastrar:
- **Dev:** `.env.local` (local) ou Vault/`private.app_secrets` do `masterapp-dev`.
- **Homologação:** Vercel → `app-lanches` → Settings → Environment Variables, ambiente **Preview** apenas, ou o Vault do `masterapp-dev` (a homologação usa o mesmo banco do dev).
- **Produção:** Vercel, ambiente **Production**, ou o Vault de produção. Só com aprovação, na preparação do piloto.

## Resumo

| Integração | Núcleo? | Obrigatória? | Dev/Homologação hoje | Produção hoje | Sem a chave |
|---|---|---|---|---|---|
| Supabase (URL e chave pública) | sim | **obrigatória** | ok | ok | build da prévia para (`assertSafePreviewEnvironment`) |
| Supabase (`SUPABASE_SECRET_KEY`) | sim | **obrigatória** | **falta em Preview** | ok (integração) | rotas de servidor respondem 503 "credenciais do servidor não configuradas"; login por senha não funciona |
| Funções do Supabase (Edge Functions) | sim | **obrigatória** | **nenhuma publicada no dev** | 10 publicadas | login de funcionário (garçom, caixa, cozinha, entregador), push e WhatsApp não funcionam |
| Pix / pagamento online (Mercado Pago ou Pagar.me) | sim | opcional (dinheiro funciona sem) | falta | Mercado Pago da plataforma e da loja de teste cadastrados | pagamento online não é oferecido; "Gateway não configurado" |
| Stripe (assinatura do SaaS) | sim | opcional no piloto | falta | falta | "Stripe ainda não foi ativado neste ambiente" |
| Push (VAPID) | sim | opcional | falta | ok | notificação push não é enviada |
| WhatsApp (Meta Cloud API) | sim | opcional | falta | não conectado | atualização por WhatsApp fica desligada; envio fora de produção só para `WHATSAPP_TEST_RECIPIENTS` |
| OpenAI (atendente de IA) | não (complemento do WhatsApp) | opcional | falta | falta | o atendente responde pelo roteador de intenções, sem IA |
| Segredos internos (portal, workers) | sim | `CUSTOMER_PORTAL_OTP_SECRET` opcional | workers: Vault (ver `docs/ambientes.md`) | ok | portal usa `SUPABASE_SECRET_KEY` como base |
| E-mail | — | — | não existe envio de e-mail próprio | — | — |

## Detalhe por integração

### 1. Supabase
- **Onde obter (teste):** Supabase → projeto `masterapp-dev` → Project Settings → API Keys → Secret keys (`sb_secret_...`).
- **Onde cadastrar:** Vercel, Preview, nome `SUPABASE_SECRET_KEY`, tipo Sensitive.
- **Validação em homologação:** depois do cadastro, entrar em `/login` com o dono de teste do seed.

### 2. Funções do Supabase (Edge Functions)
- Código em `supabase/functions/`. Publicar no dev com `pnpm exec supabase functions deploy --project-ref bfmrcvjxbmxxmdustrgo` (ou pelo agente, na etapa 97C).
- O dev tem uma função temporária `dev-migrate-temp` que não está no repositório; pode ser apagada.

### 3. Pix e pagamento online (Mercado Pago / Pagar.me)
- As credenciais **não** ficam em variáveis de ambiente: a loja cadastra no painel (Configurações → Pagamentos) e elas vão para o Vault, por loja. As da plataforma (SaaS) também.
- **Teste:** Mercado Pago → Suas integrações → aplicação → **Credenciais de teste** (`TEST-...`). Pagar.me → Dashboard em modo **Sandbox** (`sk_test_...`).
- Ambiente `test` usa `sandbox_init_point` (Mercado Pago) e `sdx-api.pagar.me` (Pagar.me). Fora de produção, o modo `production` do gateway é recusado (`lib/order-payments/providers.ts`).
- **Produção:** já existem credenciais Mercado Pago da plataforma e da loja de teste no Vault de produção. Conferir com o dono se são de produção ou de teste antes do piloto.

### 4. Stripe (assinatura do SaaS)
- **Teste:** Stripe → modo de teste → Developers → API keys (`sk_test_...`); Product catalog → preço do plano (`STRIPE_GROWTH_MONTHLY_PRICE_ID`); Webhooks → endpoint `https://app-lanches-git-staging-lucas-patrick.vercel.app/api/stripe/webhook` → signing secret (`whsec_...`).
- **Cadastrar em Preview:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_GROWTH_MONTHLY_PRICE_ID`. A trava da prévia recusa `sk_live_`.
- **Produção (falta):** as três, com chaves live, e o webhook em `https://app-lanches-psi.vercel.app/api/stripe/webhook`. Opcional se o piloto começar sem cobrança automática.

### 5. Push (VAPID)
- A chave pública VAPID está fixa no código (`lib/push-notifications.ts`) e é a de produção. A privada fica em `private.app_secrets` (`vapid_private_key`, `push_webhook_secret`).
- Em homologação, push só funciona com um par próprio de chaves. Gerar com `npx web-push generate-vapid-keys`; a privada vai para `private.app_secrets` do dev; a pública precisa de `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (ajuste de código registrado no relatório da fase).

### 6. WhatsApp (Meta Cloud API)
- **Teste:** Meta for Developers → app do tipo Business → WhatsApp → API Setup: número de teste da Meta, token temporário, Phone number ID. Adicionar o **seu** número como destinatário de teste.
- **Cadastrar:** a conexão é feita pela loja no painel (WhatsApp → Conectar); o token vai para o Vault. Em Preview, cadastrar `WHATSAPP_TEST_RECIPIENTS` com o seu número (formato `55DDDNUMERO`). Fora de produção, mensagens para outros números são bloqueadas (`lib/whatsapp/cloud-api.ts`).
- **Webhook de teste:** `https://app-lanches-git-staging-lucas-patrick.vercel.app/api/whatsapp/webhook` (exige o bypass da Vercel; a Meta não manda cabeçalhos próprios, então para testar recebimento é preciso liberar o caminho na proteção ou testar localmente com túnel).

### 7. OpenAI
- **Teste:** platform.openai.com → API keys → criar uma chave **só para homologação**, com limite de gasto baixo.
- **Cadastrar em Preview:** `OPENAI_API_KEY` (Sensitive). Opcional: `WHATSAPP_AI_MODEL`, `CX_AI_MODEL`.

### 8. Segredos internos
- `CUSTOMER_PORTAL_OTP_SECRET`: valor aleatório (`[guid]::NewGuid().ToString("N")`). Opcional.
- Workers: tokens no Vault, conferidos por `verify_worker_secret` (ver `docs/ambientes.md`).

## Chaves de produção que faltam (não cadastradas nesta fase)

| Chave | Necessária para o piloto? |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_GROWTH_MONTHLY_PRICE_ID` (live) | Só se a assinatura for cobrada pelo app desde o início |
| `OPENAI_API_KEY` (produção) | Não; só para o atendente de IA |
| Conexão do WhatsApp da loja piloto (token permanente da Meta) | Sim, se o piloto usar atualização de pedido por WhatsApp; também é item do checklist de privacidade |
| Credenciais de pagamento da loja piloto (Mercado Pago ou Pagar.me, produção) | Sim, se o piloto aceitar Pix online |
| `CUSTOMER_PORTAL_OTP_SECRET` | Recomendada (separa o segredo do portal da chave do Supabase) |
