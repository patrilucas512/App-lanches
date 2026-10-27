-- Phase 78: internal platform FinOps. Billing, Finance, Usage Metering and Observability remain authoritative.
create schema if not exists private;

create table public.finops_member_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function private.finops_allowed(permission_key text) returns boolean
language sql stable security definer
set search_path=pg_catalog,public,private
as $$
  select (select auth.uid()) is not null and (
    private.is_superadmin() or exists(
      select 1 from public.finops_member_permissions p
      where p.user_id=(select auth.uid()) and p.active
        and (permission_key=any(p.permissions) or 'finops:*'=any(p.permissions))
    )
  )
$$;
revoke all on function private.finops_allowed(text) from public,anon;
grant execute on function private.finops_allowed(text) to authenticated,service_role;

create table public.cost_providers(
  id uuid primary key default gen_random_uuid(),
  provider_type text not null check(provider_type in('ai','voice','messaging','database','storage','bandwidth','serverless','observability','email','maps','payments','fiscal','marketplace','infrastructure','custom')),
  provider_key text not null unique,
  provider_name text not null,
  status text not null default 'draft' check(status in('draft','active','inactive','retired')),
  currency char(3) not null,
  billing_cycle text not null default 'monthly' check(billing_cycle in('daily','monthly','quarterly','annual','custom')),
  source_type text not null check(source_type in('api','invoice_import','manual','estimated','cloud_billing_export')),
  owner_label text,
  account_reference text,
  contract_document_id uuid,
  metadata_redacted jsonb not null default '{}',
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table public.cost_meter_definitions(
  id uuid primary key default gen_random_uuid(),
  meter_key text not null unique,
  service_key text not null,
  provider_id uuid references public.cost_providers(id) on delete set null,
  unit text not null check(unit in('token','minute','character','GB_month','GB_transfer','invocation','ms_compute','message','conversation','request','email','document','percentage_point','unit')),
  source text not null,
  aggregation text not null default 'sum' check(aggregation in('sum','max','average','latest','distinct_count')),
  allowed_dimensions text[] not null default '{}',
  owner_label text not null,
  content_free boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table public.provider_rate_cards(
  id uuid primary key default gen_random_uuid(),provider_id uuid not null references public.cost_providers(id) on delete restrict,
  service_key text not null,meter_key text references public.cost_meter_definitions(meter_key) on delete restrict,
  pricing_model text not null check(pricing_model in('per_unit','tiered','volume_tiered','fixed_monthly','fixed_plus_usage','percentage','minimum_commit','custom_safe_formula')),
  currency char(3) not null,valid_from timestamptz not null,valid_until timestamptz,
  version integer not null check(version>0),source text not null,status text not null default 'draft' check(status in('draft','review','active','expired','retired')),
  tier_distribution_policy text check(tier_distribution_policy in('marginal','blended') or tier_distribution_policy is null),
  safe_formula jsonb,contract_document_id uuid,created_by uuid references auth.users(id),approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(valid_until is null or valid_until>valid_from),unique(provider_id,service_key,meter_key,version)
);

create table public.provider_rate_components(
  id uuid primary key default gen_random_uuid(),rate_card_id uuid not null references public.provider_rate_cards(id) on delete cascade,
  component_order integer not null default 0,tier_from numeric(30,8),tier_to numeric(30,8),unit_price numeric(30,12) not null default 0,
  unit text not null,fixed_fee numeric(30,8),percentage numeric(12,8),minimum_fee numeric(30,8),
  metadata_redacted jsonb not null default '{}',created_at timestamptz not null default now(),
  check(tier_from is null or tier_from>=0),check(tier_to is null or tier_from is null or tier_to>tier_from),
  check(unit_price>=0),check(fixed_fee is null or fixed_fee>=0),check(percentage is null or percentage>=0),check(minimum_fee is null or minimum_fee>=0),
  unique(rate_card_id,component_order)
);

create table public.platform_cost_fx_rates(
  id uuid primary key default gen_random_uuid(),from_currency char(3) not null,to_currency char(3) not null,rate_date date not null,
  fx_rate numeric(30,12) not null check(fx_rate>0),source text not null,status text not null default 'active' check(status in('active','superseded')),
  created_at timestamptz not null default now(),unique(from_currency,to_currency,rate_date,source)
);

create table public.platform_cost_usage_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id) on delete set null,
  tenant_id uuid references public.organizations(id) on delete set null,store_id uuid references public.establishments(id) on delete set null,
  feature_key text,service_key text not null,meter_key text not null references public.cost_meter_definitions(meter_key) on delete restrict,
  quantity numeric(30,8) not null check(quantity>=0),unit text not null,occurred_at timestamptz not null,
  source_system text not null,source_event_id text not null,provider_ref text,environment text not null default 'production' check(environment in('production','staging','development','test')),
  region text,channel text,model_key text,cost_bearer text not null default 'masterapp' check(cost_bearer in('masterapp','tenant','customer','shared','unknown')),
  dimensions jsonb not null default '{}',privacy_class text not null default 'technical_no_content' check(privacy_class='technical_no_content'),
  ingestion_status text not null default 'pending' check(ingestion_status in('pending','processed','unknown_rate','failed')),
  created_at timestamptz not null default now(),unique(source_system,source_event_id)
);

