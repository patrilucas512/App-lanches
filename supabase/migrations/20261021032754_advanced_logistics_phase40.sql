-- Phase 40: extend the canonical delivery domain; do not create a parallel delivery system.
alter table public.store_feature_flags add column if not exists advanced_delivery_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists smart_dispatch_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists route_optimization_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists driver_tracking_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists external_logistics_enabled boolean not null default false;

alter table public.deliveries add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.deliveries add column if not exists store_id uuid references public.establishments(id) on delete cascade;
alter table public.deliveries add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.deliveries add column if not exists delivery_address_id uuid references public.customer_addresses(id) on delete set null;
alter table public.deliveries add column if not exists priority text not null default 'normal' check(priority in('low','normal','high','urgent'));
alter table public.deliveries add column if not exists pickup_deadline timestamptz;
alter table public.deliveries add column if not exists delivery_deadline timestamptz;
alter table public.deliveries add column if not exists assigned_driver_id uuid references public.driver_profiles(id) on delete set null;
alter table public.deliveries add column if not exists estimated_cost_cents integer check(estimated_cost_cents is null or estimated_cost_cents>=0);
alter table public.deliveries add column if not exists cost_components jsonb not null default '{}';
alter table public.deliveries add column if not exists zone_id uuid references public.delivery_zones(id) on delete set null;
update public.deliveries d set organization_id=e.organization_id,store_id=d.establishment_id,customer_id=o.customer_id from public.establishments e,public.orders o where e.id=d.establishment_id and o.id=d.order_id and (d.organization_id is null or d.store_id is null or d.customer_id is null);

alter table public.driver_profiles add column if not exists authorized_store_ids uuid[] not null default '{}';
alter table public.driver_profiles add column if not exists location_retention_days integer not null default 30 check(location_retention_days between 1 and 90);
alter table public.driver_availability drop constraint if exists driver_availability_status_check;
alter table public.driver_availability add constraint driver_availability_status_check check(status in('offline','available','assigned','picking_up','delivering','paused','unavailable'));
alter table public.driver_locations add column if not exists gps_quality text check(gps_quality is null or gps_quality in('high','medium','low','unknown'));
alter table public.driver_locations add column if not exists suspected_mock boolean not null default false;

alter table public.delivery_zones add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.delivery_zones add column if not exists zone_type text not null default 'neighborhood' check(zone_type in('radius','polygon','neighborhood','postal_code_range'));
alter table public.delivery_zones add column if not exists rules jsonb not null default '{}';
alter table public.delivery_zones add column if not exists priority integer not null default 0;
alter table public.delivery_zones add column if not exists base_fee_cents integer check(base_fee_cents is null or base_fee_cents>=0);
alter table public.delivery_zones add column if not exists fee_per_km_cents integer check(fee_per_km_cents is null or fee_per_km_cents>=0);
alter table public.delivery_zones add column if not exists sla_minutes integer check(sla_minutes is null or sla_minutes>0);
alter table public.delivery_zones add column if not exists max_delivery_time_after_pickup integer check(max_delivery_time_after_pickup is null or max_delivery_time_after_pickup>0);
update public.delivery_zones z set organization_id=e.organization_id from public.establishments e where e.id=z.establishment_id and z.organization_id is null;

