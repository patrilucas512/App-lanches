# Fase 95 — Privacy Operations & Data Subject Governance (LGPD)

Este módulo é ferramenta de operação. Ele não dá aconselhamento jurídico. Textos legais, prazos e bases legais são configurados pelo estabelecimento, pelo jurídico ou pelo encarregado (DPO).

## 1. Diagnóstico

O diagnóstico completo está em `phase95-initial-diagnosis.md`.

- **Onde estão os dados pessoais:**
  - clientes: `customers`, `organization_customers`, endereços, pedidos, entregas, reservas, WhatsApp, voz, Customer 360 e Customer Experience;
  - funcionários: Fase 18;
  - entregadores: perfil e localização;
  - clientes do SaaS: cobrança;
  - leads: Fase 29;
  - IP de superadmin.
- **Dados sensíveis:** preferência alimentar no Customer 360, sinal de alergia no Customer Experience, gravações de voz e documentos de funcionários.
- **Consentimento estava em quatro lugares:** `customers.marketing_status`, `whatsapp_contacts`, `crm_consent_events` e `customer_notification_preferences`.
- **Já existia** `customer_privacy_requests` (Fase 13), com 4 tipos e 4 status.

## 2. Contextos de controlador

`privacy_contexts` tem dois tipos de contexto:

- `tenant_controller`: um por organização. O estabelecimento é o controlador dos dados dos seus clientes, funcionários e entregadores; o MasterApp é o operador.
- `platform_controller`: um só. O MasterApp é o controlador dos dados dos clientes do SaaS. Só o superadmin acessa (`?context=platform`).

Todo registro pertence a um contexto. A API resolve o contexto pela organização da loja, e o encarregado de um estabelecimento não alcança outro.

## 3. Arquivos

**Criados:**
- `lib/privacy-operations/`: `core`, `server`, `adapters`, `inventory`, `ropa`, `consents`, `dsr`, `deletion`, `retention`, `governance`, `integrations`, `dashboard`.
- APIs: `app/api/privacy/route.ts`, `app/api/privacy/worker/route.ts` e `app/api/customer-portal/[slug]/privacy/route.ts`.
- Tela: `app/painel/seguranca/privacidade/page.tsx`.
- Componentes: `components/privacy-operations-center.tsx` e `components/privacy-portal-center.tsx`.
- Qualidade: `scripts/quality/personal-data-check.mjs`.
- Testes: `tests/privacy-operations-phase95.test.mjs`.
- Documentos: este relatório e o diagnóstico.

**Modificados** (todas as mudanças são aditivas):
- Customer Experience: `surveys.ts`.
- Journeys: worker.
- Marketing: route.
- Executive Command Center: route.
- Reporting: `core` e route.
- Workspace: `core` e `widget-data`.
- Data Platform: `core`.
- Automation: `core`.
- Identity Governance: `core` e `server`.
- Copilot: `copilot-tools`.
- Menu: `dashboard-shell`.
- Portal do Cliente: `customer-portal.tsx`.
- CSS do SOC, `package.json` e workflow `quality.yml`.

## 4. Migrations

| Arquivo | Conteúdo |
|---|---|
| `20261103120000_phase95a_privacy_contexts_inventory` | 5 flags (desligadas), contextos, permissões, configurações, `personal_data_map` com 53 linhas do esquema, achados e auditoria imutável |
| `20261103121000_phase95b_ropa_legal_bases` | Catálogo de bases legais e atividades de tratamento com versões |
| `20261103122000_phase95c_canonical_consents` | Finalidades, textos versionados, `consent_records`, `consent_current`, espelhamento, `privacy_record_consent` e baseline |
| `20261103123000_phase95d_data_subject_requests` | Extensão de `customer_privacy_requests`, verificação, linha do tempo, pacotes e bucket privado `privacy-exports` |
| `20261103124000_phase95e_retention_holds_deletion` | Legal holds, retenção, execuções, sal por contexto, planos e passos de exclusão |
| `20261103125000_phase95f_residency_subprocessors_incidents_dpia` | Residência, perfil de privacidade de vendors, categoria `privacy` em incidentes, avaliação do incidente e RIPD |
| `20261103126000_phase95g_privacy_by_design_integrations` | Revisões de privacy by design, usos de IA e `fact_privacy_requests` |
| `20261103127000_phase95g_identity_reporting_registries` | Integração RBAC com a Fase 93 e registros de métricas, datasets, widget, busca, automação e notificações |
| `20261103128000_phase95c_consent_order` | Desempate por sequência no registro canônico (achado na validação do dev) |

