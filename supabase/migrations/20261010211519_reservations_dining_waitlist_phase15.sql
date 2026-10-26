create extension if not exists btree_gist with schema extensions;

alter table public.plans add column if not exists reservations_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists reservations_enabled boolean not null default true;

create table public.dining_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 80),
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id,name)
);

alter table public.restaurant_tables
  add column if not exists dining_area_id uuid references public.dining_areas(id) on delete set null,
  add column if not exists min_capacity integer not null default 1 check(min_capacity between 1 and 100),
  add column if not exists max_capacity integer not null default 4 check(max_capacity between 1 and 100),
  add column if not exists combinable boolean not null default false;
alter table public.restaurant_tables drop constraint if exists restaurant_tables_capacity_check;
alter table public.restaurant_tables add constraint restaurant_tables_capacity_check check(max_capacity>=min_capacity);

create table public.table_combinations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 100), min_capacity integer not null default 2 check(min_capacity between 1 and 200),
  max_capacity integer not null check(max_capacity between 2 and 200), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(max_capacity>=min_capacity), unique(establishment_id,name)
);
create table public.table_combination_members (
  combination_id uuid not null references public.table_combinations(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(combination_id,table_id)
);

create table public.reservation_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  default_duration_minutes integer not null default 90 check(default_duration_minutes between 30 and 480),
  buffer_minutes integer not null default 15 check(buffer_minutes between 0 and 120),
  slot_interval_minutes integer not null default 30 check(slot_interval_minutes between 10 and 120),
  advance_booking_days integer not null default 60 check(advance_booking_days between 1 and 730),
  minimum_notice_minutes integer not null default 60 check(minimum_notice_minutes between 0 and 10080),
  cancellation_mode text not null default 'free' check(cancellation_mode in('free','hours_before','human_review')),
  cancellation_hours integer not null default 2 check(cancellation_hours between 0 and 720),
  grace_minutes integer not null default 15 check(grace_minutes between 0 and 120),
  waitlist_arrival_minutes integer not null default 10 check(waitlist_arrival_minutes between 1 and 120),
  large_party_threshold integer not null default 9 check(large_party_threshold between 2 and 200),
  large_party_requires_human boolean not null default true,
  deposit_enabled boolean not null default false,
  deposit_threshold integer not null default 9 check(deposit_threshold between 2 and 200),
  deposit_cents integer not null default 0 check(deposit_cents>=0),
  reminder_hours integer[] not null default array[24,2], confirmation_required boolean not null default false,
  duration_rules jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.reservation_exceptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  dining_area_id uuid references public.dining_areas(id) on delete cascade, table_id uuid references public.restaurant_tables(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null, reason text not null check(char_length(btrim(reason)) between 2 and 240),
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_at>starts_at), check(not(dining_area_id is not null and table_id is not null))
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null, organization_customer_id uuid references public.organization_customers(id) on delete set null,
  reservation_code text not null unique, starts_at timestamptz not null, ends_at timestamptz not null,
  party_size integer not null check(party_size between 1 and 200),
  status text not null default 'pending' check(status in('pending','pending_payment','confirmed','waiting','checked_in','seated','completed','cancelled','no_show','expired')),
  source text not null check(source in('whatsapp','web','portal','phone','manual','ai')),
  customer_name text not null, customer_phone text, notes text,
  deposit_cents integer not null default 0 check(deposit_cents>=0),
  deposit_status text not null default 'not_required' check(deposit_status in('not_required','pending','paid','failed','refunded','forfeited')),
  payment_transaction_id uuid,
  idempotency_key text, created_by_user_id uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz, checked_in_at timestamptz, seated_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, no_show_at timestamptz, cancellation_reason text,
  rescheduled_from_id uuid references public.reservations(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_at>starts_at), unique(organization_id,idempotency_key)
);

create table public.reservation_table_assignments (
  id uuid primary key default gen_random_uuid(), reservation_id uuid not null references public.reservations(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete restrict,
  occupied_period tstzrange not null, active boolean not null default true,
  created_at timestamptz not null default now(), unique(reservation_id,table_id),
  exclude using gist(table_id with =,occupied_period with &&) where(active)
);

create table public.reservation_payment_intents (
  id uuid primary key default gen_random_uuid(), reservation_id uuid not null references public.reservations(id) on delete cascade,
  gateway_account_id uuid not null references public.payment_gateway_accounts(id) on delete restrict,
  provider text not null check(provider in('mercado_pago','pagarme')), amount_cents integer not null check(amount_cents>0),
  status text not null default 'pending' check(status in('pending','approved','declined','cancelled','refunded','expired')),
  external_id text, checkout_url text, idempotency_key text not null unique, expires_at timestamptz,
  paid_at timestamptz, raw_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.reservations add constraint reservations_payment_intent_fk foreign key(payment_transaction_id) references public.reservation_payment_intents(id) on delete set null;

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null, organization_customer_id uuid references public.organization_customers(id) on delete set null,
  customer_name text not null, customer_phone text, party_size integer not null check(party_size between 1 and 200),
  joined_at timestamptz not null default now(), estimated_wait_minutes integer check(estimated_wait_minutes between 0 and 1440),
  status text not null default 'waiting' check(status in('waiting','notified','arrived','seated','cancelled','expired')),
  priority text not null default 'normal' check(priority in('normal','reservation','accessibility')),
  source text not null default 'manual' check(source in('whatsapp','web','portal','phone','manual','ai')),
  notes text, notified_at timestamptz, arrived_at timestamptz, seated_at timestamptz, expires_at timestamptz,
  assigned_table_id uuid references public.restaurant_tables(id) on delete set null,
  idempotency_key text, created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,idempotency_key)
);

