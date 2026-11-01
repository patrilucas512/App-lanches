-- Fase 83: Revenue Management. Camada comercial governada sobre Pricing 36,
-- Marketing 37, Forecast 35, Catalog 62, Capacity 63, Marketplace 69,
-- Policy 79 e Digital Twin 82. Nenhum mecanismo paralelo publica preços/campanhas.
-- quality: allow-nonconcurrent-index reason=new-empty-revenue-management-tables

alter table public.plans add column if not exists revenue_management_enabled boolean not null default false;
alter table public.plans add column if not exists commercial_recommendations_enabled boolean not null default false;
alter table public.plans add column if not exists commercial_inventory_opportunities_enabled boolean not null default false;
alter table public.plans add column if not exists commercial_dynamic_offer_guardrails_enabled boolean not null default false;

create table public.revenue_management_member_permissions(
 organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 permissions text[] not null default '{revenue_management:view}',active boolean not null default true,updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),primary key(organization_id,user_id),
 check(permissions <@ array['revenue_management:view','revenue_management:view_economics','revenue_management:create_plan','revenue_management:create_offer','revenue_management:edit_offer','revenue_management:simulate','revenue_management:approve_offer','revenue_management:publish_offer','revenue_management:manage_channel_strategy','revenue_management:manage_markdowns','revenue_management:view_network','revenue_management:manage_governance']::text[])
);
create or replace function private.revenue_management_allowed(target_organization uuid,requested_permission text default 'revenue_management:view') returns boolean language sql stable security definer set search_path='' as $$
 select private.is_superadmin() or (target_organization is not null and (exists(select 1 from public.revenue_management_member_permissions p where p.organization_id=target_organization and p.user_id=(select auth.uid()) and p.active and (requested_permission=any(p.permissions) or 'revenue_management:view_network'=any(p.permissions))) or exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=(select auth.uid()) and m.active and m.role in('owner','admin'))))
$$;
revoke all on function private.revenue_management_allowed(uuid,text) from public,anon,authenticated;grant execute on function private.revenue_management_allowed(uuid,text) to authenticated,service_role;

create table public.commercial_plans(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,period_start date not null,period_end date not null,
 scope_type text not null check(scope_type in('organization','brand','region','store','channel')),scope_id text,status text not null default 'draft' check(status in('draft','review','approved','active','completed','cancelled')),
 owner_user_id uuid references auth.users(id),plan_version integer not null default 1 check(plan_version>0),objectives jsonb not null default '[]',targets jsonb not null default '{}',guardrail_refs jsonb not null default '[]',ibp_plan_ref uuid,goal_refs uuid[] not null default '{}',created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(period_end>=period_start),unique(organization_id,name,plan_version)
);
create table public.commercial_offers(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,commercial_plan_id uuid references public.commercial_plans(id) on delete set null,
 offer_type text not null check(offer_type in('discount','bundle','combo','fixed_price','percentage_discount','buy_x_get_y','upsell','cross_sell','loyalty_offer','markdown','channel_exclusive','time_window_offer','inventory_clearance','custom_safe')),
 name text not null,description text,scope_type text not null check(scope_type in('organization','brand','region','store','channel')),scope_id text,channel_scope text[] not null default '{}',starts_at timestamptz not null,ends_at timestamptz,status text not null default 'draft' check(status in('draft','simulation','approved','scheduled','active','paused','expired','cancelled')),
 economics_status text not null default 'unknown' check(economics_status in('complete','partial','low_confidence','unknown')),source text not null default 'manual' check(source in('manual','recommendation','inventory_opportunity','pricing_bridge','template')),current_version integer not null default 1,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ends_at is null or ends_at>starts_at)
);
create table public.commercial_offer_versions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,offer_id uuid not null references public.commercial_offers(id) on delete cascade,version integer not null check(version>0),
 rules jsonb not null default '{}',pricing_refs jsonb not null default '[]',product_refs jsonb not null default '[]',eligibility_refs jsonb not null default '[]',stacking_policy_ref text,offline_safe boolean not null default false,status text not null default 'draft' check(status in('draft','simulation','approved','published','superseded','archived')),effective_from timestamptz,effective_until timestamptz,definition_hash text not null,created_by uuid references auth.users(id),created_at timestamptz not null default now(),published_at timestamptz,unique(offer_id,version),unique(offer_id,definition_hash),check(effective_until is null or effective_from is null or effective_until>effective_from)
);
create or replace function private.prevent_published_offer_version_mutation() returns trigger language plpgsql security invoker set search_path='' as $$begin if old.status='published' then raise exception 'published_offer_version_is_immutable';end if;return new;end$$;
revoke all on function private.prevent_published_offer_version_mutation() from public,anon,authenticated;
create trigger commercial_offer_version_immutable before update or delete on public.commercial_offer_versions for each row execute function private.prevent_published_offer_version_mutation();

