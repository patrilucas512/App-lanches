create schema if not exists tms_private;
revoke all on schema tms_private from public, anon;
grant usage on schema tms_private to service_role;

alter table public.plans add column if not exists transport_management_enabled boolean not null default true;
alter table public.plans add column if not exists transport_route_planning_enabled boolean not null default true;
alter table public.plans add column if not exists transport_tracking_enabled boolean not null default false;
alter table public.plans add column if not exists transport_pod_enabled boolean not null default true;
alter table public.plans add column if not exists transport_cost_management_enabled boolean not null default true;
alter table public.plans add column if not exists transport_load_consolidation_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists transport_management_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists transport_route_planning_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists transport_tracking_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists transport_pod_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists transport_cost_management_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists transport_load_consolidation_enabled boolean not null default true;

create table public.transport_member_permissions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, permissions text[] not null default '{}', store_ids uuid[] not null default '{}', active boolean not null default true,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,user_id),
 check(permissions <@ array['transport:view','transport:plan','transport:manage_loads','transport:assign_carrier','transport:assign_vehicle','transport:dispatch','transport:manage_trips','transport:report_occurrence','transport:manage_occurrences','transport:record_pod','transport:view_cost','transport:manage_cost','transport:view_network','transport:manage_settings','transport_driver:view_assigned_trip','transport_driver:update_trip','transport_driver:record_pod','transport_driver:report_occurrence']::text[])
);
create table public.transport_settings(
 organization_id uuid primary key references public.organizations(id) on delete cascade, dispatch_requires_complete_load boolean not null default true,
 capacity_policy text not null default 'block' check(capacity_policy in('block','warning')), document_policy text not null default 'warning' check(document_policy in('block','warning')),
 pod_requirements jsonb not null default '{"recipient_confirmation":true}', tracking_retention_days integer not null default 30 check(tracking_retention_days between 1 and 365),
 degraded_mode_enabled boolean not null default true, driver_location_opt_in_required boolean not null default true, updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
create table public.transport_carriers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, supplier_id uuid references public.suppliers(id) on delete set null,
 name text not null, carrier_type text not null check(carrier_type in('third_party','own_fleet','partner','supplier_managed')), status text not null default 'active' check(status in('active','inactive','suspended')),
 contract_id uuid references public.contracts(id) on delete set null, service_regions jsonb not null default '[]', contact_refs jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name)
);
create table public.transport_vehicle_profiles(
 asset_id uuid primary key references public.assets(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
 vehicle_type text not null check(vehicle_type in('van','truck','refrigerated_truck','motorcycle_internal','car','custom')), capacity_weight numeric check(capacity_weight is null or capacity_weight>=0),
 capacity_volume numeric check(capacity_volume is null or capacity_volume>=0), pallet_capacity integer check(pallet_capacity is null or pallet_capacity>=0), temperature_capabilities text[] not null default '{}',
 active_for_transport boolean not null default true, home_node_id uuid references public.geo_locations(id) on delete set null, document_policy_status text not null default 'unknown' check(document_policy_status in('valid','warning','blocked','unknown')), updated_at timestamptz not null default now()
);
create table public.transport_driver_profiles(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 driver_type text not null check(driver_type in('employee','existing_driver','third_party_contact')), user_id uuid references auth.users(id) on delete set null,
 delivery_driver_profile_id uuid references public.driver_profiles(id) on delete set null, contact_ref text, carrier_id uuid references public.transport_carriers(id) on delete set null,
 active boolean not null default true, allowed_vehicle_types text[] not null default '{}', document_status text not null default 'not_required' check(document_status in('not_required','valid','warning','blocked','unknown')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(user_id is not null or delivery_driver_profile_id is not null or contact_ref is not null)
);
create table public.transport_lanes(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 origin_node_id uuid not null references public.geo_locations(id), destination_node_id uuid not null references public.geo_locations(id), preferred_carrier_id uuid references public.transport_carriers(id) on delete set null,
 alternate_carrier_ids uuid[] not null default '{}', standard_lead_time_minutes integer check(standard_lead_time_minutes is null or standard_lead_time_minutes>=0), service_days integer[] not null default '{}', active boolean not null default true,
 created_at timestamptz not null default now(), unique(organization_id,origin_node_id,destination_node_id)
);
create table public.transport_orders(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 source_type text not null check(source_type in('internal_transfer','warehouse_shipment','supplier_pickup','production_distribution','return','custom')), source_id uuid not null,
 warehouse_shipment_id uuid references public.warehouse_shipments(id) on delete restrict, inventory_transfer_id uuid references public.inventory_transfers(id) on delete restrict,
 origin_node_id uuid not null references public.geo_locations(id), destination_node_id uuid not null references public.geo_locations(id),
 transport_type text not null check(transport_type in('own_fleet','third_party','supplier_managed','internal_courier','other')), required_pickup_at timestamptz, required_delivery_at timestamptz,
 status text not null default 'draft' check(status in('draft','planned','assigned','ready_for_pickup','picked_up','in_transit','delivered','partially_delivered','failed','cancelled','returned')),
 priority integer not null default 50 check(priority between 0 and 100), carrier_id uuid references public.transport_carriers(id) on delete set null, vehicle_asset_id uuid references public.assets(id) on delete set null,
 responsible_user_id uuid references auth.users(id), content_reference jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,source_type,source_id), check(origin_node_id<>destination_node_id)
);
create table public.transport_loads(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, load_number text not null,
 origin_node_id uuid not null references public.geo_locations(id), status text not null default 'draft' check(status in('draft','building','ready','dispatched','in_transit','completed','cancelled')),
 carrier_id uuid references public.transport_carriers(id) on delete set null, vehicle_asset_id uuid references public.assets(id) on delete set null, planned_departure_at timestamptz, actual_departure_at timestamptz,
 total_weight numeric check(total_weight is null or total_weight>=0), total_volume numeric check(total_volume is null or total_volume>=0), package_count integer check(package_count is null or package_count>=0),
 partial_load boolean not null default false, manager_reviewed_by uuid references auth.users(id), manager_reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,load_number)
);
create table public.transport_load_items(
 id uuid primary key default gen_random_uuid(), load_id uuid not null references public.transport_loads(id) on delete cascade, transport_order_id uuid not null references public.transport_orders(id) on delete restrict,
 warehouse_shipment_id uuid references public.warehouse_shipments(id) on delete restrict, handling_unit_id uuid references public.warehouse_handling_units(id) on delete restrict, lot_id uuid references public.inventory_lots(id) on delete restrict,
 package_reference text, planned_quantity numeric check(planned_quantity is null or planned_quantity>=0), verified_quantity numeric check(verified_quantity is null or verified_quantity>=0), verification_status text not null default 'pending' check(verification_status in('pending','verified','missing','partial','blocked')),
 created_at timestamptz not null default now(), unique(load_id,transport_order_id,warehouse_shipment_id,handling_unit_id,package_reference)
);
create table public.transport_routes(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, origin_node_id uuid not null references public.geo_locations(id),
 destination_summary text not null, provider_config_id uuid references public.geo_provider_configs(id) on delete set null, provider_route_ref text,
 planned_distance numeric check(planned_distance is null or planned_distance>=0), planned_duration integer check(planned_duration is null or planned_duration>=0),
 eta_min timestamptz, eta_max timestamptz, status text not null default 'suggested' check(status in('suggested','reviewed','approved','superseded','cancelled')), route_version integer not null default 1,
 assumptions jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.transport_trips(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, trip_number text not null,
 load_id uuid not null references public.transport_loads(id) on delete restrict, vehicle_asset_id uuid references public.assets(id) on delete set null, carrier_id uuid references public.transport_carriers(id) on delete set null,
 driver_profile_id uuid references public.transport_driver_profiles(id) on delete set null, status text not null default 'planned' check(status in('planned','assigned','loading','ready','departed','in_progress','completed','failed','cancelled')),
 planned_start_at timestamptz not null, actual_start_at timestamptz, planned_end_at timestamptz, actual_end_at timestamptz, route_id uuid references public.transport_routes(id) on delete set null,
 tracking_mode text not null default 'manual' check(tracking_mode in('manual','provider','opt_in_driver')), risk_level text not null default 'low' check(risk_level in('low','medium','high','critical')),
 idempotency_key uuid not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,trip_number)
);
create table public.transport_stops(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, trip_id uuid not null references public.transport_trips(id) on delete cascade,
 sequence integer not null check(sequence>0), stop_type text not null check(stop_type in('pickup','delivery','crossdock','warehouse','return','custom')), node_id uuid references public.geo_locations(id), address_ref jsonb,
 transport_order_id uuid references public.transport_orders(id) on delete restrict, planned_arrival_at timestamptz, actual_arrival_at timestamptz, planned_departure_at timestamptz, actual_departure_at timestamptz,
 status text not null default 'pending' check(status in('pending','approaching','arrived','unloading','completed','skipped','failed')), completion_tentative boolean not null default false,
 created_at timestamptz not null default now(), unique(trip_id,sequence), check(node_id is not null or address_ref is not null)
);
create table public.transport_proof_of_delivery(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, transport_order_id uuid not null references public.transport_orders(id) on delete restrict,
 stop_id uuid not null references public.transport_stops(id) on delete restrict, delivery_status text not null check(delivery_status in('delivered','partially_delivered','failed','returned')),
 recipient_name text, recipient_role text, delivered_at timestamptz not null, evidence_type text not null check(evidence_type in('signature','photo','pin','scan','manual_confirmation','document')),
 evidence_file_id uuid, pin_hash text, notes text, package_summary jsonb not null default '{}', captured_at_device timestamptz, received_at_server timestamptz not null default now(), created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 unique(stop_id,transport_order_id), check(evidence_type<>'pin' or pin_hash is not null)
);
create table public.transport_occurrences(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, trip_id uuid not null references public.transport_trips(id) on delete cascade,
 stop_id uuid references public.transport_stops(id) on delete set null, occurrence_type text not null check(occurrence_type in('delay','vehicle_issue','accident_operational','road_block','cargo_damage','temperature_issue','lost_package','failed_delivery','route_change','security_issue','other')),
 severity text not null check(severity in('info','warning','high','critical')), status text not null default 'open' check(status in('open','acknowledged','resolved','dismissed')),
 description text not null, reported_at timestamptz not null, reported_by uuid references auth.users(id), evidence_ref uuid, related_incident_id uuid references public.operational_incidents(id) on delete set null,
 resolution text, resolved_at timestamptz, created_at timestamptz not null default now()
);
create table public.transport_cost_records(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, trip_id uuid not null references public.transport_trips(id) on delete cascade,
 cost_type text not null check(cost_type in('freight','fuel','toll','carrier_fee','handling','surcharge','waiting','return','other')), amount numeric(18,2) not null check(amount>=0), currency char(3) not null default 'BRL',
 source text not null check(source in('contract','carrier_invoice','manual_estimate','actual_finance_transaction')), quality text not null check(quality in('estimated','actual','reconciled')),
 status text not null default 'open' check(status in('open','approved','reconciled','disputed','cancelled')), document_ref uuid, finance_transaction_ref uuid, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.transport_cost_allocations(
 id uuid primary key default gen_random_uuid(), cost_record_id uuid not null references public.transport_cost_records(id) on delete cascade, allocation_type text not null check(allocation_type in('shipment','store','weight','volume','package','equal_split','custom')),
 target_type text not null, target_id uuid not null, amount numeric(18,2) not null check(amount>=0), calculation jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.carrier_rate_cards(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, carrier_id uuid not null references public.transport_carriers(id) on delete cascade,
 origin_scope jsonb not null default '{}', destination_scope jsonb not null default '{}', weight_from numeric, weight_to numeric, volume_from numeric, volume_to numeric,
 fixed_price numeric(18,2), per_km numeric(18,4), minimum_fee numeric(18,2), currency char(3) not null default 'BRL', valid_from date not null, valid_to date, active boolean not null default true,
 check(coalesce(fixed_price,0)>=0 and coalesce(per_km,0)>=0 and coalesce(minimum_fee,0)>=0)
);
create table public.transport_trip_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade, trip_id uuid not null references public.transport_trips(id) on delete cascade,
 stop_id uuid references public.transport_stops(id) on delete set null, event_type text not null check(event_type in('assigned','loading','dispatched','departed','arrived','occurrence','delivered','failed','returned','cost_recorded','pod_recorded')),
 actor_user_id uuid references auth.users(id), source text not null default 'manual', payload jsonb not null default '{}', occurred_at timestamptz not null default now()
);
create table public.transport_tracking_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade, trip_id uuid not null references public.transport_trips(id) on delete cascade,
 provider_config_id uuid references public.geo_provider_configs(id) on delete set null, source text not null check(source in('provider','opt_in_driver','manual')), latitude numeric, longitude numeric,
 status text, captured_at timestamptz not null, received_at timestamptz not null default now(), retention_until timestamptz not null, check(source='manual' or (latitude is not null and longitude is not null))
);
create table public.transport_driver_access_tokens(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, trip_id uuid not null references public.transport_trips(id) on delete cascade,
 driver_profile_id uuid references public.transport_driver_profiles(id) on delete cascade, token_hash text not null unique, scopes text[] not null default '{}', expires_at timestamptz not null, revoked_at timestamptz,
 created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.transport_offline_commands(
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade, trip_id uuid not null references public.transport_trips(id) on delete cascade,
 driver_profile_id uuid references public.transport_driver_profiles(id) on delete set null, command_type text not null, payload jsonb not null, status text not null default 'queued' check(status in('queued','processing','applied','rejected','conflict')),
 captured_at_device timestamptz not null, received_at_server timestamptz not null default now(), conflict_reason text, server_result jsonb, processed_at timestamptz
);
create table public.transport_audit_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade, actor_user_id uuid references auth.users(id), action text not null,
 entity_type text not null, entity_id uuid, reason text, before_state jsonb, after_state jsonb, correlation_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now()
);