alter table public.delivery_settings add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.delivery_settings add column if not exists store_id uuid references public.establishments(id) on delete cascade;
alter table public.delivery_settings add column if not exists dispatch_mode text not null default 'manual' check(dispatch_mode in('manual','assisted','automatic'));
alter table public.delivery_settings add column if not exists auto_dispatch_enabled boolean not null default false;
alter table public.delivery_settings add column if not exists smart_batching_enabled boolean not null default false;
alter table public.delivery_settings add column if not exists max_detour_minutes integer not null default 10 check(max_detour_minutes between 0 and 120);
alter table public.delivery_settings add column if not exists location_update_seconds integer not null default 30 check(location_update_seconds between 15 and 600);
alter table public.delivery_settings add column if not exists eta_change_notification_minutes integer not null default 10 check(eta_change_notification_minutes between 5 and 120);
alter table public.delivery_settings add column if not exists fleet_strategy text not null default 'own' check(fleet_strategy in('own','external','hybrid'));
alter table public.delivery_settings add column if not exists external_auto_hire_enabled boolean not null default false;
alter table public.delivery_settings add column if not exists updated_by uuid references auth.users(id);
update public.delivery_settings s set organization_id=e.organization_id,store_id=s.establishment_id from public.establishments e where e.id=s.establishment_id and (s.organization_id is null or s.store_id is null);
create unique index if not exists delivery_settings_store_phase40_idx on public.delivery_settings(store_id);
create table public.driver_capacity(
 driver_profile_id uuid primary key references public.driver_profiles(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
 max_orders integer not null default 1 check(max_orders between 1 and 20),max_weight_kg numeric(10,2),max_volume_liters numeric(10,2),authorized_zone_ids uuid[] not null default '{}',updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
create table public.delivery_routes(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,driver_id uuid not null references public.driver_profiles(id) on delete restrict,
 status text not null default 'draft' check(status in('draft','planned','active','completed','cancelled')),estimated_distance_meters integer check(estimated_distance_meters is null or estimated_distance_meters>=0),actual_distance_meters integer check(actual_distance_meters is null or actual_distance_meters>=0),estimated_duration_minutes integer,actual_duration_minutes integer,
 provider text not null default 'fallback',optimization_factors jsonb not null default '{}',started_at timestamptz,completed_at timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.deliveries add column if not exists route_id uuid references public.delivery_routes(id) on delete set null;
create table public.delivery_route_stops(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,route_id uuid not null references public.delivery_routes(id) on delete cascade,delivery_job_id uuid not null references public.deliveries(id) on delete cascade,sequence integer not null check(sequence>0),stop_type text not null check(stop_type in('pickup','delivery','return')),address jsonb not null,
 estimated_arrival timestamptz,actual_arrival timestamptz,status text not null default 'pending' check(status in('pending','arrived','completed','skipped')),latitude numeric,longitude numeric,geocode_quality text,geocode_provider text,unique(route_id,sequence),unique(route_id,delivery_job_id,stop_type)
);
alter table public.delivery_incidents add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.delivery_incidents add column if not exists store_id uuid references public.establishments(id) on delete cascade;
alter table public.delivery_incidents add column if not exists severity text not null default 'medium' check(severity in('low','medium','high','emergency'));
update public.delivery_incidents i set organization_id=e.organization_id,store_id=i.establishment_id from public.establishments e where e.id=i.establishment_id and (i.organization_id is null or i.store_id is null);
alter table public.delivery_incidents drop constraint if exists delivery_incidents_incident_type_check;
alter table public.delivery_incidents add constraint delivery_incidents_incident_type_check check(incident_type in('customer_absent','payment','vehicle','return','customer_not_found','wrong_address','customer_unavailable','vehicle_problem','accident','order_damage','payment_issue','route_blocked','other'));
alter table public.delivery_incidents drop constraint if exists delivery_incidents_status_check;
alter table public.delivery_incidents add constraint delivery_incidents_status_check check(status in('open','supervisor_review','retry','return','resolved','cancelled','canceled'));
create table public.delivery_tracking_tokens(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,delivery_id uuid not null references public.deliveries(id) on delete cascade,token_hash text not null unique,expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default now()
);
create unique index delivery_tracking_one_active_idx on public.delivery_tracking_tokens(delivery_id) where revoked_at is null;
create table public.logistics_provider_quotes(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,delivery_id uuid not null references public.deliveries(id) on delete cascade,provider_key text not null,price_cents integer not null check(price_cents>=0),eta_min_minutes integer,eta_max_minutes integer,expires_at timestamptz,status text not null default 'quoted' check(status in('quoted','selected','expired','rejected')),created_at timestamptz not null default now()
);
create table public.external_logistics_deliveries(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,delivery_id uuid not null references public.deliveries(id) on delete cascade,quote_id uuid references public.logistics_provider_quotes(id),provider_key text not null,external_id text,status text not null default 'draft',tracking_url text,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(provider_key,external_id)
);
create table public.delivery_cash_custody(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,delivery_id uuid not null references public.deliveries(id) on delete cascade,driver_id uuid not null references public.driver_profiles(id) on delete restrict,amount_cents integer not null check(amount_cents>=0),status text not null default 'with_driver' check(status in('with_driver','handed_over','reconciled','disputed')),handed_over_at timestamptz,reconciled_at timestamptz,created_at timestamptz not null default now(),unique(delivery_id)
);
create table public.delivery_operational_alerts_v2(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,alert_key text not null,severity text not null check(severity in('info','warning','high','critical')),message text not null,evidence jsonb not null default '{}',status text not null default 'open' check(status in('open','acknowledged','resolved')),first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),occurrences integer not null default 1,unique(organization_id,store_id,alert_key,status)
);
create table public.delivery_audit_events_v2(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,delivery_id uuid references public.deliveries(id),route_id uuid references public.delivery_routes(id),driver_id uuid references public.driver_profiles(id),actor_user_id uuid references auth.users(id),event_type text not null,reason text,before_state jsonb,after_state jsonb,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);

alter table public.delivery_assignments add column if not exists assignment_mode text not null default 'manual' check(assignment_mode in('manual','assisted','automatic'));
alter table public.delivery_assignments add column if not exists idempotency_key text;
alter table public.delivery_assignments add column if not exists assigned_by uuid references auth.users(id);
create unique index if not exists delivery_assignment_idempotency_idx on public.delivery_assignments(establishment_id,idempotency_key) where idempotency_key is not null;

create table public.analytics_dim_delivery_zone(zone_id uuid primary key,organization_id uuid not null,store_id uuid not null,name text not null,zone_type text not null,active boolean not null,source_updated_at timestamptz not null,loaded_at timestamptz not null default now());
create table public.analytics_dim_driver(driver_id uuid primary key,organization_id uuid not null,store_id uuid not null,vehicle_type text not null,driver_kind text not null,active boolean not null,source_updated_at timestamptz not null,loaded_at timestamptz not null default now());
create table public.analytics_dim_vehicle(vehicle_key text primary key,name text not null);
insert into public.analytics_dim_vehicle values('motorcycle','Motocicleta'),('bicycle','Bicicleta'),('car','Carro'),('other','Outro') on conflict do nothing;
create table public.analytics_fact_deliveries(delivery_id uuid primary key,organization_id uuid not null,store_id uuid not null,driver_id uuid,zone_id uuid,status text not null,ready_at timestamptz,picked_up_at timestamptz,delivered_at timestamptz,estimated_minutes integer,actual_minutes integer,distance_meters integer,estimated_cost_cents integer,fee_cents integer,loaded_at timestamptz not null default now());
create table public.analytics_fact_delivery_routes(route_id uuid primary key,organization_id uuid not null,store_id uuid not null,driver_id uuid not null,status text not null,deliveries_count integer not null,estimated_distance_meters integer,actual_distance_meters integer,estimated_duration_minutes integer,actual_duration_minutes integer,loaded_at timestamptz not null default now());
create table public.analytics_fact_delivery_stops(stop_id uuid primary key,route_id uuid not null,delivery_id uuid not null,organization_id uuid not null,store_id uuid not null,sequence integer not null,stop_type text not null,estimated_arrival timestamptz,actual_arrival timestamptz,status text not null,loaded_at timestamptz not null default now());
create table public.analytics_fact_delivery_incidents(incident_id uuid primary key,organization_id uuid not null,store_id uuid not null,delivery_id uuid not null,driver_id uuid,incident_type text not null,severity text not null,status text not null,created_at timestamptz not null,resolved_at timestamptz,loaded_at timestamptz not null default now());
create table public.analytics_fact_driver_activity(activity_id uuid primary key default gen_random_uuid(),organization_id uuid not null,store_id uuid not null,driver_id uuid not null,status text not null,started_at timestamptz not null,ended_at timestamptz,duration_minutes integer,loaded_at timestamptz not null default now());

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('delivery_time','Delivery Time','Tempo entre coleta e entrega.','delivered_at - picked_up_at','analytics_fact_deliveries','delivery','Logística','hourly','minutes','calculation',true,array['date','store','driver','zone']),
('dispatch_wait_time','Dispatch Wait Time','Tempo entre pedido pronto e coleta.','picked_up_at - ready_at','analytics_fact_deliveries','delivery','Logística','hourly','minutes','calculation',true,array['date','store','zone']),
('delivery_on_time_rate','On-Time Rate','Percentual entregue no SLA.','on_time / delivered','analytics_fact_deliveries','store_day','Logística','daily','percent','calculation',false,array['date','store','zone']),
('cost_per_delivery','Cost per Delivery','Custo gerencial estimado médio.','sum(estimated_cost_cents) / deliveries','analytics_fact_deliveries','store_day','Logística','daily','BRL','estimate',true,array['date','store','zone']),
('deliveries_per_route','Deliveries per Route','Entregas médias por rota.','deliveries / routes','analytics_fact_delivery_routes','route','Logística','daily','count','calculation',false,array['date','store','driver']),
('delivery_incident_rate','Delivery Incident Rate','Ocorrências por entrega.','incidents / deliveries','analytics_fact_delivery_incidents','store_day','Logística','daily','percent','calculation',true,array['date','store','zone']),
('delivery_eta_accuracy','ETA Accuracy','Diferença entre ETA e tempo real.','abs(actual_minutes-estimated_minutes)','analytics_fact_deliveries','delivery','Logística','daily','minutes','calculation',false,array['date','store','zone']) on conflict(metric_key) do nothing;

do $$ declare t text; begin foreach t in array array['delivery_settings','driver_capacity','delivery_routes','delivery_route_stops','delivery_incidents','delivery_tracking_tokens','logistics_provider_quotes','external_logistics_deliveries','delivery_cash_custody','delivery_operational_alerts_v2','delivery_audit_events_v2'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on table public.%I from anon,authenticated',t); execute format('grant select,insert,update,delete on table public.%I to authenticated',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['analytics_dim_delivery_zone','analytics_dim_driver','analytics_dim_vehicle','analytics_fact_deliveries','analytics_fact_delivery_routes','analytics_fact_delivery_stops','analytics_fact_delivery_incidents','analytics_fact_driver_activity'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on table public.%I from anon,authenticated',t); execute format('grant select on table public.%I to authenticated',t); end loop; end $$;

do $$ declare t text; begin foreach t in array array['delivery_settings','driver_capacity','delivery_routes','delivery_route_stops','delivery_incidents','logistics_provider_quotes','external_logistics_deliveries','delivery_cash_custody','delivery_operational_alerts_v2','delivery_audit_events_v2'] loop execute format('create policy %I on public.%I for all to authenticated using (private.has_role(store_id,array[''owner'',''manager'']::public.member_role[])) with check (private.has_role(store_id,array[''owner'',''manager'']::public.member_role[]))',t||'_manager',t); end loop; end $$;
create policy delivery_tracking_tokens_manager on public.delivery_tracking_tokens for all to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[])) with check(private.has_role(store_id,array['owner','manager']::public.member_role[]));
do $$ declare t text; begin foreach t in array array['analytics_dim_delivery_zone','analytics_dim_driver','analytics_fact_deliveries','analytics_fact_delivery_routes','analytics_fact_delivery_stops','analytics_fact_delivery_incidents','analytics_fact_driver_activity'] loop execute format('create policy %I on public.%I for select to authenticated using (exists(select 1 from public.organization_members om where om.organization_id=%I.organization_id and om.user_id=(select auth.uid()) and om.active=true))',t||'_read',t,t); end loop; end $$;
create policy analytics_dim_vehicle_read on public.analytics_dim_vehicle for select to authenticated using(true);

