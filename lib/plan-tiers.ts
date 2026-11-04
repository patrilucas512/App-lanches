// Fase 98B: o que cada nível de plano liga. Fonte única para o código e para os testes; as migrations
// 20261104131000_phase98b_pilot_plan.sql e 20261104132000_phase98b_plan_cleanup.sql gravam as mesmas listas.
// Os planos são identificados pelo código "piloto" e, os demais, pela ordem de preço entre os planos ativos
// (o mais barato é o Básico, o seguinte o Profissional, o mais caro o MasterApp/Premium), porque os códigos
// de produção não seguem um padrão.

// Núcleo do docs/nucleo-e-flags.md: cardápio e pedidos (sem flag), mesa, retirada, delivery (chave da loja),
// pagamento, cozinha/impressão, garçom/caixa, entregador, acompanhamento, push, WhatsApp básico (chave da
// loja) e relatórios básicos (painel de vendas).
export const PILOT_PLAN_FLAGS = [
  "workspace_enabled",
  "personalized_home_enabled",
  "kitchen_enabled",
  "advanced_printing_enabled",
  "cashier_enabled",
  "waiter_mode_enabled",
  "table_qr_ordering_enabled",
  "table_tabs_enabled",
  "drivers_enabled",
  "staff_management_enabled",
  "pix_secure_enabled",
  "card_proof_enabled",
  "order_tracking_enabled",
  "customer_portal_enabled",
  "pickup_display_enabled",
  "notification_center_enabled",
  "reports_enabled",
  "mfa_enabled",
] as const;

export const BASIC_PLAN_FLAGS = [...PILOT_PLAN_FLAGS, "customer_coupons_enabled", "reorder_enabled"] as const;

export const PROFESSIONAL_PLAN_FLAGS = [
  ...BASIC_PLAN_FLAGS,
  "split_bill_enabled",
  "coupons_enabled",
  "custom_branding_enabled",
  "inventory_enabled",
  "recipe_costing_enabled",
  "purchase_management_enabled",
  "financial_management_enabled",
  "financial_reconciliation_enabled",
  "fiscal_module_enabled",
  "accounting_export_enabled",
  "supplier_document_import_enabled",
  "reservations_enabled",
  "loyalty_enabled",
  "loyalty_club_enabled",
  "loyalty_portal_enabled",
  "subscriptions_enabled",
  "recurring_billing_enabled",
  "workforce_management_enabled",
  "time_clock_enabled",
  "shift_planning_enabled",
  "labor_cost_enabled",
  "advanced_reporting_enabled",
  "menu_engineering_enabled",
  "profitability_analysis_enabled",
  "manager_intelligence_enabled",
  "analytics_center_enabled",
  "crm_enabled",
  "integrations_center_enabled",
  "webhooks_enabled",
  "omnichannel_inbox_enabled",
  "team_inbox_enabled",
  "web_chat_enabled",
  "global_search_enabled",
  "command_palette_enabled",
  "quick_actions_enabled",
  "campaigns_enabled",
  "smart_promotions_enabled",
  "customer_360_enabled",
  "knowledge_base_enabled",
  "notification_digests_enabled",
  "payment_terminal_integration_enabled",
  "hardware_hub_enabled",
  "local_hardware_agent_enabled",
] as const;

// Itens de menu que não tinham flag (Fase 97E) e colunas que o menu lia sem existirem no banco.
export const NEW_MENU_FLAGS = [
  "manager_intelligence_enabled",
  "analytics_center_enabled",
  "multi_unit_enabled",
  "crm_enabled",
  "integrations_center_enabled",
  "integration_orchestration_enabled",
  "digital_twin_enabled",
  "enterprise_architecture_enabled",
  "enterprise_change_management_enabled",
  "process_intelligence_enabled",
] as const;

// Flags avançadas que existiam só na loja: passam a ter coluna no plano (desligadas fora do Premium).
export const STORE_ONLY_ADVANCED_FLAGS = [
  "advanced_delivery_enabled",
  "campaigns_enabled",
  "driver_tracking_enabled",
  "external_logistics_enabled",
  "forecast_recommendations_enabled",
  "inventory_prediction_enabled",
  "model_monitoring_enabled",
  "route_optimization_enabled",
  "smart_dispatch_enabled",
  "staffing_prediction_enabled",
] as const;

// Chaves que continuam só da loja, decididas pelo dono (Fase 98A: private.store_operational_flags).
export const STORE_OPERATIONAL_FLAGS = ["delivery_enabled", "whatsapp_enabled", "ai_enabled"] as const;
