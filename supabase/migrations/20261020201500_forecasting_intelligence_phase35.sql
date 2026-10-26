-- Phase 35: tenant-isolated forecasting built on the Phase 34 warehouse.
-- Forecasts and recommendations never mutate operational tables automatically.

alter table public.plans add column if not exists demand_forecasting_enabled boolean not null default true;
alter table public.plans add column if not exists inventory_forecasting_enabled boolean not null default false;
alter table public.plans add column if not exists staffing_forecasting_enabled boolean not null default false;
alter table public.plans add column if not exists advanced_forecasting_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists demand_forecasting_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists forecast_recommendations_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists inventory_prediction_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists staffing_prediction_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists model_monitoring_enabled boolean not null default true;

create table public.forecast_settings(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  minimum_training_days integer not null default 28 check(minimum_training_days between 7 and 730),
  customer_quality_threshold numeric not null default 0.75 check(customer_quality_threshold between 0 and 1),
  alert_thresholds jsonb not null default '{"demand_change_percent":25,"capacity_utilization_percent":85,"stockout_risk":"medium"}',
  retraining_cadence text not null default 'weekly' check(retraining_cadence in('weekly','monthly','drift')),
  notifications_enabled boolean not null default false,
  daily_training_quota integer not null default 2 check(daily_training_quota between 0 and 24),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(organization_id,store_id)
);

create table public.forecast_models(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  forecast_type text not null check(forecast_type in('orders','revenue','product_demand','category_demand','ingredient_demand','staffing','delivery','reservations')),
  model_type text not null check(model_type in('moving_average','seasonal_naive','exponential_smoothing','regression','tree_based','time_series_ml','other')),
  version integer not null default 1 check(version>0),
  training_start timestamptz,
  training_end timestamptz,
  status text not null default 'draft' check(status in('draft','challenger','champion','archived','failed')),
  health text not null default 'insufficient_data' check(health in('healthy','degraded','insufficient_data','retraining','failed')),
  metrics jsonb not null default '{}',
  feature_version text not null default 'phase35-v1',
  training_scope jsonb not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,store_id,forecast_type,model_type,version)
);
create unique index forecast_one_champion_idx on public.forecast_models(organization_id,coalesce(store_id,'00000000-0000-0000-0000-000000000000'::uuid),forecast_type) where status='champion';
create index forecast_models_scope_idx on public.forecast_models(organization_id,store_id,forecast_type,status);