-- quality: allow-nonconcurrent-index reason=new-empty-transport-tables
create index transport_orders_status_idx on public.transport_orders(organization_id,status,required_delivery_at,priority desc);
create index transport_loads_status_idx on public.transport_loads(organization_id,status,planned_departure_at);
create index transport_trips_status_idx on public.transport_trips(organization_id,status,planned_start_at);
create index transport_trips_carrier_idx on public.transport_trips(organization_id,carrier_id,planned_start_at desc);
create index transport_trips_vehicle_idx on public.transport_trips(organization_id,vehicle_asset_id,planned_start_at desc);
create index transport_stops_trip_idx on public.transport_stops(trip_id,sequence,status);
create index transport_occurrences_open_idx on public.transport_occurrences(organization_id,severity,status,reported_at desc) where status in('open','acknowledged');
create index transport_costs_trip_idx on public.transport_cost_records(organization_id,trip_id,status);
create index transport_tracking_retention_idx on public.transport_tracking_events(retention_until);
create index transport_offline_queue_idx on public.transport_offline_commands(status,received_at_server) where status in('queued','processing','conflict');

create or replace function tms_private.org_allowed(org uuid, permission_name text default 'transport:view') returns boolean language sql stable security definer set search_path='' as $$
 select private.is_superadmin()
 or exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=(select auth.uid()) and m.active and m.role::text in('owner','admin','manager','supervisor'))
 or exists(select 1 from public.establishment_members m join public.establishments e on e.id=m.establishment_id where e.organization_id=org and m.user_id=(select auth.uid()) and m.status='active' and m.role::text in('owner','manager'))
 or exists(select 1 from public.transport_member_permissions p where p.organization_id=org and p.user_id=(select auth.uid()) and p.active and permission_name=any(p.permissions))