create table public.platform_cost_centers(
  id uuid primary key default gen_random_uuid(),center_key text not null unique,name text not null,description text,
  active boolean not null default true,created_at timestamptz not null default now()
);

create table public.feature_cost_mappings(
  id uuid primary key default gen_random_uuid(),feature_key text not null,service_key text not null,meter_key text,
  attribution_rule text not null check(attribution_rule in('direct','weighted','exclusive','shared')),
  weight numeric(18,8),valid_from timestamptz not null,valid_until timestamptz,version integer not null check(version>0),active boolean not null default true,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  check(weight is null or weight>=0),check(valid_until is null or valid_until>valid_from),unique(feature_key,service_key,meter_key,version)
);

create table public.platform_cost_entries(
  id uuid primary key default gen_random_uuid(),usage_event_id uuid references public.platform_cost_usage_events(id) on delete set null,
  provider_id uuid not null references public.cost_providers(id) on delete restrict,rate_card_id uuid references public.provider_rate_cards(id) on delete restrict,
  cost_center_id uuid references public.platform_cost_centers(id) on delete set null,organization_id uuid references public.organizations(id) on delete set null,
  tenant_id uuid references public.organizations(id) on delete set null,store_id uuid references public.establishments(id) on delete set null,plan_id uuid references public.plans(id) on delete set null,
  feature_key text,module_key text,service_key text not null,meter_key text,quantity numeric(30,8),unit text,
  rate_version integer,original_cost numeric(30,8) not null,original_currency char(3) not null,base_cost numeric(30,8) not null,base_currency char(3) not null,
  fx_rate numeric(30,12),fx_rate_date date,cost_status text not null check(cost_status in('estimated','allocated','provider_reported','reconciled','adjusted','unknown')),
  calculation_method text not null check(calculation_method in('direct_meter','prorated','weighted_allocation','provider_statement','manual_adjustment','unknown')),
  allocation_quality text not null check(allocation_quality in('direct','high_confidence','estimated','coarse','unknown')),
  cost_bearer text not null check(cost_bearer in('masterapp','tenant','customer','shared','unknown')),
  environment text not null default 'production',region text,channel text,model_key text,occurred_at timestamptz not null,period_start date not null,
  lineage jsonb not null default '{}',exclusive_bucket_key text,created_at timestamptz not null default now(),
  check(original_cost>=0),check(base_cost>=0),unique(usage_event_id,provider_id,rate_card_id,calculation_method)
);

create table public.platform_cost_pools(
  id uuid primary key default gen_random_uuid(),provider_id uuid not null references public.cost_providers(id) on delete restrict,
  cost_center_id uuid references public.platform_cost_centers(id) on delete set null,period_start date not null,period_end date not null,
  service_key text not null,total_cost numeric(30,8) not null check(total_cost>=0),currency char(3) not null,
  allocation_method text not null check(allocation_method in('equal','usage_based','storage_based','request_based','compute_time','revenue_based','custom_safe','unallocated')),
  allocation_quality text not null check(allocation_quality in('direct','high_confidence','estimated','coarse','unknown')),
  environment text not null default 'production',status text not null default 'open' check(status in('open','allocating','allocated','reconciled','closed')),
  source_reference text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(period_end>=period_start),
  unique(provider_id,service_key,period_start,environment,source_reference)
);

create table public.cost_allocation_rules(
  id uuid primary key default gen_random_uuid(),cost_pool_type text not null,allocation_dimension text not null check(allocation_dimension in('tenant','organization','plan','feature','module','environment','region','channel','model')),
  method text not null check(method in('equal','usage_based','storage_based','request_based','compute_time','revenue_based','custom_safe')),
  weights_source text not null,formula_config jsonb not null default '{}',valid_from timestamptz not null,valid_until timestamptz,
  version integer not null check(version>0),status text not null default 'draft' check(status in('draft','review','active','expired','retired')),
  business_decision_ref text,created_by uuid references auth.users(id),approved_by uuid references auth.users(id),created_at timestamptz not null default now(),
  check(valid_until is null or valid_until>valid_from),check(method<>'revenue_based' or business_decision_ref is not null),unique(cost_pool_type,allocation_dimension,version)
);

