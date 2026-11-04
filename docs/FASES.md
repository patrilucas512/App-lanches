# Fases do MasterApp

Status no repositório, conferido em 2026-10-31 na `main` (`a044578`), por nomes de migrations, documentação e testes. "Implementada" significa que o código da fase está no repositório, não que ela foi validada em cada ambiente.

## Pendências

Nenhuma. As Fases 38 e 57 foram as últimas a entrar na `main`.

## Todas as fases

Os números 3 a 17, 22 e 23 também aparecem em migrations antigas da série de entregas (por exemplo, `phase3_delivery_checkout`). A tabela usa a série principal do produto.

| Fase | Módulo | Status |
|---|---|---|
| 1 | Base multitenant e atendimento humano no WhatsApp (sem número nos arquivos; identificação por inferência) | Implementada |
| 2 | Atendente de IA no WhatsApp | Implementada |
| 3 | Pedidos pelo WhatsApp | Implementada |
| 4 | Comércio pelo WhatsApp | Implementada |
| 5 | CRM do WhatsApp | Implementada |
| 6 | Gestão da IA do WhatsApp | Implementada |
| 7 | WhatsApp multiunidade | Implementada |
| 8 | Supervisão do WhatsApp | Implementada |
| 9 | Copiloto do gestor | Implementada |
| 10 | Ações operacionais do copiloto | Implementada |
| 11 | Voz omnichannel | Implementada |
| 12 | Omnichannel unificado | Implementada |
| 13 | Portal do cliente | Implementada |
| 14 | Assinaturas do cliente | Implementada |
| 15 | Reservas, salão e fila de espera | Implementada |
| 16 | Estoque, custos e compras | Implementada |
| 17 | Gestão financeira | Implementada |
| 18 | Gestão de equipe | Implementada |
| 19 | Documentos fiscais | Implementada |
| 20 | Integrações e API pública | Implementada |
| 21 | Marketplace de parceiros | Implementada |
| 22 | Billing e entitlements do SaaS | Implementada |
| 23 | Onboarding guiado | Implementada |
| 24 | Central de suporte do SaaS | Implementada |
| 25 | Segurança enterprise | Implementada |
| 26 | Performance e escalabilidade | Implementada |
| 27 | Qualidade e engenharia de release | Implementada |
| 28 | Product analytics e growth | Implementada |
| 29 | CRM de vendas | Implementada |
| 30 | Customer success | Implementada |
| 31 | Revenue operations | Implementada |
| 32 | Operações internas | Implementada |
| 33 | Centro de comando executivo | Implementada |
| 34 | Plataforma de dados | Implementada |
| 35 | Forecasting | Implementada |
| 36 | Rentabilidade do cardápio | Implementada |
| 37 | Inteligência de marketing | Implementada |
| 38 | Reputação, Avaliações, NPS/CSAT e Experiência do Cliente | Implementada e aplicada em produção; depende do deploy do app; ver `docs/phase38-customer-experience-report.md` |
| 39 | Inteligência de compras | Implementada |
| 40 | Logística avançada | Implementada |
| 41 | Orquestração da cozinha | Implementada |
| 42 | Salão avançado | Implementada |
| 43 | Quiosques de autoatendimento | Implementada |
| 44 | Continuidade offline | Implementada |
| 45 | Hub de hardware | Implementada |
| 46 | Governança de rede | Implementada |
| 47 | Qualidade de alimentos | Implementada |
| 48 | Gestão de ativos | Implementada |
| 49 | Conformidade documental | Implementada |
| 50 | Central de automação | Implementada |
| 51 | Busca global | Implementada |
| 52 | Central de notificações | Implementada |
| 53 | Workspace personalizado | Implementada |
| 54 | Relatórios avançados | Implementada |
| 55 | Gestão de desempenho | Implementada |
| 56 | Central de aprendizado | Implementada |
| 57 | Comunicação Interna, Mural Corporativo e Central de Comunicados | Implementada e aplicada em produção; depende do deploy do app; ver `docs/phase57-internal-communications-report.md` |
| 58 | Planejamento de equipe | Implementada |
| 59 | Gestão de incidentes | Implementada |
| 60 | Cliente 360 | Implementada |
| 61 | Jornadas do cliente | Implementada |
| 62 | Gestão de catálogo | Implementada |
| 63 | Gestão de capacidade | Implementada |
| 64 | Finanças de franquia | Implementada |
| 65 | Abertura de lojas | Implementada |
| 66 | Gestão geográfica | Implementada |
| 67 | Auditorias operacionais | Implementada |
| 68 | Base de conhecimento | Implementada |
| 69 | Integrações de marketplace | Implementada |
| 70 | Produção central | Implementada |
| 71 | Planejamento da cadeia de suprimentos | Implementada |
| 72 | Gestão de armazém | Implementada |
| 73 | Gestão de transporte | Implementada |
| 74 | Planejamento integrado de negócios | Implementada |
| 75 | Master data management | Implementada |
| 76 | Governança de dados | Implementada |
| 77 | Feature management | Implementada |
| 78 | FinOps da plataforma | Implementada |
| 79 | Motor de políticas | Implementada |
| 80 | Governança de IA | Implementada |
| 81 | Orquestração de integrações | Implementada |
| 82 | Digital twin operacional | Implementada |
| 83 | Revenue management | Implementada |
| 84 | Centro de operações de rede | Implementada |
| 85 | Confiabilidade de serviço | Implementada |
| 86 | Continuidade de negócios | Implementada |
| 87 | Gestão de riscos corporativos | Implementada |
| 88 | Gestão de mudanças | Implementada |
| 89 | Inteligência de processos | Implementada |
| 90 | Arquitetura corporativa | Implementada |
| 91 | Gestão de portfólio | Implementada |
| 92 | Gestão de fornecedores | Implementada |
| 93 | Governança de identidades e acessos | Implementada e aplicada em produção; worker agendado desde 2026-11-03; flags desligadas |
| 94 | Centro de operações de segurança | Implementada |
| 95 | Privacidade e LGPD (Privacy Operations) | Implementada e aplicada em produção; flags desligadas; worker não agendado |
| 96 | Privacidade e LGPD: conclusão e prontidão para uso real | Implementada e aplicada em produção; flags desligadas; worker não agendado |
| 97 | Go-Live Readiness: homologação, E2E do núcleo e loja piloto | Implementada; migration aplicada em produção; funções de login publicadas em produção |

