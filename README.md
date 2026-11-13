# Mesa Viva

Plataforma SaaS multiempresa para cardápios digitais, pedidos e gestão de restaurantes.

## O que já está implementado

- landing page e página de planos;
- autenticação com Supabase e onboarding do estabelecimento;
- isolamento multi-tenant com PostgreSQL RLS;
- papéis `owner`, `manager`, `attendant` e `catalog_editor`;
- painel, catálogo, pedidos, equipe e assinatura;
- cardápio público em `/loja/:slug`, carrinho e pedido atômico;
- limites de produtos e equipe por plano;
- Stripe Checkout, Customer Portal e webhooks idempotentes;
- painel reservado para superadministrador.

## Rodar localmente no Windows

O projeto usa `vinext` (API do Next.js sobre Vite) com o plugin da Cloudflare. O ambiente local nunca deve usar o Supabase de produção.

### 1. Requisitos

- Node.js 24 (mesma versão do CI; o mínimo é 22.13);
- pnpm 11.25.0;
- um projeto Supabase de desenvolvimento (passo 4).

```powershell
winget install --id OpenJS.NodeJS.LTS --version 24.22.1 --exact
npm install -g pnpm@11.25.0
```

Se o PowerShell bloquear scripts ao chamar `pnpm`, use `pnpm.cmd`, sem alterar a política de execução. Isso vale para todos os comandos abaixo.

### 2. Instalação

```powershell
pnpm install --frozen-lockfile
```

Se o projeto estiver numa pasta do OneDrive e surgirem erros de arquivo bloqueado, pause a sincronização durante a instalação ou mova o projeto para fora do OneDrive.

### 3. `.env.local`

```powershell
Copy-Item .env.example .env.local
```

Preencha as variáveis obrigatórias com os dados do projeto de desenvolvimento e defina `MASTERAPP_ENVIRONMENT=development` e `NEXT_PUBLIC_SITE_URL=http://localhost:3000`. O `.env.local` é ignorado pelo Git. Não coloque valores reais em arquivos versionados.

Onde pegar cada chave (sempre de teste ou desenvolvimento):

| Variável | Onde pegar |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Painel do Supabase, projeto de desenvolvimento: Project Settings > API Keys |
| `STRIPE_SECRET_KEY` | Painel do Stripe em modo de teste: Developers > API keys (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Saída do comando `stripe listen --forward-to localhost:3000/api/stripe/webhook` (`whsec_...`) |
| `STRIPE_GROWTH_MONTHLY_PRICE_ID` | Painel do Stripe em modo de teste: Product catalog > preço do plano |
| `OPENAI_API_KEY` | platform.openai.com > API keys; crie uma chave só para desenvolvimento |
| `WHATSAPP_TEST_RECIPIENTS` | Seus números de teste; fora de produção, os demais são bloqueados |
| `CUSTOMER_PORTAL_OTP_SECRET`, `CRON_SECRET`, `*_WORKER_SECRET` e demais segredos internos | Gere um valor aleatório: `[guid]::NewGuid().ToString("N")` |

Credenciais de Mercado Pago, Pagar.me e WhatsApp e as chaves VAPID não ficam em variáveis de ambiente: são guardadas no banco (Vault e `private.app_secrets`), por estabelecimento ou plataforma.

Sem uma chave opcional, o recurso fica desligado, e o modo dev lista no terminal o que está desativado. Sem `SUPABASE_SECRET_KEY`, o login por senha não funciona.

### 4. Banco de desenvolvimento

Use um segundo projeto Supabase gratuito, separado da produção. Depois de criá-lo no painel:

```powershell
pnpm exec supabase login
pnpm exec supabase link --project-ref <ref-do-projeto-de-desenvolvimento>
pnpm exec supabase db push
```

Confira o `--project-ref` antes do `db push`: ele aplica as migrações no projeto vinculado.

Algumas migrações têm endereços de produção fixos em funções SQL e em um job do `pg_cron`. **Depois de cada aplicação de migrações no banco de desenvolvimento, rode [`supabase/dev/neutralize-production-endpoints.sql`](supabase/dev/neutralize-production-endpoints.sql)**: uma migração que recria uma dessas funções traz o endereço de produção de volta. O script troca esses endereços por um domínio que nunca responde e desliga os jobs que ainda citam a produção, então push, WhatsApp e campanhas não saem do ambiente local.

Rode-o no SQL Editor do projeto de desenvolvimento, nunca no de produção, colando antes desta linha, que confirma o ambiente:

```sql
select set_config('app.masterapp_test_environment', 'development', false);
```

O script termina com erro se ainda sobrar alguma função apontando para a produção.

A proteção do modo dev recusa iniciar com a URL ou uma chave JWT do Supabase de produção, Stripe live, `MASTERAPP_ENVIRONMENT=production` ou `FISCAL_ENVIRONMENT=production`, e também sem `MASTERAPP_ENVIRONMENT`. Chaves no formato `sb_secret_` não informam o projeto de origem, então a proteção não consegue identificá-las: nunca copie a chave de produção.

### 5. Como rodar

```powershell
pnpm dev
```

O servidor sobe em `http://localhost:3000`, com a faixa "AMBIENTE DE DESENVOLVIMENTO" no topo das páginas.

### 6. Pré-visualização

Abra `http://localhost:3000` no navegador. No Claude Code para desktop, configure o servidor em `.claude/launch.json` e abra-o no painel do navegador.

As migrações versionadas estão em `supabase/migrations`.

## Segurança

Decisões de autorização e cobrança são validadas no servidor ou no PostgreSQL. As tabelas expostas usam RLS, e o cardápio público acessa somente RPCs com campos explicitamente permitidos.