create table public.platform_cost_allocations(
  id uuid primary key default gen_random_uuid(),cost_pool_id uuid not null references public.platform_cost_pools(id) on delete restrict,
  allocation_rule_id uuid not null references public.cost_allocation_rules(id) on delete restrict,tenant_id uuid references public.organizations(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null,feature_key text,module_key text,driver_quantity numeric(30,8),driver_unit text,
  weight numeric(30,12) not null check(weight>=0),allocated_cost numeric(30,8) not null check(allocated_cost>=0),currency char(3) not null,
  allocation_quality text not null check(allocation_quality in('direct','high_confidence','estimated','coarse','unknown')),
  lineage jsonb not null default '{}',created_at timestamptz not null default now(),unique(cost_pool_id,allocation_rule_id,tenant_id,plan_id,feature_key,module_key)
);

create table public.provider_cost_statements(
  id uuid primary key default gen_random_uuid(),provider_id uuid not null references public.cost_providers(id) on delete restrict,
  billing_period_start date not null,billing_period_end date not null,statement_id text not null,total_amount numeric(30,8) not null check(total_amount>=0),
  currency char(3) not null,source text not null,statement_hash text not null,status text not null default 'imported' check(status in('imported','mapping','reconciling','reconciled','needs_review','reversed')),
  finance_invoice_reference text,document_id uuid,imported_by uuid references auth.users(id),imported_at timestamptz not null default now(),
  metadata_redacted jsonb not null default '{}',check(billing_period_end>=billing_period_start),unique(provider_id,statement_id),unique(provider_id,statement_hash)
);

create table public.provider_cost_statement_lines(
  id uuid primary key default gen_random_uuid(),statement_id uuid not null references public.provider_cost_statements(id) on delete cascade,
  line_number integer not null,service_key text not null,meter_key text,quantity numeric(30,8),unit text,amount numeric(30,8) not null,currency char(3) not null,
  provider_reference text,line_type text not null default 'usage' check(line_type in('usage','fixed_fee','tax','surcharge','credit','commitment','adjustment','unknown')),
  mapping_status text not null default 'unmapped' check(mapping_status in('mapped','unmapped','ignored_with_reason')),
  metadata_safe jsonb not null default '{}',created_at timestamptz not null default now(),unique(statement_id,line_number),check(amount<>0)
);

create table public.platform_cost_reconciliations(
  id uuid primary key default gen_random_uuid(),statement_id uuid not null references public.provider_cost_statements(id) on delete restrict,
  service_key text,meter_key text,estimated_amount numeric(30,8) not null,provider_amount numeric(30,8) not null,variance_amount numeric(30,8) not null,
  variance_percent numeric(18,8),currency char(3) not null,tolerance_amount numeric(30,8) not null default 0,tolerance_percent numeric(18,8) not null default 0,
  status text not null check(status in('matched','within_tolerance','mismatch','incomplete','unknown')),
  issue_types text[] not null default '{}',review_notes text,reconciled_by uuid references auth.users(id),reconciled_at timestamptz,created_at timestamptz not null default now(),
  unique(statement_id,service_key,meter_key)
);

create table public.platform_cost_adjustments(
  id uuid primary key default gen_random_uuid(),provider_id uuid references public.cost_providers(id) on delete restrict,statement_id uuid references public.provider_cost_statements(id) on delete set null,
  reversal_of_id uuid references public.platform_cost_adjustments(id) on delete restrict,period_start date not null,adjustment_type text not null check(adjustment_type in('provider_credit','provider_debit','reconciliation','manual_correction','commitment_true_up','reversal')),
  amount numeric(30,8) not null check(amount<>0),currency char(3) not null,reason text not null,finance_reference text,
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);

create table public.provider_commitments(
  id uuid primary key default gen_random_uuid(),provider_id uuid not null references public.cost_providers(id) on delete restrict,
  starts_at date not null,ends_at date not null,committed_amount numeric(30,8) not null check(committed_amount>=0),currency char(3) not null,
  minimum_usage numeric(30,8),status text not null default 'draft' check(status in('draft','active','fulfilled','underused','expired','cancelled')),
  contract_document_id uuid,assumptions jsonb not null default '{}',created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  check(ends_at>=starts_at),check(minimum_usage is null or minimum_usage>=0)
);

create table public.platform_overhead_pools(
  id uuid primary key default gen_random_uuid(),period_start date not null,period_end date not null,overhead_type text not null,
  amount numeric(30,8) not null check(amount>=0),currency char(3) not null,allocation_policy text not null default 'unallocated' check(allocation_policy in('unallocated','plans','tenants','features')),
  status text not null default 'open' check(status in('open','allocated','closed')),source_reference text,created_at timestamptz not null default now(),
  check(period_end>=period_start),unique(period_start,overhead_type,source_reference)
);

create table public.platform_cost_budgets(
  id uuid primary key default gen_random_uuid(),period_start date not null,period_end date not null,scope_type text not null check(scope_type in('total_platform','provider','service','feature','environment')),
  scope_id text,budget_amount numeric(30,8) not null check(budget_amount>=0),currency char(3) not null,alert_thresholds numeric(6,3)[] not null default '{}',
  owner_label text not null,status text not null default 'active' check(status in('draft','active','closed','cancelled')),created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  check(period_end>=period_start),unique(period_start,period_end,scope_type,scope_id)
);

create table public.platform_cost_forecasts(
  id uuid primary key default gen_random_uuid(),vintage_at timestamptz not null default now(),forecast_month date not null,scenario_key text not null default 'baseline',
  scope_type text not null check(scope_type in('total_platform','provider','service','feature','plan','environment')),scope_id text,
  method text not null check(method in('trend','usage_times_tenants','known_commitment','driver_based')),
  low_amount numeric(30,8) not null,expected_amount numeric(30,8) not null,high_amount numeric(30,8) not null,currency char(3) not null,
  drivers jsonb not null default '{}',assumptions jsonb not null default '{}',status text not null default 'baseline' check(status in('baseline','scenario','superseded')),
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),check(low_amount>=0 and expected_amount>=low_amount and high_amount>=expected_amount),
  unique(vintage_at,forecast_month,scenario_key,scope_type,scope_id)
);