create index if not exists delivery_routes_store_status_idx on public.delivery_routes(store_id,status,created_at desc);
create index if not exists delivery_route_stops_route_sequence_idx on public.delivery_route_stops(route_id,sequence);
create index if not exists delivery_incidents_store_status_idx on public.delivery_incidents(store_id,status,created_at desc);
create index if not exists deliveries_phase40_dispatch_idx on public.deliveries(store_id,status,priority,ready_at) include(assigned_driver_id,route_id,estimated_arrival_at);
create index if not exists driver_locations_retention_idx on public.driver_locations(driver_profile_id,captured_at desc);

create or replace function public.assign_delivery_v2(requested_delivery_id uuid,requested_driver_id uuid,requested_mode text,requested_idempotency_key text,requested_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.deliveries;drv public.driver_profiles;cap public.driver_capacity;avail public.driver_availability;assignment public.delivery_assignments;actor uuid:=auth.uid();org uuid;
begin
 if actor is null then raise exception 'Autenticação necessária.'; end if;
 select * into d from public.deliveries where id=requested_delivery_id for update;
 if not found or not private.has_role(d.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Entrega não encontrada.'; end if;
 if d.status not in('ready_for_dispatch','searching_driver','driver_assigned') then raise exception 'Entrega não está disponível para despacho.'; end if;
 select * into drv from public.driver_profiles where id=requested_driver_id and establishment_id=d.establishment_id and active=true and approval_status='approved';
 if not found then raise exception 'Motoboy inelegível para esta unidade.'; end if;
 select * into avail from public.driver_availability where driver_profile_id=drv.id for update;
 if avail.status<>'available' and d.assigned_driver_id is distinct from drv.id then raise exception 'Motoboy não está disponível.'; end if;
 select * into cap from public.driver_capacity where driver_profile_id=drv.id;
 if avail.active_delivery_count>=coalesce(cap.max_orders,1) and d.assigned_driver_id is distinct from drv.id then raise exception 'Capacidade do motoboy atingida.'; end if;
 select * into assignment from public.delivery_assignments where establishment_id=d.establishment_id and idempotency_key=requested_idempotency_key;
 if found then return jsonb_build_object('assignment',to_jsonb(assignment),'idempotent',true); end if;
 update public.delivery_assignments set status='canceled',responded_at=now(),canceled_reason=coalesce(requested_reason,'reatribuição') where delivery_id=d.id and status in('offered','accepted');
 insert into public.delivery_assignments(establishment_id,delivery_id,driver_profile_id,status,offer_rank,dispatch_score,score_breakdown,offered_at,expires_at,responded_at,accepted_at,assignment_mode,idempotency_key,assigned_by)
 values(d.establishment_id,d.id,drv.id,'accepted',1,100,jsonb_build_object('controlled_assignment',true,'mode',requested_mode),now(),now()+interval '30 minutes',now(),now(),requested_mode,requested_idempotency_key,actor) returning * into assignment;
 update public.deliveries set status='driver_assigned',assigned_driver_id=drv.id,dispatch_started_at=coalesce(dispatch_started_at,now()),updated_at=now() where id=d.id;
 update public.driver_availability set status='assigned',active_delivery_count=active_delivery_count+1,updated_at=now() where driver_profile_id=drv.id;
 select organization_id into org from public.establishments where id=d.establishment_id;
 insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata) values(d.establishment_id,d.id,case when d.assigned_driver_id is null then 'delivery_assigned_v2' else 'delivery_reassigned_v2' end,d.status,'driver_assigned','user',actor,drv.id,jsonb_build_object('mode',requested_mode,'reason',requested_reason));
 insert into public.delivery_audit_events_v2(organization_id,store_id,delivery_id,driver_id,actor_user_id,event_type,reason,before_state,after_state) values(org,d.establishment_id,d.id,drv.id,actor,case when d.assigned_driver_id is null then 'assignment' else 'reassignment' end,requested_reason,to_jsonb(d),jsonb_build_object('assigned_driver_id',drv.id,'mode',requested_mode));
 return jsonb_build_object('assignment',to_jsonb(assignment),'idempotent',false);
end $$;
revoke all on function public.assign_delivery_v2(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.assign_delivery_v2(uuid,uuid,text,text,text) to authenticated;

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_routes') then alter publication supabase_realtime add table public.delivery_routes; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_route_stops') then alter publication supabase_realtime add table public.delivery_route_stops; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_incidents') then alter publication supabase_realtime add table public.delivery_incidents; end if;
end $$;