$$;
revoke all on function tms_private.org_allowed(uuid,text) from public,anon;
grant execute on function tms_private.org_allowed(uuid,text) to authenticated,service_role;

do $$declare t text;begin foreach t in array array[
 'transport_member_permissions','transport_settings','transport_carriers','transport_vehicle_profiles','transport_driver_profiles','transport_lanes','transport_orders','transport_loads','transport_load_items','transport_routes','transport_trips','transport_stops','transport_proof_of_delivery','transport_occurrences','transport_cost_records','transport_cost_allocations','carrier_rate_cards','transport_trip_events','transport_tracking_events','transport_driver_access_tokens','transport_offline_commands','transport_audit_events'
] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t); end loop;end$$;

create policy transport_orders_read on public.transport_orders for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_loads_read on public.transport_loads for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_trips_read on public.transport_trips for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_stops_read on public.transport_stops for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_carriers_read on public.transport_carriers for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_vehicle_profiles_read on public.transport_vehicle_profiles for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_occurrences_read on public.transport_occurrences for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_pod_read on public.transport_proof_of_delivery for select to authenticated using(tms_private.org_allowed(organization_id));
create policy transport_costs_read on public.transport_cost_records for select to authenticated using(tms_private.org_allowed(organization_id,'transport:view_cost'));
grant select on public.transport_orders,public.transport_loads,public.transport_trips,public.transport_stops,public.transport_carriers,public.transport_vehicle_profiles,public.transport_occurrences,public.transport_proof_of_delivery,public.transport_cost_records to authenticated;

