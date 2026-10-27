-- Phase 42: advanced dining room. Extends the canonical table/order/payment flows.
alter table public.plans add column if not exists advanced_dining_room_enabled boolean not null default false;
alter table public.plans add column if not exists table_tabs_enabled boolean not null default false;
alter table public.plans add column if not exists waiter_orchestration_enabled boolean not null default false;
alter table public.plans add column if not exists split_bill_enabled boolean not null default false;
alter table public.plans add column if not exists table_qr_ordering_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists advanced_dining_room_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists table_tabs_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists waiter_orchestration_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists split_bill_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists table_qr_ordering_enabled boolean not null default true;

do $$ begin
  alter type public.restaurant_table_status add value if not exists 'reserved';
  alter type public.restaurant_table_status add value if not exists 'seated';
  alter type public.restaurant_table_status add value if not exists 'ordering';
  alter type public.restaurant_table_status add value if not exists 'in_service';
  alter type public.restaurant_table_status add value if not exists 'bill_requested';
  alter type public.restaurant_table_status add value if not exists 'payment_in_progress';
  alter type public.restaurant_table_status add value if not exists 'cleaning';
exception when duplicate_object then null; end $$;

alter table public.restaurant_tables add column if not exists floor_x numeric not null default 0;
alter table public.restaurant_tables add column if not exists floor_y numeric not null default 0;
alter table public.restaurant_tables add column if not exists floor_width numeric not null default 1;
alter table public.restaurant_tables add column if not exists floor_height numeric not null default 1;
alter table public.restaurant_tables add column if not exists block_reason text;

alter table public.table_sessions add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.table_sessions add column if not exists store_id uuid references public.establishments(id) on delete cascade;
alter table public.table_sessions add column if not exists reservation_id uuid references public.reservations(id) on delete set null;
alter table public.table_sessions add column if not exists opened_by_user_id uuid references auth.users(id) on delete set null;
alter table public.table_sessions add column if not exists assigned_waiter_id uuid references public.waiters(id) on delete set null;
alter table public.table_sessions add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.table_sessions add column if not exists session_type text not null default 'table' check(session_type in('table','counter','bar'));
alter table public.table_sessions add column if not exists bill_requested_at timestamptz;
alter table public.table_sessions add column if not exists payment_started_at timestamptz;
alter table public.table_sessions add column if not exists seated_at timestamptz;
alter table public.table_sessions add column if not exists first_order_at timestamptz;
alter table public.table_sessions add column if not exists last_order_at timestamptz;
alter table public.table_sessions add column if not exists reopened_at timestamptz;
alter table public.table_sessions add column if not exists version bigint not null default 1;
update public.table_sessions s set store_id=s.establishment_id,organization_id=e.organization_id,seated_at=coalesce(s.seated_at,s.opened_at),opened_by_user_id=coalesce(s.opened_by_user_id,s.waiter_id) from public.establishments e where e.id=s.establishment_id and (s.store_id is null or s.organization_id is null or s.opened_by_user_id is null);
alter table public.table_sessions alter column store_id set not null;
alter table public.table_sessions alter column organization_id set not null;

create table if not exists public.dining_tabs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,table_session_id uuid not null references public.table_sessions(id) on delete cascade,
 tab_type text not null default 'shared' check(tab_type in('shared','individual')),customer_name text,customer_id uuid references public.customers(id) on delete set null,seat_number integer,status text not null default 'open' check(status in('open','bill_requested','payment_in_progress','paid','closed','cancelled')),
 subtotal_cents bigint not null default 0 check(subtotal_cents>=0),discount_cents bigint not null default 0 check(discount_cents>=0),service_charge_cents bigint not null default 0 check(service_charge_cents>=0),tip_cents bigint not null default 0 check(tip_cents>=0),total_cents bigint not null default 0 check(total_cents>=0),paid_cents bigint not null default 0 check(paid_cents>=0),version bigint not null default 1,created_at timestamptz not null default now(),closed_at timestamptz
);
create unique index if not exists dining_tabs_shared_unique on public.dining_tabs(table_session_id) where tab_type='shared' and status not in('cancelled','closed');

