-- Phase 63: Capacity Management coordinates existing Orders, KDS, Logistics, Reservations,
-- Workforce, Forecasting and Catalog. It does not replace any source-of-truth module.
-- quality: allow-nonconcurrent-index reason=new-empty-quality-tables

create schema if not exists capacity_private;
revoke all on schema capacity_private from public, anon, authenticated;

create table public.capacity_member_permissions(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,permissions text[] not null default '{}',store_ids uuid[] not null default '{}',active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,user_id)
);
create table public.capacity_models(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,resource_type text not null check(resource_type in('store','kitchen','kitchen_station','expedition','pickup','delivery_dispatch','dining_room','table_zone','counter','custom')),resource_id uuid,capacity_unit text not null check(capacity_unit in('orders','items','production_points','covers','deliveries','tickets','custom_workload_units')),base_capacity numeric(12,3) not null check(base_capacity>=0),time_bucket_minutes integer not null check(time_bucket_minutes in(5,10,15,30,60,120)),active boolean not null default true,version integer not null default 1,effective_from timestamptz not null default now(),effective_until timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(effective_until is null or effective_until>effective_from)
);
create table public.product_capacity_profiles(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,variant_id uuid references public.product_variations(id) on delete cascade,kitchen_station_id uuid references public.kitchen_stations(id) on delete set null,workload_units numeric(12,3) not null check(workload_units>=0),estimated_prep_minutes integer check(estimated_prep_minutes is null or estimated_prep_minutes>=0),batchable boolean not null default false,max_batch_size integer check(max_batch_size is null or max_batch_size>0),source text not null default 'manual' check(source in('manual','historical_calibration','recipe_kds_estimation','suggested')),review_status text not null default 'approved' check(review_status in('suggested','review_required','approved','rejected')),profile_version integer not null default 1,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(store_id,product_id,variant_id,kitchen_station_id,profile_version)
);
create table public.capacity_windows(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,capacity_model_id uuid not null references public.capacity_models(id) on delete cascade,resource_type text not null,resource_id uuid,day_of_week smallint check(day_of_week between 0 and 6),specific_date date,start_time time not null,end_time time not null,capacity_override numeric(12,3) not null check(capacity_override>=0),reason text,active boolean not null default true,created_at timestamptz not null default now(),check(day_of_week is not null or specific_date is not null),check(end_time>start_time)
);
create table public.operational_queues(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,queue_type text not null check(queue_type in('kitchen','station','expedition','pickup','delivery_dispatch','counter')),resource_id uuid,time_bucket_minutes integer not null default 15,queue_length integer not null default 0,workload numeric(12,3) not null default 0,oldest_item_age_minutes numeric(12,2) not null default 0,estimated_clear_minutes numeric(12,2),delayed_count integer not null default 0,health text not null default 'normal' check(health in('normal','busy','saturated','overloaded','recovering')),source_cursor text,snapshot_at timestamptz not null default now(),unique(store_id,queue_type,resource_id,snapshot_at)
);
create table public.operational_queue_items(
  id uuid primary key default gen_random_uuid(),queue_id uuid not null references public.operational_queues(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,order_id uuid,task_id uuid,workload numeric(12,3) not null default 0,queued_at timestamptz not null,status text not null,metadata jsonb not null default '{}',unique(queue_id,order_id,task_id)
);
create table public.capacity_slots(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,resource_type text not null,resource_id uuid,starts_at timestamptz not null,ends_at timestamptz not null,capacity_total numeric(12,3) not null check(capacity_total>=0),capacity_reserved numeric(12,3) not null default 0 check(capacity_reserved>=0),capacity_committed numeric(12,3) not null default 0 check(capacity_committed>=0),capacity_available numeric(12,3) generated always as (greatest(0,capacity_total-capacity_reserved-capacity_committed)) stored,status text not null default 'open' check(status in('open','limited','full','closed','blocked')),version integer not null default 1,last_calculated_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ends_at>starts_at),check(capacity_reserved+capacity_committed<=capacity_total),unique(store_id,resource_type,resource_id,starts_at)
);
create table public.capacity_slot_holds(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,slot_id uuid not null references public.capacity_slots(id) on delete cascade,session_reference_hash text,order_draft_reference text,order_id uuid,workload_reserved numeric(12,3) not null check(workload_reserved>0),expires_at timestamptz not null,status text not null default 'active' check(status in('active','committed','released','expired')),idempotency_key text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,idempotency_key)
);
create table public.order_promise_snapshots(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,order_id uuid not null,fulfillment_type text not null,original_ready_from timestamptz,original_ready_to timestamptz,original_delivery_from timestamptz,original_delivery_to timestamptz,current_estimate_from timestamptz,current_estimate_to timestamptz,confidence text not null check(confidence in('high','medium','low')),components jsonb not null default '{}',source_version text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(store_id,order_id)
);
create table public.capacity_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,event_source text not null,source_id text,starts_at timestamptz not null,ends_at timestamptz not null,expected_demand numeric(12,3) not null default 0,reserved_capacity numeric(12,3) not null default 0,confidence text not null default 'medium' check(confidence in('high','medium','low')),metadata jsonb not null default '{}',created_at timestamptz not null default now(),check(ends_at>starts_at)
);
create table public.large_order_policies(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,workload_threshold numeric(12,3) not null,minimum_lead_time_minutes integer not null default 60,approval_required boolean not null default true,available_channels text[] not null default '{}',active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.channel_capacity_policies(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,channel text not null,max_capacity_percent numeric(5,2) check(max_capacity_percent is null or max_capacity_percent between 0 and 100),priority_weight numeric(6,3) not null default 1,commercial_reason text not null,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,store_id,channel)
);
create table public.capacity_policies(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,name text not null,resource_type text,resource_id uuid,channel text,trigger_type text not null,threshold numeric(8,4) not null,duration_minutes integer not null default 5,recovery_threshold numeric(8,4) not null,cooldown_minutes integer not null default 10,action text not null default 'notify_only' check(action in('notify_only','extend_eta','limit_slots','pause_channel','restrict_large_orders','suggest_product_pause')),approval_mode text not null default 'manual' check(approval_mode in('manual','action_engine','policy_approved')),active boolean not null default false,simulation_summary jsonb not null default '{}',created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(recovery_threshold<threshold)
);
create table public.capacity_overrides(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,resource_type text not null,resource_id uuid,channel text,override_type text not null check(override_type in('capacity_percent','extra_capacity','channel_pause','eta_minimum','slot_capacity','large_order')),numeric_value numeric(12,3),text_value text,reason text not null,starts_at timestamptz not null default now(),ends_at timestamptz not null,status text not null default 'active' check(status in('scheduled','active','expired','cancelled')),action_approval_id uuid,created_by uuid references auth.users(id),created_at timestamptz not null default now(),check(ends_at>starts_at)
);
create table public.capacity_throttle_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,policy_id uuid references public.capacity_policies(id) on delete set null,resource_type text,resource_id uuid,channel text,action text not null,previous_state jsonb not null default '{}',next_state jsonb not null default '{}',trigger_duration_minutes integer,automatic boolean not null default false,reversible boolean not null default true,action_approval_id uuid,started_at timestamptz not null default now(),ended_at timestamptz,created_at timestamptz not null default now()
);
create table public.capacity_scenarios(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,name text not null,scenario_type text not null check(scenario_type in('base','promotion','weather','event','reduced_team','custom')),inputs jsonb not null default '{}',results jsonb not null default '{}',dry_run boolean not null default true,created_by uuid references auth.users(id),created_at timestamptz not null default now()
);
create table public.capacity_order_risk_snapshots(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,order_id uuid not null,risk_level text not null check(risk_level in('low','medium','high')),minutes_to_promise numeric(10,2),remaining_production_minutes numeric(10,2),queue_backlog_minutes numeric(10,2),delivery_wait_minutes numeric(10,2),reasons jsonb not null default '[]',late boolean not null default false,snapshot_at timestamptz not null default now()
);
create table public.capacity_recalculation_jobs(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,job_type text not null,event_type text,payload jsonb not null default '{}',status text not null default 'pending' check(status in('pending','processing','retrying','completed','dead_letter')),idempotency_key text not null,attempts integer not null default 0,max_attempts integer not null default 5,available_at timestamptz not null default now(),locked_at timestamptz,locked_by text,error_message text,result jsonb,created_at timestamptz not null default now(),completed_at timestamptz,unique(organization_id,idempotency_key)
);
create table public.capacity_alerts(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,alert_type text not null,deduplication_key text not null,severity text not null check(severity in('info','warning','critical')),resource_type text,resource_id uuid,message text not null,status text not null default 'open',cooldown_until timestamptz,created_at timestamptz not null default now(),resolved_at timestamptz,unique(organization_id,deduplication_key)
);
create table public.capacity_audit_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,actor_user_id uuid references auth.users(id),event_type text not null,entity_type text not null,entity_id uuid,reason text,before_state jsonb,after_state jsonb,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);

