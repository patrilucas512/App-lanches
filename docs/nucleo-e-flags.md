# Núcleo do produto e inventário de feature flags (Fase 97B)

Estado de produção lido em 03/11/2026, somente leitura (`plans` e `store_feature_flags` do projeto `qjwmjwubtgqginwhmajv`). Produção tem 3 planos (Básico, Profissional, MasterApp) e uma loja, a loja de teste do dono. Não existe plano "Premium": o plano mais completo se chama **MasterApp**.

## 1. Fluxos essenciais

| # | Fluxo | Telas | Rotas e funções principais | O que liga ou desliga hoje |
|---|---|---|---|---|
| 1 | Cadastro e onboarding (Fase 23) | `/cadastro`, `/onboarding` | RPCs `create_establishment`, `complete_establishment_onboarding`; `/api/onboarding` | nada (sempre disponível) |
| 2 | Plano e assinatura (Fase 22) | `/planos`, `/assinar/[code]`, `/painel/assinatura` | `/api/saas/*`, `/api/stripe/*` | papel dono/gerente; chaves do Stripe ou do gateway da plataforma |
| 3 | Cardápio, categorias, produtos, adicionais, fotos | `/painel/cardapio`, `/painel/personalizacao` | gravação direta no Supabase (RLS) | só limites do plano (`max_products`) |
| 4 | Cardápio público e QR da mesa | `/loja/[slug]`, `/q/[slug]` | RPCs `get_published_catalog`, `get_public_menu` | `service_modes` da loja e `public_menu_active` |
| 5 | Pedido na mesa, retirada e delivery | `/loja/[slug]`, `/painel/pedidos`, `/retirada/[slug]` | RPC `place_public_order_v2` | `service_modes` (`table_service_enabled`, `counter_pickup_enabled`, `delivery_enabled`) |
| 6 | Pagamento: Pix, comprovante, dinheiro com troco | cardápio público, `/garcom`, `/caixa` | `/api/order-payments/*`, `/api/table-payments/pix` | `service_modes.accepted_payment_methods`, `card_proof_required`; gateway configurado na loja |
| 7 | Cozinha/KDS e impressão | `/cozinha`, `/painel/cozinha` | RPCs `queue_kitchen_print`, `register_printer_device` | `kitchen_enabled` (menu e gatilho no banco) |
| 8 | Garçom e caixa | `/garcom`, `/painel/garcons`, `/caixa`, `/painel/caixa` | RPCs `open_cash_shift`, `register_pos_sale` | `waiter_mode_enabled` (modo da loja), `cashier_enabled` (gatilho no banco) |
| 9 | Entregador: convite, despacho, rota, comprovante, repasse | `/convite-motoboy/[token]`, `/motoboy`, `/painel/pedidos#despacho-entregas`, `/painel/equipe` | RPCs `accept_delivery_assignment`, `verify_delivery_pin`, `close_driver_financial_period` | `drivers_enabled` (gatilho no banco) |
| 10 | Acompanhamento do pedido | `/loja/[slug]`, `/conta/[slug]/pedido/[id]` | RPCs `get_public_order_status`, `get_customer_delivery_tracking` | nada (`order_tracking_enabled` existe mas não é lida) |
| 11 | Notificações push | cardápio, cozinha, entregador, garçom | função `send-push-notification` | nada no app; depende das chaves VAPID |
| 12 | WhatsApp | `/painel/whatsapp`, `/painel/atendente-ia`, `/painel/configuracoes` | `/api/whatsapp/*`, funções `send-whatsapp-*` | permissões por usuário; `whatsapp_enabled`/`ai_enabled` só no atendente |
| 13 | Portal do cliente | `/conta/[slug]` | `/api/customer-portal/[slug]/*` | `customer_portal_configs.enabled` |
| 14 | Relatórios básicos de vendas | `/painel`, `/painel/pedidos`, `/painel/caixa`, `/painel/relatorios` | RPC `get_manager_copilot_snapshot`, `/api/reports` | `advanced_reporting_enabled` só no menu |

### Como uma flag é decidida (achado importante)

