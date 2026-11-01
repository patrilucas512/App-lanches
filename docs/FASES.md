# Fases do MasterApp

Status no repositório, conferido em 2026-10-31 na `main` (`a044578`), por nomes de migrations, documentação e testes. "Implementada" significa que o código da fase está no repositório, não que ela foi validada em cada ambiente.

## Pendências

| Fase | Módulo | Status | Motivo |
|---|---|---|---|
| 38 | Reputação, Avaliações, NPS/CSAT e Experiência do Cliente | Pendente – será implementada | Não foi iniciada. A Fase 37 registra isso e o desenvolvimento seguiu para a 39. |
| 57 | Comunicação Interna, Mural Corporativo e Central de Comunicados | Pendente – será implementada | Não foi iniciada. As Fases 56 e 59 registram a ausência. |

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
| 38 | Reputação, Avaliações, NPS/CSAT e Experiência do Cliente | **Pendente – será implementada** |
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
| 57 | Comunicação Interna, Mural Corporativo e Central de Comunicados | **Pendente – será implementada** |
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

## Dependências das fases pendentes

### Fase 38

Nenhuma fase depende dela no código. Ao implementá-la, reaproveite ou integre o que já existe, sem duplicar:

| Onde | O que existe | Relação |
|---|---|---|
| Fase 37 | Doc registra que a 38 não foi iniciada; `tests/marketing-intelligence-phase37.test.mjs` verifica que a migration, a API e a UI da 37 não citam a 38 | Rever esse teste se a 37 passar a integrar a 38 |
| Fase 54 | `lib/reporting/core.ts` e migration definem as métricas `csat` e `nps`, descritas como "customer experience mart" | Consumidora provável dos dados da 38 |
| Fase 55 | `lib/performance-management/core.ts` e migration usam `csat` e `nps` em metas | Consumidora provável dos dados da 38 |
| Fase 30 | `customer_feedback` guarda NPS, CSAT e feedback | Voltado ao cliente do SaaS, não ao consumidor da loja |
| Fase 24 | `support_csat` | CSAT do suporte do SaaS |
| Fase 5 | `crm_feedback`, lido também pela Fase 60 (Cliente 360) e pelo atendente de IA | Feedback do consumidor; é o ponto de sobreposição mais direto |
| Fase 21 | `app_reviews` | Avaliações de apps do marketplace; escopo diferente |

### Fase 57

| Onde | O que existe | Relação |
|---|---|---|
| Fase 59 | Doc registra a ausência e que a vinculação à "comunicação canônica da Fase 57" fica disponível quando o módulo existir. `app/api/incidents/route.ts` aceita a relação `internal_communication`, e `components/incident-management-center.tsx` cria o comunicado como rascunho no Task Engine | **Dependência declarada**, hoje contornada |
| Fase 56 | Doc diz que a Fase 57 não faz parte daquela entrega | Só citação |
| Fase 46 | `network_announcements` e `network_announcement_acknowledgements`: comunicados com escopo e confirmação de leitura | Sobreposição direta |
| Superadmin | `platform_announcements` em `app/superadmin/avisos` | Avisos da plataforma; escopo diferente |
| Fases 65, 67 e 68 | Ações de copiloto `*_create_communication_draft` | Criam só rascunho; candidatas a integrar com a 57 |
| Fase 86 | Planos de continuidade têm campo de comunicação; a doc não cita "Internal Communications" nem a Fase 57 | Sem dependência encontrada no repositório |

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

- **Cadastro de loja nova e catálogo:** `create_establishment` não preenchia `organization_id`, e o catálogo do painel inseria categorias e produtos sem ele. A migration `tenant_signup_organization` corrige os dois; o fluxo completo foi validado no dev. **Falta aplicá-la em produção.**
- **`vinext dev` responde 500 em páginas HTML:** nesta máquina Windows, em pasta do OneDrive, toda página falha com `Network connection lost`, enquanto as rotas de API funcionam. `vite preview` funciona.
- **`vinext start` não serve os assets:** a página abre sem CSS e JS, porque o build é para Cloudflare Workers. Use `vite preview`.
- **Fontes no build local:** o console acusa fontes com caminho `file:///` da máquina, e o navegador as recusa. A página continua funcionando.

## Diferenças entre repositório e produção

- **Fases 83, 93 e 94:** aplicadas em produção em 2026-11-01, com todas as flags desligadas. O worker da Fase 93 ainda não está agendado.
- **`tenant_signup_organization`:** aplicada só no dev; falta em produção.
- **Versões:** as migrations de produção têm versões diferentes dos nomes de arquivo do repositório (por exemplo, `multitenant_mvp` é `20260724165852` em produção e `20260724070000` no arquivo). Um `supabase db push` em produção tentaria reaplicá-las.
