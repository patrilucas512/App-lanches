-- Phase 34: incremental OLAP layer. OLTP remains the operational source of truth.

create table public.analytics_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default array['analytics:view'], organization_scope uuid[] not null default '{}', store_scope uuid[] not null default '{}',
  active boolean not null default true, updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create or replace function private.analytics_allowed(requested_permission text) returns boolean language sql stable security definer set search_path=''
as $$ select private.is_superadmin() or exists(select 1 from public.analytics_permissions p where p.user_id=(select auth.uid()) and p.active and (requested_permission=any(p.permissions) or 'analytics:advanced'=any(p.permissions))) $$;
create or replace function private.analytics_org_allowed(target_org uuid,requested_permission text default 'analytics:view') returns boolean language sql stable security definer set search_path=''
as $$ select private.is_superadmin() or private.has_organization_role(target_org,null) or exists(select 1 from public.analytics_permissions p where p.user_id=(select auth.uid()) and p.active and (requested_permission=any(p.permissions) or 'analytics:advanced'=any(p.permissions)) and (coalesce(array_length(p.organization_scope,1),0)=0 or target_org=any(p.organization_scope))) $$;
revoke all on function private.analytics_allowed(text) from public,anon,authenticated;
revoke all on function private.analytics_org_allowed(uuid,text) from public,anon,authenticated;
grant execute on function private.analytics_allowed(text),private.analytics_org_allowed(uuid,text) to authenticated;

create table public.analytics_feature_flags(
  singleton boolean primary key default true check(singleton), data_platform_enabled boolean not null default true, warehouse_enabled boolean not null default true,
  custom_bi_enabled boolean not null default true, scheduled_reports_enabled boolean not null default false, analytics_copilot_enabled boolean not null default true,
  provider text not null default 'postgres_analytics' check(provider in('postgres_analytics','bigquery','clickhouse','snowflake','redshift','other')),
  updated_at timestamptz not null default now()
);
insert into public.analytics_feature_flags(singleton) values(true) on conflict(singleton) do nothing;
create table public.analytics_datasets(
  id uuid primary key default gen_random_uuid(), dataset_key text not null unique, name text not null, description text not null, domain text not null,
  owner_label text not null, dataset_scope text not null check(dataset_scope in('customer_analytics','masterapp_internal_analytics')), grain text not null,
  source_tables text[] not null default '{}', refresh_frequency text not null, retention_days integer, certified boolean not null default false,
  contains_pii boolean not null default false, status text not null default 'active' check(status in('experimental','active','deprecated')),
  last_refreshed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.analytics_metric_catalog(
  metric_key text primary key, name text not null, description text not null, formula text not null, source_of_truth text not null,
  grain text not null, owner_label text not null, refresh_frequency text not null, unit text not null, evidence_class text not null check(evidence_class in('fact','calculation','estimate')),
  certified boolean not null default true, sensitive boolean not null default false, allowed_dimensions text[] not null default '{}', updated_at timestamptz not null default now()
);
create table public.analytics_data_contracts(
  id uuid primary key default gen_random_uuid(), contract_key text not null, version integer not null default 1, source text not null, required_fields jsonb not null,
  schema_definition jsonb not null default '{}', breaking_change boolean not null default false, status text not null default 'active' check(status in('draft','active','deprecated')),
  owner_label text not null, created_at timestamptz not null default now(), unique(contract_key,version)
);
create table public.analytics_lineage(
  id uuid primary key default gen_random_uuid(), source_name text not null, transformation_name text not null, target_dataset text not null,
  metric_keys text[] not null default '{}', dashboard_keys text[] not null default '{}', transformation_version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_name,transformation_name,target_dataset)
);