- O **menu do painel** (`components/dashboard-shell.tsx`) lê apenas a tabela `plans` (via `getDashboardContext`, `lib/dashboard.ts`). Ele **não** olha `store_feature_flags`.
- Cada módulo novo (Fases 38 em diante) tem a própria leitura: ligado se a flag da **loja** OU a do **plano** estiver ligada.
- Algumas telas não checam flag nenhuma e abrem mesmo com o módulo desligado; outras redirecionam em silêncio para `/painel`.
- O banco barra criação de caixa, estoque, equipe, entregador, garçom e mesas quando o plano não inclui (`private.enforce_plan_resource`).

## 2. Situação em produção

- **340 flags** no total: 260 existem no plano e na loja, 80 só no plano.
- **22 fazem parte do núcleo** (lista na tabela abaixo).
- **Fora do núcleo, muita coisa está ligada:** 138 flags no Básico, 137 no Profissional, 142 no MasterApp e 162 na loja de teste. Exemplos no Básico: armazém (WMS), planejamento integrado (IBP), dados mestres (MDM), catálogo de dados, transporte, incidentes, OAuth/marketplace de apps.
- Para uma lanchonete pequena, isso enche o menu de módulos de rede/franquia. A etapa 97E trata o menu; desligar flags em produção **não** foi feito (fica para aprovação, ver seção 3).
- `delivery_enabled`, `whatsapp_enabled`, `ai_enabled` e outras só existem na loja (o plano não tem a coluna). `order_tracking_enabled` e `customer_portal_enabled` existem, mas nenhuma tela as lê.

## 3. Conjunto "núcleo" proposto por plano

| Recurso | Flag | Básico | Profissional | MasterApp (Premium) |
|---|---|---|---|---|
| Cardápio, pedidos, acompanhamento, portal | sem flag / `order_tracking_enabled`, `customer_portal_enabled` | ✅ | ✅ | ✅ |
| Retirada e delivery | `delivery_enabled` (loja), `pickup_display_enabled` | ✅ | ✅ | ✅ |
| Cozinha e impressão | `kitchen_enabled`, `advanced_printing_enabled` | ✅ | ✅ | ✅ |
| Caixa | `cashier_enabled` | ✅ | ✅ | ✅ |
| Entregadores | `drivers_enabled` | ✅ | ✅ | ✅ |
| Equipe | `staff_management_enabled` | ✅ | ✅ | ✅ |
| Pix e comprovante | `pix_secure_enabled`, `card_proof_enabled` | ✅ | ✅ | ✅ |
| Notificações | `notification_center_enabled` | ✅ | ✅ | ✅ |
| WhatsApp (conexão e status do pedido) | `whatsapp_enabled` (loja) | ✅ | ✅ | ✅ |
| Cupons do cliente | `customer_coupons_enabled` | ✅ | ✅ | ✅ |
| Garçom e mesa | `waiter_mode_enabled`, `table_qr_ordering_enabled`, `table_tabs_enabled`, `split_bill_enabled` | mesa simples | ✅ | ✅ |
| Relatórios | `reports_enabled` | painel de vendas | ✅ | ✅ |
| Marca no cardápio, cupons de campanha | `custom_branding_enabled`, `coupons_enabled` | — | ✅ | ✅ |
| Atendente de IA | `ai_enabled` (loja) | — | ✅ | ✅ |
| Módulos avançados (KDS avançado, salão avançado, logística avançada, fidelidade, marketplaces) | vários | — | — | ✅ |

**Recomendação (precisa de aprovação, não executada):** para o piloto, desligar no plano da loja piloto os módulos fora do núcleo, ou criar um plano "Piloto" só com o núcleo. Isso é escrita em produção e fica no roteiro da loja piloto.

**Diferenças entre o que existe e o que a proposta pede:**
- `split_bill_enabled`, `table_qr_ordering_enabled` e `table_tabs_enabled` estão **desligadas** nos três planos e ligadas só na loja de teste.
- `reports_enabled` está desligada no Básico.

## 4. Inventário completo

Legenda: ✅ ligada, — desligada, · a coluna não existe no plano, n/a a flag só existe no plano. Fase "base" = criada antes da numeração por fases. Tabela gerada a partir da leitura de produção e das migrations; o núcleo vem primeiro.