alter table public.table_order_items add column if not exists tab_id uuid references public.dining_tabs(id) on delete restrict;
alter table public.table_order_items add column if not exists seat_number integer;
alter table public.table_order_items add column if not exists service_status text not null default 'sent' check(service_status in('sent','preparing','ready','served','cancelled','void_requested','voided'));
alter table public.table_order_items add column if not exists served_at timestamptz;
alter table public.table_order_items add column if not exists served_by uuid references auth.users(id) on delete set null;

create table if not exists public.table_session_waiters(
 table_session_id uuid not null references public.table_sessions(id) on delete cascade,waiter_id uuid not null references public.waiters(id) on delete restrict,assignment_type text not null default 'primary' check(assignment_type in('primary','support','runner')),assigned_by uuid references auth.users(id) on delete set null,assigned_at timestamptz not null default now(),ended_at timestamptz,primary key(table_session_id,waiter_id,assignment_type)
);
create unique index if not exists table_session_primary_waiter on public.table_session_waiters(table_session_id) where assignment_type='primary' and ended_at is null;

create table if not exists public.merged_table_session_members(
 merged_session_id uuid not null references public.table_sessions(id) on delete cascade,table_id uuid not null references public.restaurant_tables(id) on delete restrict,added_by uuid references auth.users(id),added_at timestamptz not null default now(),removed_at timestamptz,primary key(merged_session_id,table_id)
);

create table if not exists public.dining_service_requests(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,table_session_id uuid not null references public.table_sessions(id) on delete cascade,request_type text not null check(request_type in('waiter','bill','water','menu_help','other')),note text,status text not null default 'pending' check(status in('pending','accepted','completed','cancelled')),accepted_by uuid references auth.users(id),accepted_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now()
);

create table if not exists public.dining_payment_allocations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,table_session_id uuid not null references public.table_sessions(id) on delete restrict,tab_id uuid references public.dining_tabs(id) on delete restrict,table_payment_id uuid references public.table_payments(id) on delete restrict,payment_transaction_id uuid references public.order_payment_transactions(id) on delete restrict,
 payment_method text not null check(payment_method in('pix','credit_card','debit_card','cash','other')),amount_cents bigint not null check(amount_cents>0),tip_cents bigint not null default 0 check(tip_cents>=0),cash_received_cents bigint,cash_change_cents bigint,idempotency_key text not null,status text not null default 'pending' check(status in('pending','confirmed','cancelled','refunded')),confirmed_at timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(store_id,idempotency_key),check((table_payment_id is not null)::int+(payment_transaction_id is not null)::int<=1)
);

create table if not exists public.dining_adjustments(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,table_session_id uuid not null references public.table_sessions(id) on delete restrict,tab_id uuid references public.dining_tabs(id) on delete restrict,table_order_item_id uuid references public.table_order_items(id) on delete restrict,adjustment_type text not null check(adjustment_type in('discount','complimentary','void','service_charge_removal','tip')),amount_cents bigint not null default 0 check(amount_cents>=0),reason text not null,status text not null default 'applied' check(status in('pending','approved','applied','rejected','cancelled')),requested_by uuid references auth.users(id),approved_by uuid references auth.users(id),created_at timestamptz not null default now()
);

create table if not exists public.dining_transfer_logs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,transfer_type text not null check(transfer_type in('table','tab','waiter','handoff')),table_session_id uuid not null references public.table_sessions(id) on delete restrict,tab_id uuid references public.dining_tabs(id),from_table_id uuid references public.restaurant_tables(id),to_table_id uuid references public.restaurant_tables(id),from_waiter_id uuid references public.waiters(id),to_waiter_id uuid references public.waiters(id),reason text not null,actor_user_id uuid references auth.users(id),created_at timestamptz not null default now()
);