## Migrations de índices das Fases 77, 78, 79 e 87: resolvido

Confirmado em 2026-10-31, só com leitura do histórico de migrations de produção, sem nenhuma alteração. As quatro já estão aplicadas:

| Migration | Versão em produção |
|---|---|
| `phase77_feature_management_indexes` | `20261027154508` |
| `phase78_finops_fk_indexes` | `20261027222325` |
| `phase79_policy_engine_fk_indexes` | `20261028030530` |
| `phase87_enterprise_risk_fk_indexes` | `20261029071041` |

## Banco de desenvolvimento (masterapp-dev): pronto

O projeto `masterapp-dev` (`bfmrcvjxbmxxmdustrgo`) está com as 247 migrations do commit `aab680e` aplicadas, na ordem dos arquivos e com as mesmas versões dos nomes de arquivo. A trava que impede `vinext dev` de usar a URL de produção foi testada e funciona.

- **Dados fictícios:** `node scripts/dev/seed-dev.mjs` cria 1 estabelecimento (`lanchonete-teste`), 1 dono, 5 produtos, 1 mesa e 1 entregador. O script recusa outros projetos, pode ser reexecutado e grava a senha do dono em `.env.test-login.local`, ignorado pelo git.
- **Rodar localmente:** com o `.env.local` preenchido, copie-o para `.dev.vars` e para `dist/server/.dev.vars`, rode `vinext build` e depois `vite preview`.

## Problemas encontrados no banco de desenvolvimento

- **Cadastro de loja nova e catálogo:** `create_establishment` não preenchia `organization_id`, e o catálogo do painel inseria categorias e produtos sem ele. A migration `tenant_signup_organization` corrige os dois; o fluxo completo foi validado no dev. Já aplicada em produção.
- **`vinext dev` responde 500 em páginas HTML:** nesta máquina Windows, em pasta do OneDrive, toda página falha com `Network connection lost`, enquanto as rotas de API funcionam. `vite preview` funciona.
- **`vinext start` não serve os assets:** a página abre sem CSS e JS, porque o build é para Cloudflare Workers. Use `vite preview`.
- **Fontes no build local:** o console acusa fontes com caminho `file:///` da máquina, e o navegador as recusa. A página continua funcionando.

