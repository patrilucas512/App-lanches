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
| 93 | Governança de identidades e acessos | Implementada e aplicada em produção; funções desligadas até o deploy do app e o agendamento do worker |
| 94 | Centro de operações de segurança | Implementada |

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

## Diferenças entre repositório e produção

- **Fases 83, 93 e 94:** aplicadas em produção em 2026-11-01, com todas as flags desligadas. O worker da Fase 93 ainda não está agendado.
- **`tenant_signup_organization`:** aplicada em produção; fluxo de cliente novo validado lá em bloco com rollback.
- **`phase93_review_adjustments`:** aplicada em produção.
- **`usage_events_metering_columns`:** aplicada em produção em 2026-11-01, com a versão `20261101181246`. 
- **Fase 38:** migrations aplicadas em produção em 2026-11-01, com versões `20261101184633` a `20261101184904`. Flags ligadas só na loja de teste, sem IA nem avaliações externas. O app publicado ainda não tem as rotas da fase.
- **Worker da Fase 38:** jobs `masterapp-cx-worker` (a cada 5 minutos) e `masterapp-cx-worker-enqueue` (de hora em hora), criados só em produção, fora das migrations, porque têm o endereço de produção fixo. O segredo está no Vault como `cx_worker_secret`. Falta publicar o app e definir o mesmo valor em `CUSTOMER_EXPERIENCE_WORKER_SECRET`.
- **Versões:** as migrations de produção têm versões diferentes dos nomes de arquivo do repositório (por exemplo, `multitenant_mvp` é `20260724165852` em produção e `20260724070000` no arquivo). Um `supabase db push` em produção tentaria reaplicá-las.
- **Fase 57:** migrations aplicadas em produção em 2026-11-02, com versões `20261102223531` a `20261102223710`, e no `masterapp-dev` em 2026-11-01. Flags ligadas só na loja de teste, sem rascunhos de IA e sem publicação de emergência. Worker com os jobs `masterapp-comms-worker` (a cada 5 minutos) e `masterapp-comms-worker-enqueue` (de hora em hora), criados só em produção, fora das migrations, a partir do comando dos jobs da Fase 38. O app publicado ainda não tem as rotas das Fases 38 e 57.