create table if not exists public.dining_room_settings(
 store_id uuid primary key references public.establishments(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,service_charge_enabled boolean not null default false,service_charge_percent numeric(5,2) not null default 10 check(service_charge_percent between 0 and 30),allow_service_charge_removal boolean not null default true,qr_order_mode text not null default 'waiter_approval' check(qr_order_mode in('direct_to_kitchen','waiter_approval')),served_confirmation_required boolean not null default false,request_escalation_minutes integer not null default 5 check(request_escalation_minutes between 1 and 120),auto_assign_waiter boolean not null default false,cleaning_auto_release boolean not null default false,manual_discount_limit_percent numeric(5,2) not null default 10 check(manual_discount_limit_percent between 0 and 100),updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);

create table if not exists public.dining_member_permissions(
 store_id uuid not null references public.establishments(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,can_view boolean not null default true,can_operate boolean not null default false,can_assign_waiter boolean not null default false,can_transfer_table boolean not null default false,can_manage_tabs boolean not null default false,can_discount boolean not null default false,can_payments boolean not null default false,can_reopen boolean not null default false,can_analytics boolean not null default false,can_settings boolean not null default false,primary key(store_id,user_id)
);

create table if not exists public.dining_audit_events(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,actor_user_id uuid references auth.users(id),event_type text not null,entity_type text not null,entity_id uuid,reason text,before_state jsonb,after_state jsonb,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);

create table if not exists public.analytics_dim_dining_area(area_id uuid primary key,organization_id uuid not null,store_id uuid not null,name text not null,active boolean not null,loaded_at timestamptz not null default now());
create table if not exists public.analytics_dim_table(table_id uuid primary key,organization_id uuid not null,store_id uuid not null,area_id uuid,table_number text not null,capacity integer not null,loaded_at timestamptz not null default now());
create table if not exists public.analytics_dim_waiter(waiter_id uuid primary key,organization_id uuid not null,store_id uuid not null,display_name text not null,active boolean not null,loaded_at timestamptz not null default now());
create table if not exists public.analytics_fact_table_sessions(session_id uuid primary key,organization_id uuid not null,store_id uuid not null,table_id uuid,waiter_id uuid,party_size integer not null,status text not null,opened_at timestamptz,seated_at timestamptz,first_order_at timestamptz,bill_requested_at timestamptz,closed_at timestamptz,total_cents bigint not null default 0,loaded_at timestamptz not null default now());
create table if not exists public.analytics_fact_tabs(tab_id uuid primary key,organization_id uuid not null,store_id uuid not null,session_id uuid not null,tab_type text not null,total_cents bigint not null default 0,paid_cents bigint not null default 0,status text not null,loaded_at timestamptz not null default now());
create table if not exists public.analytics_fact_dining_orders(table_order_id uuid primary key,organization_id uuid not null,store_id uuid not null,session_id uuid not null,waiter_id uuid,status text not null,ordered_at timestamptz,served_at timestamptz,total_cents bigint not null default 0,loaded_at timestamptz not null default now());
create table if not exists public.analytics_fact_service_requests(request_id uuid primary key,organization_id uuid not null,store_id uuid not null,session_id uuid not null,request_type text not null,status text not null,created_at timestamptz,accepted_at timestamptz,completed_at timestamptz,loaded_at timestamptz not null default now());
create table if not exists public.analytics_fact_dining_payments(allocation_id uuid primary key,organization_id uuid not null,store_id uuid not null,session_id uuid not null,tab_id uuid,payment_method text not null,status text not null,amount_cents bigint not null,confirmed_at timestamptz,loaded_at timestamptz not null default now());

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('table_occupancy','Table Occupancy','Percentual de mesas ocupadas.','occupied_tables/available_tables','analytics_fact_table_sessions','store_hour','Salão','hourly','percent','calculation',false,array['date','store','dining_area']),
('table_turnover','Table Turnover','Sessões concluídas por mesa.','closed_sessions/tables','analytics_fact_table_sessions','table_day','Salão','daily','count','calculation',false,array['date','store','dining_area','table']),
('average_table_time','Average Table Time','Tempo médio de permanência.','avg(closed_at-seated_at)','analytics_fact_table_sessions','store_day','Salão','daily','minutes','calculation',false,array['date','store','dining_area']),
('time_to_first_order','Time to First Order','Tempo até o primeiro pedido.','avg(first_order_at-seated_at)','analytics_fact_table_sessions','session','Salão','hourly','minutes','calculation',false,array['date','store','waiter']),
('bill_close_time','Bill Close Time','Tempo entre pedido da conta e fechamento.','avg(closed_at-bill_requested_at)','analytics_fact_table_sessions','session','Financeiro','hourly','minutes','calculation',false,array['date','store','waiter']),
('average_spend_per_table','Average Spend per Table','Consumo médio por sessão.','sum(total_cents)/closed_sessions','analytics_fact_table_sessions','store_day','Salão','daily','cents','calculation',false,array['date','store','dining_area']),
('average_spend_per_guest','Average Spend per Guest','Consumo médio por pessoa.','sum(total_cents)/sum(party_size)','analytics_fact_table_sessions','store_day','Salão','daily','cents','calculation',false,array['date','store','dining_area']),
('service_request_response_time','Service Request Response Time','Tempo de resposta às solicitações.','avg(accepted_at-created_at)','analytics_fact_service_requests','request','Atendimento','hourly','minutes','calculation',false,array['date','store','waiter','request_type'])
on conflict(metric_key) do nothing;

create index if not exists table_sessions_store_status_idx on public.table_sessions(store_id,status,opened_at desc);
create index if not exists table_sessions_reservation_idx on public.table_sessions(reservation_id) where reservation_id is not null;
create index if not exists table_sessions_assigned_waiter_idx on public.table_sessions(assigned_waiter_id,status) where assigned_waiter_id is not null;
create index if not exists dining_tabs_session_status_idx on public.dining_tabs(table_session_id,status);
create index if not exists dining_tabs_store_idx on public.dining_tabs(store_id,created_at desc);
create index if not exists table_order_items_tab_idx on public.table_order_items(tab_id) where tab_id is not null;
create index if not exists dining_requests_active_idx on public.dining_service_requests(store_id,status,created_at) where status in('pending','accepted');
create index if not exists dining_requests_session_idx on public.dining_service_requests(table_session_id,created_at desc);
create index if not exists dining_payments_session_idx on public.dining_payment_allocations(table_session_id,status,created_at);
create index if not exists dining_payments_tab_idx on public.dining_payment_allocations(tab_id) where tab_id is not null;
create index if not exists dining_adjustments_session_idx on public.dining_adjustments(table_session_id,created_at desc);
create index if not exists dining_transfer_session_idx on public.dining_transfer_logs(table_session_id,created_at desc);
create index if not exists dining_audit_scope_idx on public.dining_audit_events(store_id,created_at desc);

do $$ declare t text; begin foreach t in array array['dining_tabs','table_session_waiters','merged_table_session_members','dining_service_requests','dining_payment_allocations','dining_adjustments','dining_transfer_logs','dining_room_settings','dining_member_permissions','dining_audit_events'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on table public.%I from anon,authenticated',t); execute format('grant select,insert,update on table public.%I to authenticated',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['analytics_dim_dining_area','analytics_dim_table','analytics_dim_waiter','analytics_fact_table_sessions','analytics_fact_tabs','analytics_fact_dining_orders','analytics_fact_service_requests','analytics_fact_dining_payments'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from anon,authenticated',t);execute format('grant select on table public.%I to authenticated',t);end loop;end $$;

create policy dining_tabs_operations on public.dining_tabs for all to authenticated using(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[])) with check(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[]));
create policy dining_requests_operations on public.dining_service_requests for all to authenticated using(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[])) with check(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[]));
create policy dining_allocations_operations on public.dining_payment_allocations for all to authenticated using(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[])) with check(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[]));
create policy dining_adjustments_operations on public.dining_adjustments for all to authenticated using(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[])) with check(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[]));
create policy dining_transfers_operations on public.dining_transfer_logs for all to authenticated using(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[])) with check(private.has_role(store_id,array['owner','manager','attendant']::public.member_role[]));
create policy dining_settings_manager on public.dining_room_settings for all to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[])) with check(private.has_role(store_id,array['owner','manager']::public.member_role[]));
create policy dining_permissions_manager on public.dining_member_permissions for all to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]) or user_id=(select auth.uid())) with check(private.has_role(store_id,array['owner','manager']::public.member_role[]));
create policy dining_audit_read on public.dining_audit_events for select to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]));
create policy session_waiters_read on public.table_session_waiters for select to authenticated using(exists(select 1 from public.table_sessions s where s.id=table_session_id and private.has_role(s.store_id,array['owner','manager','attendant']::public.member_role[])));
create policy session_waiters_write on public.table_session_waiters for insert to authenticated with check(exists(select 1 from public.table_sessions s where s.id=table_session_id and private.has_role(s.store_id,array['owner','manager']::public.member_role[])));
create policy merged_sessions_read on public.merged_table_session_members for select to authenticated using(exists(select 1 from public.table_sessions s where s.id=merged_session_id and private.has_role(s.store_id,array['owner','manager','attendant']::public.member_role[])));
create policy merged_sessions_write on public.merged_table_session_members for insert to authenticated with check(exists(select 1 from public.table_sessions s where s.id=merged_session_id and private.has_role(s.store_id,array['owner','manager']::public.member_role[])));
do $$ declare t text; begin foreach t in array array['analytics_dim_dining_area','analytics_dim_table','analytics_dim_waiter','analytics_fact_table_sessions','analytics_fact_tabs','analytics_fact_dining_orders','analytics_fact_service_requests','analytics_fact_dining_payments'] loop execute format('create policy %I on public.%I for select to authenticated using(exists(select 1 from public.organization_members om where om.organization_id=%I.organization_id and om.user_id=(select auth.uid()) and om.active=true))',t||'_read',t,t);end loop;end $$;

