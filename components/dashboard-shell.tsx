import Link from "next/link";
import { Brand } from "@/components/ui";
import { DashboardMobileNav } from "@/components/dashboard-mobile-nav";
import { DashboardTopbar } from "@/components/dashboard-topbar";
import { operationTheme, brandName, brandLogo, type EstablishmentBrand } from "@/lib/operation-theme";
import { StoreScopeSwitcher } from "@/components/store-scope-switcher";
import { SystemTour } from "@/components/system-tour";
import { SecuritySessionBeacon } from "@/components/security-session-beacon";
import { GlobalCommandPalette } from "@/components/global-command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { ContextualKnowledgeHelp } from "@/components/contextual-knowledge-help";
import "@/app/global-search.css";
import "@/app/painel/notificacoes/notifications.css";

export type DashboardLink = {
  key: string;
  href: string;
  label: string;
  icon: string;
  group: "principal" | "operacao" | "gestao";
};

type PlanEntitlements = { network_governance_enabled?:boolean; franchise_management_enabled?:boolean; central_catalog_enabled?:boolean; network_pricing_enabled?:boolean; network_benchmarking_enabled?:boolean; hardware_hub_enabled?:boolean; local_hardware_agent_enabled?:boolean; advanced_printing_enabled?:boolean; payment_terminal_integration_enabled?:boolean; scale_integration_enabled?:boolean; cashier_enabled?: boolean; inventory_enabled?: boolean; financial_management_enabled?:boolean; workforce_management_enabled?:boolean; fiscal_module_enabled?:boolean; staff_management_enabled?: boolean; drivers_enabled?: boolean; waiter_mode_enabled?: boolean; kitchen_enabled?: boolean; advanced_kds_enabled?:boolean; kitchen_orchestration_enabled?:boolean; advanced_dining_room_enabled?:boolean; table_tabs_enabled?:boolean; waiter_orchestration_enabled?:boolean; split_bill_enabled?:boolean; table_qr_ordering_enabled?:boolean; self_service_enabled?:boolean; kiosk_payments_enabled?:boolean; pickup_display_enabled?:boolean; kiosk_loyalty_enabled?:boolean; kiosk_analytics_enabled?:boolean; offline_operations_enabled?:boolean; voice_ai_enabled?:boolean; subscriptions_enabled?:boolean; reservations_enabled?:boolean; marketplace_integrations_enabled?:boolean; app_marketplace_enabled?:boolean;partner_platform_enabled?:boolean;mfa_enabled?:boolean; demand_forecasting_enabled?:boolean; menu_engineering_enabled?:boolean; marketing_intelligence_enabled?:boolean; procurement_intelligence_enabled?:boolean; advanced_delivery_enabled?:boolean };
type FoodQualityEntitlements = { food_quality_enabled?:boolean; lot_tracking_enabled?:boolean; temperature_tracking_enabled?:boolean; traceability_enabled?:boolean; internal_recall_enabled?:boolean; asset_management_enabled?:boolean; preventive_maintenance_enabled?:boolean; work_orders_enabled?:boolean; maintenance_analytics_enabled?:boolean; asset_qr_enabled?:boolean; document_compliance_enabled?:boolean; contract_management_enabled?:boolean; license_tracking_enabled?:boolean; renewal_workflows_enabled?:boolean; document_ai_assistant_enabled?:boolean; automation_center_enabled?:boolean; workflow_builder_enabled?:boolean; workflow_simulation_enabled?:boolean; workflow_ai_builder_enabled?:boolean; network_workflows_enabled?:boolean; global_search_enabled?:boolean; command_palette_enabled?:boolean; quick_actions_enabled?:boolean; saved_searches_enabled?:boolean; search_analytics_enabled?:boolean; network_search_enabled?:boolean; notification_center_enabled?:boolean; team_inbox_enabled?:boolean; notification_escalation_enabled?:boolean; notification_digests_enabled?:boolean; notification_ai_summary_enabled?:boolean; workspace_enabled?:boolean; personalized_home_enabled?:boolean; workspace_customization_enabled?:boolean; workspace_templates_enabled?:boolean; display_mode_enabled?:boolean; advanced_reporting_enabled?:boolean; report_builder_enabled?:boolean; scheduled_reports_enabled?:boolean; report_exports_enabled?:boolean; report_ai_builder_enabled?:boolean; performance_management_enabled?:boolean; goals_enabled?:boolean; okr_enabled?:boolean; budget_management_enabled?:boolean; scorecards_enabled?:boolean; learning_center_enabled?:boolean; learning_paths_enabled?:boolean; assessments_enabled?:boolean; internal_certifications_enabled?:boolean; learning_ai_assistant_enabled?:boolean };
type WorkforcePlanningEntitlements = { advanced_workforce_planning_enabled?:boolean; staffing_forecast_enabled?:boolean; schedule_builder_enabled?:boolean; open_shifts_enabled?:boolean; labor_planning_enabled?:boolean };
type IncidentEntitlements = { incident_management_enabled?:boolean; incident_war_room_enabled?:boolean; incident_detection_enabled?:boolean; incident_postmortems_enabled?:boolean; network_incidents_enabled?:boolean };
type Customer360Entitlements = { customer_360_enabled?:boolean; customer_health_enabled?:boolean; customer_next_best_action_enabled?:boolean; customer_identity_resolution_enabled?:boolean; customer_ai_summary_enabled?:boolean };
type JourneyEntitlements = { customer_journeys_enabled?:boolean; journey_experiments_enabled?:boolean; journey_ai_assistant_enabled?:boolean; next_best_journey_enabled?:boolean; journey_network_scope_enabled?:boolean };
type CatalogEntitlements = { central_catalog_enabled?:boolean; catalog_governance_enabled?:boolean; catalog_changesets_enabled?:boolean; catalog_scheduled_publish_enabled?:boolean; catalog_ai_assistant_enabled?:boolean };
type CapacityEntitlements = { capacity_management_enabled?:boolean; capacity_slots_enabled?:boolean; dynamic_order_promises_enabled?:boolean; capacity_throttling_enabled?:boolean; capacity_simulation_enabled?:boolean };
type FranchiseFinanceEntitlements = { franchise_finance_enabled?:boolean; franchise_royalties_enabled?:boolean; marketing_fund_enabled?:boolean; franchise_settlements_enabled?:boolean; franchise_finance_forecast_enabled?:boolean };
type StoreOpeningEntitlements = { store_opening_enabled?:boolean; expansion_pipeline_enabled?:boolean; opening_readiness_enabled?:boolean; go_live_orchestration_enabled?:boolean; opening_ai_assistant_enabled?:boolean };
type GeoEntitlements = { geo_management_enabled?:boolean; territory_management_enabled?:boolean; geo_analytics_enabled?:boolean; expansion_geo_analysis_enabled?:boolean; franchise_territories_enabled?:boolean };
type AuditEntitlements = { operational_audits_enabled?:boolean; audit_offline_enabled?:boolean; audit_scoring_enabled?:boolean; audit_followups_enabled?:boolean; audit_ai_assistant_enabled?:boolean };
type KnowledgeEntitlements = { knowledge_base_enabled?:boolean; knowledge_semantic_search_enabled?:boolean; knowledge_ai_assistant_enabled?:boolean; knowledge_offline_enabled?:boolean; knowledge_customer_safe_content_enabled?:boolean; central_production_enabled?:boolean; internal_requisitions_enabled?:boolean; interstore_transfers_enabled?:boolean; production_batch_traceability_enabled?:boolean; production_planning_enabled?:boolean; supply_chain_planning_enabled?:boolean; multi_echelon_inventory_enabled?:boolean; redistribution_recommendations_enabled?:boolean; supply_scenarios_enabled?:boolean; dynamic_safety_stock_enabled?:boolean; wms_enabled?:boolean; wms_directed_putaway_enabled?:boolean; wms_wave_picking_enabled?:boolean; wms_handling_units_enabled?:boolean; wms_offline_enabled?:boolean; wms_slotting_enabled?:boolean };
type TransportEntitlements = { transport_management_enabled?:boolean; ibp_enabled?:boolean; digital_twin_enabled?:boolean; revenue_management_enabled?:boolean; commercial_recommendations_enabled?:boolean; network_operations_center_enabled?:boolean; noc_network_view_enabled?:boolean; service_reliability_enabled?:boolean; reliability_release_guardrails_enabled?:boolean; reliability_network_view_enabled?:boolean; reliability_backtesting_enabled?:boolean; business_continuity_enabled?:boolean; continuity_advanced_failover_enabled?:boolean; continuity_exercises_enabled?:boolean; enterprise_risk_management_enabled?:boolean; third_party_risk_enabled?:boolean; risk_kri_monitoring_enabled?:boolean; risk_concentration_analysis_enabled?:boolean; data_catalog_enabled?:boolean; data_contracts_enabled?:boolean; data_lineage_enabled?:boolean; data_observability_enabled?:boolean };