create table public.reservation_events (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete cascade, waitlist_entry_id uuid references public.waitlist_entries(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null, event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null, source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table public.reservation_member_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default true, can_create boolean not null default false, can_edit boolean not null default false,
  can_cancel boolean not null default false, can_reschedule boolean not null default false, can_manage_tables boolean not null default false,
  can_manage_waitlist boolean not null default false, can_manage_settings boolean not null default false, can_view_metrics boolean not null default false,
  updated_at timestamptz not null default now(), primary key(establishment_id,user_id)
);

create table public.reservation_notification_outbox (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade, customer_id uuid references public.customers(id) on delete set null,
  notification_type text not null check(notification_type in('confirmation','reminder','presence_confirmation','waitlist_ready','changed','cancelled')),
  scheduled_at timestamptz not null, status text not null default 'pending' check(status in('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0, idempotency_key text not null unique, payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz, last_error text, created_at timestamptz not null default now()
);

create index dining_areas_store_idx on public.dining_areas(establishment_id,active,sort_order);
create index reservation_store_start_idx on public.reservations(establishment_id,starts_at,status);
create index reservation_customer_idx on public.reservations(organization_id,organization_customer_id,starts_at desc);
create index reservation_assignment_range_idx on public.reservation_table_assignments using gist(table_id,occupied_period);
create index reservation_payment_external_idx on public.reservation_payment_intents(gateway_account_id,external_id) where external_id is not null;
create index waitlist_store_status_idx on public.waitlist_entries(establishment_id,status,priority,joined_at);
create index reservation_events_timeline_idx on public.reservation_events(organization_id,customer_id,created_at desc);
create index reservation_outbox_due_idx on public.reservation_notification_outbox(status,scheduled_at) where status='pending';

do $$ declare t text; begin foreach t in array array['dining_areas','table_combinations','table_combination_members','reservation_settings','reservation_exceptions','reservations','reservation_table_assignments','reservation_payment_intents','waitlist_entries','reservation_events','reservation_member_permissions','reservation_notification_outbox'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create or replace function private.reservation_has_permission(target_store uuid,permission_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(target_store,array['owner','manager']::public.member_role[])
 or exists(select 1 from public.reservation_member_permissions p where p.establishment_id=target_store and p.user_id=(select auth.uid()) and case permission_name when 'view' then p.can_view when 'create' then p.can_create when 'edit' then p.can_edit when 'cancel' then p.can_cancel when 'reschedule' then p.can_reschedule when 'tables' then p.can_manage_tables when 'waitlist' then p.can_manage_waitlist when 'settings' then p.can_manage_settings when 'metrics' then p.can_view_metrics else false end)
$$;

create policy dining_areas_read on public.dining_areas for select to authenticated using(private.reservation_has_permission(establishment_id,'view'));
create policy reservations_read on public.reservations for select to authenticated using(private.reservation_has_permission(establishment_id,'view'));
create policy waitlist_read on public.waitlist_entries for select to authenticated using(private.reservation_has_permission(establishment_id,'view'));
create policy reservation_events_read on public.reservation_events for select to authenticated using(private.reservation_has_permission(establishment_id,'view'));
create policy reservation_settings_read on public.reservation_settings for select to authenticated using(private.reservation_has_permission(establishment_id,'view'));
create policy reservation_exceptions_read on public.reservation_exceptions for select to authenticated using(private.reservation_has_permission(establishment_id,'view'));
create policy reservation_assignments_read on public.reservation_table_assignments for select to authenticated using(exists(select 1 from public.reservations r where r.id=reservation_id and private.reservation_has_permission(r.establishment_id,'view')));
create policy table_combinations_read on public.table_combinations for select to authenticated using(private.reservation_has_permission(establishment_id,'view'));
create policy combination_members_read on public.table_combination_members for select to authenticated using(exists(select 1 from public.table_combinations c where c.id=combination_id and private.reservation_has_permission(c.establishment_id,'view')));
create policy reservation_permissions_manager on public.reservation_member_permissions for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy reservation_outbox_deny on public.reservation_notification_outbox for all to anon,authenticated using(false) with check(false);
create policy reservation_payments_deny on public.reservation_payment_intents for all to anon,authenticated using(false) with check(false);

do $$ declare t text; begin foreach t in array array['dining_areas','table_combinations','table_combination_members','reservation_settings','reservation_exceptions','reservations','reservation_table_assignments','reservation_payment_intents','waitlist_entries','reservation_events','reservation_member_permissions','reservation_notification_outbox'] loop execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t); end loop; end $$;
grant select on public.dining_areas,public.table_combinations,public.table_combination_members,public.reservation_settings,public.reservation_exceptions,public.reservations,public.reservation_table_assignments,public.waitlist_entries,public.reservation_events,public.reservation_member_permissions to authenticated;
grant usage,select on sequence public.reservation_events_id_seq to service_role;

create trigger dining_areas_touch before update on public.dining_areas for each row execute function public.touch_updated_at();
create trigger table_combinations_touch before update on public.table_combinations for each row execute function public.touch_updated_at();
create trigger reservation_settings_touch before update on public.reservation_settings for each row execute function public.touch_updated_at();
create trigger reservation_exceptions_touch before update on public.reservation_exceptions for each row execute function public.touch_updated_at();
create trigger reservations_touch before update on public.reservations for each row execute function public.touch_updated_at();
create trigger reservation_payment_intents_touch before update on public.reservation_payment_intents for each row execute function public.touch_updated_at();
create trigger waitlist_entries_touch before update on public.waitlist_entries for each row execute function public.touch_updated_at();

insert into public.reservation_settings(establishment_id,organization_id) select e.id,coalesce(e.organization_id,e.id) from public.establishments e on conflict(establishment_id) do nothing;
insert into public.dining_areas(organization_id,establishment_id,name,description) select coalesce(e.organization_id,e.id),e.id,'Salão principal','Área padrão criada para as mesas existentes.' from public.establishments e on conflict(establishment_id,name) do nothing;
update public.restaurant_tables t set dining_area_id=a.id from public.dining_areas a where a.establishment_id=t.establishment_id and a.name='Salão principal' and t.dining_area_id is null;

create or replace function public.get_reservation_availability(requested_establishment_id uuid,requested_start timestamptz,requested_party_size integer,requested_duration_minutes integer default null,requested_area_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;s public.reservation_settings%rowtype;duration_minutes integer;finish timestamptz;local_day integer;local_time time;open_row public.business_hours%rowtype;suggested jsonb;alternatives jsonb;role_name text:=current_setting('request.jwt.claim.role',true);
begin
 if role_name<>'service_role' and not private.reservation_has_permission(requested_establishment_id,'view') then raise exception 'Sem permissão.';end if;
 select * into e from public.establishments where id=requested_establishment_id and active;
 select * into s from public.reservation_settings where establishment_id=e.id and enabled;
 if e.id is null or s.establishment_id is null or requested_party_size not between 1 and 200 then raise exception 'Solicitação inválida.';end if;
 if requested_start<now()+make_interval(mins=>s.minimum_notice_minutes) or requested_start>now()+make_interval(days=>s.advance_booking_days) then return jsonb_build_object('available',false,'reason','outside_booking_window','available_slots','[]'::jsonb,'suggested_tables','[]'::jsonb,'alternatives','[]'::jsonb);end if;
 duration_minutes:=coalesce(requested_duration_minutes,s.default_duration_minutes);finish:=requested_start+make_interval(mins=>duration_minutes);
 local_day:=extract(dow from requested_start at time zone coalesce(e.timezone,'America/Sao_Paulo'));local_time:=(requested_start at time zone coalesce(e.timezone,'America/Sao_Paulo'))::time;
 select * into open_row from public.business_hours where establishment_id=e.id and weekday=local_day;
 if open_row.establishment_id is null or open_row.closed or local_time<open_row.opens_at or (finish at time zone coalesce(e.timezone,'America/Sao_Paulo'))::time>open_row.closes_at then return jsonb_build_object('available',false,'reason','outside_business_hours','available_slots','[]'::jsonb,'suggested_tables','[]'::jsonb,'alternatives','[]'::jsonb);end if;
 select coalesce(jsonb_agg(x),'[]') into suggested from (
  select jsonb_build_object('kind','table','id',t.id,'name',coalesce(t.table_name,'Mesa '||t.table_number),'capacity',t.max_capacity,'table_ids',jsonb_build_array(t.id)) x
  from public.restaurant_tables t where t.establishment_id=e.id and t.is_active and t.max_capacity>=requested_party_size and (requested_area_id is null or t.dining_area_id=requested_area_id)
  and not exists(select 1 from public.table_sessions ts where ts.table_id=t.id and ts.status in('open','awaiting_payment','paid'))
  and not exists(select 1 from public.reservation_table_assignments ra where ra.table_id=t.id and ra.active and ra.occupied_period&&tstzrange(requested_start,finish+make_interval(mins=>s.buffer_minutes),'[)'))
  and not exists(select 1 from public.reservation_exceptions ex where ex.establishment_id=e.id and ex.active and tstzrange(ex.starts_at,ex.ends_at,'[)')&&tstzrange(requested_start,finish+make_interval(mins=>s.buffer_minutes),'[)') and (ex.table_id is null or ex.table_id=t.id) and (ex.dining_area_id is null or ex.dining_area_id=t.dining_area_id))
  order by t.max_capacity,t.table_number limit 8
 )q;
 if jsonb_array_length(suggested)=0 then
  select coalesce(jsonb_agg(x),'[]') into suggested from (
   select jsonb_build_object('kind','combination','id',c.id,'name',c.name,'capacity',c.max_capacity,'table_ids',jsonb_agg(t.id)) x
   from public.table_combinations c join public.table_combination_members cm on cm.combination_id=c.id join public.restaurant_tables t on t.id=cm.table_id
   where c.establishment_id=e.id and c.active and c.max_capacity>=requested_party_size and t.is_active
   and not exists(select 1 from public.table_sessions ts where ts.table_id=t.id and ts.status in('open','awaiting_payment','paid'))
   and not exists(select 1 from public.reservation_table_assignments ra where ra.table_id=t.id and ra.active and ra.occupied_period&&tstzrange(requested_start,finish+make_interval(mins=>s.buffer_minutes),'[)'))
   group by c.id,c.name,c.max_capacity having count(*)=(select count(*) from public.table_combination_members z where z.combination_id=c.id) order by c.max_capacity limit 5
  )q;
 end if;
 select coalesce(jsonb_agg(to_char(slot at time zone coalesce(e.timezone,'America/Sao_Paulo'),'YYYY-MM-DD"T"HH24:MI')),'[]') into alternatives
 from generate_series(requested_start-interval '2 hours',requested_start+interval '2 hours',make_interval(mins=>s.slot_interval_minutes)) slot
 where slot<>requested_start and exists(select 1 from public.restaurant_tables t where t.establishment_id=e.id and t.is_active and t.max_capacity>=requested_party_size and not exists(select 1 from public.reservation_table_assignments ra where ra.table_id=t.id and ra.active and ra.occupied_period&&tstzrange(slot,slot+make_interval(mins=>duration_minutes+s.buffer_minutes),'[)'))) limit 8;
 return jsonb_build_object('available',jsonb_array_length(suggested)>0,'duration_minutes',duration_minutes,'ends_at',finish,'available_slots',case when jsonb_array_length(suggested)>0 then jsonb_build_array(requested_start) else '[]'::jsonb end,'suggested_tables',suggested,'alternatives',alternatives);
end $$;

create or replace function public.save_dining_area(requested_establishment_id uuid,requested_area_id uuid,requested_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;saved uuid;begin if not private.reservation_has_permission(requested_establishment_id,'tables') then raise exception 'Sem permissão.';end if;select * into e from public.establishments where id=requested_establishment_id;if requested_area_id is null then insert into public.dining_areas(organization_id,establishment_id,name,description,active,sort_order) values(coalesce(e.organization_id,e.id),e.id,btrim(requested_payload->>'name'),requested_payload->>'description',coalesce((requested_payload->>'active')::boolean,true),coalesce((requested_payload->>'sort_order')::integer,0)) returning id into saved;else update public.dining_areas set name=btrim(requested_payload->>'name'),description=requested_payload->>'description',active=coalesce((requested_payload->>'active')::boolean,active),sort_order=coalesce((requested_payload->>'sort_order')::integer,sort_order) where id=requested_area_id and establishment_id=e.id returning id into saved;end if;insert into public.reservation_events(organization_id,establishment_id,event_type,actor_user_id,source,metadata)values(coalesce(e.organization_id,e.id),e.id,'dining_area_saved',auth.uid(),'admin',jsonb_build_object('area_id',saved));return saved;end $$;

create or replace function public.save_reservation_table(requested_establishment_id uuid,requested_table_id uuid,requested_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;org uuid;begin if not private.reservation_has_permission(requested_establishment_id,'tables') then raise exception 'Sem permissão.';end if;select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;if requested_table_id is null then insert into public.restaurant_tables(establishment_id,table_number,table_name,dining_area_id,min_capacity,max_capacity,combinable,is_active) values(requested_establishment_id,btrim(requested_payload->>'number'),nullif(btrim(requested_payload->>'name'),''),(requested_payload->>'area_id')::uuid,coalesce((requested_payload->>'min_capacity')::integer,1),coalesce((requested_payload->>'max_capacity')::integer,4),coalesce((requested_payload->>'combinable')::boolean,false),coalesce((requested_payload->>'active')::boolean,true)) returning id into saved;else update public.restaurant_tables set table_number=btrim(requested_payload->>'number'),table_name=nullif(btrim(requested_payload->>'name'),''),dining_area_id=(requested_payload->>'area_id')::uuid,min_capacity=coalesce((requested_payload->>'min_capacity')::integer,min_capacity),max_capacity=coalesce((requested_payload->>'max_capacity')::integer,max_capacity),combinable=coalesce((requested_payload->>'combinable')::boolean,combinable),is_active=coalesce((requested_payload->>'active')::boolean,is_active) where id=requested_table_id and establishment_id=requested_establishment_id returning id into saved;end if;insert into public.reservation_events(organization_id,establishment_id,event_type,actor_user_id,source,metadata)values(org,requested_establishment_id,'table_saved',auth.uid(),'admin',jsonb_build_object('table_id',saved));return saved;end $$;

create or replace function public.save_table_combination(requested_establishment_id uuid,requested_name text,requested_table_ids uuid[],requested_min_capacity integer,requested_max_capacity integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;org uuid;table_id uuid;begin if not private.reservation_has_permission(requested_establishment_id,'tables') then raise exception 'Sem permissão.';end if;if coalesce(array_length(requested_table_ids,1),0)<2 then raise exception 'Selecione ao menos duas mesas.';end if;select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;foreach table_id in array requested_table_ids loop if not exists(select 1 from public.restaurant_tables where id=table_id and establishment_id=requested_establishment_id and combinable) then raise exception 'Mesa não combinável ou de outra unidade.';end if;end loop;insert into public.table_combinations(organization_id,establishment_id,name,min_capacity,max_capacity)values(org,requested_establishment_id,btrim(requested_name),requested_min_capacity,requested_max_capacity)returning id into saved;insert into public.table_combination_members(combination_id,table_id)select saved,unnest(requested_table_ids);insert into public.reservation_events(organization_id,establishment_id,event_type,actor_user_id,source,metadata)values(org,requested_establishment_id,'table_combination_saved',auth.uid(),'admin',jsonb_build_object('combination_id',saved,'table_ids',requested_table_ids));return saved;end $$;

create or replace function public.save_reservation_settings(requested_establishment_id uuid,requested_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.reservation_settings%rowtype;begin if not private.reservation_has_permission(requested_establishment_id,'settings') then raise exception 'Sem permissão.';end if;update public.reservation_settings set enabled=coalesce((requested_payload->>'enabled')::boolean,enabled),default_duration_minutes=coalesce((requested_payload->>'default_duration_minutes')::integer,default_duration_minutes),buffer_minutes=coalesce((requested_payload->>'buffer_minutes')::integer,buffer_minutes),slot_interval_minutes=coalesce((requested_payload->>'slot_interval_minutes')::integer,slot_interval_minutes),minimum_notice_minutes=coalesce((requested_payload->>'minimum_notice_minutes')::integer,minimum_notice_minutes),cancellation_mode=coalesce(requested_payload->>'cancellation_mode',cancellation_mode),cancellation_hours=coalesce((requested_payload->>'cancellation_hours')::integer,cancellation_hours),grace_minutes=coalesce((requested_payload->>'grace_minutes')::integer,grace_minutes),waitlist_arrival_minutes=coalesce((requested_payload->>'waitlist_arrival_minutes')::integer,waitlist_arrival_minutes),large_party_threshold=coalesce((requested_payload->>'large_party_threshold')::integer,large_party_threshold),large_party_requires_human=coalesce((requested_payload->>'large_party_requires_human')::boolean,large_party_requires_human),deposit_enabled=coalesce((requested_payload->>'deposit_enabled')::boolean,deposit_enabled),deposit_threshold=coalesce((requested_payload->>'deposit_threshold')::integer,deposit_threshold),deposit_cents=coalesce((requested_payload->>'deposit_cents')::integer,deposit_cents),confirmation_required=coalesce((requested_payload->>'confirmation_required')::boolean,confirmation_required),updated_at=now() where establishment_id=requested_establishment_id returning * into saved;return to_jsonb(saved);end $$;

create or replace function public.create_reservation(requested_establishment_id uuid,requested_customer_id uuid,requested_start timestamptz,requested_party_size integer,requested_duration_minutes integer,requested_source text,requested_customer_name text,requested_customer_phone text,requested_notes text,requested_table_ids uuid[],requested_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;s public.reservation_settings%rowtype;availability jsonb;r public.reservations%rowtype;table_ids uuid[]:=requested_table_ids;table_id uuid;finish timestamptz;org_customer uuid;role_name text:=current_setting('request.jwt.claim.role',true);deposit integer:=0;reminder integer;
begin
 if role_name<>'service_role' and not private.reservation_has_permission(requested_establishment_id,'create') then raise exception 'Sem permissão.';end if;
 if requested_source not in('whatsapp','web','portal','phone','manual','ai') then raise exception 'Origem inválida.';end if;
 perform pg_advisory_xact_lock(hashtextextended(requested_establishment_id::text||date_trunc('day',requested_start)::text,0));
 select * into e from public.establishments where id=requested_establishment_id;select * into s from public.reservation_settings where establishment_id=e.id;
 if requested_idempotency_key is not null then select * into r from public.reservations where organization_id=coalesce(e.organization_id,e.id) and idempotency_key=requested_idempotency_key;if r.id is not null then return to_jsonb(r);end if;end if;
 if s.large_party_requires_human and requested_party_size>=s.large_party_threshold and role_name='service_role' and requested_source in('portal','web','whatsapp','ai') then raise exception 'Grupo grande requer atendimento humano.';end if;
 availability:=public.get_reservation_availability(e.id,requested_start,requested_party_size,requested_duration_minutes,null);if not coalesce((availability->>'available')::boolean,false) then raise exception 'Horário indisponível. Escolha uma alternativa.';end if;
 if coalesce(array_length(table_ids,1),0)=0 then select array_agg(value::uuid) into table_ids from jsonb_array_elements_text(availability#>'{suggested_tables,0,table_ids}');end if;
 if coalesce(array_length(table_ids,1),0)=0 then raise exception 'Nenhuma mesa disponível.';end if;
 finish:=requested_start+make_interval(mins=>coalesce(requested_duration_minutes,s.default_duration_minutes));
 if requested_customer_id is not null then select c.organization_customer_id into org_customer from public.customers c join public.establishments ce on ce.id=c.establishment_id where c.id=requested_customer_id and coalesce(ce.organization_id,ce.id)=coalesce(e.organization_id,e.id);end if;
 if s.deposit_enabled and requested_party_size>=s.deposit_threshold then deposit:=s.deposit_cents;end if;
 insert into public.reservations(organization_id,establishment_id,customer_id,organization_customer_id,reservation_code,starts_at,ends_at,party_size,status,source,customer_name,customer_phone,notes,deposit_cents,deposit_status,idempotency_key,created_by_user_id)
 values(coalesce(e.organization_id,e.id),e.id,requested_customer_id,org_customer,'RES-'||upper(substr(md5(gen_random_uuid()::text),1,6)),requested_start,finish,requested_party_size,case when deposit>0 then 'pending_payment' when s.confirmation_required then 'pending' else 'confirmed' end,requested_source,btrim(requested_customer_name),requested_customer_phone,requested_notes,deposit,case when deposit>0 then 'pending' else 'not_required' end,requested_idempotency_key,auth.uid()) returning * into r;
 foreach table_id in array table_ids loop
  if not exists(select 1 from public.restaurant_tables t where t.id=table_id and t.establishment_id=e.id and t.is_active) then raise exception 'Mesa inválida.';end if;
  insert into public.reservation_table_assignments(reservation_id,table_id,occupied_period) values(r.id,table_id,tstzrange(requested_start,finish+make_interval(mins=>s.buffer_minutes),'[)'));
 end loop;
 insert into public.reservation_events(organization_id,establishment_id,reservation_id,customer_id,event_type,actor_user_id,source,metadata)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'reservation_created',auth.uid(),requested_source,jsonb_build_object('party_size',r.party_size,'deposit_cents',deposit));
 if r.status='confirmed' then update public.reservations set confirmed_at=now() where id=r.id;insert into public.reservation_events(organization_id,establishment_id,reservation_id,customer_id,event_type,source)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'reservation_confirmed','system');end if;
 if r.customer_id is not null then insert into public.customer_notifications(organization_id,establishment_id,customer_id,notification_type,title,body)values(r.organization_id,r.establishment_id,r.customer_id,'reservation_created','Reserva '||r.reservation_code,case when r.status='pending_payment' then 'Sua reserva aguarda o pagamento do sinal.' else 'Sua reserva foi registrada para '||to_char(r.starts_at at time zone coalesce(e.timezone,'America/Sao_Paulo'),'DD/MM/YYYY HH24:MI')||'.' end);end if;
 insert into public.reservation_notification_outbox(organization_id,establishment_id,reservation_id,customer_id,notification_type,scheduled_at,idempotency_key,payload)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'confirmation',now(),'reservation-confirmation-'||r.id,jsonb_build_object('code',r.reservation_code)) on conflict do nothing;
 foreach reminder in array s.reminder_hours loop if r.starts_at-make_interval(hours=>reminder)>now() then insert into public.reservation_notification_outbox(organization_id,establishment_id,reservation_id,customer_id,notification_type,scheduled_at,idempotency_key,payload)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'reminder',r.starts_at-make_interval(hours=>reminder),'reservation-reminder-'||r.id||'-'||reminder,jsonb_build_object('hours_before',reminder,'code',r.reservation_code)) on conflict do nothing;end if;end loop;
 if s.confirmation_required and r.starts_at-interval '4 hours'>now() then insert into public.reservation_notification_outbox(organization_id,establishment_id,reservation_id,customer_id,notification_type,scheduled_at,idempotency_key,payload)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'presence_confirmation',r.starts_at-interval '4 hours','reservation-presence-'||r.id,jsonb_build_object('code',r.reservation_code)) on conflict do nothing;end if;
 return to_jsonb(r)||jsonb_build_object('table_ids',to_jsonb(table_ids));
exception when exclusion_violation then raise exception 'Esta mesa acabou de ser reservada. Escolha outro horário.';end $$;

create or replace function public.reservation_action(requested_establishment_id uuid,requested_reservation_id uuid,requested_action text,requested_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;s public.reservation_settings%rowtype;event_name text;new_start timestamptz;duration integer;new_status text;required_permission text;availability jsonb;
begin
 required_permission:=case requested_action when 'cancel' then 'cancel' when 'reschedule' then 'reschedule' else 'edit' end;if not private.reservation_has_permission(requested_establishment_id,required_permission) then raise exception 'Sem permissão.';end if;
 select * into r from public.reservations where id=requested_reservation_id and establishment_id=requested_establishment_id for update;if r.id is null then raise exception 'Reserva não encontrada.';end if;select * into s from public.reservation_settings where establishment_id=r.establishment_id;
 if requested_action='reschedule' then
  new_start=(requested_payload->>'starts_at')::timestamptz;duration=coalesce((requested_payload->>'duration_minutes')::integer,(extract(epoch from(r.ends_at-r.starts_at))/60)::integer);perform pg_advisory_xact_lock(hashtextextended(r.establishment_id::text||date_trunc('day',new_start)::text,0));
  update public.reservation_table_assignments set active=false where reservation_id=r.id;availability:=public.get_reservation_availability(r.establishment_id,new_start,r.party_size,duration,null);if not coalesce((availability->>'available')::boolean,false) then raise exception 'Novo horário indisponível.';end if;
  update public.reservations set starts_at=new_start,ends_at=new_start+make_interval(mins=>duration),updated_at=now() where id=r.id;
  update public.reservation_table_assignments set occupied_period=tstzrange(new_start,new_start+make_interval(mins=>duration+s.buffer_minutes),'[)'),active=true where reservation_id=r.id;event_name='reservation_rescheduled';
 else
  new_status:=case requested_action when 'confirm' then 'confirmed' when 'check_in' then 'checked_in' when 'seat' then 'seated' when 'complete' then 'completed' when 'no_show' then 'no_show' when 'cancel' then 'cancelled' else null end;if new_status is null then raise exception 'Ação inválida.';end if;
  update public.reservations set status=new_status,confirmed_at=case when new_status='confirmed' then now() else confirmed_at end,checked_in_at=case when new_status='checked_in' then now() else checked_in_at end,seated_at=case when new_status='seated' then now() else seated_at end,completed_at=case when new_status='completed' then now() else completed_at end,no_show_at=case when new_status='no_show' then now() else no_show_at end,cancelled_at=case when new_status='cancelled' then now() else cancelled_at end,cancellation_reason=case when new_status='cancelled' then requested_payload->>'reason' else cancellation_reason end where id=r.id;
  update public.reservation_table_assignments set active=new_status not in('completed','cancelled','no_show','expired') where reservation_id=r.id;event_name='reservation_'||new_status;
 end if;
 insert into public.reservation_events(organization_id,establishment_id,reservation_id,customer_id,event_type,actor_user_id,source,metadata)values(r.organization_id,r.establishment_id,r.id,r.customer_id,event_name,auth.uid(),'admin',requested_payload);return jsonb_build_object('ok',true,'status',coalesce(new_status,r.status),'event',event_name);
exception when exclusion_violation then raise exception 'O novo horário entrou em conflito com outra reserva.';end $$;

create or replace function public.join_waitlist(requested_establishment_id uuid,requested_customer_id uuid,requested_customer_name text,requested_customer_phone text,requested_party_size integer,requested_source text,requested_notes text,requested_priority text,requested_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;w public.waitlist_entries%rowtype;a integer;estimate integer;orgc uuid;role_name text:=current_setting('request.jwt.claim.role',true);begin if role_name<>'service_role' and not private.reservation_has_permission(requested_establishment_id,'waitlist') then raise exception 'Sem permissão.';end if;select * into e from public.establishments where id=requested_establishment_id;if requested_idempotency_key is not null then select * into w from public.waitlist_entries where organization_id=coalesce(e.organization_id,e.id) and idempotency_key=requested_idempotency_key;if w.id is not null then return to_jsonb(w);end if;end if;select count(*) into a from public.waitlist_entries where establishment_id=e.id and status in('waiting','notified','arrived');estimate:=greatest(5,ceil((a+1)::numeric/greatest((select count(*) from public.restaurant_tables where establishment_id=e.id and is_active and max_capacity>=requested_party_size),1))*coalesce((select round(avg(extract(epoch from(completed_at-seated_at))/60)) from public.reservations where establishment_id=e.id and completed_at is not null and seated_at is not null and completed_at>now()-interval '90 days'),(select default_duration_minutes from public.reservation_settings where establishment_id=e.id)))::integer;if requested_customer_id is not null then select organization_customer_id into orgc from public.customers where id=requested_customer_id;end if;insert into public.waitlist_entries(organization_id,establishment_id,customer_id,organization_customer_id,customer_name,customer_phone,party_size,estimated_wait_minutes,source,notes,priority,idempotency_key,created_by_user_id)values(coalesce(e.organization_id,e.id),e.id,requested_customer_id,orgc,requested_customer_name,requested_customer_phone,requested_party_size,estimate,requested_source,requested_notes,coalesce(requested_priority,'normal'),requested_idempotency_key,auth.uid())returning * into w;insert into public.reservation_events(organization_id,establishment_id,waitlist_entry_id,customer_id,event_type,actor_user_id,source,metadata)values(w.organization_id,w.establishment_id,w.id,w.customer_id,'waitlist_joined',auth.uid(),requested_source,jsonb_build_object('estimate_minutes',estimate));return to_jsonb(w)||jsonb_build_object('position',a+1,'estimate_is_prediction',true);end $$;

create or replace function public.waitlist_action(requested_establishment_id uuid,requested_waitlist_id uuid,requested_action text,requested_table_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.waitlist_entries%rowtype;s public.reservation_settings%rowtype;new_status text;begin if not private.reservation_has_permission(requested_establishment_id,'waitlist') then raise exception 'Sem permissão.';end if;select * into w from public.waitlist_entries where id=requested_waitlist_id and establishment_id=requested_establishment_id for update;select * into s from public.reservation_settings where establishment_id=w.establishment_id;new_status:=case requested_action when 'notify' then 'notified' when 'arrive' then 'arrived' when 'seat' then 'seated' when 'cancel' then 'cancelled' when 'expire' then 'expired' else null end;if new_status is null then raise exception 'Ação inválida.';end if;update public.waitlist_entries set status=new_status,notified_at=case when new_status='notified' then now() else notified_at end,arrived_at=case when new_status='arrived' then now() else arrived_at end,seated_at=case when new_status='seated' then now() else seated_at end,expires_at=case when new_status='notified' then now()+make_interval(mins=>s.waitlist_arrival_minutes) else expires_at end,assigned_table_id=coalesce(requested_table_id,assigned_table_id) where id=w.id;insert into public.reservation_events(organization_id,establishment_id,waitlist_entry_id,customer_id,event_type,actor_user_id,source,metadata)values(w.organization_id,w.establishment_id,w.id,w.customer_id,'waitlist_'||new_status,auth.uid(),'admin',jsonb_build_object('table_id',requested_table_id));return jsonb_build_object('ok',true,'status',new_status);end $$;

create or replace function public.get_reservation_dashboard(requested_establishment_id uuid,requested_days integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare from_at timestamptz:=now()-make_interval(days=>least(greatest(requested_days,1),365));begin if not private.reservation_has_permission(requested_establishment_id,'view') then raise exception 'Sem permissão.';end if;return jsonb_build_object(
 'free_tables',(select count(*) from public.restaurant_tables t where t.establishment_id=requested_establishment_id and t.is_active and t.status='free'),
 'occupied_tables',(select count(*) from public.restaurant_tables t where t.establishment_id=requested_establishment_id and t.status not in('free','blocked')),
 'reserved_now',(select count(*) from public.reservations r where r.establishment_id=requested_establishment_id and r.status in('confirmed','checked_in') and now()<r.ends_at and now()+interval '2 hours'>r.starts_at),
 'waitlist',(select count(*) from public.waitlist_entries w where w.establishment_id=requested_establishment_id and w.status in('waiting','notified','arrived')),
 'upcoming',(select count(*) from public.reservations r where r.establishment_id=requested_establishment_id and r.status in('pending','pending_payment','confirmed') and r.starts_at between now() and now()+interval '24 hours'),
 'no_shows_today',(select count(*) from public.reservations r where r.establishment_id=requested_establishment_id and r.status='no_show' and r.no_show_at::date=current_date),
 'reservations',(select count(*) from public.reservations r where r.establishment_id=requested_establishment_id and r.created_at>=from_at),
 'cancelled',(select count(*) from public.reservations r where r.establishment_id=requested_establishment_id and r.status='cancelled' and r.created_at>=from_at),
 'no_show_rate',(select coalesce(round(100.0*count(*)filter(where status='no_show')/nullif(count(*)filter(where status in('completed','no_show')),0),1),0) from public.reservations where establishment_id=requested_establishment_id and starts_at>=from_at),
 'average_stay_minutes',(select coalesce(round(avg(extract(epoch from(completed_at-seated_at))/60)),0) from public.reservations where establishment_id=requested_establishment_id and completed_at is not null and seated_at is not null and starts_at>=from_at),
 'waitlist_conversion',(select coalesce(round(100.0*count(*)filter(where status='seated')/nullif(count(*),0),1),0) from public.waitlist_entries where establishment_id=requested_establishment_id and joined_at>=from_at),
 'by_source',(select coalesce(jsonb_object_agg(source,total),'{}') from(select source,count(*) total from public.reservations where establishment_id=requested_establishment_id and created_at>=from_at group by source)x));end $$;

create or replace function public.get_reservation_portal_context(requested_session_hash text,requested_slug text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;ids uuid[];begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;if s.id is null or e.id is null then raise exception 'Sessão expirada.';end if;select array_agg(id) into ids from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id;return jsonb_build_object(
 'reservations',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'code',r.reservation_code,'store_id',r.establishment_id,'store_name',st.name,'starts_at',r.starts_at,'ends_at',r.ends_at,'party_size',r.party_size,'status',r.status,'deposit_cents',r.deposit_cents,'deposit_status',r.deposit_status,'notes',r.notes,'tables',(select coalesce(jsonb_agg(coalesce(t.table_name,'Mesa '||t.table_number)),'[]') from public.reservation_table_assignments a join public.restaurant_tables t on t.id=a.table_id where a.reservation_id=r.id)) order by r.starts_at desc),'[]') from public.reservations r join public.establishments st on st.id=r.establishment_id where r.organization_id=s.organization_id and r.customer_id=any(ids)),
 'waitlist',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'store_id',w.establishment_id,'store_name',st.name,'party_size',w.party_size,'status',w.status,'joined_at',w.joined_at,'estimated_wait_minutes',w.estimated_wait_minutes,'position',(select count(*)+1 from public.waitlist_entries q where q.establishment_id=w.establishment_id and q.status in('waiting','notified','arrived') and(q.priority>w.priority or(q.priority=w.priority and q.joined_at<w.joined_at)))) order by w.joined_at desc),'[]') from public.waitlist_entries w join public.establishments st on st.id=w.establishment_id where w.organization_id=s.organization_id and w.customer_id=any(ids)),
 'settings',to_jsonb((select x from public.reservation_settings x where x.establishment_id=e.id))-'organization_id');end $$;

create or replace function public.create_portal_reservation(requested_session_hash text,requested_slug text,requested_start timestamptz,requested_party_size integer,requested_duration_minutes integer,requested_notes text,requested_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;c public.customers%rowtype;begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;select * into c from public.customers where id=s.customer_id;if s.id is null or e.id is null then raise exception 'Sessão expirada.';end if;return public.create_reservation(e.id,c.id,requested_start,requested_party_size,requested_duration_minutes,'portal',c.name,c.phone,requested_notes,array[]::uuid[],requested_idempotency_key);end $$;

create or replace function public.portal_reservation_action(requested_session_hash text,requested_slug text,requested_reservation_id uuid,requested_action text,requested_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;r public.reservations%rowtype;settings public.reservation_settings%rowtype;new_start timestamptz;duration integer;available jsonb;begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;select * into r from public.reservations where id=requested_reservation_id and organization_id=s.organization_id and(customer_id=s.customer_id or organization_customer_id=s.organization_customer_id) for update;select * into settings from public.reservation_settings where establishment_id=r.establishment_id;if r.id is null then raise exception 'Reserva não encontrada.';end if;
 if requested_action='cancel' then if settings.cancellation_mode='human_review' or(settings.cancellation_mode='hours_before' and r.starts_at<now()+make_interval(hours=>settings.cancellation_hours)) then raise exception 'Este cancelamento precisa de atendimento humano.';end if;update public.reservations set status='cancelled',cancelled_at=now(),cancellation_reason=requested_payload->>'reason' where id=r.id;update public.reservation_table_assignments set active=false where reservation_id=r.id;insert into public.reservation_events(organization_id,establishment_id,reservation_id,customer_id,event_type,source,metadata)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'reservation_cancelled','portal',requested_payload);return jsonb_build_object('ok',true,'message','Reserva cancelada.');
 elsif requested_action='reschedule' then new_start=(requested_payload->>'starts_at')::timestamptz;duration=(extract(epoch from(r.ends_at-r.starts_at))/60)::integer;perform pg_advisory_xact_lock(hashtextextended(r.establishment_id::text||date_trunc('day',new_start)::text,0));update public.reservation_table_assignments set active=false where reservation_id=r.id;available:=public.get_reservation_availability(r.establishment_id,new_start,r.party_size,duration,null);if not coalesce((available->>'available')::boolean,false) then raise exception 'Novo horário indisponível.';end if;update public.reservations set starts_at=new_start,ends_at=new_start+make_interval(mins=>duration) where id=r.id;update public.reservation_table_assignments set occupied_period=tstzrange(new_start,new_start+make_interval(mins=>duration+settings.buffer_minutes),'[)'),active=true where reservation_id=r.id;insert into public.reservation_events(organization_id,establishment_id,reservation_id,customer_id,event_type,source,metadata)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'reservation_rescheduled','portal',requested_payload);return jsonb_build_object('ok',true,'message','Reserva reagendada.');else raise exception 'Ação inválida.';end if;exception when exclusion_violation then raise exception 'Novo horário em conflito.';end $$;

create or replace function public.join_portal_waitlist(requested_session_hash text,requested_slug text,requested_party_size integer,requested_notes text,requested_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;c public.customers%rowtype;begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;select * into c from public.customers where id=s.customer_id;if s.id is null or e.id is null then raise exception 'Sessão expirada.';end if;return public.join_waitlist(e.id,c.id,c.name,c.phone,requested_party_size,'portal',requested_notes,'normal',requested_idempotency_key);end $$;

create or replace function public.get_reservation_ai_context(requested_establishment_id uuid,requested_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare normalized text:=public.normalize_customer_phone(requested_phone);c public.customers%rowtype;begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;select * into c from public.customers where establishment_id=requested_establishment_id and public.normalize_customer_phone(phone)=normalized order by created_at desc limit 1;return jsonb_build_object('customer_id',c.id,'reservations',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'code',r.reservation_code,'starts_at',r.starts_at,'party_size',r.party_size,'status',r.status) order by r.starts_at desc),'[]') from public.reservations r where r.establishment_id=requested_establishment_id and r.customer_id=c.id),'waitlist',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'status',w.status,'party_size',w.party_size,'estimated_wait_minutes',w.estimated_wait_minutes,'position',(select count(*)+1 from public.waitlist_entries q where q.establishment_id=w.establishment_id and q.status in('waiting','notified','arrived') and q.joined_at<w.joined_at))),'[]') from public.waitlist_entries w where w.establishment_id=requested_establishment_id and w.customer_id=c.id and w.status in('waiting','notified','arrived')));end $$;