| Flag | Fase | Onde | Básico | Profissional | MasterApp | Loja de teste | Núcleo |
|---|---|---|---|---|---|---|---|
| `advanced_printing_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (impressão) |
| `ai_enabled` | 6 | plano + loja | · | · | · | ✅ | **sim** (atendente de IA (complemento)) |
| `card_proof_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (comprovante) |
| `cashier_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (caixa) |
| `coupons_enabled` | — | só plano | — | ✅ | ✅ | n/a | **sim** (cupons) |
| `custom_branding_enabled` | — | só plano | — | ✅ | ✅ | n/a | **sim** (marca no cardápio) |
| `customer_coupons_enabled` | 13 | plano + loja | ✅ | ✅ | ✅ | ✅ | **sim** (cupons) |
| `customer_portal_enabled` | 13 | plano + loja | ✅ | ✅ | ✅ | ✅ | **sim** (portal do cliente) |
| `delivery_enabled` | 7 | plano + loja | · | · | · | ✅ | **sim** (entrega) |
| `drivers_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (entregadores) |
| `kitchen_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (cozinha/KDS) |
| `notification_center_enabled` | 52 | plano + loja | ✅ | ✅ | ✅ | ✅ | **sim** (central de notificações) |
| `order_tracking_enabled` | 13 | plano + loja | ✅ | ✅ | ✅ | ✅ | **sim** (acompanhamento) |
| `pickup_display_enabled` | 43 | plano + loja | ✅ | ✅ | ✅ | ✅ | **sim** (painel de retirada) |
| `pix_secure_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (Pix) |
| `reports_enabled` | — | só plano | — | ✅ | ✅ | n/a | **sim** (relatórios) |
| `split_bill_enabled` | 42 | plano + loja | — | — | — | ✅ | **sim** (dividir conta) |
| `staff_management_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (equipe) |
| `table_qr_ordering_enabled` | 42 | plano + loja | — | — | — | ✅ | **sim** (pedido pelo QR da mesa) |
| `table_tabs_enabled` | 42 | plano + loja | — | — | — | ✅ | **sim** (comanda da mesa) |
| `waiter_mode_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | **sim** (garçom) |
| `whatsapp_enabled` | 7 | plano + loja | · | · | · | ✅ | **sim** (WhatsApp) |
| `accounting_export_enabled` | 19 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `advanced_audit_enabled` | — | só plano | — | — | — | n/a | não |
| `advanced_delivery_enabled` | 40 | plano + loja | · | · | · | ✅ | não |
| `advanced_dining_room_enabled` | 42 | plano + loja | — | — | — | ✅ | não |
| `advanced_forecasting_enabled` | — | só plano | — | — | — | n/a | não |
| `advanced_kds_enabled` | 41 | plano + loja | — | — | — | ✅ | não |
| `advanced_observability_enabled` | — | só plano | — | — | — | n/a | não |
| `advanced_reporting_enabled` | 54 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `advanced_workforce_planning_enabled` | 58 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `app_marketplace_enabled` | 21 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `assessments_enabled` | 56 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `asset_management_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `asset_qr_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `audit_ai_assistant_enabled` | 67 | plano + loja | — | — | — | — | não |
| `audit_followups_enabled` | 67 | plano + loja | — | — | — | — | não |
| `audit_offline_enabled` | 67 | plano + loja | — | — | — | — | não |
| `audit_scoring_enabled` | 67 | plano + loja | — | — | — | — | não |
| `automation_center_enabled` | 50 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `benefit_realization_enabled` | 91 | plano + loja | — | — | — | — | não |
| `budget_management_enabled` | 55 | plano + loja | — | — | — | — | não |
| `bundle_recommendations_enabled` | 36 | plano + loja | — | — | — | ✅ | não |
| `business_continuity_enabled` | — | só plano | — | — | — | n/a | não |
| `campaigns_enabled` | 7 | plano + loja | · | · | · | ✅ | não |
| `canary_releases_enabled` | — | só plano | — | — | — | n/a | não |
| `capacity_management_enabled` | 63 | plano + loja | — | — | — | — | não |
| `capacity_simulation_enabled` | 63 | plano + loja | — | — | — | — | não |
| `capacity_slots_enabled` | 63 | plano + loja | — | — | — | — | não |
| `capacity_throttling_enabled` | 63 | plano + loja | — | — | — | — | não |
| `catalog_ai_assistant_enabled` | 62 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `catalog_changesets_enabled` | 62 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `catalog_governance_enabled` | 62 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `catalog_scheduled_publish_enabled` | 62 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `central_catalog_enabled` | 46 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `central_production_enabled` | 70 | plano + loja | — | — | — | ✅ | não |
| `command_palette_enabled` | 51 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `commercial_dynamic_offer_guardrails_enabled` | — | só plano | — | — | — | n/a | não |
| `commercial_inventory_opportunities_enabled` | — | só plano | — | — | — | n/a | não |
| `commercial_recommendations_enabled` | — | só plano | — | — | — | n/a | não |
| `comms_ai_drafts_enabled` | 57 | plano + loja | — | — | — | — | não |
| `comms_board_enabled` | 57 | plano + loja | — | — | — | ✅ | não |
| `comms_crisis_enabled` | 57 | plano + loja | — | — | — | ✅ | não |
| `comms_polls_enabled` | 57 | plano + loja | — | — | — | ✅ | não |
| `continuity_advanced_failover_enabled` | — | só plano | — | — | — | n/a | não |
| `continuity_exercises_enabled` | — | só plano | — | — | — | n/a | não |
| `contract_management_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `copilot_actions_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `cross_channel_continuity_enabled` | 12 | plano + loja | ✅ | — | — | ✅ | não |
| `custom_domain_enabled` | — | só plano | — | — | ✅ | n/a | não |
| `customer_360_enabled` | 60 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `customer_ai_summary_enabled` | 60 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `customer_experience_enabled` | 38 | plano + loja | — | — | — | ✅ | não |
| `customer_health_enabled` | 28 | plano + loja | — | — | — | ✅ | não |
| `customer_identity_resolution_enabled` | 60 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `customer_journeys_enabled` | 61 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `customer_next_best_action_enabled` | 60 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `cx_ai_response_drafts_enabled` | 38 | plano + loja | — | — | — | — | não |
| `cx_ai_sentiment_enabled` | 38 | plano + loja | — | — | — | — | não |
| `cx_external_reviews_enabled` | 38 | plano + loja | — | — | — | — | não |
| `cx_service_recovery_enabled` | 38 | plano + loja | — | — | — | ✅ | não |
| `cx_surveys_enabled` | 38 | plano + loja | — | — | — | ✅ | não |
| `data_catalog_enabled` | 76 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `data_contracts_enabled` | 76 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `data_governance_ai_enabled` | 76 | plano + loja | — | — | — | — | não |
| `data_lineage_enabled` | 76 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `data_observability_enabled` | 76 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `data_products_enabled` | 76 | plano + loja | — | — | — | — | não |
| `degraded_mode_enabled` | — | só plano | — | — | — | n/a | não |
| `demand_forecasting_enabled` | 35 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `developer_portal_enabled` | 20 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `display_mode_enabled` | 53 | plano + loja | — | — | — | — | não |
| `document_ai_assistant_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `document_compliance_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `driver_tracking_enabled` | 40 | plano + loja | · | · | · | — | não |
| `dynamic_order_promises_enabled` | 63 | plano + loja | — | — | — | — | não |
| `dynamic_safety_stock_enabled` | 71 | plano + loja | — | — | — | ✅ | não |
| `e2e_testing_enabled` | — | só plano | — | — | — | n/a | não |
| `enterprise_portfolio_management_enabled` | 91 | plano + loja | — | — | — | — | não |
| `enterprise_risk_management_enabled` | — | só plano | — | — | — | n/a | não |
| `enterprise_session_policy_enabled` | — | só plano | — | — | — | n/a | não |
| `expansion_geo_analysis_enabled` | 66 | plano + loja | — | — | — | — | não |
| `expansion_pipeline_enabled` | 65 | plano + loja | — | — | — | — | não |
| `experiments_enabled` | — | só plano | — | — | — | n/a | não |
| `external_logistics_enabled` | 40 | plano + loja | · | · | · | — | não |
| `financial_management_enabled` | 17 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `financial_multi_store_enabled` | — | só plano | — | — | — | n/a | não |
| `financial_reconciliation_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `fiscal_auto_issue_enabled` | 19 | plano + loja | — | — | — | — | não |
| `fiscal_module_enabled` | 19 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `food_quality_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `forecast_recommendations_enabled` | 35 | plano + loja | · | · | · | ✅ | não |
| `franchise_finance_enabled` | 64 | plano + loja | — | — | — | — | não |
| `franchise_finance_forecast_enabled` | 64 | plano + loja | — | — | — | — | não |
| `franchise_management_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `franchise_royalties_enabled` | 64 | plano + loja | — | — | — | — | não |
| `franchise_settlements_enabled` | 64 | plano + loja | — | — | — | — | não |
| `franchise_territories_enabled` | 66 | plano + loja | — | — | — | — | não |
| `geo_analytics_enabled` | 66 | plano + loja | — | — | — | — | não |
| `geo_management_enabled` | 66 | plano + loja | — | — | — | — | não |
| `global_search_enabled` | 51 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `go_live_orchestration_enabled` | 65 | plano + loja | — | — | — | — | não |
| `goals_enabled` | 55 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `growth_engine_enabled` | — | só plano | — | — | — | n/a | não |
| `hardware_hub_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `ibp_ai_copilot_enabled` | 74 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `ibp_enabled` | 74 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `ibp_execution_bridge_enabled` | 74 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `ibp_financial_reconciliation_enabled` | 74 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `ibp_scenarios_enabled` | 74 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `identity_access_reviews_enabled` | 93 | plano + loja | — | — | — | — | não |
| `identity_ai_assistance_enabled` | 93 | plano + loja | — | — | — | — | não |
| `identity_break_glass_enabled` | 93 | plano + loja | — | — | — | — | não |
| `identity_governance_enabled` | 93 | plano + loja | — | — | — | — | não |
| `identity_jit_enabled` | 93 | plano + loja | — | — | — | — | não |
| `identity_reconciliation_enabled` | 93 | plano + loja | — | — | — | — | não |
| `identity_sod_enabled` | 93 | plano + loja | — | — | — | — | não |
| `incident_detection_enabled` | 59 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `incident_management_enabled` | 59 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `incident_postmortems_enabled` | 59 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `incident_war_room_enabled` | 59 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `internal_certifications_enabled` | 56 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `internal_communications_enabled` | 57 | plano + loja | — | — | — | ✅ | não |
| `internal_recall_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `internal_requisitions_enabled` | 70 | plano + loja | — | — | — | ✅ | não |
| `interstore_transfers_enabled` | 70 | plano + loja | — | — | — | ✅ | não |
| `inventory_enabled` | base | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `inventory_forecasting_enabled` | — | só plano | — | — | — | n/a | não |
| `inventory_prediction_enabled` | 35 | plano + loja | · | · | · | — | não |
| `ip_allowlist_enabled` | — | só plano | — | — | — | n/a | não |
| `journey_ai_assistant_enabled` | 61 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `journey_experiments_enabled` | 61 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `journey_network_scope_enabled` | 61 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `kiosk_analytics_enabled` | 43 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `kiosk_loyalty_enabled` | 43 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `kiosk_payments_enabled` | 43 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `kitchen_batching_enabled` | 41 | plano + loja | — | — | — | — | não |
| `kitchen_capacity_enabled` | 41 | plano + loja | — | — | — | ✅ | não |
| `kitchen_orchestration_enabled` | 41 | plano + loja | — | — | — | ✅ | não |
| `knowledge_ai_assistant_enabled` | 68 | plano + loja | — | — | — | — | não |
| `knowledge_base_enabled` | 68 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `knowledge_customer_safe_content_enabled` | 68 | plano + loja | — | — | — | — | não |
| `knowledge_offline_enabled` | 68 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `knowledge_semantic_search_enabled` | 68 | plano + loja | — | — | — | — | não |
| `labor_cost_enabled` | 18 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `labor_planning_enabled` | 58 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `learning_ai_assistant_enabled` | 56 | plano + loja | — | — | — | — | não |
| `learning_center_enabled` | 56 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `learning_paths_enabled` | 56 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `license_tracking_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `lifecycle_messaging_enabled` | — | só plano | — | — | — | n/a | não |
| `load_testing_enabled` | — | só plano | — | — | — | n/a | não |
| `local_hardware_agent_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `lot_tracking_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `loyalty_club_enabled` | 14 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `loyalty_enabled` | base | plano + loja | — | — | ✅ | ✅ | não |
| `loyalty_portal_enabled` | 13 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `maintenance_analytics_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `marketing_attribution_enabled` | 37 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `marketing_experiments_enabled` | 37 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `marketing_fund_enabled` | 64 | plano + loja | — | — | — | — | não |
| `marketing_intelligence_enabled` | 37 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `marketplace_auto_accept_enabled` | 69 | plano + loja | — | — | — | — | não |
| `marketplace_capacity_sync_enabled` | 69 | plano + loja | — | — | — | ✅ | não |
| `marketplace_catalog_sync_enabled` | 69 | plano + loja | — | — | — | ✅ | não |
| `marketplace_financial_reconciliation_enabled` | 69 | plano + loja | — | — | — | ✅ | não |
| `marketplace_integrations_enabled` | 20 | plano + loja | — | — | ✅ | ✅ | não |
| `mdm_ai_assistant_enabled` | 75 | plano + loja | — | — | — | — | não |
| `mdm_data_quality_enabled` | 75 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `mdm_deduplication_enabled` | 75 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `mdm_enabled` | 75 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `mdm_golden_records_enabled` | 75 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `mdm_merge_center_enabled` | 75 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `menu_engineering_enabled` | 36 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `mfa_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `model_monitoring_enabled` | 35 | plano + loja | · | · | · | ✅ | não |
| `multi_echelon_inventory_enabled` | 71 | plano + loja | — | — | — | ✅ | não |
| `multi_store_inventory_enabled` | 16 | plano + loja | — | — | — | — | não |
| `network_benchmarking_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `network_governance_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `network_incidents_enabled` | 59 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `network_operations_center_enabled` | — | só plano | — | — | — | n/a | não |
| `network_pricing_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `network_search_enabled` | 51 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `network_workflows_enabled` | 50 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `next_best_journey_enabled` | 61 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `noc_cross_domain_correlation_enabled` | — | só plano | — | — | — | n/a | não |
| `noc_network_view_enabled` | — | só plano | — | — | — | n/a | não |
| `noc_predictive_risk_enabled` | — | só plano | — | — | — | n/a | não |
| `notification_ai_summary_enabled` | 52 | plano + loja | — | — | — | — | não |
| `notification_digests_enabled` | 52 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `notification_escalation_enabled` | 52 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `oauth_apps_enabled` | 21 | plano + loja | — | ✅ | ✅ | ✅ | não |
| `offline_cash_enabled` | 44 | plano + loja | — | — | — | — | não |
| `offline_delivery_updates_enabled` | 44 | plano + loja | — | — | — | ✅ | não |
| `offline_kds_enabled` | 44 | plano + loja | — | — | — | ✅ | não |
| `offline_operations_enabled` | 44 | plano + loja | — | — | — | ✅ | não |
| `offline_orders_enabled` | 44 | plano + loja | — | — | — | ✅ | não |
| `okr_enabled` | 55 | plano + loja | — | — | — | — | não |
| `omnichannel_inbox_enabled` | 12 | plano + loja | ✅ | — | — | ✅ | não |
| `open_shifts_enabled` | 58 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `opening_ai_assistant_enabled` | 65 | plano + loja | — | — | — | — | não |
| `opening_readiness_enabled` | 65 | plano + loja | — | — | — | — | não |
| `operational_audits_enabled` | 67 | plano + loja | — | — | — | — | não |
| `paid_apps_enabled` | 21 | plano + loja | — | — | ✅ | — | não |
| `partner_platform_enabled` | 21 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `payment_terminal_integration_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `performance_dashboard_enabled` | — | só plano | — | — | — | n/a | não |
| `performance_management_enabled` | 55 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `personalized_home_enabled` | 53 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `playbooks_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `portfolio_capacity_planning_enabled` | 91 | plano + loja | — | — | — | — | não |
| `portfolio_scenario_planning_enabled` | 91 | plano + loja | — | — | — | — | não |
| `preventive_maintenance_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `preview_environments_enabled` | — | só plano | — | — | — | n/a | não |
| `price_simulator_enabled` | 36 | plano + loja | — | — | — | ✅ | não |
| `pricing_recommendations_enabled` | 36 | plano + loja | — | — | — | ✅ | não |
| `privacy_ai_assistance_enabled` | 95 | plano + loja | — | — | — | — | não |
| `privacy_auto_anonymization_enabled` | 95 | plano + loja | — | — | — | — | não |
| `privacy_dsr_portal_enabled` | 95 | plano + loja | — | — | — | — | não |
| `privacy_operations_enabled` | 95 | plano + loja | — | — | — | — | não |
| `privacy_retention_execution_enabled` | 95 | plano + loja | — | — | — | — | não |
| `privacy_setup_enabled` | 96 | plano + loja | — | — | — | — | não |
| `procurement_copilot_enabled` | 39 | plano + loja | — | — | — | ✅ | não |
| `procurement_intelligence_enabled` | 39 | plano + loja | — | — | — | ✅ | não |
| `product_analytics_enabled` | — | só plano | — | — | — | n/a | não |
| `production_batch_traceability_enabled` | 70 | plano + loja | — | — | — | ✅ | não |
| `production_planning_enabled` | 70 | plano + loja | — | — | — | ✅ | não |
| `profitability_analysis_enabled` | 36 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `public_api_enabled` | 20 | plano + loja | — | — | ✅ | ✅ | não |
| `purchase_management_enabled` | 16 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `quick_actions_enabled` | 51 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `quote_comparison_enabled` | 39 | plano + loja | — | — | — | ✅ | não |
| `recipe_costing_enabled` | 16 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `recurring_billing_enabled` | 14 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `redistribution_recommendations_enabled` | 71 | plano + loja | — | — | — | ✅ | não |
| `reliability_backtesting_enabled` | — | só plano | — | — | — | n/a | não |
| `reliability_network_view_enabled` | — | só plano | — | — | — | n/a | não |
| `reliability_release_guardrails_enabled` | — | só plano | — | — | — | n/a | não |
| `renewal_workflows_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `reorder_enabled` | 13 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `replenishment_planning_enabled` | 39 | plano + loja | — | — | — | ✅ | não |
| `report_ai_builder_enabled` | 54 | plano + loja | — | — | — | — | não |
| `report_builder_enabled` | 54 | plano + loja | — | — | — | — | não |
| `report_exports_enabled` | 54 | plano + loja | — | — | — | — | não |
| `reservations_enabled` | 15 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `revenue_management_enabled` | — | só plano | — | — | — | n/a | não |
| `risk_concentration_analysis_enabled` | — | só plano | — | — | — | n/a | não |
| `risk_kri_monitoring_enabled` | — | só plano | — | — | — | n/a | não |
| `route_optimization_enabled` | 40 | plano + loja | · | · | · | ✅ | não |
| `saved_searches_enabled` | 51 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `scale_integration_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `schedule_builder_enabled` | 58 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `scheduled_reports_enabled` | 54 | plano + loja | — | — | — | — | não |
| `scorecards_enabled` | 55 | plano + loja | — | — | — | — | não |
| `search_analytics_enabled` | 51 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `security_ai_assistance_enabled` | 94 | plano + loja | — | — | — | — | não |
| `security_alerts_enabled` | — | só plano | — | — | — | n/a | não |
| `security_detection_engine_enabled` | 94 | plano + loja | — | — | — | — | não |
| `security_investigation_workbench_enabled` | 94 | plano + loja | — | — | — | — | não |
| `security_operations_center_enabled` | 94 | plano + loja | — | — | — | — | não |
| `security_response_orchestration_enabled` | 94 | plano + loja | — | — | — | — | não |
| `security_threat_hunting_enabled` | 94 | plano + loja | — | — | — | — | não |
| `self_service_enabled` | 43 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `service_reliability_enabled` | — | só plano | — | — | — | n/a | não |
| `shift_planning_enabled` | 18 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `smart_dispatch_enabled` | 40 | plano + loja | · | · | · | — | não |
| `smart_kitchen_queue_enabled` | 41 | plano + loja | — | — | — | — | não |
| `smart_promotions_enabled` | 37 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `sso_enabled` | — | só plano | — | — | — | n/a | não |
| `staffing_forecast_enabled` | 58 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `staffing_forecasting_enabled` | — | só plano | — | — | — | n/a | não |
| `staffing_prediction_enabled` | 35 | plano + loja | · | · | · | — | não |
| `store_opening_enabled` | 65 | plano + loja | — | — | — | — | não |
| `subscriptions_enabled` | 14 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `supplier_document_import_enabled` | 19 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `supplier_scoring_enabled` | 39 | plano + loja | — | — | — | ✅ | não |
| `supply_chain_planning_enabled` | 71 | plano + loja | — | — | — | ✅ | não |
| `supply_scenarios_enabled` | 71 | plano + loja | — | — | — | ✅ | não |
| `team_inbox_enabled` | 52 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `temperature_tracking_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `temporary_operations_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `territory_management_enabled` | 66 | plano + loja | — | — | — | — | não |
| `third_party_risk_enabled` | — | só plano | — | — | — | n/a | não |
| `time_clock_enabled` | 18 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `traceability_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `transport_cost_management_enabled` | 73 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `transport_load_consolidation_enabled` | 73 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `transport_management_enabled` | 73 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `transport_pod_enabled` | 73 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `transport_route_planning_enabled` | 73 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `transport_tracking_enabled` | 73 | plano + loja | — | — | — | — | não |
| `vendor_due_diligence_enabled` | 92 | plano + loja | — | — | — | — | não |
| `vendor_exit_planning_enabled` | 92 | plano + loja | — | — | — | — | não |
| `vendor_management_enabled` | 92 | plano + loja | — | — | — | — | não |
| `vendor_renewal_management_enabled` | 92 | plano + loja | — | — | — | — | não |
| `vendor_sla_management_enabled` | 92 | plano + loja | — | — | — | — | não |
| `visual_regression_enabled` | — | só plano | — | — | — | n/a | não |
| `voice_ai_enabled` | 11 | plano + loja | — | — | — | ✅ | não |
| `voice_callback_enabled` | 11 | plano + loja | — | — | — | ✅ | não |
| `voice_human_transfer_enabled` | 11 | plano + loja | — | — | — | ✅ | não |
| `voice_ordering_enabled` | 11 | plano + loja | — | — | — | ✅ | não |
| `voice_recording_enabled` | 11 | plano + loja | — | — | — | — | não |
| `waiter_orchestration_enabled` | 42 | plano + loja | — | — | — | ✅ | não |
| `web_chat_enabled` | 12 | plano + loja | ✅ | — | — | ✅ | não |
| `webhooks_enabled` | 20 | plano + loja | — | ✅ | ✅ | ✅ | não |
| `wms_directed_putaway_enabled` | 72 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `wms_enabled` | 72 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `wms_handling_units_enabled` | 72 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `wms_offline_enabled` | 72 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `wms_slotting_enabled` | 72 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `wms_wave_picking_enabled` | 72 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `work_orders_enabled` | — | só plano | ✅ | ✅ | ✅ | n/a | não |
| `workflow_ai_builder_enabled` | 50 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `workflow_builder_enabled` | 50 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `workflow_simulation_enabled` | 50 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `workforce_management_enabled` | 18 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `workspace_customization_enabled` | 53 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `workspace_enabled` | 53 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
| `workspace_templates_enabled` | 53 | plano + loja | ✅ | ✅ | ✅ | ✅ | não |