create table public.platform_cost_scenarios(
  id uuid primary key default gen_random_uuid(),scenario_key text not null,version integer not null check(version>0),name text not null,description text,
  assumptions jsonb not null default '{}',result jsonb not null default '{}',actions_executed boolean not null default false,
  status text not null default 'draft' check(status in('draft','calculated','reviewed','archived')),created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  unique(scenario_key,version)
);

create table public.platform_cost_anomalies(
  id uuid primary key default gen_random_uuid(),detected_at timestamptz not null default now(),scope_type text not null,scope_id text,
  anomaly_type text not null check(anomaly_type in('day_over_day_spike','moving_baseline_spike','service_usage_spike','unexpected_meter','burn_rate','unknown_cost_spike')),
  observed_amount numeric(30,8),baseline_amount numeric(30,8),currency char(3),severity text not null check(severity in('info','warning','high','critical')),
  status text not null default 'candidate' check(status in('candidate','reviewing','confirmed','dismissed','resolved')),
  correlation_context jsonb not null default '{}',explanation text,evidence jsonb not null default '{}',created_at timestamptz not null default now()
);

create table public.platform_cost_optimization_recommendations(
  id uuid primary key default gen_random_uuid(),recommendation_type text not null check(recommendation_type in('unused_resource','oversized_infrastructure','excessive_logs','high_storage_retention','expensive_model_choice','duplicate_processing','cache_opportunity','queue_retry_storm','provider_rate_mismatch','commitment_underutilization')),
  title text not null,description text not null,evidence jsonb not null,potential_savings_low numeric(30,8),potential_savings_high numeric(30,8),currency char(3),
  status text not null default 'proposed' check(status in('proposed','reviewing','accepted','rejected','implemented','measured')),
  baseline_reference jsonb,measurement_result jsonb,feature_key text,provider_id uuid references public.cost_providers(id) on delete set null,
  reviewed_by uuid references auth.users(id),reviewed_at timestamptz,created_at timestamptz not null default now(),
  check(potential_savings_low is null or potential_savings_low>=0),check(potential_savings_high is null or potential_savings_low is null or potential_savings_high>=potential_savings_low)
);

create table public.finops_margin_guardrails(
  id uuid primary key default gen_random_uuid(),scope_type text not null check(scope_type in('plan','feature','tenant_segment')),scope_id text not null,
  attention_percent numeric(9,4),low_margin_percent numeric(9,4),negative_margin_percent numeric(9,4) not null default 0,
  actions text[] not null default array['alert','recommend_pricing_review','recommend_limit_review','recommend_optimization'],
  active boolean not null default true,valid_from timestamptz not null,valid_until timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  check(valid_until is null or valid_until>valid_from),unique(scope_type,scope_id,valid_from)
);

