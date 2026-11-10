// Fases 98B/98C: o que liga cada item do menu do painel (e a tela dele).
// `plan` é o plano já somado às flags da loja (lib/store-entitlements.ts). Item sem regra aparece sempre.
// mode "all" (padrão): todas as flags diferentes de false; "any": basta uma; "strict": precisa ser true.
export type MenuPlan = Record<string, unknown>;
export type ModuleRule = { label: string; flags: readonly string[]; mode?: "all" | "any" | "strict" };

export const MODULE_RULES: Record<string, ModuleRule> = {
  // Fase 99A: busca global e paleta de comandos (não é item do menu; o shell só mostra a paleta com as duas ligadas).
  "global-search": { label: "Busca global", flags: ["global_search_enabled", "command_palette_enabled"] },
  "overview": { label: "Minha Home", flags: ["workspace_enabled", "personalized_home_enabled"] },
  "cashier": { label: "Caixa", flags: ["cashier_enabled"] },
  "network": { label: "Rede", flags: ["network_governance_enabled"] },
  "geo-map": { label: "Rede · Mapa", flags: ["geo_management_enabled", "network_governance_enabled"] },
  "audits": { label: "Auditorias", flags: ["operational_audits_enabled"] },
  "knowledge": { label: "Conhecimento", flags: ["knowledge_base_enabled"] },
  "quality": { label: "Qualidade", flags: ["food_quality_enabled"] },
  "assets": { label: "Ativos e Manutenção", flags: ["asset_management_enabled"] },
  "documents": { label: "Documentos e Obrigações", flags: ["document_compliance_enabled"] },
  "automation": { label: "Automação", flags: ["automation_center_enabled"] },
  "notifications": { label: "Central de Notificações", flags: ["notification_center_enabled"] },
  "internal-communications": { label: "Comunicação Interna", flags: ["internal_communications_enabled"] },
  "my-announcements": { label: "Comunicados", flags: ["internal_communications_enabled"] },
  "reports": { label: "Relatórios", flags: ["advanced_reporting_enabled"] },
  "performance-management": { label: "Metas e Desempenho", flags: ["performance_management_enabled"] },
  "my-learning": { label: "Meu aprendizado", flags: ["learning_center_enabled"] },
  "learning-admin": { label: "Centro de Aprendizado", flags: ["learning_center_enabled"] },
  "forecast": { label: "Previsão", flags: ["demand_forecasting_enabled"] },
  "menu-engineering": { label: "Engenharia de Cardápio", flags: ["menu_engineering_enabled"] },
  "marketing-intelligence": { label: "Marketing · Inteligência", flags: ["marketing_intelligence_enabled"] },
  "inventory": { label: "Estoque", flags: ["inventory_enabled"] },
  "procurement": { label: "Compras", flags: ["procurement_intelligence_enabled"] },
  "logistics": { label: "Central de Despacho", flags: ["advanced_delivery_enabled", "drivers_enabled"] },
  "finance": { label: "Financeiro", flags: ["financial_management_enabled"] },
  "franchise-finance": { label: "Franquias · Financeiro", flags: ["franchise_finance_enabled", "franchise_management_enabled"] },
  "store-opening": { label: "Expansão · Novas Unidades", flags: ["store_opening_enabled"] },
  "fiscal": { label: "Fiscal", flags: ["fiscal_module_enabled"] },
  "workforce": { label: "Gestão de Pessoas", flags: ["workforce_management_enabled"] },
  "workforce-planning": { label: "Escalas e Cobertura", flags: ["workforce_management_enabled", "advanced_workforce_planning_enabled"] },
  "kitchen": { label: "Cozinha", flags: ["kitchen_enabled"] },
  "kitchen-orchestration": { label: "Cozinha Avançada", flags: ["kitchen_enabled", "advanced_kds_enabled"] },
  "capacity": { label: "Capacidade", flags: ["capacity_management_enabled"] },
  "central-production": { label: "Produção Central", flags: ["central_production_enabled"] },
  "supply-chain": { label: "Abastecimento", flags: ["supply_chain_planning_enabled"] },
  "warehouse": { label: "Armazém", flags: ["wms_enabled", "inventory_enabled"] },
  "transport": { label: "Transporte", flags: ["transport_management_enabled"] },
  "ibp": { label: "Planejamento Integrado", flags: ["ibp_enabled"] },
  "digital-twin": { label: "Simulador da Operação", flags: ["digital_twin_enabled"] },
  "revenue-management": { label: "Gestão de Receita", flags: ["revenue_management_enabled"] },
  "network-operations": { label: "Central da Rede", flags: ["network_operations_center_enabled"] },
  "service-reliability": { label: "Confiabilidade", flags: ["service_reliability_enabled"] },
  "business-continuity": { label: "Continuidade de Negócios", flags: ["business_continuity_enabled"] },
  "enterprise-risk": { label: "Riscos Empresariais", flags: ["enterprise_risk_management_enabled"] },
  "change-management": { label: "Mudanças", flags: ["enterprise_change_management_enabled"] },
  "process-intelligence": { label: "Análise de Processos", flags: ["process_intelligence_enabled"] },
  "enterprise-architecture": { label: "Arquitetura Empresarial", flags: ["enterprise_architecture_enabled"] },
  "enterprise-portfolio": { label: "Portfólio Estratégico", flags: ["enterprise_portfolio_management_enabled"] },
  "vendor-management": { label: "Terceiros & Fornecedores", flags: ["vendor_management_enabled"] },
  "security-operations": { label: "Central de Segurança", flags: ["security_operations_center_enabled"] },
  "identity-governance": { label: "Governança de Acessos", flags: ["identity_governance_enabled"] },
  "privacy-operations": { label: "Privacidade & LGPD", flags: ["privacy_operations_enabled"] },
  "customer-experience": { label: "Clientes · Experiência & Reputação", flags: ["customer_experience_enabled"] },
  "data-governance": { label: "Governança de Dados", flags: ["data_catalog_enabled"] },
  "voice": { label: "Voz", mode: "strict", flags: ["voice_ai_enabled"] },
  "subscriptions": { label: "Assinaturas", flags: ["subscriptions_enabled"] },
  "dining": { label: "Salão", flags: ["reservations_enabled", "advanced_dining_room_enabled"] },
  "self-service": { label: "Autoatendimento", flags: ["self_service_enabled"] },
  "continuity": { label: "Continuidade", flags: ["offline_operations_enabled"] },
  "incidents": { label: "Incidentes", flags: ["incident_management_enabled"] },
  "customer360": { label: "Clientes · Perfil Completo", flags: ["customer_360_enabled"] },
  "journeys": { label: "Jornadas de clientes", flags: ["customer_journeys_enabled"] },
  "central-catalog": { label: "Catálogo central", flags: ["central_catalog_enabled"] },
  "hardware": { label: "Equipamentos", flags: ["hardware_hub_enabled"] },
  "marketplace-integrations": { label: "Canais de delivery", flags: ["marketplace_integrations_enabled"] },
  "marketplace": { label: "Loja de Aplicativos", flags: ["app_marketplace_enabled"] },
  "developers": { label: "Desenvolvedores", flags: ["partner_platform_enabled"] },
  "security": { label: "Segurança", flags: ["mfa_enabled"] },
  "team": { label: "Equipe", mode: "any", flags: ["staff_management_enabled", "drivers_enabled", "waiter_mode_enabled"] },
  "deliveries": { label: "Entregas", flags: ["drivers_enabled", "delivery_enabled"] },
  "ai-attendant": { label: "Atendente IA", flags: ["ai_enabled"] },
  "whatsapp-supervision": { label: "Supervisão", flags: ["whatsapp_enabled"] },
  "master-data": { label: "Dados Mestres", flags: ["mdm_enabled"] },
  "intelligence": { label: "Inteligência", flags: ["manager_intelligence_enabled"] },
  "analytics": { label: "Análise de Dados", flags: ["analytics_center_enabled"] },
  "units": { label: "Unidades", flags: ["multi_unit_enabled"] },
  "inbox": { label: "Caixa de Entrada", flags: ["omnichannel_inbox_enabled"] },
  "crm": { label: "Relacionamento com Clientes", flags: ["crm_enabled"] },
  "integrations": { label: "Integrações", flags: ["integrations_center_enabled"] },
  "integration-orchestration": { label: "Automação de Integrações", flags: ["integration_orchestration_enabled"] },
  "calls": { label: "Chamados", flags: ["waiter_mode_enabled"] },
};