const allLinks: DashboardLink[] = [
  { key: "overview", href: "/home", label: "Minha Home", icon: "⌂", group: "principal" },
  { key: "notifications", href: "/painel/notificacoes", label: "Central de Notificações", icon: "🔔", group: "principal" },
  { key: "intelligence", href: "/painel/inteligencia", label: "Inteligência", icon: "✦", group: "principal" },
  { key: "forecast", href: "/painel/previsao", label: "Previsão", icon: "⌁", group: "principal" },
  { key: "menu-engineering", href: "/painel/engenharia-cardapio", label: "Engenharia de Cardápio", icon: "◫", group: "principal" },
  { key: "marketing-intelligence", href: "/painel/marketing-inteligencia", label: "Marketing · Inteligência", icon: "◎", group: "principal" },
  { key: "analytics", href: "/painel/analytics", label: "Analytics & Dados", icon: "⌁", group: "principal" },
  { key: "reports", href: "/painel/relatorios", label: "Relatórios", icon: "▥", group: "principal" },
  { key: "performance-management", href: "/painel/metas", label: "Metas e Performance", icon: "◎", group: "principal" },
  { key: "my-learning", href: "/painel/aprendizado", label: "Meu aprendizado", icon: "◫", group: "principal" },
  { key: "knowledge", href: "/painel/conhecimento", label: "Conhecimento", icon: "▧", group: "principal" },
  { key: "units", href: "/painel/unidades", label: "Unidades", icon: "▣", group: "principal" },
  { key: "network", href: "/painel/rede", label: "Rede", icon: "◉", group: "principal" },
  { key: "geo-map", href: "/painel/rede/mapa", label: "Rede · Mapa", icon: "⌖", group: "principal" },
  { key: "audits", href: "/painel/auditorias", label: "Auditorias", icon: "✓", group: "operacao" },
  { key: "quality", href: "/painel/qualidade", label: "Qualidade", icon: "✓", group: "principal" },
  { key: "assets", href: "/painel/ativos", label: "Ativos e Manutenção", icon: "◇", group: "operacao" },
  { key: "documents", href: "/painel/documentos", label: "Documentos e Obrigações", icon: "▧", group: "gestao" },
  { key: "automation", href: "/painel/automacao", label: "Automação", icon: "⌁", group: "gestao" },
  { key: "onboarding", href: "/onboarding", label: "Primeiros passos", icon: "✓", group: "principal" },
  { key: "attendance", href: "/painel/atendimento", label: "Atendimento", icon: "◌", group: "operacao" },
  { key: "inbox", href: "/painel/caixa-de-entrada", label: "Caixa de Entrada", icon: "◎", group: "operacao" },
  { key: "voice", href: "/painel/voz", label: "Voz", icon: "☎", group: "operacao" },
  { key: "whatsapp-supervision", href: "/painel/whatsapp/supervisao", label: "Supervisão", icon: "◫", group: "gestao" },
  { key: "ai-attendant", href: "/painel/atendente-ia", label: "Atendente IA", icon: "✦", group: "gestao" },
  { key: "crm", href: "/painel/crm", label: "CRM", icon: "◇", group: "gestao" },
  { key: "customer360", href: "/painel/clientes-360", label: "Clientes · Perfil 360", icon: "◎", group: "gestao" },
  { key: "journeys", href: "/painel/jornadas", label: "Jornadas de clientes", icon: "↝", group: "gestao" },
  { key: "subscriptions", href: "/painel/assinaturas", label: "Assinaturas", icon: "◉", group: "gestao" },
  { key: "kitchen", href: "/cozinha", label: "Cozinha", icon: "◆", group: "operacao" },
  { key: "kitchen-orchestration", href: "/painel/cozinha", label: "KDS Avançado", icon: "◈", group: "operacao" },
  { key: "capacity", href: "/painel/capacidade", label: "Capacidade", icon: "◴", group: "operacao" },
  { key: "central-production", href: "/painel/producao-central", label: "Produção Central", icon: "◆", group: "operacao" },
  { key: "supply-chain", href: "/painel/supply-chain", label: "Supply Chain", icon: "⌁", group: "operacao" },
  { key: "warehouse", href: "/painel/armazem", label: "Armazém WMS", icon: "▦", group: "operacao" },
  { key: "transport", href: "/painel/transporte", label: "Transporte TMS", icon: "⇄", group: "operacao" },
  { key: "ibp", href: "/painel/planejamento/ibp", label: "Planejamento IBP", icon: "◎", group: "gestao" },
  { key: "digital-twin", href: "/painel/planejamento/digital-twin", label: "Digital Twin", icon: "◇", group: "gestao" },
  { key: "revenue-management", href: "/painel/comercial/revenue-management", label: "Revenue Management", icon: "↗", group: "gestao" },
  { key: "network-operations", href: "/painel/operacoes/central-da-rede", label: "Central da Rede", icon: "◉", group: "operacao" },
  { key: "service-reliability", href: "/painel/operacoes/confiabilidade", label: "Confiabilidade", icon: "◌", group: "operacao" },
  { key: "business-continuity", href: "/painel/operacoes/continuidade-negocio", label: "Continuidade de Negócios", icon: "↻", group: "operacao" },
  { key: "master-data", href: "/painel/dados-mestres", label: "Dados Mestres", icon: "◈", group: "gestao" },
  { key: "data-governance", href: "/painel/governanca-dados", label: "Governança de Dados", icon: "⌘", group: "gestao" },
  { key: "enterprise-risk", href: "/painel/governanca/riscos", label: "Riscos Empresariais", icon: "△", group: "gestao" },
  { key: "orders", href: "/painel/pedidos", label: "Pedidos", icon: "≡", group: "operacao" },
  { key: "dining", href: "/painel/salao", label: "Salão", icon: "▦", group: "operacao" },
  { key: "self-service", href: "/painel/autoatendimento", label: "Autoatendimento", icon: "▣", group: "operacao" },
  { key: "continuity", href: "/painel/continuidade", label: "Continuidade", icon: "↻", group: "operacao" },
  { key: "incidents", href: "/painel/incidentes", label: "Incidentes", icon: "!", group: "operacao" },
  { key: "hardware", href: "/painel/hardware", label: "Hardware", icon: "⌘", group: "gestao" },
  { key: "deliveries", href: "/painel/pedidos#despacho-entregas", label: "Entregas", icon: "🚚", group: "operacao" },
  { key: "logistics", href: "/painel/logistica", label: "Central de Despacho", icon: "⌖", group: "operacao" },
  { key: "cashier", href: "/painel/caixa", label: "Caixa", icon: "$", group: "operacao" },
  { key: "catalog", href: "/painel/cardapio", label: "Cardápio", icon: "▦", group: "gestao" },
  { key: "central-catalog", href: "/painel/catalogo-central", label: "Catálogo central", icon: "◫", group: "gestao" },
  { key: "customize", href: "/painel/personalizacao", label: "Personalizar site", icon: "✦", group: "gestao" },
  { key: "inventory", href: "/painel/estoque", label: "Estoque", icon: "▤", group: "gestao" },
  { key: "procurement", href: "/painel/compras", label: "Compras", icon: "◧", group: "gestao" },
  { key: "finance", href: "/painel/financeiro", label: "Financeiro", icon: "R$", group: "gestao" },
  { key: "franchise-finance", href: "/painel/franquias-financeiro", label: "Franquias · Financeiro", icon: "%", group: "gestao" },
  { key: "store-opening", href: "/painel/novas-unidades", label: "Expansão · Novas Unidades", icon: "↗", group: "gestao" },
  { key: "fiscal", href: "/painel/fiscal", label: "Fiscal", icon: "▧", group: "gestao" },
  { key: "integrations", href: "/painel/integracoes", label: "Integrações", icon: "↔", group: "gestao" },
  { key: "integration-orchestration", href: "/painel/integracoes/orquestracao", label: "Orquestração iPaaS", icon: "⌘", group: "gestao" },
  { key: "marketplace-integrations", href: "/painel/integracoes/marketplaces", label: "Canais de delivery", icon: "⇄", group: "gestao" },
  { key: "marketplace", href: "/painel/marketplace", label: "Marketplace", icon: "▦", group: "gestao" },
  { key: "developers", href: "/painel/desenvolvedores", label: "Desenvolvedores", icon: "</>", group: "gestao" },
  { key: "security", href: "/painel/seguranca", label: "Segurança", icon: "◈", group: "gestao" },
  { key: "calls", href: "/painel/chamados", label: "Chamados", icon: "!", group: "operacao" },
  { key: "team", href: "/painel/equipe", label: "Equipe", icon: "◎", group: "gestao" },
  { key: "workforce", href: "/painel/equipe/gestao", label: "Gestão de Pessoas", icon: "◷", group: "gestao" },
  { key: "workforce-planning", href: "/painel/escalas", label: "Escalas e Cobertura", icon: "▦", group: "gestao" },
  { key: "learning-admin", href: "/painel/treinamentos", label: "Centro de Aprendizado", icon: "▤", group: "gestao" },
  { key: "settings", href: "/painel/configuracoes", label: "Configurações", icon: "⚙", group: "gestao" },
  { key: "billing", href: "/painel/assinatura", label: "Plano e cobrança", icon: "◇", group: "gestao" },
  { key: "help", href: "/painel/ajuda", label: "Ajuda", icon: "?", group: "gestao" },
  { key: "saas-support", href: "/painel/suporte", label: "Suporte MasterApp", icon: "◉", group: "gestao" },
];