create or replace function public.transport_dispatch_trip(requested_trip_id uuid, requested_command_id uuid, requested_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.transport_trips; l public.transport_loads; actor uuid:=(select auth.uid()); item record;
begin
 if actor is null then raise exception 'authentication required'; end if;
 select * into t from public.transport_trips where id=requested_trip_id for update;
 if t.id is null or not tms_private.org_allowed(t.organization_id,'transport:dispatch') then raise exception 'forbidden'; end if;
 if exists(select 1 from public.transport_trip_events e where e.trip_id=t.id and e.payload->>'command_id'=requested_command_id::text) then return t.id; end if;
 select * into l from public.transport_loads where id=t.load_id for update;
 if t.status not in('assigned','loading','ready') or l.status not in('ready','building') then raise exception 'trip or load not ready'; end if;
 if l.manager_reviewed_at is null then raise exception 'manager review required'; end if;
 if exists(select 1 from public.transport_load_items li join public.inventory_lots il on il.id=li.lot_id where li.load_id=l.id and il.status in('blocked','quarantined','recalled','expired','discarded')) then raise exception 'blocked or quarantined lot'; end if;
 if exists(select 1 from public.transport_load_items li where li.load_id=l.id and li.verification_status in('pending','missing','blocked')) then raise exception 'load verification incomplete'; end if;
 if t.vehicle_asset_id is not null and exists(select 1 from public.assets a where a.id=t.vehicle_asset_id and (not a.active or a.status in('maintenance','retired','disposed','out_of_service'))) then raise exception 'vehicle unavailable'; end if;
 for item in select distinct ws.inventory_transfer_id from public.transport_load_items li join public.warehouse_shipments ws on ws.id=li.warehouse_shipment_id where li.load_id=l.id and ws.inventory_transfer_id is not null loop
  perform public.dispatch_internal_transfer(item.inventory_transfer_id,requested_command_id::text||':'||item.inventory_transfer_id::text);
 end loop;
 update public.warehouse_shipments ws set status='handed_off',handed_off_by=actor,handed_off_at=now() where ws.id in(select li.warehouse_shipment_id from public.transport_load_items li where li.load_id=l.id) and ws.status in('staged','ready');
 update public.transport_loads set status='in_transit',actual_departure_at=coalesce(actual_departure_at,now()),updated_at=now() where id=l.id;
 update public.transport_trips set status='in_progress',actual_start_at=coalesce(actual_start_at,now()),updated_at=now() where id=t.id;
 update public.transport_orders set status='in_transit',updated_at=now() where id in(select transport_order_id from public.transport_load_items where load_id=l.id);
 insert into public.transport_trip_events(organization_id,trip_id,event_type,actor_user_id,source,payload) values(t.organization_id,t.id,'dispatched',actor,'transaction',jsonb_build_object('command_id',requested_command_id,'reason',left(requested_reason,500),'official_transfer_service',true));
 insert into public.transport_audit_events(organization_id,actor_user_id,action,entity_type,entity_id,reason,after_state,correlation_id) values(t.organization_id,actor,'trip_dispatched','transport_trip',t.id,left(requested_reason,500),jsonb_build_object('load_id',l.id,'status','in_progress'),requested_command_id);
 return t.id;
end$$;
revoke all on function public.transport_dispatch_trip(uuid,uuid,text) from public,anon;
grant execute on function public.transport_dispatch_trip(uuid,uuid,text) to authenticated;

create or replace function public.transport_record_pod(requested_stop_id uuid, requested_order_id uuid, requested_status text, requested_evidence_type text, requested_pin text, requested_recipient text, requested_notes text, requested_captured_at timestamptz, requested_command_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.transport_stops; o public.transport_orders; actor uuid:=(select auth.uid()); pod_id uuid; trip_done boolean;
begin
 if actor is null then raise exception 'authentication required'; end if;
 select * into s from public.transport_stops where id=requested_stop_id for update;
 select * into o from public.transport_orders where id=requested_order_id for update;
 if s.id is null or o.id is null or s.transport_order_id<>o.id or not tms_private.org_allowed(o.organization_id,'transport:record_pod') then raise exception 'forbidden'; end if;
 if requested_status not in('delivered','partially_delivered','failed','returned') then raise exception 'invalid status'; end if;
 if requested_evidence_type='pin' and coalesce(length(requested_pin),0)<4 then raise exception 'valid pin required'; end if;
 insert into public.transport_proof_of_delivery(organization_id,transport_order_id,stop_id,delivery_status,recipient_name,delivered_at,evidence_type,pin_hash,notes,captured_at_device,created_by)
 values(o.organization_id,o.id,s.id,requested_status,nullif(left(requested_recipient,120),''),now(),requested_evidence_type,case when requested_evidence_type='pin' then encode(extensions.digest(requested_pin,'sha256'),'hex') end,left(requested_notes,1000),requested_captured_at,actor)
 on conflict(stop_id,transport_order_id) do update set delivery_status=excluded.delivery_status,recipient_name=excluded.recipient_name,delivered_at=excluded.delivered_at,evidence_type=excluded.evidence_type,pin_hash=excluded.pin_hash,notes=excluded.notes,captured_at_device=excluded.captured_at_device,received_at_server=now(),created_by=excluded.created_by returning id into pod_id;
 update public.transport_orders set status=requested_status,updated_at=now() where id=o.id;
 update public.transport_stops set status=case when requested_status in('delivered','partially_delivered') then 'completed' else 'failed' end,actual_departure_at=now(),completion_tentative=false where id=s.id;
 select not exists(select 1 from public.transport_stops where trip_id=s.trip_id and status not in('completed','skipped')) into trip_done;
 if trip_done then update public.transport_trips set status='completed',actual_end_at=now(),updated_at=now() where id=s.trip_id; update public.transport_loads set status='completed',updated_at=now() where id=(select load_id from public.transport_trips where id=s.trip_id); end if;
 insert into public.transport_trip_events(organization_id,trip_id,stop_id,event_type,actor_user_id,source,payload) values(o.organization_id,s.trip_id,s.id,case when requested_status in('delivered','partially_delivered') then 'pod_recorded' else 'failed' end,actor,'manual',jsonb_build_object('pod_id',pod_id,'command_id',requested_command_id,'status',requested_status));
 return pod_id;
end$$;
revoke all on function public.transport_record_pod(uuid,uuid,text,text,text,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.transport_record_pod(uuid,uuid,text,text,text,text,text,timestamptz,uuid) to authenticated;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,certified,sensitive,allowed_dimensions) values
('transport_on_time_pickup_rate','On-Time Pickup Rate','Coletas realizadas dentro da janela planejada.','on_time_pickups / completed_pickups','transport_stops','trip/day','TMS','hourly','percent','calculation',true,false,array['date','store','carrier','transport_lane']),
('transport_on_time_delivery_rate','On-Time Delivery Rate','Entregas B2B dentro da janela planejada.','on_time_deliveries / completed_deliveries','transport_stops','trip/day','TMS','hourly','percent','calculation',true,false,array['date','store','carrier','transport_lane']),
('transport_lead_time','Transport Lead Time','Tempo entre partida e conclusão.','actual_end_at - actual_start_at','transport_trips','trip','TMS','hourly','minutes','calculation',true,false,array['date','carrier','transport_lane']),
('transport_cost','Transport Cost','Custos logísticos registrados e reconciliados.','sum(amount)','transport_cost_records','trip/day','TMS','daily','currency','calculation',true,true,array['date','store','carrier','transport_lane']),
('transport_load_utilization','Load Utilization','Ocupação conhecida por peso, volume ou pallets.','used capacity / configured capacity','transport_loads','load','TMS','hourly','percent','calculation',true,false,array['date','carrier','vehicle_type']),
('transport_pod_completion_rate','POD Completion Rate','Paradas que exigem POD e possuem confirmação.','valid POD / required POD','transport_proof_of_delivery','trip/day','TMS','hourly','percent','calculation',true,false,array['date','store','carrier'])
on conflict(metric_key) do update set name=excluded.name,description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth;
insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values
('transport-management','Transporte TMS','/painel/transporte',array['transporte','tms','carga','viagem','rota b2b','transportadora','pod'],'transport_management','transport:view','⇄',40)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,required_permission=excluded.required_permission,position=excluded.position;
insert into public.search_command_registry(id,title,description,keywords,command_type,route,required_permission,risk_level,scope,position) values
('transport-active-trips','Ver viagens ativas','Abrir torre de controle de transporte',array['viagens','cargas','atrasos'],'navigation','/painel/transporte?tab=viagens','transport:view','low','organization',45),
('transport-plan-load','Planejar carga','Abrir planejamento de consolidação para revisão humana',array['planejar','consolidar','carga'],'navigation','/painel/transporte?tab=planejamento','transport:plan','medium','organization',46),
('transport-report-occurrence','Registrar ocorrência','Abrir registro de ocorrência operacional',array['ocorrência','avaria','atraso'],'navigation','/painel/transporte?tab=ocorrencias','transport:report_occurrence','medium','organization',47)
on conflict(id) do update set title=excluded.title,description=excluded.description,route=excluded.route,required_permission=excluded.required_permission;
