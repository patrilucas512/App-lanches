-- MasterApp Phase 37 — Marketing Intelligence.
-- Extends the canonical CRM/campaign/customer/coupon stack; it does not create a parallel CRM.

alter table public.store_feature_flags add column if not exists marketing_intelligence_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists smart_promotions_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists marketing_experiments_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists marketing_attribution_enabled boolean not null default true;
alter table public.plans add column if not exists marketing_intelligence_enabled boolean not null default true;
alter table public.plans add column if not exists smart_promotions_enabled boolean not null default true;
alter table public.plans add column if not exists marketing_experiments_enabled boolean not null default true;
alter table public.plans add column if not exists marketing_attribution_enabled boolean not null default true;

create table public.marketing_intelligence_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  minimum_sample_size integer not null default 30 check(minimum_sample_size between 5 and 100000),
  minimum_margin_percent numeric(7,2) not null default 15 check(minimum_margin_percent between -100 and 100),
  quiet_hours_start time not null default '21:00', quiet_hours_end time not null default '08:00',
  max_messages_per_customer_7d integer not null default 2 check(max_messages_per_customer_7d between 1 and 30),
  minimum_campaign_interval_hours integer not null default 24 check(minimum_campaign_interval_hours between 1 and 720),
  attribution_window_days integer not null default 7 check(attribution_window_days between 1 and 90),
  default_control_percent integer not null default 10 check(default_control_percent between 0 and 50),
  approval_required boolean not null default true, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.marketing_intelligence_permissions(
  organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
  permissions text[] not null default array['marketing:view'],active boolean not null default true,updated_at timestamptz not null default now(),primary key(organization_id,user_id)
);
create table public.marketing_margin_guardrails(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,category_id uuid references public.categories(id) on delete cascade,product_id uuid references public.products(id) on delete cascade,
  minimum_margin_percent numeric(7,2) not null,active boolean not null default true,created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  check(num_nonnulls(store_id,category_id,product_id)<=1)
);
create unique index marketing_guardrail_scope_uidx on public.marketing_margin_guardrails(organization_id,coalesce(store_id,'00000000-0000-0000-0000-000000000000'),coalesce(category_id,'00000000-0000-0000-0000-000000000000'),coalesce(product_id,'00000000-0000-0000-0000-000000000000')) where active;

create table public.marketing_opportunities(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,
  opportunity_type text not null check(opportunity_type in('inactive_customer','high_value_low_frequency','repeat_purchase','high_margin_product','underperforming_product','excess_inventory','low_demand_period','birthday','loyalty','cross_sell','upsell','abandoned_cart','forecast_based','new_product','lapsed_category')),
  title text not null,explanation text not null,audience_definition jsonb not null default '{}',estimated_audience integer,margin_evidence jsonb not null default '{}',risk_notes text[] not null default '{}',sample_size integer not null default 0,
  data_classification text not null default 'observed' check(data_classification in('observed','calculated','forecast','insufficient_data')),
  status text not null default 'open' check(status in('open','dismissed','converted','expired')),source_references jsonb not null default '[]',detected_at timestamptz not null default now(),expires_at timestamptz
);
create index marketing_opportunities_scope_idx on public.marketing_opportunities(organization_id,store_id,status,detected_at desc);

create table public.marketing_promotions(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,
  name text not null,promotion_type text not null check(promotion_type in('percentage','fixed','buy_x_get_y','free_delivery','free_item','bundle','bonus_points')),
  conditions jsonb not null default '{}',benefits jsonb not null default '{}',eligible_products uuid[] not null default '{}',eligible_categories uuid[] not null default '{}',eligible_segments uuid[] not null default '{}',channels text[] not null default '{}',
  starts_at timestamptz,ends_at timestamptz,usage_limit integer,per_customer_limit integer not null default 1,stacking_rule text not null default 'exclusive' check(stacking_rule in('exclusive','combinable','best_benefit')),
  minimum_margin_percent numeric(7,2),loss_leader boolean not null default false,override_reason text,override_by uuid references auth.users(id),status text not null default 'draft' check(status in('draft','pending_approval','approved','active','paused','ended','rejected')),
  validation_result jsonb not null default '{}',created_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),approved_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(ends_at is null or starts_at is null or ends_at>starts_at),check(not loss_leader or override_reason is not null)
);
create index marketing_promotions_scope_idx on public.marketing_promotions(organization_id,store_id,status,starts_at);