Detalhes das migrations:

- Todas foram aplicadas no **masterapp-dev**, que antes já tinha todas as migrations da `main`. Nada foi aplicado em produção.
- Tabelas novas: RLS ligado, sem acesso para `anon` e `authenticated`, só `service_role`, no mesmo padrão das Fases 57 e 94.
- Os únicos avisos do Supabase são do tipo "RLS sem política" (informativo), esperados nesse padrão.
- `migration-safety` passou.

## 5. Inventário e ROPA

- `personal_data_map` descreve tabela, campo, categoria, titular, sensibilidade, guarda legal, serviço dono e adapter.
- A ligação com a Data Governance (Fase 76) funciona nos dois sentidos:
  - campos catalogados com cara de dado pessoal e sem mapeamento viram achados;
  - campos mapeados passam a ter `sensitivity='personal_data'` no catálogo.
- O ROPA é versionado a cada mudança.
- Uma atividade só fica ativa se tiver finalidade, base legal, retenção e dono. Legítimo interesse exige a referência da LIA (regra configurável).
- O sistema indica quando uma RIPD é recomendada.

## 6. Consentimentos

O registro canônico é `consent_records`: só recebe inserções, é organizado por finalidade e canal e guarda versão do texto, origem e evidência.

**Compatibilidade com quem já lê as tabelas antigas:**
- Escritas em `crm_consent_events` e `customer_notification_preferences` são espelhadas no registro canônico por gatilho.
- Toda mudança feita pelo módulo passa por `privacy_record_consent`, que atualiza `customers`, `whatsapp_contacts` e as preferências na mesma transação. Assim, campanhas, outbox e a ponte da Fase 37 (que leem em SQL) passam a ver a revogação na hora.
- O estado atual foi importado como baseline, marcado como importado.

**Quem consulta o registro:**
- Journeys (worker), Customer Experience (pesquisas) e Marketing (prévia de público) consultam o registro canônico quando a flag está ligada na loja.
- WhatsApp é atendido pelo espelhamento acima.
- Se o registro não puder ser lido, marketing não sai. Mensagens transacionais continuam.
- Se o banco não tem a migração, valem só as regras antigas.

## 7. Solicitações de titulares

- `customer_privacy_requests` virou a solicitação canônica, com 11 tipos e 8 status. Os registros da Fase 13 foram convertidos.
- Um gatilho preenche contexto e prazo, inclusive quando a solicitação chega pelo fluxo antigo do portal.
- **Verificação de identidade:** código de 6 dígitos enviado ao telefone já cadastrado; só o HMAC fica guardado. Sem canal de envio, a verificação é manual, com registro de quem verificou. Nenhum documento é pedido.
- **Pacote de acesso:** arquivo JSON por domínio, num bucket privado, com link que expira. A auditoria guarda o hash, não o conteúdo.
- **Correção:** aplicada no cadastro de clientes. Troca de telefone continua pelo fluxo com código do portal.
- **Rejeição ou atendimento parcial:** sempre com motivo; uma restrição no banco impede ficar sem.
- **Resposta ao titular:** só é enviada depois de aprovada por uma pessoa.

## 8. Retenção, legal holds, anonimização e exclusão