## Hospedagem do app

Em 2026-11-02 o app passou a ser publicado na Vercel, no projeto `app-lanches` do time `lucas-patrick`, saindo do ChatGPT Sites.

- A Vercel compila com `next build` (configurado no projeto). O build `vinext` do `package.json` continua existindo para a Cloudflare, mas não é usado na Vercel.
- Cada merge na `main` publica em produção automaticamente.
- Desde 2026-11-03 as prévias (Preview) são a homologação: usam o `masterapp-dev`, mostram a faixa "HOMOLOGAÇÃO" e têm o endereço fixo `app-lanches-git-staging-lucas-patrick.vercel.app` (branch `staging`). Detalhes em `docs/ambientes.md`.
- As chaves do Supabase de produção chegam pela integração oficial Supabase ↔ Vercel, ligada ao projeto `qjwmjwubtgqginwhmajv`. `MASTERAPP_ENVIRONMENT=production` foi cadastrada à mão.
- Os jobs do `pg_cron` apontam para `app-lanches-psi.vercel.app` desde 2026-11-02. Os workers das Fases 38, 57 e 93 conferem o token no Vault pela função `verify_worker_secret` (aplicada em produção); o de webhooks da Fase 20 já fazia isso. `NEXT_PUBLIC_SITE_URL` foi cadastrada em 2026-11-03. `CUSTOMER_PORTAL_OTP_SECRET` é opcional: sem ela, o código do portal usa `SUPABASE_SECRET_KEY`. Faltam só as chaves opcionais (Stripe, OpenAI).
- O código de acesso do portal do cliente (`/conta/<loja>`) vai por WhatsApp. Sem uma conexão em `whatsapp_connections` com status `connected`, nenhum código é enviado.

## Diferenças entre repositório e produção

- **Fase 98 (endurecimento para a loja piloto):** relatório em `docs/phase98-pilot-hardening-report.md`.
  - As 8 migrations `20261104130000` a `20261104137000` foram aplicadas **só no `masterapp-dev`** em 2026-11-04 (versões na seção 7 do relatório). Produção não foi tocada; a ordem proposta de aplicação está na seção 8.
  - No dev: a loja `lanchonete-teste` está no plano **Piloto**, tem garçom, cozinha, caixa e entregador com login (senhas no `.env.test-login.local`) e o job `masterapp-pilot-alerts` roda a cada 5 minutos.
  - Login de funcionário por nome estava quebrado (telefone sem o 55); corrigido pela migration `20261104134000`.
  - **Aplicadas em produção em 2026-11-04, com aprovação, uma a uma:** `phase98d_employee_login_phone` (versão `20261104222401`; as 4 contas de equipe de produção passam a ser encontradas), `phase98a_flags_within_plan` (`20261104222503`; o dono voltou a ler as flags da loja) e `phase98b_pilot_plan` (`20261104222612`; Piloto criado, fora da vitrine; Básico, Profissional e MasterApp ganharam as flags novas ligadas; o cadastro continua no Básico). Depois, `phase98g_public_functions` (`20261104225035`; funções públicas 21 -> 20, limite de frequência no pedido público, no chat do site e nos eventos). O código da fase foi publicado com o merge do PR #30. Depois, `phase98g_internal_functions` (`20261104232213`; 19 funções internas deixam de ser executáveis por usuário logado: 274 -> 254 em produção, `service_role` mantido). Depois, `phase98i_legal_acceptance` (`20261104232410`; o cadastro grava versão e data do aceite dos termos em `legal_acceptances`; os textos continuam rascunho). As outras 2 migrations (alertas e limpeza dos planos) seguem só no dev.