alter table public.crm_campaigns add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
update public.crm_campaigns c set organization_id=e.organization_id from public.establishments e where e.id=c.establishment_id and c.organization_id is null;
alter table public.crm_campaigns add column if not exists objective text;
alter table public.crm_campaigns add column if not exists channels text[] not null default array['whatsapp'];
alter table public.crm_campaigns add column if not exists promotion_id uuid references public.marketing_promotions(id) on delete set null;
alter table public.crm_campaigns add column if not exists primary_metric text;
alter table public.crm_campaigns add column if not exists guardrail_metrics text[] not null default '{}';
alter table public.crm_campaigns add column if not exists cost_cents bigint;
alter table public.crm_campaigns add column if not exists audience_snapshot_id uuid;
alter table public.crm_campaigns add column if not exists approval_status text not null default 'not_submitted' check(approval_status in('not_submitted','pending','approved','rejected'));
alter table public.crm_campaigns add column if not exists approval_reason text;

create table public.marketing_campaign_plans(
  campaign_id uuid primary key references public.crm_campaigns(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  objective text not null,product_scope jsonb not null default '{}',audience_definition jsonb not null default '{}',offer_definition jsonb not null default '{}',content jsonb not null default '{}',schedule jsonb not null default '{}',channel_policy jsonb not null default '{}',capacity_check jsonb not null default '{}',stock_check jsonb not null default '{}',margin_check jsonb not null default '{}',wizard_step integer not null default 1 check(wizard_step between 1 and 10),updated_at timestamptz not null default now()
);
create table public.marketing_audience_snapshots(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  segment_id uuid references public.crm_segments(id) on delete set null,definition jsonb not null,eligible_count integer not null default 0,suppressed_count integer not null default 0,suppression_summary jsonb not null default '{}',fixed_at timestamptz not null default now(),created_by uuid not null references auth.users(id),unique(campaign_id)
);
alter table public.crm_campaigns add constraint crm_campaigns_audience_snapshot_fk foreign key(audience_snapshot_id) references public.marketing_audience_snapshots(id) on delete set null deferrable initially deferred;
create table public.marketing_audience_snapshot_members(
  snapshot_id uuid not null references public.marketing_audience_snapshots(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check(channel in('whatsapp','web','push','email')),eligible boolean not null,suppression_reasons text[] not null default '{}',assignment text check(assignment in('control','A','B')),created_at timestamptz not null default now(),primary key(snapshot_id,customer_id,channel)
);
create table public.marketing_campaign_experiments(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  variable text not null check(variable in('content','offer','channel','schedule')),primary_metric text not null,guardrail_metrics text[] not null default '{}',control_percent integer not null default 10 check(control_percent between 0 and 50),minimum_sample_size integer not null default 30,
  variant_a jsonb not null,variant_b jsonb not null,status text not null default 'draft' check(status in('draft','running','completed','cancelled')),result jsonb not null default '{}',created_at timestamptz not null default now(),unique(campaign_id)
);
create table public.marketing_attribution_results(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  window_start timestamptz not null,window_end timestamptz not null,attributed_revenue_cents bigint not null default 0,attributed_margin_cents bigint,incremental_revenue_cents bigint,campaign_cost_cents bigint,paid_media_cost_cents bigint,
  roi numeric,roas numeric,sample_size integer not null default 0,sufficient_sample boolean not null default false,method text not null default 'last_touch',disclaimer text not null default 'Atribuição não prova causalidade; incrementalidade exige controle e amostra suficiente.',calculated_at timestamptz not null default now(),unique(campaign_id,window_start,window_end)
);
create table public.marketing_delivery_jobs(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,snapshot_id uuid not null references public.marketing_audience_snapshots(id) on delete cascade,
  channel text not null check(channel in('whatsapp','web','push','email')),batch_number integer not null,batch_size integer not null check(batch_size between 1 and 1000),status text not null default 'pending' check(status in('pending','processing','completed','failed','dead_letter','paused')),attempts integer not null default 0 check(attempts between 0 and 8),next_attempt_at timestamptz not null default now(),rate_limit_per_minute integer not null default 60,last_error text,idempotency_key text not null,created_at timestamptz not null default now(),unique(organization_id,idempotency_key)
);
create index marketing_delivery_queue_idx on public.marketing_delivery_jobs(next_attempt_at,created_at) where status in('pending','failed');
create table public.marketing_action_previews(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,action_type text not null check(action_type in('campaign_draft','campaign_publish','campaign_pause','promotion_create','promotion_activate','promotion_deactivate','coupon_create','bulk_campaign_publish')),
  entity_id uuid,payload jsonb not null,impact_preview jsonb not null,status text not null default 'pending' check(status in('pending','confirmed','executed','expired','cancelled')),reinforced_confirmation boolean not null default false,created_by uuid not null references auth.users(id),expires_at timestamptz not null default(now()+interval '30 minutes'),confirmed_at timestamptz,executed_at timestamptz,created_at timestamptz not null default now()
);
create table public.marketing_audit_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,actor_user_id uuid references auth.users(id) on delete set null,event_type text not null,entity_type text not null,entity_id uuid,reason text,before_state jsonb,after_state jsonb,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create index marketing_audit_scope_idx on public.marketing_audit_events(organization_id,store_id,created_at desc);

do $$ declare t text; begin foreach t in array array['marketing_intelligence_settings','marketing_intelligence_permissions','marketing_margin_guardrails','marketing_opportunities','marketing_promotions','marketing_campaign_plans','marketing_audience_snapshots','marketing_audience_snapshot_members','marketing_campaign_experiments','marketing_attribution_results','marketing_action_previews','marketing_audit_events'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
  execute format('create policy %I on public.%I for select to authenticated using((select private.analytics_org_allowed(organization_id,''analytics:view'')))','marketing_select_'||t,t);execute format('grant select on public.%I to authenticated',t);
end loop; end $$;
alter table public.marketing_delivery_jobs enable row level security;
revoke all on public.marketing_delivery_jobs from public,anon,authenticated;
grant all on public.marketing_delivery_jobs to service_role;

insert into public.analytics_datasets(dataset_key,name,description,domain,owner_label,dataset_scope,grain,source_tables,refresh_frequency,retention_days,certified,contains_pii)
values('marketing_intelligence_mart','Marketing Intelligence Mart','Oportunidades, audiências consentidas, promoções, experimentos, atribuição e margem.','marketing','Marketing & CRM','customer_analytics','campanha/audiência/canal/unidade/período',array['crm_segments','crm_campaigns','crm_campaign_recipients','crm_campaign_attributions','marketing_promotions','marketing_opportunities','product_profitability_snapshots','forecast_predictions'],'hourly',1095,true,true)
on conflict(dataset_key) do update set description=excluded.description,source_tables=excluded.source_tables,updated_at=now();
insert into public.analytics_lineage(source_name,transformation_name,target_dataset,metric_keys,dashboard_keys) values('CRM + pedidos + consentimento + rentabilidade + previsão','phase37_marketing_intelligence','marketing_intelligence_mart',array['audience_eligible','attributed_revenue','incremental_revenue','campaign_margin','roi','roas','fatigue'],array['marketing_intelligence']) on conflict do nothing;
insert into public.analytics_quality_rules(rule_key,dataset_key,rule_type,definition,severity,owner_label) values
('marketing_no_fake_conversion','marketing_intelligence_mart','accepted_values','{"rule":"conversion/uplift hidden when minimum sample is not met"}','critical','Marketing & Dados'),
('marketing_consent_enforced','marketing_intelligence_mart','accepted_values','{"rule":"recipient requires channel consent and no active suppression"}','critical','Privacidade'),
('marketing_margin_guardrail','marketing_intelligence_mart','accepted_values','{"rule":"activation below margin floor requires permission and reason"}','critical','Financeiro'),
('marketing_roi_cost_required','marketing_intelligence_mart','accepted_values','{"rule":"ROI only when campaign cost exists; ROAS only with paid media cost"}','warning','Marketing & Dados') on conflict(rule_key) do nothing;
notify pgrst,'reload schema';