create table public.platform_unit_economics_snapshots(
  id uuid primary key default gen_random_uuid(),period_start date not null,period_end date not null,scope_type text not null check(scope_type in('tenant','plan','feature','addon','segment')),
  scope_id text not null,gross_revenue numeric(30,8),net_revenue numeric(30,8),direct_platform_cogs numeric(30,8),allocated_platform_overhead numeric(30,8),
  total_technical_cost numeric(30,8),technical_margin numeric(30,8),technical_margin_percent numeric(18,8),currency char(3) not null,
  cost_quality text not null check(cost_quality in('direct','high_confidence','estimated','coarse','unknown')),
  p50_cost numeric(30,8),p75_cost numeric(30,8),p90_cost numeric(30,8),p95_cost numeric(30,8),definition_version integer not null,
  lineage jsonb not null default '{}',created_at timestamptz not null default now(),check(period_end>=period_start),unique(period_start,period_end,scope_type,scope_id,definition_version)
);

create table public.finops_period_closes(
  id uuid primary key default gen_random_uuid(),period_start date not null,period_end date not null,status text not null default 'open' check(status in('open','calculating','reconciling','review','closed','reopened')),
  exceptions jsonb not null default '[]',snapshot jsonb not null default '{}',closed_by uuid references auth.users(id),closed_at timestamptz,
  reopened_by uuid references auth.users(id),reopened_at timestamptz,reopen_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(period_end>=period_start),unique(period_start,period_end)
);

create table public.technical_cost_circuit_breaker_policies(
  id uuid primary key default gen_random_uuid(),feature_key text not null,workflow_key text not null,environment text not null default 'production',
  invocation_rate_threshold numeric(30,8),cost_burn_rate_threshold numeric(30,8),currency char(3),retry_rate_threshold numeric(12,8),
  action text not null check(action in('alert_only','throttle_noncritical','pause_background_workflow','request_kill_switch')),
  protects_core_ordering boolean not null default true,human_approval_required boolean not null default true,active boolean not null default false,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(feature_key,workflow_key,environment)
);

create table public.cost_meter_health_results(
  id uuid primary key default gen_random_uuid(),meter_key text not null,checked_at timestamptz not null default now(),status text not null check(status in('healthy','stale','unmapped','missing_rate','delayed','failed')),
  event_lag_seconds bigint,unmatched_events bigint not null default 0,stale_rate_card boolean not null default false,details jsonb not null default '{}'
);

create table public.finops_semantic_metrics(
  metric_key text primary key,name text not null,definition text not null,formula text not null,source_dataset text not null,grain text not null,
  owner_label text not null,unit text not null,quality_rule text not null,active boolean not null default true,created_at timestamptz not null default now()
);

create table public.finops_audit_events(
  id uuid primary key default gen_random_uuid(),actor_user_id uuid references auth.users(id),action text not null,entity_type text not null,entity_id uuid,
  reason text,before_state jsonb,after_state jsonb,metadata_redacted jsonb not null default '{}',created_at timestamptz not null default now()
);

insert into public.platform_cost_centers(center_key,name,description) values
('ai','AI','Modelos, tokens e workflows de IA'),('communications','Communications','WhatsApp, voz, email e mensageria'),
('data','Data','Banco, storage, bandwidth e Data Platform'),('infrastructure','Infrastructure','Compute, serverless, workers, queues e realtime'),
('payments','Payments','Custos de providers pagos pelo MasterApp'),('integrations','Integrations','APIs externas, marketplace, maps e fiscal'),
('analytics','Analytics','Observabilidade, relatórios e analytics'),('support_platform','Support Platform','Ferramentas técnicas internas de suporte')
on conflict(center_key) do nothing;