alter table public.orders add column if not exists promised_ready_from timestamptz,add column if not exists promised_ready_to timestamptz,add column if not exists promised_delivery_from timestamptz,add column if not exists promised_delivery_to timestamptz,add column if not exists current_estimate_from timestamptz,add column if not exists current_estimate_to timestamptz,add column if not exists capacity_slot_id uuid references public.capacity_slots(id),add column if not exists capacity_workload numeric(12,3);
alter table public.table_orders add column if not exists promised_ready_from timestamptz,add column if not exists promised_ready_to timestamptz,add column if not exists current_estimate_from timestamptz,add column if not exists current_estimate_to timestamptz,add column if not exists capacity_workload numeric(12,3);

create index capacity_models_store_resource_idx on public.capacity_models(store_id,resource_type,resource_id,effective_from desc) where active;
create index product_capacity_profiles_product_idx on public.product_capacity_profiles(store_id,product_id,variant_id,profile_version desc);
create index capacity_windows_model_idx on public.capacity_windows(capacity_model_id,specific_date,day_of_week,start_time) where active;
create index operational_queues_live_idx on public.operational_queues(store_id,queue_type,snapshot_at desc);
create index operational_queue_items_order_idx on public.operational_queue_items(store_id,order_id,queued_at);
create index capacity_slots_lookup_idx on public.capacity_slots(store_id,resource_type,starts_at,status);
create unique index capacity_slots_resource_time_uq on public.capacity_slots(store_id,resource_type,coalesce(resource_id,'00000000-0000-0000-0000-000000000000'::uuid),starts_at);
create index capacity_slot_holds_expiry_idx on public.capacity_slot_holds(status,expires_at) where status='active';
create index promise_order_idx on public.order_promise_snapshots(store_id,order_id);
create index capacity_events_time_idx on public.capacity_events(store_id,starts_at,ends_at);
create index capacity_overrides_active_idx on public.capacity_overrides(store_id,starts_at,ends_at) where status in('scheduled','active');
create index capacity_policy_scope_idx on public.capacity_policies(organization_id,store_id,active);
create index capacity_risk_live_idx on public.capacity_order_risk_snapshots(store_id,risk_level,snapshot_at desc);
create index capacity_jobs_claim_idx on public.capacity_recalculation_jobs(status,available_at,created_at) where status in('pending','retrying');
create index capacity_audit_scope_idx on public.capacity_audit_events(organization_id,store_id,created_at desc);