// Itens sempre disponíveis (núcleo e conta): atendimento (modos e garçons), cardápio, pedidos, configurações,
// cobrança, ajuda, suporte.
export const ALWAYS_AVAILABLE_MENU_KEYS = ["onboarding", "attendance", "orders", "catalog", "customize", "settings", "billing", "help", "saas-support", "waiter"] as const;

export function menuRuleKeys() { return Object.keys(MODULE_RULES); }

function flagOn(plan: MenuPlan, flag: string, strict: boolean) { return strict ? plan[flag] === true : plan[flag] !== false; }

export function isMenuItemEntitled(key: string, plan: MenuPlan | null | undefined): boolean {
  if (!plan) return true;
  const rule = MODULE_RULES[key];
  if (!rule) return true;
  if (rule.mode === "any") return rule.flags.some((f) => flagOn(plan, f, false));
  return rule.flags.every((f) => flagOn(plan, f, rule.mode === "strict"));
}

// Por que o módulo está desligado: "plan" quando alguma flag que falta é controlada pelo plano; "store" quando
// só faltam chaves que existem apenas na loja (entrega, WhatsApp, atendente), desligadas pela própria loja ou
// pelo administrador. `basePlan` é o plano sem as flags da loja.
export function moduleOffReason(key: string, merged: MenuPlan, basePlan: MenuPlan | null | undefined): "plan" | "store" {
  const rule = MODULE_RULES[key];
  if (!rule || !basePlan) return "plan";
  const missing = rule.flags.filter((f) => !flagOn(merged, f, rule.mode === "strict"));
  return missing.some((f) => Object.prototype.hasOwnProperty.call(basePlan, f)) ? "plan" : "store";
}
