# Fase 95 — Diagnóstico inicial: Privacy Operations & LGPD

Levantamento feito em 2026-11-03 na `main` (`dde56f8`), só por leitura das migrations, de `lib/` e de `app/`. Este módulo é ferramenta de operação, não aconselhamento jurídico.

## 1. Mapa de dados pessoais

| Titular | Onde está | Campos pessoais | Sensível |
|---|---|---|---|
| Cliente final | `customers` (por loja) e `organization_customers` (por rede, Fase 7) | nome, telefone, e-mail, nascimento, notas de CRM | — |
| Cliente final | `customer_addresses`, `orders.delivery_address`, `delivery_destinations` | endereço, latitude/longitude | localização |
| Cliente final | `orders`, `reservations`, `waitlist_entries` | nome, telefone, observações | — |
| Cliente final | `whatsapp_contacts`, `whatsapp_messages`, omnichannel (Fase 12) | telefone, nome de perfil, conteúdo | — |
| Cliente final | `voice_call_sessions`, `voice_transcript_segments` (Fase 11) | telefone, gravação, transcrição | gravação |
| Cliente final | `customer360_preferences` (Fase 60), `cx_risk_signals` (Fase 38) | preferência alimentar, sinal de alergia | **saúde** |
| Funcionário | `custom_staff_members`, `employee_documents` (Fase 18) | nome, telefone, foto, documentos | documentos |
| Entregador | `driver_profiles`, `driver_locations` | telefone, `cpf_hash`, localização (apagada em 30 dias) | localização |
| Cliente do SaaS | `billing_contacts` (Fase 22), `establishments`, `pix_settings` | nome, e-mail, telefone, documento | documento |
| Lead | `sales_leads`, `sales_contacts` (Fase 29) | nome, e-mail, telefone | — |
| Usuário do SaaS | `superadmin_audit_logs.ip_address` | IP em claro | — |

A Data Governance (Fase 76) cataloga ativos e campos por organização (`data_assets`, `data_asset_fields` com `sensitivity='personal_data'`), mas não tem os campos do produto pré-cadastrados. Por isso o mapa da Fase 95 traz 53 linhas que descrevem o esquema do produto (sem contexto, valem para todos os tenants) e pode ser ligado ao catálogo de cada tenant por `data_asset_field_id`.

O cliente canônico é `organization_customers` (identidade da rede), com `customers` por loja apontando para ele. O Master Data (Fase 75) tem `master_entity_registry` com status `anonymized`, que a exclusão deve respeitar.

## 2. Consentimentos existentes e como serão centralizados

| Onde | O que guarda | Quem lê antes de enviar |
|---|---|---|
| `customers.marketing_status` (Fase 5) | opted_in / opted_out / unknown | campanhas de CRM, outbox da Fase 4, Marketing (37), CX (38) |
| `whatsapp_contacts.marketing_opt_out`, `marketing_status` | opt-out por contato | campanhas, ponte de disparo da Fase 37, CX |
| `crm_consent_events` (Fase 5) | histórico de opt-in/opt-out com origem e evidência | Journeys (61) |
| `customer_notification_preferences` (Fase 13) | marketing por WhatsApp e e-mail, transacional | Journeys, CX, Portal |
| `customer_subscriptions.consent_*` (Fase 14) | aceite de cobrança recorrente | — (não é marketing) |
| `channel_continuities.consented_at` (Fase 12) | continuidade entre canais | omnichannel |
| `sales_leads.consent_basis` (Fase 29) | base do contato comercial | Sales CRM |

Não existe consentimento por cliente para uso de dados em IA, e `lib/whatsapp/*` não confere consentimento (os envios de marketing passam pelas funções SQL, que conferem).

**Centralização:** `consent_records` vira o registro canônico, por finalidade e canal, com versão do texto, origem e evidência. Para não quebrar quem já lê:

- toda escrita nas tabelas antigas é espelhada no registro canônico por gatilho (`crm_consent_events` e `customer_notification_preferences`);
- toda mudança feita pelo módulo passa por `privacy_record_consent`, que grava o registro canônico e atualiza as colunas antigas na mesma transação; assim, uma revogação chega na hora às campanhas e ao outbox em SQL;
- o estado atual é importado como baseline (marcado `baseline:`), para ninguém confundir com um aceite novo;
- Journeys, Customer Experience e Marketing passam a consultar o registro canônico quando o módulo está ligado na loja; se o registro não puder ser lido, marketing não sai e mensagem transacional do pedido continua.

## 3. Domínios com obrigação de guarda

- **Fiscal (19):** `fiscal_documents` liga ao cliente por `customer_id` (`on delete set null`); o XML provavelmente traz o CPF do destinatário (não confirmado). Mantido; só o vínculo pessoal pode ser anonimizado.
- **Financeiro (17):** `financial_entries` e afins; `order_payment_transactions.pix_key`. Mantido.
- **Contratos (49):** `contracts`, `compliance_documents` com `retention_until` e `legal_hold_future` (coluna que nada usa hoje). Mantido.
- **Audit:** `audit_logs`, `security_audit_logs` e cerca de 80 tabelas `*_audit_events`. Nunca apagadas.

## 4. Lacunas

1. Não há registro de atividades de tratamento (ROPA), bases legais nem RIPD.
2. `customer_privacy_requests` (Fase 13) só aceita 4 tipos e 4 status, sem prazo, verificação, evidência ou resposta.
3. Não existe legal hold geral nem fluxo de exclusão; existem só purgas pontuais (`purge_old_driver_locations`, webhooks de marketplace).
4. Consentimento espalhado em 4 lugares, sem versão de texto e sem finalidade além de marketing.
5. Incidentes (59) não têm categoria de privacidade.
6. Vendors (92) não registram quais dados pessoais recebem.
7. Backups (25) expiram pela política de retenção; não há remoção seletiva, e o produto não deve prometer isso.

## 5. Plano

| Etapa | Entrega |
|---|---|
| 95A | `privacy_contexts` (tenant e MasterApp), permissões, configurações, `personal_data_map` sobre a Fase 76, achados de campos sem mapeamento, auditoria imutável, 5 flags desligadas |
| 95B | Catálogo configurável de bases legais e `processing_activities` com versões |
| 95C | `consent_records` canônico, finalidades e textos versionados, espelhamento, baseline e consulta com fail-safe |
| 95D | `customer_privacy_requests` estendida (11 tipos, 8 status, prazo, verificação, eventos, pacote de exportação) |
| 95E | Retenção (simulação por padrão), legal holds, sal por contexto, planos e passos de exclusão |
| 95F | Residência, perfil de privacidade de vendors, incidente com categoria `privacy` e RIPD |
| 95G | Revisão de privacy by design na Change Management, usos de IA, Portal do titular, Reporting, Workspace, Executive, Copilot, Identity |