create or replace function public.open_advanced_table_session(requested_table_id uuid,requested_party_size integer,requested_customer_name text default null,requested_reservation_id uuid default null,requested_waiter_id uuid default null,requested_idempotency_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());t public.restaurant_tables;s public.table_sessions;org uuid;w uuid;begin
 if actor is null then raise exception 'Autenticação necessária.';end if;select * into t from public.restaurant_tables where id=requested_table_id for update;if not found or not private.has_role(t.establishment_id,array['owner','manager','attendant']::public.member_role[]) then raise exception 'Mesa não encontrada.';end if;if t.status not in('free','reserved') then raise exception 'Mesa não está disponível.';end if;if requested_party_size<1 then raise exception 'Quantidade de pessoas inválida.';end if;select organization_id into org from public.establishments where id=t.establishment_id;
 if requested_reservation_id is not null and not exists(select 1 from public.reservations r where r.id=requested_reservation_id and r.establishment_id=t.establishment_id and r.status in('confirmed','checked_in')) then raise exception 'Reserva inválida.';end if;
 if requested_waiter_id is not null and not exists(select 1 from public.waiters x where x.id=requested_waiter_id and x.establishment_id=t.establishment_id and x.active_now) then raise exception 'Garçom indisponível.';end if;w:=requested_waiter_id;
 insert into public.table_sessions(establishment_id,store_id,organization_id,table_id,waiter_id,opened_by_user_id,assigned_waiter_id,reservation_id,customer_name,people_count,status,opened_at,seated_at) values(t.establishment_id,t.establishment_id,org,t.id,actor,actor,w,requested_reservation_id,nullif(btrim(requested_customer_name),''),requested_party_size,'open',now(),now()) returning * into s;
 insert into public.dining_tabs(organization_id,store_id,table_session_id,tab_type,customer_name) values(org,t.establishment_id,s.id,'shared',nullif(btrim(requested_customer_name),''));
 if w is not null then insert into public.table_session_waiters(table_session_id,waiter_id,assignment_type,assigned_by) values(s.id,w,'primary',actor);end if;
 update public.restaurant_tables set status='seated',assigned_waiter_id=(select user_id from public.waiters where id=w),updated_at=now() where id=t.id;
 if requested_reservation_id is not null then update public.reservations set status='seated',checked_in_at=coalesce(checked_in_at,now()),seated_at=now(),updated_at=now() where id=requested_reservation_id;end if;
 insert into public.dining_audit_events(organization_id,store_id,actor_user_id,event_type,entity_type,entity_id,after_state,metadata) values(org,t.establishment_id,actor,'session_open','table_session',s.id,to_jsonb(s),jsonb_build_object('idempotency_key',requested_idempotency_key));return to_jsonb(s);end$$;