create table public.offer_economics_snapshots(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,offer_version_id uuid not null references public.commercial_offer_versions(id) on delete cascade,
 base_price_cents bigint not null,discounted_price_cents bigint not null,cogs_cents bigint,channel_fee_cents bigint not null default 0,payment_fee_cents bigint not null default 0,logistics_cents bigint not null default 0,campaign_spend_cents bigint not null default 0,
 gross_revenue_cents bigint,net_revenue_cents bigint,gross_margin_cents bigint,contribution_margin_cents bigint,contribution_margin_percent numeric,break_even_uplift_percent numeric,incremental_revenue_cents bigint,incremental_margin_cents bigint,
 quality text not null check(quality in('complete','partial','low_confidence','unknown')),assumptions jsonb not null default '{}',source_refs jsonb not null default '[]',pricing_engine_version text not null default 'phase36',finance_data_as_of timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),check(base_price_cents>=0 and discounted_price_cents>=0)
);
create table public.commercial_demand_windows(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,channel text not null,day_of_week smallint not null check(day_of_week between 0 and 6),daypart_key text not null,starts_at time not null,ends_at time not null,
 window_type text not null check(window_type in('peak','normal','low','opportunity')),predicted_orders numeric,baseline_orders numeric,confidence text not null check(confidence in('high','medium','low')),forecast_ref uuid,forecast_version text,data_as_of timestamptz not null,stale_after timestamptz not null,created_at timestamptz not null default now(),unique(store_id,channel,day_of_week,daypart_key,data_as_of)
);
create table public.commercial_inventory_opportunities(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,inventory_item_id uuid,product_id uuid references public.products(id) on delete set null,
 opportunity_type text not null check(opportunity_type in('excess_inventory','slow_moving','expiry_risk','overproduction','ingredient_surplus')),quantity numeric,days_cover numeric,expiry_at timestamptz,quality_status text not null,recipe_safe boolean not null default false,status text not null default 'open' check(status in('open','reviewing','converted','dismissed','expired')),evidence jsonb not null default '{}',recommendation_id uuid,created_at timestamptz not null default now(),expires_at timestamptz,check(quality_status='released')
);
create table public.commercial_recommendations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,recommendation_type text not null,scope_type text not null,scope_id text,generated_at timestamptz not null default now(),valid_until timestamptz,
 source_services text[] not null,recommendation jsonb not null,expected_impact jsonb not null,confidence text not null check(confidence in('high','medium','low')),explanation text not null,status text not null default 'proposed' check(status in('proposed','reviewed','accepted','rejected','expired','executed')),accepted_by uuid references auth.users(id),accepted_at timestamptz,executed_at timestamptz,
 contains_sensitive_targeting boolean not null default false,creates_draft_only boolean not null default true,model_version text,created_at timestamptz not null default now(),check(contains_sensitive_targeting=false),check(creates_draft_only=true)
);
create table public.commercial_channel_economics(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,channel text not null,period_start timestamptz not null,period_end timestamptz not null,
 gross_revenue_cents bigint not null default 0,fees_cents bigint not null default 0,payment_cost_cents bigint not null default 0,delivery_cost_cents bigint not null default 0,campaign_cost_cents bigint not null default 0,cogs_cents bigint,net_revenue_cents bigint,contribution_margin_cents bigint,margin_percent numeric,orders bigint not null default 0,capacity_burden numeric,quality text not null check(quality in('complete','partial','low_confidence','unknown')),provider_capability_snapshot jsonb not null default '{}',data_as_of timestamptz not null,check(period_end>period_start)
);
create table public.commercial_scenarios(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,commercial_plan_id uuid references public.commercial_plans(id) on delete set null,name text not null,scenario_type text not null check(scenario_type in('discount','bundle','price_change','daypart_offer','inventory_markdown','channel_shift','custom')),baseline_ref jsonb not null,assumptions jsonb not null default '[]',digital_twin_scenario_id uuid references public.digital_twin_scenarios(id) on delete set null,status text not null default 'draft' check(status in('draft','queued','running','completed','partial','failed','cancelled')),simulation_only boolean not null default true,created_by uuid references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz,check(simulation_only=true)
);
create table public.commercial_scenario_results(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,scenario_id uuid not null references public.commercial_scenarios(id) on delete cascade,variant_key text not null,
 revenue_cents bigint,margin_cents bigint,orders numeric,inventory_impact jsonb,capacity_impact jsonb,waste_impact jsonb,channel_mix jsonb,quality text not null check(quality in('complete','partial','low_confidence','unknown')),warnings text[] not null default '{}',actual boolean not null default false,created_at timestamptz not null default now(),unique(scenario_id,variant_key),check(actual=false)
);
create table public.commercial_offer_conflicts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,left_offer_id uuid not null references public.commercial_offers(id) on delete cascade,right_offer_id uuid not null references public.commercial_offers(id) on delete cascade,conflict_type text not null check(conflict_type in('overlap','double_discount','incompatible_bundle','loyalty_collision','channel_mismatch','stacking_denied')),policy_decision_ref text,status text not null default 'open' check(status in('open','resolved','accepted_with_approval')),resolution text,created_at timestamptz not null default now(),unique(left_offer_id,right_offer_id,conflict_type)
);
create table public.commercial_offer_performance(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,offer_id uuid not null references public.commercial_offers(id) on delete cascade,offer_version integer not null,period_start timestamptz not null,period_end timestamptz not null,
 impressions bigint,redemptions bigint not null default 0,orders bigint not null default 0,revenue_cents bigint not null default 0,margin_cents bigint,average_basket_cents bigint,incremental_revenue_cents bigint,incremental_margin_cents bigint,cannibalization numeric,operational_impact jsonb not null default '{}',experiment_ref uuid,incrementality_quality text not null default 'unknown' check(incrementality_quality in('experiment','modeled','descriptive','unknown')),forecast_snapshot jsonb not null default '{}',actual_snapshot jsonb not null default '{}',data_as_of timestamptz not null,check(period_end>period_start)
);
create table public.commercial_offer_redemptions(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,offer_id uuid not null references public.commercial_offers(id),offer_version integer not null,order_id uuid not null references public.orders(id),channel text not null,discount_cents bigint not null default 0,price_snapshot jsonb not null,customer_reference_hash text,created_at timestamptz not null default now(),unique(order_id,offer_id,offer_version)
);
create table public.commercial_calendar_entries(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,title text not null,entry_type text not null check(entry_type in('offer','campaign','price_change','holiday_event','product_launch')),source_entity_id uuid,scope_type text not null,scope_id text,starts_at timestamptz not null,ends_at timestamptz not null,status text not null default 'planned',created_at timestamptz not null default now(),check(ends_at>starts_at)
);
create table public.commercial_governance_policies(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,scope_type text not null,scope_id text,policy_set_id uuid references public.policy_sets(id) on delete restrict,margin_floor_ref text,max_discount_percent numeric,maximum_duration_hours integer,channel_restrictions text[] not null default '{}',local_autonomy jsonb not null default '{}',approval_thresholds jsonb not null default '{}',active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(max_discount_percent is null or max_discount_percent between 0 and 100)
);
create table public.commercial_execution_drafts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,recommendation_id uuid not null references public.commercial_recommendations(id),target_domain text not null check(target_domain in('pricing_phase36','campaign_phase37','catalog_phase62','offer_phase83','channel_strategy')),target_draft_ref uuid,status text not null default 'draft' check(status in('draft','approval_required','approved','rejected','handed_off')),approval_id uuid references public.internal_approvals(id),preview jsonb not null default '{}',published boolean not null default false,created_by uuid references auth.users(id),created_at timestamptz not null default now(),check(published=false)
);
create table public.revenue_management_audit_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,actor_id uuid references auth.users(id),event_type text not null,entity_type text not null,entity_id uuid,reason text,before_state_redacted jsonb,after_state_redacted jsonb,correlation_id uuid not null default gen_random_uuid(),created_at timestamptz not null default now()
);
create table public.revenue_management_settings(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade unique,timezone text not null default 'America/Sao_Paulo',recommendations_enabled boolean not null default false,dynamic_guardrails_enabled boolean not null default false,personalized_hidden_base_prices_enabled boolean not null default false,protected_attribute_targeting_enabled boolean not null default false,checkout_cache_ttl_seconds integer not null default 60 check(checkout_cache_ttl_seconds between 5 and 600),scenario_daily_limit integer not null default 50 check(scenario_daily_limit between 1 and 500),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(personalized_hidden_base_prices_enabled=false),check(protected_attribute_targeting_enabled=false)
);