const attendantLinks: DashboardLink[] = [
  { key: "inbox", href: "/painel/caixa-de-entrada", label: "Caixa de Entrada", icon: "◎", group: "operacao" },
  { key: "voice", href: "/painel/voz", label: "Voz", icon: "☎", group: "operacao" },
  { key: "whatsapp-supervision", href: "/painel/whatsapp/supervisao", label: "Supervisão", icon: "◫", group: "gestao" },
  { key: "waiter", href: "/painel/garcom", label: "Pedidos", icon: "≡", group: "operacao" },
  { key: "calls", href: "/painel/chamados", label: "Chamados", icon: "!", group: "operacao" },
];

const groupLabels = { principal: "Principal", operacao: "Operação", gestao: "Gestão" };

function roleLabel(role?: string) {
  if (role === "owner") return "Proprietário";
  if (role === "manager") return "Gerente";
  if (role === "catalog_editor") return "Editor de catálogo";
  if (role === "attendant") return "Atendimento";
  if (role === "kitchen") return "Cozinha";
  return "Administrador";
}

export function DashboardShell({ children, active = "overview", storeSlug, role, operationColors, brand }: { children: React.ReactNode; active?: string; storeSlug?: string; role?: string; operationColors?: React.CSSProperties; brand?: EstablishmentBrand }) {
  const colors = brand ? operationTheme(brand) : operationColors;
  const name = brand ? brandName(brand) : "MasterApp";
  const logo = brand ? brandLogo(brand) : "";
  const plan = (brand as EstablishmentBrand & { plan?: (PlanEntitlements & FoodQualityEntitlements & WorkforcePlanningEntitlements & IncidentEntitlements & Customer360Entitlements & JourneyEntitlements & CatalogEntitlements & CapacityEntitlements & FranchiseFinanceEntitlements & StoreOpeningEntitlements & GeoEntitlements & AuditEntitlements & KnowledgeEntitlements & TransportEntitlements) | null } | undefined)?.plan;
  const entitledLinks = allLinks.filter(link => {
    if (!plan) return true;
    if (link.key === "overview") return plan.workspace_enabled !== false && plan.personalized_home_enabled !== false;
    if (link.key === "cashier") return plan.cashier_enabled !== false;
    if (link.key === "network") return plan.network_governance_enabled !== false;
    if (link.key === "geo-map") return plan.geo_management_enabled !== false && plan.network_governance_enabled !== false;
    if (link.key === "audits") return plan.operational_audits_enabled !== false;
    if (link.key === "knowledge") return plan.knowledge_base_enabled !== false;
    if (link.key === "quality") return plan.food_quality_enabled !== false;
    if (link.key === "assets") return plan.asset_management_enabled !== false;
    if (link.key === "documents") return plan.document_compliance_enabled !== false;
    if (link.key === "automation") return plan.automation_center_enabled !== false;
    if (link.key === "notifications") return plan.notification_center_enabled !== false;
    if (link.key === "reports") return plan.advanced_reporting_enabled !== false;
    if (link.key === "performance-management") return plan.performance_management_enabled !== false;
    if (link.key === "my-learning" || link.key === "learning-admin") return plan.learning_center_enabled !== false;
    if (link.key === "forecast") return plan.demand_forecasting_enabled !== false;
    if (link.key === "menu-engineering") return plan.menu_engineering_enabled !== false;
    if (link.key === "marketing-intelligence") return plan.marketing_intelligence_enabled !== false;
    if (link.key === "inventory") return plan.inventory_enabled !== false;
    if (link.key === "procurement") return plan.procurement_intelligence_enabled !== false;
    if (link.key === "logistics") return plan.advanced_delivery_enabled !== false && plan.drivers_enabled !== false;
    if (link.key === "finance") return plan.financial_management_enabled !== false;
    if (link.key === "franchise-finance") return plan.franchise_finance_enabled !== false && plan.franchise_management_enabled !== false;
    if (link.key === "store-opening") return plan.store_opening_enabled !== false;
    if (link.key === "fiscal") return plan.fiscal_module_enabled !== false;
    if (link.key === "workforce") return plan.workforce_management_enabled !== false;
    if (link.key === "workforce-planning") return plan.workforce_management_enabled !== false && plan.advanced_workforce_planning_enabled !== false;
    if (link.key === "kitchen") return plan.kitchen_enabled !== false;
    if (link.key === "kitchen-orchestration") return plan.kitchen_enabled !== false && plan.advanced_kds_enabled !== false;
    if (link.key === "capacity") return plan.capacity_management_enabled !== false;
    if (link.key === "central-production") return plan.central_production_enabled !== false;
    if (link.key === "supply-chain") return plan.supply_chain_planning_enabled !== false;
    if (link.key === "warehouse") return plan.wms_enabled !== false && plan.inventory_enabled !== false;
    if (link.key === "transport") return plan.transport_management_enabled !== false;
    if (link.key === "ibp") return plan.ibp_enabled !== false;
    if (link.key === "digital-twin") return plan.digital_twin_enabled !== false;
    if (link.key === "revenue-management") return plan.revenue_management_enabled !== false;
    if (link.key === "network-operations") return plan.network_operations_center_enabled !== false;
    if (link.key === "service-reliability") return plan.service_reliability_enabled !== false;
    if (link.key === "business-continuity") return plan.business_continuity_enabled !== false;
    if (link.key === "enterprise-risk") return plan.enterprise_risk_management_enabled !== false;
    if (link.key === "data-governance") return plan.data_catalog_enabled !== false;
    if (link.key === "voice") return plan.voice_ai_enabled === true;
    if (link.key === "subscriptions") return plan.subscriptions_enabled !== false;
    if (link.key === "dining") return plan.reservations_enabled !== false && plan.advanced_dining_room_enabled !== false;
    if (link.key === "self-service") return plan.self_service_enabled !== false;
    if (link.key === "continuity") return plan.offline_operations_enabled !== false;
    if (link.key === "incidents") return plan.incident_management_enabled !== false;
    if (link.key === "customer360") return plan.customer_360_enabled !== false;
    if (link.key === "journeys") return plan.customer_journeys_enabled !== false;
    if (link.key === "central-catalog") return plan.central_catalog_enabled !== false;
    if (link.key === "hardware") return plan.hardware_hub_enabled !== false;
    if (link.key === "marketplace-integrations") return plan.marketplace_integrations_enabled !== false;
    if (link.key === "marketplace") return plan.app_marketplace_enabled !== false;
    if (link.key === "developers") return plan.partner_platform_enabled !== false;
    if (link.key === "security") return plan.mfa_enabled !== false;
    if (link.key === "team") return plan.staff_management_enabled !== false || plan.drivers_enabled !== false || plan.waiter_mode_enabled !== false;
    return true;
  });
  const links = role === "attendant" ? attendantLinks
    : role === "kitchen" ? entitledLinks.filter(link => link.key === "kitchen")
    : role === "catalog_editor" ? entitledLinks.filter(link => link.key === "catalog" || link.key === "central-catalog") : entitledLinks;
  const dateLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" }).format(new Date());
  const currentLabel = links.find(link => link.key === active)?.label ?? "Painel";
  const scope = brand as EstablishmentBrand & { organization?: { id: string; name: string } | null; availableStores?: { id: string; name: string; unit_status: string }[] } | undefined;

  return <main className={`dashboard admin-theme ${colors ? "operation-dashboard establishment-theme" : ""}`} style={colors}>
    <SecuritySessionBeacon organizationId={scope?.organization?.id} />
    <aside className="sidebar admin-sidebar">
      <div className="admin-sidebar-brand"><Brand href="/painel" name={name} logo={logo} /></div>
      <nav aria-label="Navegação principal">
        {(["principal", "operacao", "gestao"] as const).map(group => {
          const groupLinks = links.filter(link => link.group === group);
          if (!groupLinks.length) return null;
          return <div className="admin-nav-group" key={group}>
            <small>{groupLabels[group]}</small>
            {groupLinks.map(link => <Link key={link.key} className={active === link.key ? "active" : ""} href={link.href} aria-current={active === link.key ? "page" : undefined}><span aria-hidden="true">{link.icon}</span><b>{link.label}</b></Link>)}
          </div>;
        })}
      </nav>
      <div className="sidebar-bottom">
        {storeSlug && <Link className="admin-store-link" href={`/loja/${storeSlug}`} target="_blank"><span aria-hidden="true">↗</span><b>Ver minha loja</b></Link>}
        <div className="admin-sidebar-user"><span>MA</span><div><b>Administrador</b><small>{roleLabel(role)}</small></div></div>
        <Link className="admin-exit-link" href="/">Sair do painel</Link>
      </div>
    </aside>
    <section className="dashboard-main">
      <DashboardTopbar links={links} currentLabel={currentLabel} dateLabel={dateLabel} roleLabel={roleLabel(role)} storeSlug={storeSlug} />
      <DashboardMobileNav links={links} active={active} storeSlug={storeSlug} currentLabel={currentLabel} roleLabel={roleLabel(role)} brandName={name} brandLogo={logo} />
      {scope?.availableStores && scope.availableStores.length > 0 && <StoreScopeSwitcher activeStoreId={brand?.id ?? ""} organizationName={scope.organization?.name ?? name} stores={scope.availableStores} />}
      <div className="dashboard-content">{children}</div>
      {brand?.id && plan?.global_search_enabled !== false && plan?.command_palette_enabled !== false && <GlobalCommandPalette storeId={brand.id} />}
      {brand?.id && plan?.notification_center_enabled !== false && <NotificationBell storeId={brand.id} organizationId={scope?.organization?.id ?? undefined} />}
      {brand?.id && plan?.knowledge_base_enabled !== false && <ContextualKnowledgeHelp storeId={brand.id} />}
      {(role === "owner" || role === "manager" || !role) && <SystemTour />}
    </section>
  </main>;
}