create or replace function public.begin_reservation_deposit_checkout(requested_session_hash text,requested_slug text,requested_reservation_id uuid,requested_provider text,requested_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;r public.reservations%rowtype;a public.payment_gateway_accounts%rowtype;i public.reservation_payment_intents%rowtype;begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;select * into r from public.reservations where id=requested_reservation_id and organization_id=s.organization_id and(customer_id=s.customer_id or organization_customer_id=s.organization_customer_id) for update;if r.id is null or r.deposit_cents<=0 or r.deposit_status<>'pending' or r.status<>'pending_payment' then raise exception 'Esta reserva não possui sinal pendente.';end if;select * into a from public.payment_gateway_accounts where establishment_id=r.establishment_id and provider=requested_provider and active and secret_id is not null order by updated_at desc limit 1;if a.id is null then raise exception 'Pagamento indisponível.';end if;insert into public.reservation_payment_intents(reservation_id,gateway_account_id,provider,amount_cents,idempotency_key,expires_at)values(r.id,a.id,a.provider,r.deposit_cents,requested_idempotency_key,now()+interval '60 minutes')on conflict(idempotency_key)do update set updated_at=now() returning * into i;update public.reservations set payment_transaction_id=i.id where id=r.id;return jsonb_build_object('intent_id',i.id,'reservation_id',r.id,'code',r.reservation_code,'amount_cents',r.deposit_cents,'customer_name',r.customer_name,'provider',a.provider,'environment',a.environment,'account_id',a.id,'existing_url',i.checkout_url,'store_slug',e.slug);end $$;

create or replace function public.record_reservation_deposit_checkout(requested_intent_id uuid,requested_external_id text,requested_checkout_url text)
returns void language plpgsql security definer set search_path='' as $$ begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;update public.reservation_payment_intents set external_id=requested_external_id,checkout_url=requested_checkout_url where id=requested_intent_id and status='pending';if not found then raise exception 'Cobrança inválida.';end if;end $$;

create or replace function public.process_reservation_deposit_event(requested_gateway_account_id uuid,requested_external_id text,requested_status text,requested_raw_status text,requested_amount_cents integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.reservation_payment_intents%rowtype;r public.reservations%rowtype;normalized text;begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Operação interna.';end if;normalized:=case when requested_status in('approved','paid') then 'approved' when requested_status in('declined','failed') then 'declined' when requested_status in('cancelled','canceled') then 'cancelled' when requested_status='refunded' then 'refunded' else 'pending' end;select * into i from public.reservation_payment_intents where gateway_account_id=requested_gateway_account_id and(external_id=requested_external_id or id::text=requested_external_id) for update;if i.id is null then raise exception 'Cobrança não encontrada.';end if;if requested_amount_cents<>i.amount_cents then raise exception 'Valor do sinal divergente.';end if;update public.reservation_payment_intents set status=normalized,raw_status=requested_raw_status,paid_at=case when normalized='approved' then coalesce(paid_at,now()) else paid_at end where id=i.id;select * into r from public.reservations where id=i.reservation_id for update;if normalized='approved' then update public.reservations set deposit_status='paid',status='confirmed',confirmed_at=coalesce(confirmed_at,now()) where id=r.id and deposit_status='pending';insert into public.reservation_events(organization_id,establishment_id,reservation_id,customer_id,event_type,source,metadata)values(r.organization_id,r.establishment_id,r.id,r.customer_id,'reservation_confirmed','payment',jsonb_build_object('intent_id',i.id,'provider',i.provider)) on conflict do nothing;elsif normalized in('declined','cancelled') then update public.reservations set deposit_status='failed' where id=r.id and deposit_status='pending';elsif normalized='refunded' then update public.reservations set deposit_status='refunded' where id=r.id;end if;return jsonb_build_object('ok',true,'reservation_id',r.id,'status',normalized);end $$;

revoke all on function private.reservation_has_permission(uuid,text) from public,anon,authenticated;
revoke all on function public.get_reservation_availability(uuid,timestamptz,integer,integer,uuid),public.save_dining_area(uuid,uuid,jsonb),public.save_reservation_table(uuid,uuid,jsonb),public.save_table_combination(uuid,text,uuid[],integer,integer),public.save_reservation_settings(uuid,jsonb),public.create_reservation(uuid,uuid,timestamptz,integer,integer,text,text,text,text,uuid[],text),public.reservation_action(uuid,uuid,text,jsonb),public.join_waitlist(uuid,uuid,text,text,integer,text,text,text,text),public.waitlist_action(uuid,uuid,text,uuid),public.get_reservation_dashboard(uuid,integer) from public,anon;
grant execute on function public.get_reservation_availability(uuid,timestamptz,integer,integer,uuid),public.save_dining_area(uuid,uuid,jsonb),public.save_reservation_table(uuid,uuid,jsonb),public.save_table_combination(uuid,text,uuid[],integer,integer),public.save_reservation_settings(uuid,jsonb),public.create_reservation(uuid,uuid,timestamptz,integer,integer,text,text,text,text,uuid[],text),public.reservation_action(uuid,uuid,text,jsonb),public.join_waitlist(uuid,uuid,text,text,integer,text,text,text,text),public.waitlist_action(uuid,uuid,text,uuid),public.get_reservation_dashboard(uuid,integer) to authenticated,service_role;
revoke all on function public.get_reservation_portal_context(text,text),public.create_portal_reservation(text,text,timestamptz,integer,integer,text,text),public.portal_reservation_action(text,text,uuid,text,jsonb),public.join_portal_waitlist(text,text,integer,text,text),public.get_reservation_ai_context(uuid,text) from public,anon,authenticated;
revoke all on function public.begin_reservation_deposit_checkout(text,text,uuid,text,text),public.record_reservation_deposit_checkout(uuid,text,text),public.process_reservation_deposit_event(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.get_reservation_portal_context(text,text),public.create_portal_reservation(text,text,timestamptz,integer,integer,text,text),public.portal_reservation_action(text,text,uuid,text,jsonb),public.join_portal_waitlist(text,text,integer,text,text),public.get_reservation_ai_context(uuid,text),public.begin_reservation_deposit_checkout(text,text,uuid,text,text),public.record_reservation_deposit_checkout(uuid,text,text),public.process_reservation_deposit_event(uuid,text,text,text,integer) to service_role;

do $$ begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='reservations') then alter publication supabase_realtime add table public.reservations;end if;if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='waitlist_entries') then alter publication supabase_realtime add table public.waitlist_entries;end if;end $$;