**Exclusão:**
- O fluxo é: prévia por domínio (apagar, anonimizar, manter por lei, manual) → aprovação por outra pessoa → execução → verificação → evidência.
- A execução só ocorre com a identidade do titular verificada.
- Registros dos quais outros dependem (cliente, pedidos, contatos) são anonimizados, para os totais continuarem certos.
- Documentos fiscais e financeiros são mantidos; o vínculo com o cadastro sai.
- Legal hold sempre vence, inclusive um criado depois da prévia.
- Falha num domínio deixa a solicitação parcial. A execução é idempotente e pode ser retomada.

**Retenção:**
- Simulação por padrão.
- Execução real exige a flag `privacy_retention_execution_enabled` e aprovação.
- Hoje há um conjunto com executor (clientes inativos). Os outros aparecem no relatório como "sem executor".

**Anonimização:**
- Técnicas: supressão, generalização, hash com sal por contexto e máscara.
- Tokenização reversível foi recusada de propósito até existir um cofre governado.

**Adapters:**

| Situação | Domínios |
|---|---|
| Implementados | clientes, pedidos, entregas, reservas, WhatsApp, voz (campos), Customer Experience, Journeys, fiscal (vínculo), financeiro (mantido), consentimentos (mantidos como prova) |
| Pendentes (viram passo manual) | Workforce, entregadores, leads, Data Platform, arquivos no Storage, marketplaces |

## 9. Residência e suboperadores

- **Residência:** os dados ficam no Supabase em `sa-east-1`, conforme informado pelo provedor. Backups, Vercel, WhatsApp, provedores de IA e pagamentos estão marcados como "a confirmar", sem prometer residência.
- **Suboperadores:** são vendors da Fase 92 com perfil de privacidade (dados, finalidade, local, transferência, DPA da Fase 49, revisão). A lista é exportável.

## 10. Incidentes de privacidade

- Um incidente de privacidade é um incidente da Fase 59 com a nova categoria `privacy`, sempre confidencial.
- A avaliação registra: dados pessoais envolvidos, categorias, estimativa de titulares, risco, contenção, evidências e lições aprendidas.
- A decisão de comunicar a ANPD e os titulares é humana, fundamentada e fica registrada.
- O sistema gera rascunhos de comunicação.
- O prazo de comunicação vem da configuração; sem configuração, não existe prazo.

## 11. RIPD e privacy by design

- **RIPD:** versionada. A aprovação exige o parecer de quem tem `privacy:dpo`. Editar uma RIPD aprovada a devolve para "precisa atualizar".
- **Privacy by design:** a revisão de uma mudança da Fase 88 gera um checklist de privacidade, gravado em `change_checklists`.
- **Aviso no CI:** a etapa `personal-data-map` avisa quando uma migration cria coluna com cara de dado pessoal sem entrada no mapa. Ela não bloqueia o build.

## 12. Portal do titular

No perfil do Portal do Cliente o titular pode:

- baixar os próprios dados;
- gerir os consentimentos por finalidade;
- abrir pedidos e acompanhar o andamento.

Funciona no celular e usa linguagem simples. Sem a flag `privacy_dsr_portal_enabled`, ou sem a migração, a seção não aparece e o resto do portal segue normal.

## 13. Integrações

- **Identity Governance (93):** as 15 permissões viraram entitlements governados. `execute_deletion` e `dpo` são críticos.
- **Reporting:** 8 datasets e 6 métricas com denominador explícito.
- **Workspace:** widget de solicitações perto do prazo.
- **Executive Command Center:** mostra só sinais materiais (incidentes de risco alto e solicitações vencidas).
- **Copilot:** 8 ferramentas só de leitura.
- **Automation:** só lembretes.
- **Notifications:** alertas de prazo.
- **Busca:** página registrada na busca global.
- **Data Platform:** `fact_privacy_requests`.
- **Policy Engine:** os prazos e regras ficam em `privacy_settings` por contexto. O motor de políticas da Fase 79 não foi ligado.