insert into public.finops_semantic_metrics(metric_key,name,definition,formula,source_dataset,grain,owner_label,unit,quality_rule) values
('platform_cost','Platform Cost','Custo técnico MasterApp e compartilhado; exclui custo operacional do restaurante.','sum(base_cost) where cost_bearer in (masterapp,shared)','fact_platform_cost','period,provider,service','FinOps','currency','unknown cost is not zero'),
('direct_platform_cost','Direct Platform Cost','Custo diretamente medido.','sum(base_cost) where calculation_method=direct_meter','fact_platform_cost','period,tenant,feature','FinOps','currency','direct meter required'),
('allocated_platform_cost','Allocated Platform Cost','Custo compartilhado alocado com regra versionada.','sum(allocated_cost)','fact_cost_allocation','period,scope','FinOps','currency','allocation ties to pool'),
('cost_per_tenant','Cost per Tenant','Custo técnico dividido por tenants ativos.','platform_cost / active_tenants','fact_unit_economics','period','FinOps','currency','active tenant denominator'),
('cost_per_active_store','Cost per Active Store','Custo técnico dividido por lojas ativas.','platform_cost / active_stores','fact_unit_economics','period','FinOps','currency','active store denominator'),
('cost_per_order','Cost per Order','Custo técnico dividido por pedidos válidos concluídos/processados.','platform_cost / completed_processed_orders','fact_unit_economics','period','FinOps','currency','exclude cancelled/test orders'),
('technical_gross_margin','Technical Gross Margin','Receita SaaS líquida menos COGS técnico da plataforma; não é margem contábil.','net_saas_revenue - platform_cogs','fact_unit_economics','period,scope','FinOps','currency','revenue from Billing/Finance'),
('technical_gross_margin_pct','Technical Gross Margin %','Margem técnica dividida pela receita SaaS líquida.','technical_margin / net_saas_revenue','fact_unit_economics','period,scope','FinOps','percent','unknown when revenue is zero'),
('provider_cost_variance','Provider Cost Variance','Diferença entre statement do provider e custo estimado.','provider_amount - estimated_amount','fact_cost_reconciliation','period,provider','FinOps','currency','tolerance explicit'),
('unreconciled_cost','Unreconciled Cost','Custo provider reportado ainda não reconciliado.','sum(provider_amount) where status not matched/within_tolerance','fact_cost_reconciliation','period,provider','FinOps','currency','statement required'),
('direct_cost_coverage_rate','Direct Cost Coverage Rate','Parcela diretamente medida.','direct_cost / covered_cost','fact_platform_cost','period','FinOps','percent','unknown excluded from denominator'),
('allocated_cost_coverage_rate','Allocated Cost Coverage Rate','Parcela alocada por regra versionada.','allocated_cost / covered_cost','fact_cost_allocation','period','FinOps','percent','allocation quality exposed')
on conflict(metric_key) do update set definition=excluded.definition,formula=excluded.formula,quality_rule=excluded.quality_rule;

-- Reuse existing official Billing meters without copying events or assigning prices.
insert into public.cost_meter_definitions(meter_key,service_key,unit,source,aggregation,allowed_dimensions,owner_label)
select 'billing.'||m.key,'billing',case lower(m.unit) when 'tokens' then 'token' when 'minutes' then 'minute' when 'messages' then 'message' when 'conversations' then 'conversation' when 'requests' then 'request' else 'unit' end,
       'usage_events:'||m.key,m.aggregation,array['tenant','store','feature','environment'],'Billing / FinOps'
from public.usage_meters m
on conflict(meter_key) do nothing;

create index cost_provider_type_status_idx on public.cost_providers(provider_type,status);
create index cost_meter_provider_service_idx on public.cost_meter_definitions(provider_id,service_key,active);
create index provider_rate_effective_idx on public.provider_rate_cards(provider_id,service_key,meter_key,valid_from desc,valid_until);
create index provider_rate_components_card_idx on public.provider_rate_components(rate_card_id,tier_from,tier_to);
create index platform_cost_usage_tenant_time_idx on public.platform_cost_usage_events(tenant_id,occurred_at desc);
create index platform_cost_usage_provider_meter_time_idx on public.platform_cost_usage_events(meter_key,occurred_at desc,ingestion_status);
create index platform_cost_usage_feature_time_idx on public.platform_cost_usage_events(feature_key,occurred_at desc) where feature_key is not null;
create index platform_cost_entries_provider_period_idx on public.platform_cost_entries(provider_id,period_start,service_key);
create index platform_cost_entries_tenant_period_idx on public.platform_cost_entries(tenant_id,period_start) where tenant_id is not null;
create index platform_cost_entries_feature_period_idx on public.platform_cost_entries(feature_key,period_start) where feature_key is not null;
create index platform_cost_entries_plan_period_idx on public.platform_cost_entries(plan_id,period_start) where plan_id is not null;
create index platform_cost_pools_period_idx on public.platform_cost_pools(period_start,provider_id,status);
create index cost_allocation_rules_effective_idx on public.cost_allocation_rules(cost_pool_type,allocation_dimension,valid_from desc,valid_until);
create index platform_cost_allocations_pool_idx on public.platform_cost_allocations(cost_pool_id,allocation_rule_id);
create index platform_cost_allocations_tenant_idx on public.platform_cost_allocations(tenant_id) where tenant_id is not null;
create index provider_statements_period_idx on public.provider_cost_statements(provider_id,billing_period_start,status);
create index provider_statement_lines_statement_idx on public.provider_cost_statement_lines(statement_id,service_key,meter_key);
create index cost_reconciliation_statement_idx on public.platform_cost_reconciliations(statement_id,status);
create index cost_adjustments_period_idx on public.platform_cost_adjustments(period_start,provider_id);
create index provider_commitments_period_idx on public.provider_commitments(provider_id,starts_at,ends_at,status);
create index platform_budgets_period_idx on public.platform_cost_budgets(period_start,period_end,scope_type);
create index platform_forecasts_month_idx on public.platform_cost_forecasts(forecast_month,scope_type,scenario_key,vintage_at desc);
create index platform_anomalies_status_idx on public.platform_cost_anomalies(status,severity,detected_at desc);
create index platform_optimization_status_idx on public.platform_cost_optimization_recommendations(status,recommendation_type,created_at desc);
create index unit_economics_period_idx on public.platform_unit_economics_snapshots(period_start,scope_type,scope_id);
create index meter_health_key_time_idx on public.cost_meter_health_results(meter_key,checked_at desc);
create index finops_audit_entity_idx on public.finops_audit_events(entity_type,entity_id,created_at desc);