- **Fase 97:**
  - A migration `20261104120000_phase97_default_service_mode` foi aplicada no `masterapp-dev` e, com aprovação, em produção em 2026-11-04 (versão `20261104030018`). Em produção não havia loja para preencher: a única já tinha a linha em `service_modes`.
  - As funções `employee-login`, `activate-waiter-access`, `activate-kitchen-access`, `activate-cashier-access` e `activate-driver-access` foram publicadas em produção em 2026-11-03, com aprovação, para aceitar `app-lanches-psi.vercel.app`. Antes, o login de funcionário era recusado pelo navegador.
  - O `masterapp-dev` não tinha nenhuma função do Supabase; as 5 de login foram publicadas lá. Faltam as de push e WhatsApp.
  - Variáveis da Vercel separadas por ambiente (ver `docs/ambientes.md`).
  - Os jobs dos workers no dev apontam para a homologação; os segredos do Vault do dev ainda não existem.

- **Fase 96:** as 3 migrations (`20261103130000`, `20261103131000`, `20261103132000`) foram aplicadas no `masterapp-dev` (versões `20261103073107`, `20261103073348` e `20261103073414`) e, depois do merge do PR #25, em produção em 2026-11-03 (versões `20261103231311`, `20261103231333` e `20261103231336`). Em produção nenhuma loja ou plano tem flag de privacidade ligada, e não há `privacy_worker_secret` no Vault nem job do worker. A flag nova `privacy_setup_enabled` começa desligada, e `privacy_operations_enabled` só liga pelo checklist de go-live (gatilho no banco). O dev tem 50 mil clientes fictícios "Volume Teste" do teste de volume.

- **Fase 95:** as 9 migrations (`20261103120000` a `20261103128000`) foram aplicadas no `masterapp-dev` e, depois do merge do PR #22, em produção em 2026-11-03, com versões `20261103063715` a `20261103064110`. Em produção nenhuma loja ou plano tem as flags ligadas, o baseline de consentimento importou 0 registros (não havia opt-in/opt-out) e o mapa tem 53 campos. O worker `/api/privacy/worker` não está agendado e não há `privacy_worker_secret` no Vault. No dev, as flags `privacy_operations_enabled`, `privacy_dsr_portal_enabled` e `privacy_ai_assistance_enabled` estão ligadas só na loja fictícia `lanchonete-teste`.

- **Fases 83, 93 e 94:** aplicadas em produção em 2026-11-01, com todas as flags desligadas. O worker da Fase 93 roda pelos jobs `masterapp-idgov-worker` (a cada 5 minutos) e `masterapp-idgov-worker-enqueue` (de hora em hora), criados só em produção em 2026-11-03.
- **`tenant_signup_organization`:** aplicada em produção; fluxo de cliente novo validado lá em bloco com rollback.
- **`phase93_review_adjustments`:** aplicada em produção.
- **`usage_events_metering_columns`:** aplicada em produção em 2026-11-01, com a versão `20261101181246`. 
- **Fase 38:** migrations aplicadas em produção em 2026-11-01, com versões `20261101184633` a `20261101184904`. Flags ligadas só na loja de teste, sem IA nem avaliações externas. O app publicado ainda não tem as rotas da fase.
- **Worker da Fase 38:** jobs `masterapp-cx-worker` (a cada 5 minutos) e `masterapp-cx-worker-enqueue` (de hora em hora), criados só em produção, fora das migrations, porque têm o endereço de produção fixo. O segredo está no Vault como `cx_worker_secret`. Falta publicar o app e definir o mesmo valor em `CUSTOMER_EXPERIENCE_WORKER_SECRET`.
- **Versões:** as migrations de produção têm versões diferentes dos nomes de arquivo do repositório (por exemplo, `multitenant_mvp` é `20260724165852` em produção e `20260724070000` no arquivo). Um `supabase db push` em produção tentaria reaplicá-las.
- **Fase 57:** migrations aplicadas em produção em 2026-11-02, com versões `20261102223531` a `20261102223710`, e no `masterapp-dev` em 2026-11-01. Flags ligadas só na loja de teste, sem rascunhos de IA e sem publicação de emergência. Worker com os jobs `masterapp-comms-worker` (a cada 5 minutos) e `masterapp-comms-worker-enqueue` (de hora em hora), criados só em produção, fora das migrations, a partir do comando dos jobs da Fase 38. O app publicado ainda não tem as rotas das Fases 38 e 57.