## 14. RBAC e auditoria

**RBAC:** as 15 permissões pedidas.

| Papel | Permissões |
|---|---|
| Dono | todas |
| Admin | todas, menos `dpo` |
| Gerente | `view`, `handle_dsr` e `manage_consents` |

Executar exclusão e atuar como encarregado exigem concessão explícita pela Fase 93.

**Auditoria:** `privacy_audit_events` (imutável) e `security_audit_logs` registram:
- acesso a dados do titular e geração de pacote;
- correções, exclusões e anonimizações;
- retenção, consentimentos, holds, decisões de incidente e RIPD.

O teste T16 confirma que nome, telefone, e-mail, endereço e notas do titular não aparecem na auditoria.

## 15. Testes

- `tests/privacy-operations-phase95.test.mjs` tem 24 testes, cobrindo os 23 obrigatórios e mais um sobre os adapters. Todos passaram.
- Com as suítes das Fases 33, 37, 38, 57, 61 e 93 juntas, foram 372 testes, todos passando.
- Lint dos arquivos alterados: sem erros. O lint do repositório inteiro estourou memória nesta máquina; no CI roda normalmente.
- `typecheck:ci`: sem erros novos.
- `migration-safety` e `secret-scan` passaram.

Os testes acharam dois erros reais, já corrigidos:
- a consulta de consentimento ignorava o campo `purpose_key`, o que bloquearia todo marketing com o módulo ligado;
- faltava exigir identidade verificada antes de executar uma exclusão.

A validação no dev achou um terceiro: empate de horário no registro canônico. Foi corrigido pela migration `20261103128000_phase95c_consent_order`.

## 16. O que não foi verificado

- Envio real do código por WhatsApp: o dev não tem conexão de WhatsApp.
- Download do pacote pelo Storage real.
- Carga e volume.
- Worker rodando por `pg_cron`: ele não foi agendado.
- `vinext build`: ver o PR.

## 17. Precisa de validação do jurídico ou do encarregado

- Prazo padrão de 15 dias para solicitações e o alerta 3 dias antes.
- Prazo de comunicação de incidente (vazio de propósito).
- Rótulos das bases legais e quando exigir LIA.
- Gatilhos de RIPD.
- Textos de consentimento: hoje são marcadores "a ser redigido pelo encarregado".
- Rascunhos de comunicação à ANPD e aos titulares.
- Classificação dos dados fiscais e financeiros como guarda legal.
- Mecanismos de transferência internacional e regiões dos provedores.

## 18. Precisa de aprovação

- ~~Aplicar as 9 migrations em produção.~~ Feito em 2026-11-03, depois do merge do PR #22, com versões `20261103063715` a `20261103064110`. Avisos de segurança: só "RLS sem política", como no dev.
- Ligar as flags em alguma loja.
- Agendar o worker (`privacy_worker_secret` no Vault).
- Ligar `privacy_retention_execution_enabled`.

## 19. Limitações

- Seis domínios ainda não têm adapter e viram passo manual.
- A retenção executa só o conjunto de clientes inativos.
- Remoção de arquivos no Storage não é automática.
- O Policy Engine não foi integrado.
- O ActionEngine (`copilot_action_requests`) não foi usado: o `before_state` dele guardaria os dados apagados. A aprovação usa `internal_approvals`.
- Backups expiram pela própria retenção.
- A tela usa diálogos simples (`prompt`/`confirm`) em algumas decisões.

## 20. Recomendações para a Fase 96

1. Adapters de Workforce, entregadores, leads, Data Platform e Storage.
2. Integrar prazos e aprovações ao Policy Engine.
3. Formulários próprios no lugar dos diálogos.
4. Executor de retenção para mensagens e voz.
5. Aplicar em produção com validação do encarregado antes de ligar qualquer flag.