create or replace function public.dining_room_action(requested_session_id uuid,requested_action text,requested_payload jsonb default '{}',requested_idempotency_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());s public.table_sessions;before_state jsonb;target_table public.restaurant_tables;tab_record public.dining_tabs;req public.dining_service_requests;reason text:=nullif(btrim(requested_payload->>'reason'),'');begin
 if actor is null then raise exception 'Autenticação necessária.';end if;select * into s from public.table_sessions where id=requested_session_id for update;if not found or not private.has_role(s.store_id,array['owner','manager','attendant']::public.member_role[]) then raise exception 'Atendimento não encontrado.';end if;before_state:=to_jsonb(s);
 if requested_action='bill_request' then update public.table_sessions set status='awaiting_payment',bill_requested_at=coalesce(bill_requested_at,now()),updated_at=now(),version=version+1 where id=s.id returning * into s;update public.restaurant_tables set status='bill_requested',updated_at=now() where id=s.table_id;
 elsif requested_action='create_tab' then insert into public.dining_tabs(organization_id,store_id,table_session_id,tab_type,customer_name,seat_number) values(s.organization_id,s.store_id,s.id,coalesce(requested_payload->>'tab_type','individual'),nullif(btrim(requested_payload->>'customer_name'),''),nullif(requested_payload->>'seat_number','')::integer) returning * into tab_record;
 elsif requested_action='assign_waiter' then if not private.has_role(s.store_id,array['owner','manager']::public.member_role[]) then raise exception 'Permissão de supervisor necessária.';end if;update public.table_session_waiters set ended_at=now() where table_session_id=s.id and assignment_type='primary' and ended_at is null;insert into public.table_session_waiters(table_session_id,waiter_id,assignment_type,assigned_by) values(s.id,(requested_payload->>'waiter_id')::uuid,'primary',actor);update public.table_sessions set assigned_waiter_id=(requested_payload->>'waiter_id')::uuid,version=version+1,updated_at=now() where id=s.id returning * into s;
 elsif requested_action='transfer_table' then if reason is null then raise exception 'Informe o motivo.';end if;if not private.has_role(s.store_id,array['owner','manager']::public.member_role[]) then raise exception 'Permissão de supervisor necessária.';end if;select * into target_table from public.restaurant_tables where id=(requested_payload->>'table_id')::uuid and establishment_id=s.store_id for update;if not found or target_table.status<>'free' then raise exception 'Mesa de destino indisponível.';end if;update public.restaurant_tables set status='cleaning',updated_at=now() where id=s.table_id;update public.restaurant_tables set status='in_service',assigned_waiter_id=(select user_id from public.waiters where id=s.assigned_waiter_id),updated_at=now() where id=target_table.id;insert into public.dining_transfer_logs(organization_id,store_id,transfer_type,table_session_id,from_table_id,to_table_id,reason,actor_user_id) values(s.organization_id,s.store_id,'table',s.id,s.table_id,target_table.id,reason,actor);update public.table_sessions set table_id=target_table.id,version=version+1,updated_at=now() where id=s.id returning * into s;
 elsif requested_action='reopen' then if reason is null or not private.has_role(s.store_id,array['owner','manager']::public.member_role[]) then raise exception 'Supervisor e motivo são obrigatórios.';end if;update public.table_sessions set status='open',payment_status='pending',reopened_at=now(),closed_at=null,version=version+1,updated_at=now() where id=s.id returning * into s;update public.restaurant_tables set status='in_service',updated_at=now() where id=s.table_id;
 elsif requested_action='mark_clean' then update public.restaurant_tables set status='free',block_reason=null,updated_at=now() where id=s.table_id;
 elsif requested_action='block_table' then if reason is null or not private.has_role(s.store_id,array['owner','manager']::public.member_role[]) then raise exception 'Supervisor e motivo são obrigatórios.';end if;update public.restaurant_tables set status='blocked',block_reason=reason,updated_at=now() where id=s.table_id;
 else raise exception 'Ação inválida.';end if;
 insert into public.dining_audit_events(organization_id,store_id,actor_user_id,event_type,entity_type,entity_id,reason,before_state,after_state,metadata) values(s.organization_id,s.store_id,actor,requested_action,'table_session',s.id,reason,before_state,to_jsonb(s),jsonb_build_object('payload',requested_payload,'idempotency_key',requested_idempotency_key));return jsonb_build_object('session',to_jsonb(s),'tab',to_jsonb(tab_record),'request',to_jsonb(req));end$$;