create table public.forecast_training_runs(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  model_id uuid references public.forecast_models(id) on delete set null,
  queue_name text not null default 'analytics_forecasting',
  status text not null default 'queued' check(status in('queued','validating','training','backtesting','succeeded','blocked','failed')),
  data_quality_status text not null default 'pending' check(data_quality_status in('pending','passed','low_data','blocked')),
  train_start timestamptz,
  train_end timestamptz,
  validation_start timestamptz,
  validation_end timestamptz,
  rows_read bigint not null default 0,
  duration_ms integer,
  estimated_cost_cents integer not null default 0,
  failure_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index forecast_training_queue_idx on public.forecast_training_runs(status,created_at);

create table public.forecast_backtests(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  model_id uuid not null references public.forecast_models(id) on delete cascade,
  training_run_id uuid references public.forecast_training_runs(id) on delete set null,
  validation_start timestamptz not null,
  validation_end timestamptz not null,
  mae numeric,
  rmse numeric,
  mape numeric,
  wape numeric,
  bias numeric,
  underforecast_rate numeric,
  overforecast_rate numeric,
  observations integer not null default 0,
  passed boolean not null default false,
  created_at timestamptz not null default now()
);
create index forecast_backtests_model_idx on public.forecast_backtests(model_id,created_at desc);

create table public.forecast_predictions(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  forecast_type text not null check(forecast_type in('orders','revenue','product_demand','category_demand','ingredient_demand','staffing','delivery','reservations')),
  entity_type text not null default 'store',
  entity_id uuid,
  forecast_for timestamptz not null,
  horizon text not null check(horizon in('hours','tomorrow','7_days','4_weeks')),
  granularity text not null check(granularity in('15_min','30_min','hour','day','week')),
  predicted_value numeric not null check(predicted_value>=0),
  lower_bound numeric not null check(lower_bound>=0),
  upper_bound numeric not null check(upper_bound>=lower_bound),
  confidence_level text not null check(confidence_level in('high','medium','low')),
  quality_score numeric check(quality_score between 0 and 1),
  model_id uuid not null references public.forecast_models(id) on delete restrict,
  context jsonb not null default '{}',
  system_forecast numeric not null check(system_forecast>=0),
  manual_adjustment numeric not null default 0,
  final_operational_forecast numeric generated always as(greatest(0,system_forecast+manual_adjustment)) stored,
  actual_value numeric,
  generated_at timestamptz not null default now(),
  unique(model_id,forecast_type,entity_type,entity_id,forecast_for,granularity)
);
create index forecast_predictions_scope_idx on public.forecast_predictions(organization_id,store_id,forecast_for,forecast_type);

create table public.forecast_inventory_requirements(
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.forecast_predictions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  required_quantity numeric not null check(required_quantity>=0),
  current_stock numeric not null,
  inbound_quantity numeric not null default 0,
  safety_stock numeric not null default 0,
  expected_remaining numeric not null,
  risk_level text not null check(risk_level in('low','medium','high')),
  suggested_purchase_quantity numeric not null default 0 check(suggested_purchase_quantity>=0),
  lead_time_deadline timestamptz,
  created_at timestamptz not null default now(),
  unique(prediction_id,inventory_item_id)
);

create table public.forecast_manual_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  event_type text not null check(event_type in('local_holiday','sports','show','promotion','closure','outage','other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expected_impact_percent numeric check(expected_impact_percent between -100 and 500),
  label text not null check(length(btrim(label)) between 3 and 120),
  structured_context jsonb not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(ends_at>starts_at)
);

create table public.forecast_adjustments(
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.forecast_predictions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  adjustment_value numeric not null,
  adjustment_mode text not null check(adjustment_mode in('absolute','percent')),
  reason text not null check(length(btrim(reason)) between 3 and 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.forecast_recommendations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  prediction_id uuid references public.forecast_predictions(id) on delete cascade,
  recommendation_type text not null check(recommendation_type in('stock','purchase','staffing','prep','delivery','availability','transfer')),
  title text not null,
  message text not null,
  impact jsonb not null default '{}',
  status text not null default 'suggested' check(status in('suggested','accepted','dismissed','completed')),
  requires_human_confirmation boolean not null default true check(requires_human_confirmation),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index forecast_recommendations_scope_idx on public.forecast_recommendations(organization_id,store_id,status,created_at desc);

create table public.forecast_drift_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  model_id uuid not null references public.forecast_models(id) on delete cascade,
  drift_type text not null check(drift_type in('volume','mix','hours','ticket','model_error')),
  drift_percent numeric not null,
  threshold_percent numeric not null,
  status text not null check(status in('observed','degraded','fallback_activated','resolved')),
  baseline_window jsonb not null,
  recent_window jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.forecast_audit_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in('model_trained','model_published','fallback','override','recommendation_accepted','recommendation_dismissed','configuration_changed','scenario_run')),
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index forecast_audit_scope_idx on public.forecast_audit_events(organization_id,store_id,created_at desc);

do $$ declare t text; begin foreach t in array array[
  'forecast_settings','forecast_models','forecast_training_runs','forecast_backtests','forecast_predictions','forecast_inventory_requirements',
  'forecast_manual_events','forecast_adjustments','forecast_recommendations','forecast_drift_events','forecast_audit_events'
] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
end loop; end $$;

do $$ declare t text; begin foreach t in array array[
  'forecast_settings','forecast_models','forecast_training_runs','forecast_backtests','forecast_predictions','forecast_inventory_requirements',
  'forecast_manual_events','forecast_adjustments','forecast_recommendations','forecast_drift_events','forecast_audit_events'
] loop
  execute format('create policy %I on public.%I for select to authenticated using((select private.analytics_org_allowed(organization_id,''analytics:view'')))','forecast_select_'||t,t);
  execute format('grant select on public.%I to authenticated',t);
end loop; end $$;

-- Writes are performed only by reviewed server routes using service_role. No client can
-- create a purchase, edit a shift, dispatch a driver, or change stock from a prediction.
revoke insert,update,delete on public.forecast_settings,public.forecast_models,public.forecast_training_runs,public.forecast_backtests,
  public.forecast_predictions,public.forecast_inventory_requirements,public.forecast_manual_events,public.forecast_adjustments,
  public.forecast_recommendations,public.forecast_drift_events,public.forecast_audit_events from anon,authenticated;

insert into public.analytics_datasets(dataset_key,name,description,domain,owner_label,dataset_scope,grain,source_tables,refresh_frequency,retention_days,certified,contains_pii)
values('forecasting_mart','Forecasting Mart','Previsões versionadas, intervalos, backtests e recomendações humanas.','forecasting','Dados & Operações','customer_analytics','previsão por tenant/unidade/entidade/janela',array['analytics_fact_orders','analytics_fact_order_items','analytics_fact_inventory_movements','analytics_fact_delivery'],'hourly',1095,true,false)
on conflict(dataset_key) do update set description=excluded.description,source_tables=excluded.source_tables,updated_at=now();

insert into public.analytics_lineage(source_name,transformation_name,target_dataset,metric_keys,dashboard_keys)
values('analytics_fact_orders + analytics_fact_order_items + operations context','phase35_baseline_backtest_and_forecast','forecasting_mart',array['orders','revenue','average_ticket','delivery_time'],array['forecasting','operations'])
on conflict do nothing;

insert into public.analytics_quality_rules(rule_key,dataset_key,rule_type,definition,severity,owner_label)
values
('forecast_history_minimum','forecasting_mart','volume_anomaly','{"recommended_active_days":28,"minimum_observations":20}','high','Dados'),
('forecast_interval_valid','forecasting_mart','accepted_values','{"rule":"lower_bound <= predicted_value <= upper_bound"}','critical','Dados'),
('forecast_no_future_training','forecasting_mart','accepted_values','{"rule":"training_end < validation_start"}','critical','Dados')
on conflict(rule_key) do nothing;

notify pgrst, 'reload schema';
