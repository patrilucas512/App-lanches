export type ManagerPeriodKey = "today" | "yesterday" | "7d" | "30d" | "month" | "previous_month" | "custom";

export type ManagerPeriodRange = {
  key: ManagerPeriodKey;
  label: string;
  start: string;
  end: string;
  compareStart: string;
  compareEnd: string;
  comparisonLabel: string;
  sameHour: boolean;
};

export type ManagerAlert = {
  id: string;
  level: "informative" | "attention" | "critical";
  category: string;
  title: string;
  message: string;
  action_label?: string;
  action_href?: string;
};

export type ManagerSnapshot = {
  version: string;
  generated_at: string;
  scope: { organization_id: string; establishment_id: string; store_ids: string[]; all_units: boolean; timezone: string };
  period: { start: string; end: string; compare_start: string; compare_end: string };
  permissions: Record<string, boolean>;
  settings: Record<string, unknown>;
  sources: string[];
  sales: Record<string, number>;
  comparison: Record<string, number>;
  baseline: Record<string, number>;
  products: Array<Record<string, string | number | null>>;
  units: Array<Record<string, string | number | boolean | null>>;
  hourly: Array<Record<string, number>>;
  payments: Array<Record<string, string | number>>;
  delivery: Record<string, unknown>;
  campaigns: Array<Record<string, string | number | null>>;
  crm: Record<string, number>;
  support: Record<string, number>;
  ai: Record<string, number>;
  inventory: { critical_count: number; items: Array<Record<string, string | number | null>>; inventory_value_cents?:number; stockouts?:number; waste_cents?:number; pending_purchases?:number; cmv_cents?:number; product_costs?:Array<Record<string,string|number|null>> };
  financial?: { cards?:Record<string,number>; pnl?:Record<string,string|number>; payables?:Array<Record<string,unknown>>; receivables?:Array<Record<string,unknown>>; reconciliations?:Array<Record<string,unknown>>; by_store?:Array<Record<string,unknown>>; cash_sessions?:Array<Record<string,unknown>>; categories?:Array<Record<string,unknown>> };
  workforce?: { cards?:Record<string,number>; current_staff?:Array<Record<string,unknown>>; day_schedule?:Array<Record<string,unknown>>; coverage?:Array<Record<string,unknown>>; productivity?:Record<string,number>; alerts?:Array<Record<string,unknown>>; managerial_notice?:string };
  fiscal?: { cards?:Record<string,number>; profile?:Record<string,unknown>; documents?:Array<Record<string,unknown>>; exports?:Array<Record<string,unknown>>; health?:Array<Record<string,unknown>>; security?:Record<string,boolean> };
  operational: Record<string, number | boolean>;
  alerts: ManagerAlert[];
  forecast: { estimated: true; label: string; revenue_cents: number | null; basis: string; sample_orders: number };
  forecasting?: { predicted_value:number; lower_bound:number; upper_bound:number; confidence_level:string; forecast_for:string; model_type?:string; health?:string; factors?:string[] };
  profitability?: { products:Array<Record<string,string|number|null>>; cost_quality:string; recommendations?:Array<Record<string,unknown>> };
};

export type CopilotAnswer = {
  intent: string;
  title: string;
  answer: string;
  facts: string[];
  hypotheses: string[];
  recommendations: string[];
  tools: string[];
  sources: string[];
  action?: { label: string; href: string };
  fallback: boolean;
  queryAuditId?: string | null;
  actionProposal?: import("./action-types").CopilotActionProposal;
  prohibitedAction?: boolean;
};
