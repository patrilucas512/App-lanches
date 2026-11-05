// Fase 99A: classificação de todas as pastas de app/api. O teste tests/unit/api-module-gate-phase99.test.mjs
// falha se surgir pasta nova sem classificação ou rota de módulo sem trava (requireModuleEnabled e parecidas).
// A chave é a do item de menu em lib/menu-entitlements.ts (MODULE_RULES).

// Módulos com a trava da Fase 98C/99A (lib/module-gate.ts).
export const API_MODULE_DIRS: Record<string, string> = {
  "analytics": "analytics",
  "asset-management": "assets",
  "business-continuity": "business-continuity",
  "capacity-management": "capacity",
  "central-production": "central-production",
  "change-management": "change-management",
  "customer-journeys": "journeys",
  "customer-subscriptions": "subscriptions",
  "data-governance": "data-governance",
  "digital-twin": "digital-twin",
  "document-compliance": "documents",
  "enterprise-architecture": "enterprise-architecture",
  "enterprise-portfolio": "enterprise-portfolio",
  "enterprise-risk": "enterprise-risk",
  "fiscal": "fiscal",
  "food-quality": "quality",
  "forecasting": "forecast",
  "franchise-finance": "franchise-finance",
  "geo-management": "geo-map",
  "global-search": "global-search",
  "hardware-hub": "hardware",
  "incidents": "incidents",
  "integrated-business-planning": "ibp",
  "integration-orchestration": "integration-orchestration",
  "intelligence": "intelligence",
  "knowledge": "knowledge",
  "learning": "my-learning",
  "marketing-intelligence": "marketing-intelligence",
  "marketplace-integrations": "marketplace-integrations",
  "master-data": "master-data",
  "network-governance": "network",
  "network-operations": "network-operations",
  "offline": "continuity",
  "omnichannel": "inbox",
  "performance-management": "performance-management",
  "process-intelligence": "process-intelligence",
  "procurement-intelligence": "procurement",
  "profitability": "menu-engineering",
  "reports": "reports",
  "revenue-management": "revenue-management",
  "security-operations": "security-operations",
  "service-reliability": "service-reliability",
  "store-opening": "store-opening",
  "transport-management": "transport",
  "vendor-management": "vendor-management",
  "warehouse-management": "warehouse",
  "workforce-planning": "workforce-planning",
};

// Módulos que já conferem as próprias flags desde a fase em que nasceram (FEATURE_DISABLED ou leitura de *_enabled).
export const API_OWN_CHECK_DIRS = [
  "ai-governance", "automation", "catalog-management", "customer-360", "customer-experience", "customer-portal",
  "executive-command", "identity-governance", "integrations", "internal-communications", "kitchen-orchestration",
  "logistics", "marketplace", "notifications", "oauth", "onboarding", "operational-audits", "privacy", "public-capacity",
  "quality", "security", "self-service", "supply-chain-planning", "whatsapp",
] as const;

// Sem flag de loja: núcleo do pedido e pagamento, plataforma/superadmin, cobrança do SaaS e integrações externas.
export const API_UNFLAGGED_DIRS: Record<string, string> = {
  "customer-success": "plataforma (superadmin)",
  "feature-management": "plataforma (superadmin)",
  "health": "monitoramento",
  "internal-work": "plataforma (superadmin)",
  "order-payments": "núcleo: pagamento do pedido",
  "organization": "núcleo: conta e unidades",
  "partner": "plataforma: programa de parceiros",
  "performance": "plataforma: observabilidade",
  "platform-finops": "plataforma (superadmin)",
  "policy-engine": "plataforma (superadmin)",
  "product-analytics": "plataforma (superadmin)",
  "public": "núcleo: cardápio público",
  "reservation-payments": "pagamento de reserva (o módulo de reservas confere na tela)",
  "revenue-ops": "plataforma (superadmin)",
  "saas": "cobrança do SaaS",
  "sales-crm": "plataforma (superadmin)",
  "stripe": "cobrança do SaaS",
  "superadmin": "plataforma (superadmin)",
  "support": "núcleo: chamados para o suporte MasterApp",
  "table-payments": "núcleo: pagamento da mesa",
  "v1": "API pública com chave própria (plano confere em api_clients)",
  "voice": "webhook do provedor de voz",
  "web-chat": "widget público; a RPC confere o widget ativo",
  "workspace": "núcleo: Minha Home",
};

// Rotas chamadas pelo cron, por provedores externos ou pelo agente de impressão, não pelo usuário.
export const API_EXEMPT_PATH = /\/(worker|webhook|indexer)(\/|$)|\/fiscal\/document\/|\/customer-subscriptions\/webhook\//;
