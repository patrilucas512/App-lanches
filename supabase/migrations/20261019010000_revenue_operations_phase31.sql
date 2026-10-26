-- Phase 31: internal Revenue Operations and executive planning for MasterApp.
-- Billing remains the source of truth for recurring revenue; snapshots are derived caches.

create table public.revenue_ops_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default array['revenue_ops:view'], active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create or replace function private.revenue_ops_allowed(requested_permission text) returns boolean
language sql stable security definer set search_path=''
as $$ select private.is_superadmin() or exists(select 1 from public.revenue_ops_permissions p where p.user_id=(select auth.uid()) and p.active and (requested_permission=any(p.permissions) or 'revenue_ops:manage'=any(p.permissions))) $$;
revoke all on function private.revenue_ops_allowed(text) from public,anon,authenticated;
grant execute on function private.revenue_ops_allowed(text) to authenticated;

create table public.revenue_metric_catalog(
  metric_key text primary key, name text not null, definition text not null, formula text not null,
  source_of_truth text not null, refresh_frequency text not null, owner text not null,
  classification text not null check(classification in('fact','calculation','estimate','hypothesis')),
  updated_at timestamptz not null default now()
);
create table public.revenue_snapshots(
  snapshot_date date primary key, mrr_cents bigint not null default 0, arr_cents bigint not null default 0,
  new_mrr_cents bigint not null default 0, expansion_mrr_cents bigint not null default 0,
  contraction_mrr_cents bigint not null default 0, churned_mrr_cents bigint not null default 0,
  reactivation_mrr_cents bigint not null default 0, active_customers integer not null default 0,
  trial_customers integer not null default 0, source_hash text not null, locked_at timestamptz,
  locked_by uuid references auth.users(id) on delete set null, calculated_at timestamptz not null default now()
);
create table public.mrr_movements(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  amount_delta_cents bigint not null, movement_type text not null check(movement_type in('new','expansion','contraction','churn','reactivation')),
  source_type text not null, source_id text not null, idempotency_key text not null unique,
  occurred_at timestamptz not null, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.revenue_forecasts(
  id uuid primary key default gen_random_uuid(), period date not null, opportunity_id uuid not null references public.sales_opportunities(id) on delete cascade,
  forecast_category text not null check(forecast_category in('pipeline','best_case','commit','closed')),
  stage_probability numeric(5,2) not null check(stage_probability between 0 and 100),
  manual_probability_override numeric(5,2) check(manual_probability_override between 0 and 100),
  estimated_mrr_cents bigint not null default 0, override_reason text,
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(),
  unique(period,opportunity_id), check(manual_probability_override is null or nullif(trim(override_reason),'') is not null)
);
create table public.revenue_targets(
  id uuid primary key default gen_random_uuid(), period date not null, metric text not null check(metric in('new_mrr','arr','new_customers','expansion','max_churn','nrr','trial_conversion')),
  target_value numeric not null, team_id text, user_id uuid references auth.users(id) on delete set null, segment text,
  owner_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null,
  reason text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.marketing_spend(
  id uuid primary key default gen_random_uuid(), source text not null, campaign text, period date not null,
  amount_cents bigint not null check(amount_cents>=0), currency text not null default 'BRL',
  import_source text not null check(import_source in('integration','csv','manual')),
  is_actual boolean not null default true, source_reference text, created_by uuid references auth.users(id) on delete set null,
  reason text not null, created_at timestamptz not null default now(), unique(source,campaign,period,source_reference)
);
create table public.revenue_cost_entries(
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null, period date not null,
  cost_type text not null check(cost_type in('ai','voice','whatsapp','gateway','variable_infrastructure','partner_app','support','other')),
  amount_cents bigint not null check(amount_cents>=0), currency text not null default 'BRL',
  classification text not null check(classification in('actual','estimated')), source text not null,
  source_reference text, reason text not null, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), unique(cost_type,period,source,source_reference)
);
create table public.revenue_budgets(
  id uuid primary key default gen_random_uuid(), period date not null,
  category text not null check(category in('new_mrr','expansion','churn','marketing_spend','provider_cost','support_cost_estimate','infrastructure_cost_estimate')),
  target_cents bigint not null default 0, actual_cents bigint not null default 0, forecast_cents bigint not null default 0,
  reason text not null, owner_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(period,category)
);
create table public.revenue_scenarios(
  id uuid primary key default gen_random_uuid(), name text not null, scenario_type text not null check(scenario_type in('base','conservative','aggressive','custom')),
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.revenue_scenario_versions(
  id uuid primary key default gen_random_uuid(), scenario_id uuid not null references public.revenue_scenarios(id) on delete cascade,
  version integer not null, assumptions jsonb not null, projection jsonb not null,
  reason text not null, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), unique(scenario_id,version)
);
create table public.revenue_risks(
  id uuid primary key default gen_random_uuid(), risk_type text not null check(risk_type in('sales_gap','churn_spike','margin_compression','pipeline_shortage','trial_conversion_drop','payment_failure_spike','concentration_risk')),
  title text not null, severity text not null check(severity in('info','warning','critical')), threshold numeric,
  measured_value numeric, classification text not null default 'calculation' check(classification in('fact','calculation','estimate','hypothesis')),
  details jsonb not null default '{}', status text not null default 'open' check(status in('open','acknowledged','resolved')),
  detected_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.revenue_reconciliation_alerts(
  id uuid primary key default gen_random_uuid(), check_type text not null check(check_type in('billing_mrr','invoice_payment','opportunity_forecast','churn_subscription')),
  period date not null, expected_value numeric, actual_value numeric, difference numeric, details jsonb not null default '{}',
  status text not null default 'open' check(status in('open','acknowledged','resolved')), detected_at timestamptz not null default now(), resolved_at timestamptz,
  unique(check_type,period)
);
create table public.revenue_goal_comments(
  id uuid primary key default gen_random_uuid(), target_id uuid not null references public.revenue_targets(id) on delete cascade,
  body text not null, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table public.revenue_executive_summaries(
  id uuid primary key default gen_random_uuid(), period date not null, frequency text not null check(frequency in('daily','weekly','monthly')),
  content jsonb not null, status text not null default 'draft' check(status in('draft','approved','archived')),
  generated_by uuid references auth.users(id) on delete set null, generated_at timestamptz not null default now(), unique(period,frequency)
);
create table public.revenue_ops_audit_events(
  id bigint generated always as identity primary key, actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null, entity_type text not null, entity_id text, reason text not null,
  before_state jsonb, after_state jsonb, created_at timestamptz not null default now()
);
create table public.revenue_ops_feature_flags(
  singleton boolean primary key default true check(singleton), revenue_ops_enabled boolean not null default true,
  executive_dashboard_enabled boolean not null default true, scenario_planning_enabled boolean not null default true,
  revenue_forecasting_enabled boolean not null default true, unit_economics_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.revenue_ops_feature_flags(singleton) values(true) on conflict(singleton) do nothing;

insert into public.revenue_metric_catalog(metric_key,name,definition,formula,source_of_truth,refresh_frequency,owner,classification) values
('mrr','MRR','Receita recorrente mensal de assinaturas ativas.','mensal + anual/12','subscriptions + plans','daily','Revenue Ops','calculation'),
('arr','ARR','Receita recorrente anualizada.','MRR x 12','RevenueMetricsService','daily','Revenue Ops','calculation'),
('net_new_mrr','Net New MRR','Variação líquida explicável de MRR.','new + expansion + reactivation - contraction - churn','mrr_movements','daily','Revenue Ops','calculation'),
('arpa','ARPA','MRR médio por cliente ativo.','MRR / clientes ativos','revenue_snapshots','daily','Revenue Ops','calculation'),
('grr','GRR','Retenção bruta de receita sem expansão.','(MRR inicial - contraction - churn) / MRR inicial','mrr_movements','monthly','Customer Success','calculation'),
('nrr','NRR','Retenção líquida incluindo expansão e reativação.','(MRR inicial + expansion + reactivation - contraction - churn) / MRR inicial','mrr_movements','monthly','Customer Success','calculation'),
('cac','CAC','Custo real de aquisição por cliente adquirido.','marketing spend real / clientes adquiridos','marketing_spend + organizations','monthly','Growth','calculation'),
('gross_margin','Margem bruta SaaS','Receita menos COGS SaaS.','(receita - custos variáveis reais/estimados identificados) / receita','usage_events + revenue_cost_entries','monthly','Finance','calculation'),
('pipeline_coverage','Pipeline coverage','Cobertura da meta restante pelo pipeline.','pipeline / max(meta - closed,0)','sales_opportunities + revenue_targets','daily','Sales','calculation')
on conflict(metric_key) do update set definition=excluded.definition,formula=excluded.formula,source_of_truth=excluded.source_of_truth,refresh_frequency=excluded.refresh_frequency,owner=excluded.owner,classification=excluded.classification,updated_at=now();

create index revenue_snapshot_date_idx on public.revenue_snapshots(snapshot_date desc);
create index mrr_movements_period_idx on public.mrr_movements(occurred_at desc,movement_type);
create index mrr_movements_org_idx on public.mrr_movements(organization_id,occurred_at desc);
create index revenue_forecasts_period_idx on public.revenue_forecasts(period,forecast_category);
create index revenue_targets_period_idx on public.revenue_targets(period,metric);
create index marketing_spend_period_idx on public.marketing_spend(period,source);
create index revenue_cost_period_idx on public.revenue_cost_entries(period,cost_type,classification);
create index revenue_risks_status_idx on public.revenue_risks(status,severity,detected_at desc);

do $$ declare t text; begin foreach t in array array['revenue_ops_permissions','revenue_metric_catalog','revenue_snapshots','mrr_movements','revenue_forecasts','revenue_targets','marketing_spend','revenue_cost_entries','revenue_budgets','revenue_scenarios','revenue_scenario_versions','revenue_risks','revenue_reconciliation_alerts','revenue_goal_comments','revenue_executive_summaries','revenue_ops_audit_events','revenue_ops_feature_flags'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy %I on public.%I for select to authenticated using((select private.revenue_ops_allowed(''revenue_ops:view'')))','revops_select_'||t,t); execute format('create policy %I on public.%I for insert to authenticated with check((select private.revenue_ops_allowed(''revenue_ops:manage'')))','revops_insert_'||t,t); execute format('create policy %I on public.%I for update to authenticated using((select private.revenue_ops_allowed(''revenue_ops:manage''))) with check((select private.revenue_ops_allowed(''revenue_ops:manage'')))','revops_update_'||t,t); execute format('create policy %I on public.%I for delete to authenticated using((select private.revenue_ops_allowed(''revenue_ops:manage'')))','revops_delete_'||t,t); end loop; end $$;

revoke all on public.revenue_ops_permissions,public.revenue_metric_catalog,public.revenue_snapshots,public.mrr_movements,public.revenue_forecasts,public.revenue_targets,public.marketing_spend,public.revenue_cost_entries,public.revenue_budgets,public.revenue_scenarios,public.revenue_scenario_versions,public.revenue_risks,public.revenue_reconciliation_alerts,public.revenue_goal_comments,public.revenue_executive_summaries,public.revenue_ops_audit_events,public.revenue_ops_feature_flags from anon;
grant select,insert,update,delete on public.revenue_ops_permissions,public.revenue_metric_catalog,public.revenue_snapshots,public.mrr_movements,public.revenue_forecasts,public.revenue_targets,public.marketing_spend,public.revenue_cost_entries,public.revenue_budgets,public.revenue_scenarios,public.revenue_scenario_versions,public.revenue_risks,public.revenue_reconciliation_alerts,public.revenue_goal_comments,public.revenue_executive_summaries,public.revenue_ops_audit_events,public.revenue_ops_feature_flags to authenticated;
grant all on public.revenue_ops_permissions,public.revenue_metric_catalog,public.revenue_snapshots,public.mrr_movements,public.revenue_forecasts,public.revenue_targets,public.marketing_spend,public.revenue_cost_entries,public.revenue_budgets,public.revenue_scenarios,public.revenue_scenario_versions,public.revenue_risks,public.revenue_reconciliation_alerts,public.revenue_goal_comments,public.revenue_executive_summaries,public.revenue_ops_audit_events,public.revenue_ops_feature_flags to service_role;
grant usage,select on sequence public.revenue_ops_audit_events_id_seq to authenticated,service_role;