create or replace function capacity_private.can_access(requested_org uuid,requested_store uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (
    exists(select 1 from public.organization_members om where om.organization_id=requested_org and om.user_id=(select auth.uid()) and om.active=true and (requested_store is null or om.all_stores=true or exists(select 1 from public.establishment_members em where em.establishment_id=requested_store and em.user_id=(select auth.uid()) and em.status='active')))
    or exists(select 1 from public.establishment_members em join public.establishments e on e.id=em.establishment_id where e.organization_id=requested_org and em.user_id=(select auth.uid()) and em.status='active' and (requested_store is null or em.establishment_id=requested_store))
  );
$$;
revoke all on function capacity_private.can_access(uuid,uuid) from public,anon;
grant execute on function capacity_private.can_access(uuid,uuid) to authenticated;

do $$ declare t text; begin foreach t in array array['capacity_member_permissions','capacity_models','product_capacity_profiles','capacity_windows','operational_queues','operational_queue_items','capacity_slots','capacity_slot_holds','order_promise_snapshots','capacity_events','large_order_policies','channel_capacity_policies','capacity_policies','capacity_overrides','capacity_throttle_events','capacity_scenarios','capacity_order_risk_snapshots','capacity_recalculation_jobs','capacity_alerts','capacity_audit_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
end loop; end $$;
do $$ declare t text; begin foreach t in array array['capacity_models','product_capacity_profiles','capacity_windows','operational_queues','operational_queue_items','capacity_slots','order_promise_snapshots','capacity_events','large_order_policies','channel_capacity_policies','capacity_policies','capacity_overrides','capacity_throttle_events','capacity_scenarios','capacity_order_risk_snapshots','capacity_alerts'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using ((select capacity_private.can_access(organization_id,store_id)))','capacity_read_'||t,t);
end loop; end $$;
do $$ declare t text; begin foreach t in array array['capacity_member_permissions','capacity_slot_holds','capacity_recalculation_jobs','capacity_audit_events'] loop execute format('create policy %I on public.%I for all to service_role using(true) with check(true)','capacity_service_'||t,t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['capacity_models','product_capacity_profiles','capacity_windows','operational_queues','operational_queue_items','capacity_slots','order_promise_snapshots','capacity_events','large_order_policies','channel_capacity_policies','capacity_policies','capacity_overrides','capacity_throttle_events','capacity_scenarios','capacity_order_risk_snapshots','capacity_alerts'] loop execute format('create policy %I on public.%I for all to service_role using(true) with check(true)','capacity_service_'||t,t); end loop; end $$;

create or replace function public.reserve_capacity_slot(requested_slot uuid,requested_org uuid,requested_store uuid,requested_workload numeric,requested_session_hash text,requested_draft text,requested_idempotency text,requested_ttl_seconds integer default 300)
returns public.capacity_slot_holds language plpgsql security definer set search_path='' as $$
declare s public.capacity_slots; h public.capacity_slot_holds;
begin
  if requested_workload<=0 or requested_ttl_seconds<30 or requested_ttl_seconds>900 then raise exception 'invalid reservation'; end if;
  select * into h from public.capacity_slot_holds where organization_id=requested_org and idempotency_key=requested_idempotency;
  if found then return h; end if;
  update public.capacity_slot_holds set status='expired',updated_at=now() where slot_id=requested_slot and status='active' and expires_at<=now();
  select * into s from public.capacity_slots where id=requested_slot and organization_id=requested_org and store_id=requested_store for update;
  if not found or s.status in('closed','blocked') or s.ends_at<=now() then raise exception 'slot unavailable'; end if;
  update public.capacity_slots cs set capacity_reserved=(select coalesce(sum(workload_reserved),0) from public.capacity_slot_holds where slot_id=cs.id and status='active' and expires_at>now()) where cs.id=s.id returning * into s;
  if s.capacity_total-s.capacity_reserved-s.capacity_committed<requested_workload then raise exception 'slot capacity exceeded'; end if;
  insert into public.capacity_slot_holds(organization_id,store_id,slot_id,session_reference_hash,order_draft_reference,workload_reserved,expires_at,idempotency_key) values(requested_org,requested_store,requested_slot,requested_session_hash,requested_draft,requested_workload,now()+make_interval(secs=>requested_ttl_seconds),requested_idempotency) returning * into h;
  update public.capacity_slots set capacity_reserved=capacity_reserved+requested_workload,status=case when capacity_total-capacity_reserved-capacity_committed-requested_workload<=0 then 'full' else status end,version=version+1,updated_at=now() where id=requested_slot;
  return h;
end $$;
revoke all on function public.reserve_capacity_slot(uuid,uuid,uuid,numeric,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_capacity_slot(uuid,uuid,uuid,numeric,text,text,text,integer) to service_role;

create or replace function public.commit_capacity_slot_hold(requested_hold uuid,requested_order uuid,requested_org uuid)
returns public.capacity_slot_holds language plpgsql security definer set search_path='' as $$
declare h public.capacity_slot_holds;
begin
  select * into h from public.capacity_slot_holds where id=requested_hold and organization_id=requested_org for update;
  if not found then raise exception 'hold not found'; end if;
  if h.status='committed' then return h; end if;
  if h.status<>'active' or h.expires_at<=now() then raise exception 'hold expired'; end if;
  update public.capacity_slot_holds set status='committed',order_id=requested_order,updated_at=now() where id=h.id returning * into h;
  update public.capacity_slots set capacity_reserved=greatest(0,capacity_reserved-h.workload_reserved),capacity_committed=capacity_committed+h.workload_reserved,version=version+1,updated_at=now() where id=h.slot_id;
  return h;
end $$;
revoke all on function public.commit_capacity_slot_hold(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.commit_capacity_slot_hold(uuid,uuid,uuid) to service_role;

create or replace function public.release_capacity_slot_hold(requested_hold uuid,requested_org uuid)
returns public.capacity_slot_holds language plpgsql security definer set search_path='' as $$
declare h public.capacity_slot_holds;
begin
  select * into h from public.capacity_slot_holds where id=requested_hold and organization_id=requested_org for update;
  if not found then raise exception 'hold not found'; end if;
  if h.status<>'active' then return h; end if;
  update public.capacity_slot_holds set status='released',updated_at=now() where id=h.id returning * into h;
  update public.capacity_slots set capacity_reserved=greatest(0,capacity_reserved-h.workload_reserved),status=case when status in('closed','blocked') then status when capacity_total-(greatest(0,capacity_reserved-h.workload_reserved))-capacity_committed<=0 then 'full' when capacity_total-(greatest(0,capacity_reserved-h.workload_reserved))-capacity_committed<capacity_total*.2 then 'limited' else 'open' end,version=version+1,updated_at=now() where id=h.slot_id;
  return h;
end $$;
revoke all on function public.release_capacity_slot_hold(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_capacity_slot_hold(uuid,uuid) to service_role;

create or replace function public.refresh_capacity_slots(requested_org uuid,requested_store uuid,requested_horizon_hours integer default 8)
returns integer language plpgsql security definer set search_path='' as $$
declare inserted_count integer;
begin
  insert into public.capacity_slots(organization_id,store_id,resource_type,resource_id,starts_at,ends_at,capacity_total,status)
  select m.organization_id,m.store_id,m.resource_type,m.resource_id,
    date_trunc('hour',now())+(g.step*make_interval(mins=>m.time_bucket_minutes)),
    date_trunc('hour',now())+((g.step+1)*make_interval(mins=>m.time_bucket_minutes)),
    m.base_capacity,'open'
  from public.capacity_models m
  cross join lateral generate_series(0,greatest(0,ceil(requested_horizon_hours*60.0/m.time_bucket_minutes)::integer-1)) g(step)
  where m.organization_id=requested_org and m.store_id=requested_store and m.active=true and m.effective_from<=now() and (m.effective_until is null or m.effective_until>now())
  on conflict do nothing;
  get diagnostics inserted_count=row_count;
  return inserted_count;
end $$;
revoke all on function public.refresh_capacity_slots(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.refresh_capacity_slots(uuid,uuid,integer) to service_role;

create or replace function public.expire_capacity_slot_holds(requested_store uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare expired_count integer;
begin
  update public.capacity_slot_holds set status='expired',updated_at=now() where store_id=requested_store and status='active' and expires_at<=now();
  get diagnostics expired_count=row_count;
  update public.capacity_slots cs set capacity_reserved=(select coalesce(sum(h.workload_reserved),0) from public.capacity_slot_holds h where h.slot_id=cs.id and h.status='active' and h.expires_at>now()),updated_at=now() where cs.store_id=requested_store;
  update public.capacity_slots set status=case when status in('closed','blocked') then status when capacity_available<=0 then 'full' when capacity_available<capacity_total*.2 then 'limited' else 'open' end,version=version+1,updated_at=now() where store_id=requested_store;
  return expired_count;
end $$;
revoke all on function public.expire_capacity_slot_holds(uuid) from public,anon,authenticated;
grant execute on function public.expire_capacity_slot_holds(uuid) to service_role;

create or replace function public.claim_capacity_recalculation_jobs(requested_worker text,requested_limit integer default 10)
returns setof public.capacity_recalculation_jobs language plpgsql security definer set search_path='' as $$
begin
  return query update public.capacity_recalculation_jobs j set status='processing',locked_at=now(),locked_by=requested_worker,attempts=j.attempts+1 where j.id in(select id from public.capacity_recalculation_jobs where status in('pending','retrying') and available_at<=now() order by created_at limit least(greatest(requested_limit,1),50) for update skip locked) returning j.*;
end $$;
revoke all on function public.claim_capacity_recalculation_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_capacity_recalculation_jobs(text,integer) to service_role;

alter table public.store_feature_flags add column if not exists capacity_management_enabled boolean not null default false,add column if not exists capacity_slots_enabled boolean not null default false,add column if not exists dynamic_order_promises_enabled boolean not null default false,add column if not exists capacity_throttling_enabled boolean not null default false,add column if not exists capacity_simulation_enabled boolean not null default false;
alter table public.plans add column if not exists capacity_management_enabled boolean not null default false,add column if not exists capacity_slots_enabled boolean not null default false,add column if not exists dynamic_order_promises_enabled boolean not null default false,add column if not exists capacity_throttling_enabled boolean not null default false,add column if not exists capacity_simulation_enabled boolean not null default false;

insert into public.automation_event_registry(event_name,module,description,payload_schema,allowed_fields,sensitivity) values
('capacity.resource_saturated','capacity','Recurso saturado de forma persistente.','{"type":"object"}',array['store.id','resource.type','resource.id','capacity.utilization'],'normal'),
('capacity.slot_full','capacity','Slot operacional sem capacidade disponível.','{"type":"object"}',array['store.id','slot.id','slot.starts_at'],'normal'),
('capacity.order_at_risk','capacity','Pedido com risco operacional explicável.','{"type":"object"}',array['store.id','order.id','risk.level'],'normal'),
('capacity.recovered','capacity','Recurso entrou em recuperação.','{"type":"object"}',array['store.id','resource.type','resource.id'],'normal'),
('capacity.forecast_overload','capacity','Projeção indica sobrecarga futura.','{"type":"object"}',array['store.id','slot.starts_at','capacity.projected_utilization'],'normal')
on conflict(event_name,schema_version) do update set description=excluded.description,active=true;

insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,action_engine_required,registered_destination_only) values
('capacity_notify_manager','capacity','Notificar gerente sobre capacidade.','{"type":"object"}','capacity:view','low',false,false),
('capacity_create_task','capacity','Criar tarefa de capacidade.','{"type":"object"}','capacity:view','low',false,false),
('capacity_create_attention_item','capacity','Criar item de atenção operacional.','{"type":"object"}','capacity:view','low',false,false),
('capacity_create_incident_candidate','capacity','Criar candidato a incidente após saturação extrema persistente.','{"type":"object"}','capacity:manage_policies','medium',true,false),
('capacity_apply_policy_action','capacity','Aplicar ação operacional aprovada de capacidade.','{"type":"object"}','capacity:pause_channels','high',true,false)
on conflict(action_type) do update set description=excluded.description,required_permission=excluded.required_permission,risk_level=excluded.risk_level,action_engine_required=excluded.action_engine_required,active=true;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,size_options,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('current_capacity','Capacidade atual','Utilização e gargalo atual.','capacity','metric_card','["small","medium"]','{capacity:view}','{store,network}','capacity:current','realtime','{}','{}','/painel/capacidade',true,false),
('capacity_next_two_hours','Próximas 2 horas','Capacidade projetada por slot.','capacity','trend_chart','["medium","large"]','{capacity:view_future}','{store,network}','capacity:future','5m','{}','{}','/painel/capacidade',true,false),
('capacity_orders_at_risk','Pedidos em risco','Pedidos que exigem atenção.','capacity','status_list','["medium","large"]','{capacity:view}','{store}','capacity:risks','realtime','{}','{}','/painel/capacidade',true,false),
('capacity_saturated_resources','Recursos saturados','Estações e recursos saturados.','capacity','status_list','["medium","large"]','{capacity:view}','{store,network}','capacity:resources','realtime','{}','{}','/painel/capacidade',true,false),
('capacity_delivery_backlog','Backlog do delivery','Expedição e despacho de entregas.','capacity','status_list','["medium","large"]','{capacity:view}','{store}','capacity:delivery','realtime','{}','{}','/painel/capacidade',true,false)
on conflict(id) do update set description=excluded.description,required_permissions=excluded.required_permissions,data_source=excluded.data_source,route=excluded.route,active=true,updated_at=now();

insert into public.analytics_datasets(dataset_key,name,description,domain,owner_label,dataset_scope,grain,source_tables,refresh_frequency,retention_days,certified,contains_pii) values
('capacity_utilization','Capacity Utilization','Capacidade efetiva e utilizada.','capacity','Operações','customer_analytics','recurso/slot',array['capacity_models','capacity_slots'],'5 minutes',730,true,false),
('capacity_slots','Capacity Slots','Slots futuros e compromissos.','capacity','Operações','customer_analytics','loja/recurso/slot',array['capacity_slots','capacity_slot_holds'],'5 minutes',730,true,false),
('queue_health','Queue Health','Saúde das filas derivadas.','capacity','Operações','customer_analytics','fila/snapshot',array['operational_queues'],'1 minute',180,true,false),
('order_promises','Order Promises','Promessa original versus realizado.','capacity','Operações','customer_analytics','pedido',array['order_promise_snapshots','orders'],'hourly',1095,true,false),
('capacity_overrides','Capacity Overrides','Ajustes temporários auditáveis.','capacity','Operações','customer_analytics','override',array['capacity_overrides'],'hourly',1095,true,false),
('channel_throttling','Channel Throttling','Limitações de canal e recuperação.','capacity','Operações','customer_analytics','evento',array['capacity_throttle_events'],'hourly',1095,true,false)
on conflict(dataset_key) do update set description=excluded.description,source_tables=excluded.source_tables,certified=true;

notify pgrst,'reload schema';

-- Named permissions enforced by the server route:
-- capacity:view, capacity:view_future, capacity:manage_models,
-- capacity:manage_slots, capacity:manage_overrides, capacity:manage_policies,
-- capacity:pause_channels, capacity:simulate, capacity:view_network.
