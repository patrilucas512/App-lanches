-- Phase 36: transparent menu profitability and human-confirmed pricing.
-- This layer never changes prices, promotions or menu placement automatically.

alter table public.plans add column if not exists menu_engineering_enabled boolean not null default true;
alter table public.plans add column if not exists profitability_analysis_enabled boolean not null default true;
alter table public.plans add column if not exists price_simulator_enabled boolean not null default false;
alter table public.plans add column if not exists pricing_recommendations_enabled boolean not null default false;
alter table public.plans add column if not exists bundle_recommendations_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists menu_engineering_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists profitability_analysis_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists price_simulator_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists pricing_recommendations_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists bundle_recommendations_enabled boolean not null default true;

create table public.profitability_settings(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  default_target_margin_percent numeric(6,2) not null default 35 check(default_target_margin_percent between 0 and 99),
  popularity_scope text not null default 'category' check(popularity_scope in('global','category')),
  cost_outdated_days integer not null default 90 check(cost_outdated_days between 1 and 730),
  recommendation_cooldown_days integer not null default 14 check(recommendation_cooldown_days between 1 and 365),
  minimum_basket_orders integer not null default 5 check(minimum_basket_orders between 2 and 10000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(organization_id,store_id)
);

create table public.profitability_member_permissions(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permissions text[] not null default array['menu_profitability:view','pricing:view','pricing:simulate'],
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(store_id,user_id),
  check(permissions <@ array['menu_profitability:view','menu_profitability:manage','pricing:view','pricing:simulate','pricing:change','pricing:bulk_change','menu_engineering:view']::text[])
);

create table public.product_cost_configs(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  channel_code text not null default 'all',
  packaging_cents bigint not null default 0 check(packaging_cents>=0),
  marketplace_fee_cents bigint not null default 0 check(marketplace_fee_cents>=0),
  marketplace_fee_percent numeric(7,4) not null default 0 check(marketplace_fee_percent between 0 and 100),
  gateway_fee_cents bigint not null default 0 check(gateway_fee_cents>=0),
  gateway_fee_percent numeric(7,4) not null default 0 check(gateway_fee_percent between 0 and 100),
  delivery_subsidy_cents bigint not null default 0 check(delivery_subsidy_cents>=0),
  other_variable_cents bigint not null default 0 check(other_variable_cents>=0),
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(store_id,product_id,channel_code)
);

create table public.profitability_target_margins(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  channel_code text,
  target_margin_percent numeric(6,2) not null check(target_margin_percent between 0 and 99),
  priority integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(num_nonnulls(product_id,category_id)<=1)
);
create index profitability_targets_scope_idx on public.profitability_target_margins(organization_id,store_id,product_id,category_id,channel_code,priority desc);

create table public.product_price_history(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  old_price_cents bigint not null check(old_price_cents>=0),
  new_price_cents bigint not null check(new_price_cents>=0),
  changed_by uuid references auth.users(id) on delete set null,
  reason text not null check(length(btrim(reason)) between 3 and 500),
  source text not null default 'manager' check(source in('manager','bulk_manager','scheduled_manager','rollback')),
  preview_id uuid,
  rollback_of uuid references public.product_price_history(id) on delete set null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index product_price_history_lookup_idx on public.product_price_history(store_id,product_id,effective_at desc);

create table public.product_profitability_snapshots(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  channel_code text not null default 'all',
  period_start date not null,
  period_end date not null,
  sale_price_cents bigint not null,
  ingredient_cost_cents numeric,
  variable_cost_cents numeric,
  cost_status text not null check(cost_status in('complete','partial','missing','outdated')),
  cost_completeness_percent numeric(6,2) not null default 0,
  quantity_sold bigint not null default 0,
  revenue_cents bigint not null default 0,
  gross_product_margin_cents bigint,
  contribution_margin_estimate_cents bigint,
  channel_adjusted_margin_cents bigint,
  margin_percent numeric(8,3),
  waste_adjusted_margin_cents bigint,
  forecasted_quantity numeric,
  forecasted_contribution_margin_cents numeric,
  product_health text not null check(product_health in('strong','watch','critical','insufficient_data')),
  source_metrics jsonb not null default '{}',
  calculated_at timestamptz not null default now(),
  unique(store_id,product_id,channel_code,period_start,period_end)
);
create index profitability_snapshots_scope_idx on public.product_profitability_snapshots(organization_id,store_id,period_end desc,channel_code);

create table public.menu_engineering_snapshots(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  period_start date not null,
  period_end date not null,
  analysis_scope text not null check(analysis_scope in('global','category')),
  quantity_sold bigint not null default 0,
  popularity_index numeric,
  popularity_threshold numeric,
  margin_percent numeric,
  margin_threshold numeric,
  classification text check(classification in('star','popular_low_margin','profitable_low_sales','low_sales_low_margin')),
  components jsonb not null default '{}',
  calculated_at timestamptz not null default now(),
  unique(store_id,product_id,analysis_scope,period_start,period_end)
);

create table public.profitability_recommendations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  recommendation_type text not null check(recommendation_type in('review_price','reduce_cost','promote_product','bundle_product','review_recipe','review_portion','remove_or_reposition','channel_adjustment','addon_opportunity')),
  reason text not null,
  impact_estimate jsonb not null default '{}',
  confidence text not null check(confidence in('high','medium','low')),
  source_metrics jsonb not null default '{}',
  status text not null default 'suggested' check(status in('suggested','accepted','dismissed','implemented')),
  dedupe_key text not null,
  cooldown_until timestamptz,
  requires_human_confirmation boolean not null default true check(requires_human_confirmation),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index profitability_recommendation_active_dedupe_idx on public.profitability_recommendations(organization_id,store_id,dedupe_key) where status='suggested';
create index profitability_recommendations_scope_idx on public.profitability_recommendations(organization_id,store_id,status,created_at desc);

create table public.profitability_basket_associations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_a_id uuid not null references public.products(id) on delete cascade,
  product_b_id uuid not null references public.products(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  pair_orders integer not null check(pair_orders>=0),
  sample_orders integer not null check(sample_orders>=0),
  support numeric not null check(support between 0 and 1),
  confidence numeric not null check(confidence between 0 and 1),
  sufficient_sample boolean not null default false,
  calculated_at timestamptz not null default now(),
  check(product_a_id<>product_b_id),
  unique(store_id,product_a_id,product_b_id,period_start,period_end)
);

create table public.pricing_simulations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  current_price_cents bigint not null,
  simulated_price_cents bigint not null,
  variable_cost_cents numeric,
  current_margin_percent numeric,
  simulated_margin_percent numeric,
  elasticity_used numeric,
  elasticity_reliable boolean not null default false,
  estimated_demand numeric,
  estimated_revenue_cents numeric,
  disclaimer text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.pricing_action_previews(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  action_type text not null check(action_type in('price_change','bulk_price_change','price_rollback','schedule_price','combo_draft','promotion_draft','menu_highlight')),
  payload jsonb not null,
  impact_preview jsonb not null,
  status text not null default 'pending' check(status in('pending','confirmed','executed','expired','cancelled')),
  reinforced_confirmation boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null default(now()+interval '30 minutes'),
  confirmed_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);
create index pricing_previews_actor_idx on public.pricing_action_previews(created_by,status,expires_at);

create table public.pricing_scheduled_changes(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  old_price_cents bigint not null,
  new_price_cents bigint not null,
  effective_at timestamptz not null,
  status text not null default 'scheduled' check(status in('scheduled','executed','cancelled','failed')),
  preview_id uuid not null references public.pricing_action_previews(id),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.profitability_audit_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in('snapshot_calculated','recommendation_created','recommendation_decided','simulation_run','price_previewed','price_changed','price_rolled_back','bulk_previewed','bulk_changed','target_margin_changed','combo_draft_created','promotion_draft_created','price_scheduled')),
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index profitability_audit_scope_idx on public.profitability_audit_events(organization_id,store_id,created_at desc);

do $$ declare t text; begin foreach t in array array[
  'profitability_settings','profitability_member_permissions','product_cost_configs','profitability_target_margins','product_price_history','product_profitability_snapshots',
  'menu_engineering_snapshots','profitability_recommendations','profitability_basket_associations','pricing_simulations','pricing_action_previews',
  'pricing_scheduled_changes','profitability_audit_events'
] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy %I on public.%I for select to authenticated using((select private.analytics_org_allowed(organization_id,''analytics:view'')))','profitability_select_'||t,t);
  execute format('grant select on public.%I to authenticated',t);
end loop; end $$;

-- Named permissions enforced by the server route:
-- menu_profitability:view, menu_profitability:manage, pricing:view,
-- pricing:simulate, pricing:change, pricing:bulk_change, menu_engineering:view.

insert into public.analytics_datasets(dataset_key,name,description,domain,owner_label,dataset_scope,grain,source_tables,refresh_frequency,retention_days,certified,contains_pii)
values('menu_profitability_mart','Menu Profitability Mart','Custos rastreáveis, margens, popularidade, canais e recomendações explicáveis.','profitability','Financeiro & Operações','customer_analytics','produto/unidade/canal/período',array['products','inventory_recipes','inventory_items','analytics_fact_orders','analytics_fact_order_items','forecast_predictions'],'daily',1095,true,false)
on conflict(dataset_key) do update set description=excluded.description,source_tables=excluded.source_tables,updated_at=now();

insert into public.analytics_lineage(source_name,transformation_name,target_dataset,metric_keys,dashboard_keys)
values('products + recipes + inventory + sales + forecasts','phase36_menu_profitability','menu_profitability_mart',array['product_cost','cmv','gross_product_margin','contribution_margin_estimate','channel_adjusted_margin','popularity'],array['menu_engineering','profitability'])
on conflict do nothing;

insert into public.analytics_quality_rules(rule_key,dataset_key,rule_type,definition,severity,owner_label)
values
('profitability_cost_not_invented','menu_profitability_mart','accepted_values','{"rule":"missing recipe or cost => cost_status missing/partial"}','critical','Financeiro & Operações'),
('profitability_margin_types_separated','menu_profitability_mart','accepted_values','{"rule":"gross_product_margin != net_profit and channel margin is explicit"}','critical','Financeiro & Operações'),
('pricing_confirmation_required','menu_profitability_mart','accepted_values','{"rule":"price update requires unexpired confirmed preview and permission"}','critical','Produto & Segurança')
on conflict(rule_key) do nothing;

notify pgrst, 'reload schema';