create index commercial_offers_effective_idx on public.commercial_offers(organization_id,status,starts_at,ends_at);
create index commercial_offer_versions_runtime_idx on public.commercial_offer_versions(offer_id,status,effective_from,effective_until);
create index commercial_recommendations_status_idx on public.commercial_recommendations(organization_id,status,generated_at desc);
create index commercial_inventory_opportunities_idx on public.commercial_inventory_opportunities(organization_id,store_id,status,created_at desc);
create index commercial_performance_offer_idx on public.commercial_offer_performance(offer_id,period_end desc);
create index commercial_redemptions_order_idx on public.commercial_offer_redemptions(order_id,created_at desc);
create index commercial_audit_org_idx on public.revenue_management_audit_events(organization_id,created_at desc);

do $$ declare t text; begin foreach t in array array[
 'revenue_management_member_permissions','commercial_plans','commercial_offers','commercial_offer_versions','offer_economics_snapshots','commercial_demand_windows','commercial_inventory_opportunities','commercial_recommendations','commercial_channel_economics','commercial_scenarios','commercial_scenario_results','commercial_offer_conflicts','commercial_offer_performance','commercial_offer_redemptions','commercial_calendar_entries','commercial_governance_policies','commercial_execution_drafts','revenue_management_audit_events','revenue_management_settings'
] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',left('revenue_management_service_'||t,63),t);end loop;end $$;
revoke all on sequence public.commercial_offer_redemptions_id_seq,public.revenue_management_audit_events_id_seq from public,anon,authenticated;grant usage,select on sequence public.commercial_offer_redemptions_id_seq,public.revenue_management_audit_events_id_seq to service_role;

create or replace view public.revenue_management_overview with (security_invoker=true) as
select o.organization_id,count(*) filter(where o.status='active') active_offers,count(*) filter(where o.status='scheduled') scheduled_offers,
 count(*) filter(where o.economics_status in('partial','low_confidence','unknown')) economics_risks,
 coalesce(sum(p.revenue_cents),0) offer_revenue_cents,coalesce(sum(p.margin_cents),0) offer_margin_cents
from public.commercial_offers o left join public.commercial_offer_performance p on p.offer_id=o.id group by o.organization_id;
revoke all on public.revenue_management_overview from public,anon,authenticated;grant select on public.revenue_management_overview to service_role;

comment on table public.commercial_offers is 'Oferta define valor e termos; campanhas da Fase 37 apenas comunicam/distribuem.';
comment on table public.commercial_execution_drafts is 'Bridge cria somente rascunhos nos domínios oficiais. Nunca publica preço ou campanha.';
comment on column public.offer_economics_snapshots.break_even_uplift_percent is 'Crescimento unitário mínimo determinístico; nulo quando contribuição promocional não é positiva ou custos estão ausentes.';
