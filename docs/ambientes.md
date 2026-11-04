# Ambientes do MasterApp

| | Desenvolvimento | Homologação | Produção |
|---|---|---|---|
| Onde roda | Computador local (`pnpm dev`) | Vercel **Preview** | Vercel **Production** |
| Endereço | `http://localhost:3000` | `https://app-lanches-git-staging-lucas-patrick.vercel.app` (fixo, branch `staging`) e um endereço por branch/PR | `https://app-lanches-psi.vercel.app` |
| Banco | Supabase `masterapp-dev` (`bfmrcvjxbmxxmdustrgo`) | Supabase `masterapp-dev` (o mesmo do dev) | Supabase de produção (`qjwmjwubtgqginwhmajv`, São Paulo) |
| `MASTERAPP_ENVIRONMENT` | `development` (no `.env.local`) | `staging` | `production` |
| Faixa no topo | "AMBIENTE DE DESENVOLVIMENTO" (laranja) | "HOMOLOGAÇÃO · dados de teste" (roxa) | nenhuma |
| Trava contra o banco de produção | `vite.config.ts` → `assertSafeDevEnvironment` | `next.config.ts` → `assertSafePreviewEnvironment` (derruba o build) | — |
| Dados | Fictícios (seed `scripts/dev/seed-dev.mjs`, loja `lanchonete-teste`) | Os mesmos do dev | Reais (hoje só a loja de teste do dono) |
| Chaves externas | Modo de teste | Modo de teste | Produção (ver `docs/integracoes-checklist.md`) |

## Como publicar em cada um

- **Desenvolvimento:** `pnpm dev` com o `.env.local` apontando para o `masterapp-dev` (README, seção "Banco de desenvolvimento").
- **Homologação:** todo push numa branch que não seja a `main` gera uma prévia. Para atualizar o endereço fixo, publique na branch `staging`:
  ```bash
  git push origin HEAD:staging --force-with-lease
  ```
  A `staging` não tem histórico próprio: ela recebe a branch que se quer homologar.
- **Produção:** merge na `main`. Cada merge publica em produção. Para voltar atrás: Vercel → Deployments → deploy anterior → "Instant Rollback".
- **Migrations:** primeiro no `masterapp-dev` (vale para dev e homologação). Produção só com aprovação separada.

## Variáveis na Vercel

A integração Supabase ↔ Vercel (`icfg_ULANb5R8pPJX6OL5bjetqVtE`) grava as variáveis do banco **só em Production**. Ela não foi alterada.

| Variável | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | produção (manual, só Production desde 03/11/2026) | `https://bfmrcvjxbmxxmdustrgo.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | integração | chave pública do `masterapp-dev` |
| `SUPABASE_SECRET_KEY` | integração | **falta** (o usuário cadastra, ver abaixo) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `POSTGRES_*` | integração | não existem (não são necessárias) |
| `MASTERAPP_ENVIRONMENT` | `production` (só Production desde 03/11/2026) | `staging` |
| `NEXT_PUBLIC_SITE_URL` | `https://app-lanches-psi.vercel.app` | `https://app-lanches-git-staging-lucas-patrick.vercel.app` |
| `masterapp_cron_secret` | sim | não |

Antes de 03/11/2026, `NEXT_PUBLIC_SUPABASE_URL` e `MASTERAPP_ENVIRONMENT` valiam para Production **e** Preview: uma prévia apontaria para o banco de produção. Como as chaves só existiam em Production, todas as prévias falhavam no build ("Supabase não configurado").

### O que o usuário precisa cadastrar

1. **`SUPABASE_SECRET_KEY` do dev em Preview.** Obter em Supabase → projeto `masterapp-dev` → Project Settings → API Keys → "Secret keys" (`sb_secret_...`). Cadastrar em Vercel → `app-lanches` → Settings → Environment Variables → Add, ambiente **Preview** apenas, tipo Sensitive. Sem ela, a prévia abre, mas login por senha, páginas de status e rotas administrativas ficam desligados.
2. **Protection Bypass for Automation.** As prévias pedem login da Vercel (Deployment Protection → Vercel Authentication). Os workers do `pg_cron` e os testes E2E precisam passar por ela. Gerar em Vercel → `app-lanches` → Settings → Deployment Protection → "Protection Bypass for Automation" → Add. Guardar o valor em dois lugares:
   - no Vault do `masterapp-dev` como `vercel_bypass_secret` (item 3);
   - no GitHub → repositório → Settings → Secrets and variables → Actions como `VERCEL_AUTOMATION_BYPASS_SECRET` (para o E2E no CI).
3. **Segredos dos workers no Vault do dev.** Rodar no SQL Editor do `masterapp-dev` (não no de produção). Os dois tokens de worker nascem no próprio banco e não precisam ser copiados para lugar nenhum: o app confere o token pelo Vault (`verify_worker_secret`).
   ```sql
   select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'cx_worker_secret', 'Homologação: workers das Fases 38, 57 e 93');
   select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'privacy_worker_secret', 'Homologação: worker de privacidade');
   select vault.create_secret('<valor do Protection Bypass>', 'vercel_bypass_secret', 'Homologação: bypass da proteção das prévias');
   ```

## Workers

| Job (`pg_cron`) | Frequência | Rota | Token |
|---|---|---|---|
| `masterapp-cx-worker` / `-enqueue` | 5 min / hora | `/api/customer-experience/worker` (Fase 38) | Vault `cx_worker_secret` |
| `masterapp-comms-worker` / `-enqueue` | 5 min / hora | `/api/internal-communications/worker` (Fase 57) | Vault `cx_worker_secret` |
| `masterapp-idgov-worker` / `-enqueue` | 5 min / hora | `/api/identity-governance/worker` (Fase 93) | Vault `cx_worker_secret` |
| `masterapp-privacy-worker` | 15 min | `/api/privacy/worker` (Fases 95 e 96) | Vault `privacy_worker_secret` |
| `masterapp-phase20-webhook-worker` | 1 min | `/api/integrations/webhooks/process` (Fase 20) | Vault `masterapp-phase20-worker` (criado pela migration) |

- **Produção:** os jobs apontam para `app-lanches-psi.vercel.app`. O worker de privacidade **não** está agendado em produção (entra no roteiro de ativação da privacidade).
- **Dev/homologação:** os jobs apontam para o endereço fixo da homologação e mandam também o cabeçalho `x-vercel-protection-bypass`. Script: `scripts/dev/staging-workers.sql` (aplicado em 03/11/2026; pode ser rodado de novo, ele substitui os jobs). Antes dele, o webhook da Fase 20 no dev chamava o endereço antigo do app.
- Conferir se rodaram:
  ```sql
  select j.jobname, r.status, r.return_message, r.start_time
  from cron.job_run_details r join cron.job j using (jobid)
  where j.jobname like 'masterapp-%worker%' order by r.start_time desc limit 20;
  select id, status_code, left(content::text, 120) from net._http_response order by id desc limit 20;
  ```
  `status_code` 200 é sucesso; 401 indica token ausente no Vault; uma página de login da Vercel indica bypass ausente.