create table public.data_sync_checkpoints(
  source text primary key, last_cursor text, last_synced_at timestamptz, status text not null default 'idle' check(status in('idle','running','succeeded','failed','paused')),
  last_error text, rows_processed bigint not null default 0, schema_version integer not null default 1, lag_seconds integer, updated_at timestamptz not null default now()
);
create table public.analytics_ingestion_outbox(
  id uuid primary key default gen_random_uuid(), source text not null, source_event_id text not null, organization_id uuid, store_id uuid,
  event_type text not null, schema_version integer not null default 1, event_timestamp_utc timestamptz not null, payload jsonb not null,
  operation text not null default 'upsert' check(operation in('upsert','delete','anonymize')), status text not null default 'pending' check(status in('pending','processing','processed','quarantined','failed')),
  available_at timestamptz not null default now(), attempts integer not null default 0, processed_at timestamptz, created_at timestamptz not null default now(),
  unique(source,source_event_id,operation)
);
create table public.analytics_raw_events(
  id uuid primary key default gen_random_uuid(), source text not null, source_event_id text not null, organization_id uuid, store_id uuid,
  schema_version integer not null default 1, event_timestamp_utc timestamptz not null, payload jsonb not null, ingested_at timestamptz not null default now(),
  unique(source,source_event_id,schema_version)
);
create table public.analytics_staging_records(
  id uuid primary key default gen_random_uuid(), pipeline_run_id uuid, source text not null, source_id text not null, organization_id uuid, store_id uuid,
  normalized_payload jsonb not null, validation_status text not null default 'pending' check(validation_status in('pending','valid','invalid')),
  staged_at timestamptz not null default now(), unique(source,source_id)
);
create table public.analytics_clean_events(
  id uuid primary key default gen_random_uuid(), source text not null, source_id text not null, organization_id uuid, store_id uuid,
  event_type text not null, event_timestamp_utc timestamptz not null, local_date date, source_timezone text,
  clean_payload jsonb not null, transformed_at timestamptz not null default now(), unique(source,source_id)
);
create table public.analytics_pipeline_runs(
  id uuid primary key default gen_random_uuid(), pipeline_key text not null, run_type text not null check(run_type in('incremental','backfill','reconciliation','quality')),
  status text not null default 'running' check(status in('queued','running','succeeded','failed','cancelled')), cursor_from text, cursor_to text,
  rows_read bigint not null default 0, rows_loaded bigint not null default 0, rows_quarantined bigint not null default 0, duration_ms bigint,
  lag_seconds integer, estimated_cost_cents bigint not null default 0, error_summary text, started_at timestamptz not null default now(), finished_at timestamptz
);
create table public.analytics_pipeline_dead_letters(
  id uuid primary key default gen_random_uuid(), pipeline_run_id uuid references public.analytics_pipeline_runs(id) on delete set null, source text not null,
  source_event_id text, payload jsonb not null, error_code text not null, error_message text not null, attempts integer not null, next_retry_at timestamptz,
  resolved_at timestamptz, created_at timestamptz not null default now()
);
create table public.analytics_quality_rules(
  id uuid primary key default gen_random_uuid(), rule_key text not null unique, dataset_key text not null, rule_type text not null check(rule_type in('null','uniqueness','referential_integrity','accepted_values','freshness','volume_anomaly','non_negative','reconciliation')),
  definition jsonb not null, severity text not null default 'high' check(severity in('info','warning','high','critical')), active boolean not null default true,
  owner_label text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.analytics_quality_results(
  id uuid primary key default gen_random_uuid(), rule_id uuid not null references public.analytics_quality_rules(id) on delete cascade,
  pipeline_run_id uuid references public.analytics_pipeline_runs(id) on delete set null, status text not null check(status in('passed','warning','failed')),
  rows_checked bigint not null default 0, invalid_rows bigint not null default 0, details jsonb not null default '{}', checked_at timestamptz not null default now()
);
create table public.analytics_quarantine(
  id uuid primary key default gen_random_uuid(), organization_id uuid, source text not null, source_id text, dataset_key text not null,
  reason_codes text[] not null, payload jsonb not null, status text not null default 'open' check(status in('open','reprocessed','discarded')),
  created_at timestamptz not null default now(), resolved_at timestamptz
);

create table public.analytics_dim_date(
  date_key integer primary key, full_date date not null unique, day integer not null, week integer not null, month integer not null, quarter integer not null,
  year integer not null, weekday integer not null, weekday_name text not null, is_weekend boolean not null
);
insert into public.analytics_dim_date(date_key,full_date,day,week,month,quarter,year,weekday,weekday_name,is_weekend)
select to_char(d,'YYYYMMDD')::integer,d::date,extract(day from d)::integer,extract(week from d)::integer,extract(month from d)::integer,extract(quarter from d)::integer,extract(year from d)::integer,extract(isodow from d)::integer,to_char(d,'TMDay'),extract(isodow from d) in(6,7)
from generate_series('2020-01-01'::date,'2035-12-31'::date,'1 day') d on conflict do nothing;
create table public.analytics_dim_time(
  time_key smallint primary key, hour smallint not null, minute smallint not null, hour_label text not null, day_part text not null
);
insert into public.analytics_dim_time(time_key,hour,minute,hour_label,day_part)
select h*100+m,h,m,lpad(h::text,2,'0')||':'||lpad(m::text,2,'0'),case when h<6 then 'madrugada' when h<12 then 'manhã' when h<18 then 'tarde' else 'noite' end
from generate_series(0,23) h cross join generate_series(0,59) m on conflict do nothing;
create table public.analytics_dim_organizations(
  organization_key bigint generated always as identity primary key, organization_id uuid not null, name text not null, business_type text,
  timezone text not null default 'America/Sao_Paulo', valid_from timestamptz not null, valid_to timestamptz, is_current boolean not null default true,
  source_updated_at timestamptz, unique(organization_id,valid_from)
);
create table public.analytics_dim_stores(
  store_key bigint generated always as identity primary key, organization_id uuid not null, store_id uuid not null, name text not null, city text, state text,
  timezone text not null default 'America/Sao_Paulo', valid_from timestamptz not null, valid_to timestamptz, is_current boolean not null default true,
  source_updated_at timestamptz, unique(store_id,valid_from)
);
create table public.analytics_dim_customers(
  customer_key bigint generated always as identity primary key, organization_id uuid not null, store_id uuid, customer_id uuid not null,
  pseudonym text not null, first_seen_at timestamptz, valid_from timestamptz not null, valid_to timestamptz, is_current boolean not null default true,
  anonymized_at timestamptz, unique(organization_id,customer_id,valid_from)
);
create table public.analytics_dim_products(
  product_key bigint generated always as identity primary key, organization_id uuid not null, store_id uuid not null, product_id uuid not null,
  name text not null, category_id uuid, price_cents integer not null default 0, active boolean not null, valid_from timestamptz not null,
  valid_to timestamptz, is_current boolean not null default true, source_updated_at timestamptz, unique(product_id,valid_from)
);
create table public.analytics_dim_plans(
  plan_key bigint generated always as identity primary key, plan_id uuid not null, name text not null, valid_from timestamptz not null,
  valid_to timestamptz, is_current boolean not null default true, source_updated_at timestamptz, unique(plan_id,valid_from)
);
create table public.analytics_dim_channels(channel_key smallint generated always as identity primary key, channel_code text not null unique, label text not null);
insert into public.analytics_dim_channels(channel_code,label) values('menu','Cardápio'),('whatsapp','WhatsApp'),('pos','PDV'),('waiter','Garçom'),('voice','Voz'),('web_chat','Chat web'),('other','Outro') on conflict do nothing;
create table public.analytics_dim_employees(
  employee_key bigint generated always as identity primary key, organization_id uuid not null, store_id uuid, employee_id uuid not null,
  role_code text, employment_type text, pseudonym text not null, valid_from timestamptz not null, valid_to timestamptz, is_current boolean not null default true,
  unique(organization_id,employee_id,valid_from)
);
create table public.analytics_dim_campaigns(
  campaign_key bigint generated always as identity primary key, organization_id uuid not null, campaign_id uuid not null, name text not null,
  channel_code text, valid_from timestamptz not null, valid_to timestamptz, is_current boolean not null default true,
  unique(organization_id,campaign_id,valid_from)
);
create table public.analytics_dim_sources(
  source_key smallint generated always as identity primary key, source_code text not null unique, name text not null, source_group text not null
);
insert into public.analytics_dim_sources(source_code,name,source_group) values
('menu','Cardápio digital','customer'),('whatsapp','WhatsApp','customer'),('pos','PDV','store'),('waiter','Garçom','store'),('voice','Voz','customer'),('api','API de parceiros','partner'),('internal','Operação interna','masterapp') on conflict do nothing;

create table public.analytics_fact_orders(
  order_id uuid primary key, organization_id uuid not null, store_id uuid not null, customer_id uuid, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, local_date date not null, source_timezone text not null, status text not null, fulfillment_type text not null,
  channel_code text not null, subtotal_cents bigint not null check(subtotal_cents>=0), discount_cents bigint not null check(discount_cents>=0),
  delivery_fee_cents bigint not null check(delivery_fee_cents>=0), total_cents bigint not null check(total_cents>=0), payment_status text,
  is_approved boolean not null, is_cancelled boolean not null, deleted_at timestamptz, source_updated_at timestamptz not null, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_order_items(
  order_item_id uuid primary key, order_id uuid not null references public.analytics_fact_orders(order_id) on delete cascade, organization_id uuid not null,
  store_id uuid not null, product_id uuid, date_key integer not null references public.analytics_dim_date(date_key), quantity integer not null check(quantity>0),
  unit_price_cents bigint not null check(unit_price_cents>=0), total_cents bigint not null check(total_cents>=0), loaded_at timestamptz not null default now()
);
create table public.analytics_fact_payments(
  payment_id uuid primary key, order_id uuid, organization_id uuid not null, store_id uuid not null, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, provider text, payment_kind text, status text not null, amount_cents bigint not null check(amount_cents>=0),
  approved_at timestamptz, source_updated_at timestamptz not null, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_inventory_movements(
  movement_id uuid primary key, organization_id uuid not null, store_id uuid not null, stock_item_id uuid not null, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, kind text not null, quantity numeric not null, unit_cost_cents numeric, total_cost_cents bigint,
  source_kind text, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_messages(
  message_id uuid primary key, organization_id uuid not null, store_id uuid, customer_key bigint, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, channel_type text not null, direction text not null, message_type text not null, status text,
  loaded_at timestamptz not null default now()
);
create table public.analytics_fact_ai_usage(
  usage_id bigint primary key, organization_id uuid not null, store_id uuid not null, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, event_type text not null, provider text, model text, input_tokens bigint not null default 0,
  output_tokens bigint not null default 0, estimated_cost_micros bigint not null default 0, latency_ms integer, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_delivery(
  delivery_id uuid primary key, order_id uuid not null, organization_id uuid not null, store_id uuid not null, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, status text not null, delivery_minutes numeric, delay_minutes numeric, distance_meters integer,
  customer_fee_cents bigint not null default 0, driver_payout_cents bigint not null default 0, logistics_margin_cents bigint not null default 0, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_support_tickets(
  ticket_id uuid primary key, organization_id uuid not null, store_id uuid, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, status text not null, priority text not null, category text, first_response_minutes numeric,
  resolution_minutes numeric, sla_met boolean, source_updated_at timestamptz not null, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_saas_subscriptions(
  subscription_id uuid primary key, organization_id uuid not null, plan_id uuid, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, status text not null, billing_cycle text, provider text, source_updated_at timestamptz not null,
  loaded_at timestamptz not null default now()
);
create table public.analytics_fact_mrr_movements(
  movement_key text primary key, date_key integer not null references public.analytics_dim_date(date_key), event_timestamp_utc timestamptz not null,
  movement_type text not null, amount_cents bigint not null, active_customers integer, source_hash text, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_sales_opportunities(
  opportunity_id uuid primary key, organization_id uuid, date_key integer not null references public.analytics_dim_date(date_key), event_timestamp_utc timestamptz not null,
  status text not null, forecast_category text, estimated_mrr_cents bigint not null default 0, probability numeric, expected_close_date date,
  source_updated_at timestamptz not null, loaded_at timestamptz not null default now()
);
create table public.analytics_fact_customer_health(
  organization_id uuid not null, snapshot_date date not null, date_key integer not null references public.analytics_dim_date(date_key), total_score numeric not null,
  risk_level text not null, activation_score numeric, adoption_score numeric, support_score numeric, billing_score numeric, estimated boolean not null default false,
  loaded_at timestamptz not null default now(), primary key(organization_id,snapshot_date)
);
create table public.analytics_fact_product_events(
  event_id uuid primary key, organization_id uuid not null, store_id uuid, date_key integer not null references public.analytics_dim_date(date_key),
  event_timestamp_utc timestamptz not null, event_name text not null, source text, schema_version integer not null, release_version text,
  loaded_at timestamptz not null default now()
);

create table public.analytics_daily_orders(
  organization_id uuid not null, store_id uuid not null, metric_date date not null, orders_count bigint not null, approved_orders bigint not null,
  cancelled_orders bigint not null, gmv_cents bigint not null, revenue_cents bigint not null, average_ticket_cents bigint not null,
  refreshed_at timestamptz not null default now(), primary key(organization_id,store_id,metric_date)
);
create table public.analytics_daily_revenue(
  metric_date date primary key, mrr_cents bigint not null, arr_cents bigint not null, new_mrr_cents bigint not null, expansion_mrr_cents bigint not null,
  contraction_mrr_cents bigint not null, churned_mrr_cents bigint not null, active_customers integer not null, source_hash text, refreshed_at timestamptz not null default now()
);
create table public.analytics_daily_support(
  organization_id uuid not null, metric_date date not null, opened bigint not null, resolved bigint not null, sla_met bigint not null,
  average_first_response_minutes numeric, refreshed_at timestamptz not null default now(), primary key(organization_id,metric_date)
);
create table public.analytics_daily_ai_usage(
  organization_id uuid not null, store_id uuid not null, metric_date date not null, requests bigint not null, input_tokens bigint not null,
  output_tokens bigint not null, estimated_cost_micros bigint not null, average_latency_ms numeric, refreshed_at timestamptz not null default now(),
  primary key(organization_id,store_id,metric_date)
);
create table public.analytics_customer_360(
  organization_id uuid not null, customer_id uuid not null, pseudonym text not null, first_order_at timestamptz, last_order_at timestamptz,
  order_count bigint not null default 0, revenue_cents bigint not null default 0, average_ticket_cents bigint not null default 0,
  preferred_category_id uuid, campaign_engagements bigint not null default 0, support_tickets bigint not null default 0,
  refreshed_at timestamptz not null default now(), primary key(organization_id,customer_id)
);
create table public.analytics_organization_360(
  organization_id uuid primary key, snapshot_date date not null, mrr_cents bigint, plan_id uuid, usage_score numeric, ticket_count bigint,
  health_score numeric, churn_risk text, feature_adoption jsonb not null default '{}', sales_source text, refreshed_at timestamptz not null default now()
);

create table public.analytics_dashboards(
  id uuid primary key default gen_random_uuid(), organization_id uuid, dashboard_key text not null, name text not null, description text,
  dashboard_type text not null check(dashboard_type in('executive','sales','operations','finance','customer','product','support','saas_growth','custom')),
  scope text not null check(scope in('organization','masterapp_internal')), owner_user_id uuid not null references auth.users(id) on delete cascade,
  shared_internally boolean not null default false, status text not null default 'draft' check(status in('draft','active','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_user_id,dashboard_key)
);
create table public.analytics_dashboard_widgets(
  id uuid primary key default gen_random_uuid(), dashboard_id uuid not null references public.analytics_dashboards(id) on delete cascade,
  widget_type text not null check(widget_type in('kpi','line','bar','table','funnel','cohort','heatmap')), title text not null,
  metric_key text not null references public.analytics_metric_catalog(metric_key), dimensions text[] not null default '{}', filters jsonb not null default '{}',
  date_range jsonb not null default '{}', position jsonb not null default '{}', configuration jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.analytics_scheduled_reports(
  id uuid primary key default gen_random_uuid(), organization_id uuid, dashboard_id uuid references public.analytics_dashboards(id) on delete cascade,
  name text not null, frequency text not null check(frequency in('daily','weekly','monthly')), delivery_method text not null check(delivery_method in('email','download_center')),
  recipients text[] not null default '{}', enabled boolean not null default false, next_run_at timestamptz, created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.analytics_report_runs(
  id uuid primary key default gen_random_uuid(), scheduled_report_id uuid references public.analytics_scheduled_reports(id) on delete set null,
  organization_id uuid, status text not null default 'queued' check(status in('queued','processing','ready','failed','expired')),
  format text not null check(format in('csv','xlsx','pdf')), storage_path text, download_token_hash text, download_expires_at timestamptz,
  row_count bigint, error_message text, created_at timestamptz not null default now(), finished_at timestamptz
);
create table public.analytics_export_jobs(
  id uuid primary key default gen_random_uuid(), organization_id uuid, requested_by uuid not null references auth.users(id) on delete cascade,
  dataset_key text not null, format text not null check(format in('csv','xlsx','pdf')), filters jsonb not null default '{}', status text not null default 'queued' check(status in('queued','processing','ready','failed','expired','cancelled')),
  storage_path text, row_count bigint, expires_at timestamptz, created_at timestamptz not null default now(), finished_at timestamptz
);
create table public.analytics_backfill_jobs(
  id uuid primary key default gen_random_uuid(), source text not null, date_from date not null, date_to date not null, preview jsonb not null default '{}',
  status text not null default 'preview' check(status in('preview','approved','running','succeeded','failed','cancelled')), requested_by uuid not null references auth.users(id) on delete cascade,
  approved_by uuid references auth.users(id) on delete set null, reason text not null, created_at timestamptz not null default now(), finished_at timestamptz,
  check(date_to>=date_from and date_to-date_from<=366)
);
create table public.analytics_query_cache(
  cache_key text primary key, organization_id uuid, metric_key text not null, filters_hash text not null, date_from date not null, date_to date not null,
  payload jsonb not null, source_freshness timestamptz not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.analytics_query_audit(
  id uuid primary key default gen_random_uuid(), actor_user_id uuid references auth.users(id) on delete set null, organization_id uuid,
  action text not null, metric_keys text[] not null default '{}', dimensions text[] not null default '{}', filters jsonb not null default '{}',
  sensitive boolean not null default false, rows_returned bigint, duration_ms bigint, estimated_cost_cents bigint not null default 0, created_at timestamptz not null default now()
);
create table public.analytics_reconciliations(
  id uuid primary key default gen_random_uuid(), reconciliation_key text not null, organization_id uuid, period_start date not null, period_end date not null,
  oltp_value numeric not null, warehouse_value numeric not null, difference numeric generated always as(warehouse_value-oltp_value) stored,
  difference_percent numeric generated always as(case when oltp_value=0 then null else round(abs(warehouse_value-oltp_value)/abs(oltp_value)*100,4) end) stored,
  tolerance_percent numeric not null default 0.5, status text not null check(status in('matched','divergent')), checked_at timestamptz not null default now()
);
create table public.analytics_cost_usage(
  id uuid primary key default gen_random_uuid(), usage_date date not null, provider text not null, storage_bytes bigint not null default 0,
  compute_ms bigint not null default 0, query_count bigint not null default 0, estimated_cost_cents bigint not null default 0,
  budget_cents bigint, budget_alerted boolean not null default false, created_at timestamptz not null default now(), unique(usage_date,provider)
);
create table public.data_subject_deletion_jobs(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, subject_type text not null, subject_id_hash text not null,
  requested_by uuid references auth.users(id) on delete set null, status text not null default 'queued' check(status in('queued','processing','completed','failed')),
  datasets_affected text[] not null default '{}', error_message text, requested_at timestamptz not null default now(), completed_at timestamptz
);

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('orders','Pedidos','Pedidos no período.','count(distinct order_id)','analytics_fact_orders','pedido','Operações','5 min','count','calculation',false,array['date','store','channel','fulfillment']),
('gmv','GMV','Valor bruto dos pedidos.','sum(total_cents)','analytics_fact_orders','pedido','Financeiro','5 min','cents','calculation',false,array['date','store','channel']),
('revenue','Receita aprovada','Receita de pedidos concluídos ou com pagamento aprovado.','sum(total_cents) where is_approved','analytics_fact_orders / métricas oficiais','pedido','Financeiro','5 min','cents','calculation',true,array['date','store','channel']),
('average_ticket','Ticket médio','Receita aprovada dividida por pedidos aprovados.','revenue / approved_orders','analytics_fact_orders','pedido','Operações','5 min','cents','calculation',false,array['date','store','channel']),
('cancellation_rate','Taxa de cancelamento','Pedidos cancelados divididos pelos pedidos totais.','cancelled_orders / orders','analytics_fact_orders','pedido','Operações','5 min','percent','calculation',false,array['date','store','channel']),
('delivery_time','Tempo de entrega','Média entre início e conclusão da entrega.','avg(delivery_minutes)','analytics_fact_delivery','entrega','Logística','15 min','minutes','calculation',false,array['date','store']),
('repeat_rate','Taxa de repetição','Clientes com mais de um pedido no período.','repeat_customers / ordering_customers','analytics_customer_360','cliente','CRM','daily','percent','calculation',false,array['date','store']),
('ai_conversion','Conversão da IA','Pedidos atribuídos à IA sobre conversas atendidas pela IA.','ai_orders / ai_conversations','analytics_fact_ai_usage + orders attribution','conversa','Produto','hourly','percent','calculation',false,array['date','store','channel']),
('support_sla','SLA de suporte','Tickets dentro do SLA sobre tickets avaliados.','sla_met / evaluated_tickets','analytics_fact_support_tickets','ticket','Suporte','hourly','percent','calculation',false,array['date','organization','priority']),
('mrr','MRR','Receita recorrente mensal oficial.','RevenueMetricsService MRR','revenue_snapshots / RevenueMetricsService','dia','Revenue Ops','daily','cents','calculation',true,array['date','plan']),
('nrr','NRR','Retenção líquida de receita oficial.','RevenueMetricsService NRR','RevenueMetricsService + mrr movements','mês','Revenue Ops','monthly','percent','calculation',true,array['date','plan']),
('churn','Churn','MRR perdido sobre MRR inicial.','RevenueMetricsService churn','RevenueMetricsService + revenue_snapshots','mês','Revenue Ops','monthly','percent','calculation',true,array['date','plan'])
on conflict(metric_key) do nothing;
insert into public.analytics_data_contracts(contract_key,source,required_fields,schema_definition,owner_label) values
('order.created','orders','["order_id","organization_id","store_id","created_at","total_cents"]','{"grain":"one row per order","timezone":"UTC"}','Operações'),
('product.event','product_events','["event_id","organization_id","occurred_at","event_name"]','{"grain":"one row per event"}','Produto'),
('revenue.snapshot','revenue_snapshots','["snapshot_date","mrr_cents","arr_cents","source_hash"]','{"grain":"one row per day"}','Revenue Ops')
on conflict(contract_key,version) do nothing;
insert into public.analytics_datasets(dataset_key,name,description,domain,owner_label,dataset_scope,grain,source_tables,refresh_frequency,retention_days,certified,contains_pii) values
('sales_mart','Sales Mart','Pedidos, itens e pagamentos aprovados.','sales','Operações','customer_analytics','pedido/item',array['orders','order_items','order_payment_transactions'],'5 min',2555,true,false),
('operations_mart','Operations Mart','Estoque, entrega e operação.','operations','Operações','customer_analytics','evento operacional',array['inventory_movements','deliveries'],'15 min',2555,true,false),
('customer_mart','Customer Mart','Customer 360 pseudonimizado.','customer','CRM','customer_analytics','cliente',array['customers','orders'],'daily',2555,true,true),
('saas_revenue_mart','SaaS Revenue Mart','MRR, NRR, churn e assinaturas.','revenue','Revenue Ops','masterapp_internal_analytics','snapshot diário',array['revenue_snapshots','subscriptions'],'daily',3650,true,false),
('support_mart','Support Mart','Tickets e SLA.','support','Suporte','masterapp_internal_analytics','ticket',array['support_tickets'],'hourly',2555,true,false),
('product_mart','Product Mart','Eventos de produto, funis e coortes.','product','Produto','masterapp_internal_analytics','evento',array['product_events'],'hourly',730,true,false)
on conflict(dataset_key) do nothing;
insert into public.analytics_quality_rules(rule_key,dataset_key,rule_type,definition,severity,owner_label) values
('orders_unique','sales_mart','uniqueness','{"column":"order_id"}','critical','Dados'),('orders_store_fk','sales_mart','referential_integrity','{"column":"store_id","dimension":"analytics_dim_stores"}','high','Dados'),
('orders_total_non_negative','sales_mart','non_negative','{"column":"total_cents"}','critical','Dados'),('orders_freshness','sales_mart','freshness','{"maximum_lag_minutes":15}','high','Dados'),
('orders_volume','sales_mart','volume_anomaly','{"comparison_days":28,"threshold_percent":50}','warning','Dados'),('revenue_reconciliation','saas_revenue_mart','reconciliation','{"tolerance_percent":0.5}','critical','Revenue Ops')
on conflict(rule_key) do nothing;
insert into public.analytics_lineage(source_name,transformation_name,target_dataset,metric_keys,dashboard_keys) values
('orders + order_items + payments','incremental_sales_transform','sales_mart',array['orders','gmv','revenue','average_ticket','cancellation_rate'],array['executive','sales','operations']),
('revenue_snapshots','official_revenue_snapshot_copy','saas_revenue_mart',array['mrr','nrr','churn'],array['executive','saas_growth']),
('product_events','incremental_product_events','product_mart',array['ai_conversion'],array['product']) on conflict do nothing;

create index analytics_outbox_pending_idx on public.analytics_ingestion_outbox(status,available_at);
create index analytics_pipeline_runs_idx on public.analytics_pipeline_runs(pipeline_key,started_at desc);
create index analytics_fact_orders_tenant_date_idx on public.analytics_fact_orders(organization_id,store_id,local_date);
create index analytics_fact_items_tenant_date_idx on public.analytics_fact_order_items(organization_id,store_id,date_key);
create index analytics_fact_messages_tenant_date_idx on public.analytics_fact_messages(organization_id,store_id,date_key);
create index analytics_fact_product_events_tenant_date_idx on public.analytics_fact_product_events(organization_id,store_id,date_key);
create index analytics_quality_results_idx on public.analytics_quality_results(checked_at desc,status);
create index analytics_reports_status_idx on public.analytics_report_runs(status,created_at desc);
create index analytics_exports_status_idx on public.analytics_export_jobs(status,created_at desc);

do $$ declare t text; begin foreach t in array array[
  'analytics_permissions','analytics_feature_flags','analytics_datasets','analytics_metric_catalog','analytics_data_contracts','analytics_lineage','data_sync_checkpoints','analytics_ingestion_outbox','analytics_raw_events','analytics_staging_records','analytics_clean_events','analytics_pipeline_runs','analytics_pipeline_dead_letters','analytics_quality_rules','analytics_quality_results','analytics_quarantine','analytics_dim_date','analytics_dim_time','analytics_dim_organizations','analytics_dim_stores','analytics_dim_customers','analytics_dim_products','analytics_dim_plans','analytics_dim_channels','analytics_dim_employees','analytics_dim_campaigns','analytics_dim_sources','analytics_fact_orders','analytics_fact_order_items','analytics_fact_payments','analytics_fact_inventory_movements','analytics_fact_messages','analytics_fact_ai_usage','analytics_fact_delivery','analytics_fact_support_tickets','analytics_fact_saas_subscriptions','analytics_fact_mrr_movements','analytics_fact_sales_opportunities','analytics_fact_customer_health','analytics_fact_product_events','analytics_daily_orders','analytics_daily_revenue','analytics_daily_support','analytics_daily_ai_usage','analytics_customer_360','analytics_organization_360','analytics_dashboards','analytics_dashboard_widgets','analytics_scheduled_reports','analytics_report_runs','analytics_export_jobs','analytics_backfill_jobs','analytics_query_cache','analytics_query_audit','analytics_reconciliations','analytics_cost_usage','data_subject_deletion_jobs'
  ] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon',t); execute format('grant all on public.%I to service_role',t); end loop; end $$;

-- Internal catalog and platform operations are restricted to explicit analytics permissions.
do $$ declare t text; begin foreach t in array array['analytics_permissions','analytics_feature_flags','analytics_datasets','analytics_metric_catalog','analytics_data_contracts','analytics_lineage','data_sync_checkpoints','analytics_ingestion_outbox','analytics_raw_events','analytics_staging_records','analytics_clean_events','analytics_pipeline_runs','analytics_pipeline_dead_letters','analytics_quality_rules','analytics_quality_results','analytics_quarantine','analytics_dim_date','analytics_dim_time','analytics_dim_organizations','analytics_dim_stores','analytics_dim_customers','analytics_dim_products','analytics_dim_plans','analytics_dim_channels','analytics_dim_employees','analytics_dim_campaigns','analytics_dim_sources','analytics_fact_mrr_movements','analytics_cost_usage'] loop
  execute format('create policy %I on public.%I for select to authenticated using((select private.analytics_allowed(''analytics:view'')))','analytics_select_'||t,t);
  execute format('grant select on public.%I to authenticated',t);
end loop; end $$;

-- Tenant-bearing analytical data always checks organization scope.
do $$ declare t text; begin foreach t in array array['analytics_fact_orders','analytics_fact_order_items','analytics_fact_payments','analytics_fact_inventory_movements','analytics_fact_messages','analytics_fact_ai_usage','analytics_fact_delivery','analytics_fact_support_tickets','analytics_fact_saas_subscriptions','analytics_fact_sales_opportunities','analytics_fact_customer_health','analytics_fact_product_events','analytics_daily_orders','analytics_daily_support','analytics_daily_ai_usage','analytics_customer_360','analytics_organization_360','analytics_dashboards','analytics_scheduled_reports','analytics_report_runs','analytics_export_jobs','analytics_query_cache','analytics_query_audit','analytics_reconciliations','data_subject_deletion_jobs'] loop
  execute format('create policy %I on public.%I for select to authenticated using((select private.analytics_org_allowed(organization_id,''analytics:view'')))','analytics_org_select_'||t,t);
  execute format('grant select on public.%I to authenticated',t);
end loop; end $$;

create policy analytics_daily_revenue_select on public.analytics_daily_revenue for select to authenticated using((select private.analytics_allowed('analytics:internal')));
create policy analytics_backfill_select on public.analytics_backfill_jobs for select to authenticated using((select private.analytics_allowed('analytics:advanced')));
create policy analytics_widgets_select on public.analytics_dashboard_widgets for select to authenticated using(exists(select 1 from public.analytics_dashboards d where d.id=dashboard_id and (select private.analytics_org_allowed(d.organization_id,'analytics:view'))));
grant select on public.analytics_daily_revenue,public.analytics_backfill_jobs,public.analytics_dashboard_widgets to authenticated;

create policy analytics_dashboards_insert on public.analytics_dashboards for insert to authenticated with check(owner_user_id=(select auth.uid()) and (select private.analytics_org_allowed(organization_id,'analytics:custom_dashboard')));
create policy analytics_dashboards_update on public.analytics_dashboards for update to authenticated using(owner_user_id=(select auth.uid()) and (select private.analytics_org_allowed(organization_id,'analytics:custom_dashboard'))) with check(owner_user_id=(select auth.uid()) and (select private.analytics_org_allowed(organization_id,'analytics:custom_dashboard')));
create policy analytics_widgets_insert on public.analytics_dashboard_widgets for insert to authenticated with check(exists(select 1 from public.analytics_dashboards d where d.id=dashboard_id and d.owner_user_id=(select auth.uid()) and (select private.analytics_org_allowed(d.organization_id,'analytics:custom_dashboard'))));
create policy analytics_widgets_update on public.analytics_dashboard_widgets for update to authenticated using(exists(select 1 from public.analytics_dashboards d where d.id=dashboard_id and d.owner_user_id=(select auth.uid()))) with check(exists(select 1 from public.analytics_dashboards d where d.id=dashboard_id and d.owner_user_id=(select auth.uid())));
grant insert,update on public.analytics_dashboards,public.analytics_dashboard_widgets to authenticated;