create view public.fact_platform_usage with(security_invoker=true) as
select id,organization_id,tenant_id,store_id,feature_key,service_key,meter_key,quantity,unit,occurred_at,source_system,environment,region,channel,model_key,cost_bearer,ingestion_status from public.platform_cost_usage_events;
create view public.fact_platform_cost with(security_invoker=true) as
select id,provider_id,tenant_id,store_id,plan_id,feature_key,module_key,service_key,meter_key,quantity,unit,base_cost,base_currency,cost_status,calculation_method,allocation_quality,cost_bearer,environment,region,channel,model_key,occurred_at,period_start from public.platform_cost_entries;
create view public.fact_provider_cost_statement with(security_invoker=true) as
select s.id statement_id,s.provider_id,s.billing_period_start,s.billing_period_end,s.total_amount,s.currency,s.status,l.service_key,l.meter_key,l.quantity,l.amount,l.line_type,l.mapping_status from public.provider_cost_statements s join public.provider_cost_statement_lines l on l.statement_id=s.id;
create view public.fact_cost_allocation with(security_invoker=true) as select * from public.platform_cost_allocations;
create view public.fact_cost_reconciliation with(security_invoker=true) as select * from public.platform_cost_reconciliations;
create view public.fact_cost_anomaly with(security_invoker=true) as select * from public.platform_cost_anomalies;
create view public.fact_unit_economics with(security_invoker=true) as select * from public.platform_unit_economics_snapshots;
create view public.dim_cost_provider with(security_invoker=true) as select id,provider_key,provider_name,provider_type,status,currency,billing_cycle,source_type,owner_label from public.cost_providers;
create view public.dim_cost_service with(security_invoker=true) as select distinct service_key,provider_id from public.cost_meter_definitions;
create view public.dim_cost_meter with(security_invoker=true) as select id,meter_key,service_key,provider_id,unit,source,aggregation,owner_label,active from public.cost_meter_definitions;
create view public.dim_cost_center with(security_invoker=true) as select * from public.platform_cost_centers;
create view public.dim_cost_quality with(security_invoker=true) as select unnest(array['direct','high_confidence','estimated','coarse','unknown']) quality;
create view public.dim_cost_status with(security_invoker=true) as select unnest(array['estimated','allocated','provider_reported','reconciled','adjusted','unknown']) status;