create or replace function public.record_dining_payment(requested_session_id uuid,requested_tab_id uuid,requested_method text,requested_amount_cents bigint,requested_idempotency_key text,requested_cash_received_cents bigint default null,requested_gateway_transaction_id text default null,requested_tip_cents bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());s public.table_sessions;paid bigint;remaining bigint;allocation public.dining_payment_allocations;begin
 if actor is null then raise exception 'Autenticação necessária.';end if;select * into s from public.table_sessions where id=requested_session_id for update;if not found or not private.has_role(s.store_id,array['owner','manager','attendant']::public.member_role[]) then raise exception 'Conta não encontrada.';end if;if s.status not in('awaiting_payment','paid') then raise exception 'Conta não está em pagamento.';end if;if requested_amount_cents<=0 then raise exception 'Valor inválido.';end if;if requested_method='pix' and nullif(requested_gateway_transaction_id,'') is null then raise exception 'PIX exige confirmação válida do provedor.';end if;select coalesce(sum(amount_cents),0) into paid from public.dining_payment_allocations where table_session_id=s.id and status='confirmed';remaining:=s.total_cents-paid;if requested_amount_cents>remaining then raise exception 'Pagamento supera o saldo restante.';end if;if requested_method='cash' and coalesce(requested_cash_received_cents,0)<requested_amount_cents then raise exception 'Valor recebido insuficiente.';end if;
 insert into public.dining_payment_allocations(organization_id,store_id,table_session_id,tab_id,payment_method,amount_cents,tip_cents,cash_received_cents,cash_change_cents,idempotency_key,status,confirmed_at,created_by) values(s.organization_id,s.store_id,s.id,requested_tab_id,requested_method,requested_amount_cents,requested_tip_cents,requested_cash_received_cents,case when requested_method='cash' then requested_cash_received_cents-requested_amount_cents end,requested_idempotency_key,'confirmed',now(),actor) on conflict(store_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into allocation;
 if requested_tab_id is not null then update public.dining_tabs set paid_cents=least(total_cents,paid_cents+requested_amount_cents),status=case when paid_cents+requested_amount_cents>=total_cents then 'paid' else 'payment_in_progress' end,version=version+1 where id=requested_tab_id and table_session_id=s.id;end if;paid:=paid+requested_amount_cents;update public.table_sessions set status=case when paid>=total_cents then 'paid' else 'awaiting_payment' end,payment_status=case when paid>=total_cents then 'confirmed' else 'pending' end,payment_started_at=coalesce(payment_started_at,now()),version=version+1,updated_at=now() where id=s.id returning * into s;update public.restaurant_tables set status=case when paid>=s.total_cents then 'paid' else 'payment_in_progress' end,updated_at=now() where id=s.table_id;
 insert into public.dining_audit_events(organization_id,store_id,actor_user_id,event_type,entity_type,entity_id,after_state,metadata) values(s.organization_id,s.store_id,actor,'payment','payment_allocation',allocation.id,to_jsonb(allocation),jsonb_build_object('gateway_transaction_id',requested_gateway_transaction_id));return jsonb_build_object('allocation',to_jsonb(allocation),'remaining_cents',greatest(0,s.total_cents-paid),'session',to_jsonb(s));end$$;

revoke all on function public.open_advanced_table_session(uuid,integer,text,uuid,uuid,text) from public,anon;grant execute on function public.open_advanced_table_session(uuid,integer,text,uuid,uuid,text) to authenticated;
revoke all on function public.dining_room_action(uuid,text,jsonb,text) from public,anon;grant execute on function public.dining_room_action(uuid,text,jsonb,text) to authenticated;
revoke all on function public.record_dining_payment(uuid,uuid,text,bigint,text,bigint,text,bigint) from public,anon;grant execute on function public.record_dining_payment(uuid,uuid,text,bigint,text,bigint,text,bigint) to authenticated;

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dining_tabs') then alter publication supabase_realtime add table public.dining_tabs;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dining_service_requests') then alter publication supabase_realtime add table public.dining_service_requests;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dining_payment_allocations') then alter publication supabase_realtime add table public.dining_payment_allocations;end if;
end$$;