do $$ declare t text; begin foreach t in array array[
 'finops_member_permissions','cost_providers','cost_meter_definitions','provider_rate_cards','provider_rate_components','platform_cost_fx_rates',
 'platform_cost_usage_events','platform_cost_centers','feature_cost_mappings','platform_cost_entries','platform_cost_pools','cost_allocation_rules',
 'platform_cost_allocations','provider_cost_statements','provider_cost_statement_lines','platform_cost_reconciliations','platform_cost_adjustments',
 'provider_commitments','platform_overhead_pools','platform_cost_budgets','platform_cost_forecasts','platform_cost_scenarios','platform_cost_anomalies',
 'platform_cost_optimization_recommendations','finops_margin_guardrails','platform_unit_economics_snapshots','finops_period_closes',
 'technical_cost_circuit_breaker_policies','cost_meter_health_results','finops_semantic_metrics','finops_audit_events'
] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy %I on public.%I for select to authenticated using((select private.finops_allowed(''finops:view'')))','finops_select_'||t,t);
 execute format('create policy %I on public.%I for insert to authenticated with check((select private.finops_allowed(''finops:manage'')))','finops_insert_'||t,t);
 execute format('create policy %I on public.%I for update to authenticated using((select private.finops_allowed(''finops:manage''))) with check((select private.finops_allowed(''finops:manage'')))','finops_update_'||t,t);
 end loop; end $$;

do $$ declare t text; begin foreach t in array array[
 'finops_member_permissions','cost_providers','cost_meter_definitions','provider_rate_cards','provider_rate_components','platform_cost_fx_rates',
 'platform_cost_usage_events','platform_cost_centers','feature_cost_mappings','platform_cost_entries','platform_cost_pools','cost_allocation_rules',
 'platform_cost_allocations','provider_cost_statements','provider_cost_statement_lines','platform_cost_reconciliations','platform_cost_adjustments',
 'provider_commitments','platform_overhead_pools','platform_cost_budgets','platform_cost_forecasts','platform_cost_scenarios','platform_cost_anomalies',
 'platform_cost_optimization_recommendations','finops_margin_guardrails','platform_unit_economics_snapshots','finops_period_closes',
 'technical_cost_circuit_breaker_policies','cost_meter_health_results','finops_semantic_metrics','finops_audit_events'
] loop execute format('revoke all on public.%I from anon',t); end loop; end $$;
revoke all on public.fact_platform_usage,public.fact_platform_cost,public.fact_provider_cost_statement,public.fact_cost_allocation,
 public.fact_cost_reconciliation,public.fact_cost_anomaly,public.fact_unit_economics,public.dim_cost_provider,public.dim_cost_service,
 public.dim_cost_meter,public.dim_cost_center,public.dim_cost_quality,public.dim_cost_status from anon;
grant select,insert,update on public.finops_member_permissions,public.cost_providers,public.cost_meter_definitions,public.provider_rate_cards,public.provider_rate_components,
 public.platform_cost_fx_rates,public.platform_cost_usage_events,public.platform_cost_centers,public.feature_cost_mappings,public.platform_cost_entries,
 public.platform_cost_pools,public.cost_allocation_rules,public.platform_cost_allocations,public.provider_cost_statements,public.provider_cost_statement_lines,
 public.platform_cost_reconciliations,public.platform_cost_adjustments,public.provider_commitments,public.platform_overhead_pools,public.platform_cost_budgets,
 public.platform_cost_forecasts,public.platform_cost_scenarios,public.platform_cost_anomalies,public.platform_cost_optimization_recommendations,
 public.finops_margin_guardrails,public.platform_unit_economics_snapshots,public.finops_period_closes,public.technical_cost_circuit_breaker_policies,
 public.cost_meter_health_results,public.finops_semantic_metrics,public.finops_audit_events to authenticated;
grant select on public.fact_platform_usage,public.fact_platform_cost,public.fact_provider_cost_statement,public.fact_cost_allocation,public.fact_cost_reconciliation,
 public.fact_cost_anomaly,public.fact_unit_economics,public.dim_cost_provider,public.dim_cost_service,public.dim_cost_meter,public.dim_cost_center,
 public.dim_cost_quality,public.dim_cost_status to authenticated;
grant all on public.finops_member_permissions,public.cost_providers,public.cost_meter_definitions,public.provider_rate_cards,public.provider_rate_components,
 public.platform_cost_fx_rates,public.platform_cost_usage_events,public.platform_cost_centers,public.feature_cost_mappings,public.platform_cost_entries,
 public.platform_cost_pools,public.cost_allocation_rules,public.platform_cost_allocations,public.provider_cost_statements,public.provider_cost_statement_lines,
 public.platform_cost_reconciliations,public.platform_cost_adjustments,public.provider_commitments,public.platform_overhead_pools,public.platform_cost_budgets,
 public.platform_cost_forecasts,public.platform_cost_scenarios,public.platform_cost_anomalies,public.platform_cost_optimization_recommendations,
 public.finops_margin_guardrails,public.platform_unit_economics_snapshots,public.finops_period_closes,public.technical_cost_circuit_breaker_policies,
 public.cost_meter_health_results,public.finops_semantic_metrics,public.finops_audit_events to service_role;
