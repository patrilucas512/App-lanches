create type public.waiter_call_status as enum ('waiting', 'attended', 'canceled');

alter table public.establishment_settings
  add column if not exists waiter_calls_enabled boolean not null default false;

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_number text not null,
  table_name text,
  sector text,
  qr_code_url text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint restaurant_tables_number_length check (char_length(trim(table_number)) between 1 and 20),
  constraint restaurant_tables_name_length check (table_name is null or char_length(table_name) <= 80),
  constraint restaurant_tables_sector_length check (sector is null or char_length(sector) <= 80),
  unique (establishment_id, table_number)
);

create table public.qr_code_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  title text not null default 'Escaneie e veja o cardápio',
  subtitle text not null default 'Faça seu pedido pelo celular',
  footer_text text not null default 'Aponte a câmera do celular para o QR Code',
  primary_color text not null default '#6d2627',
  logo_url text,
  print_template text not null default 'simple',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint qr_settings_color_check check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint qr_settings_template_check check (print_template in ('simple', 'premium', 'counter')),
  constraint qr_settings_text_length check (
    char_length(title) between 2 and 100
    and char_length(subtitle) between 2 and 140
    and char_length(footer_text) between 2 and 180
  )
);

create table public.qr_code_scans (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_id uuid references public.restaurant_tables(id) on delete set null,
  scan_type text not null,
  source text not null default 'qr',
  user_agent text,
  created_at timestamp with time zone not null default now(),
  constraint qr_scans_type_check check (scan_type in ('general', 'table')),
  constraint qr_scans_source_check check (source in ('qr', 'print', 'counter', 'social', 'packaging'))
);

create table public.waiter_calls (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  status public.waiter_call_status not null default 'waiting',
  customer_note text,
  created_at timestamp with time zone not null default now(),
  attended_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint waiter_calls_note_length check (customer_note is null or char_length(customer_note) <= 300),
  constraint waiter_calls_attended_check check (
    (status = 'attended' and attended_at is not null)
    or status <> 'attended'
  )
);

alter table public.orders
  add column if not exists restaurant_table_id uuid references public.restaurant_tables(id) on delete set null,
  add column if not exists source text not null default 'direct';

alter table public.orders
  add constraint orders_source_check check (source in ('direct', 'qr'));

create index restaurant_tables_establishment_active_idx
  on public.restaurant_tables (establishment_id, is_active, table_number);
create index qr_code_scans_establishment_created_idx
  on public.qr_code_scans (establishment_id, created_at desc);
create index qr_code_scans_table_created_idx
  on public.qr_code_scans (table_id, created_at desc);
create index waiter_calls_establishment_status_created_idx
  on public.waiter_calls (establishment_id, status, created_at desc);
create index waiter_calls_table_idx on public.waiter_calls (table_id);
create index orders_restaurant_table_idx on public.orders (restaurant_table_id);
create index orders_establishment_source_created_idx
  on public.orders (establishment_id, source, created_at desc);

create trigger restaurant_tables_touch
before update on public.restaurant_tables
for each row execute function public.touch_updated_at();
create trigger qr_code_settings_touch
before update on public.qr_code_settings
for each row execute function public.touch_updated_at();
create trigger waiter_calls_touch
before update on public.waiter_calls
for each row execute function public.touch_updated_at();

alter table public.restaurant_tables enable row level security;
alter table public.qr_code_settings enable row level security;
alter table public.qr_code_scans enable row level security;
alter table public.waiter_calls enable row level security;

create policy restaurant_tables_member_select
on public.restaurant_tables for select to authenticated
using (private.has_role(establishment_id, null));
create policy restaurant_tables_manager_insert
on public.restaurant_tables for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy restaurant_tables_manager_update
on public.restaurant_tables for update to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy restaurant_tables_manager_delete
on public.restaurant_tables for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy qr_code_settings_member_select
on public.qr_code_settings for select to authenticated
using (private.has_role(establishment_id, null));
create policy qr_code_settings_manager_insert
on public.qr_code_settings for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy qr_code_settings_manager_update
on public.qr_code_settings for update to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy qr_code_scans_manager_select
on public.qr_code_scans for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy waiter_calls_member_select
on public.waiter_calls for select to authenticated
using (private.has_role(establishment_id, null));
create policy waiter_calls_member_update
on public.waiter_calls for update to authenticated
using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));

grant select, insert, update, delete on public.restaurant_tables to authenticated;
grant select, insert, update on public.qr_code_settings to authenticated;
grant select on public.qr_code_scans to authenticated;
grant select, update on public.waiter_calls to authenticated;

insert into public.qr_code_settings (establishment_id, primary_color, logo_url)
select e.id, e.accent_color, e.logo_url
from public.establishments e
on conflict (establishment_id) do nothing;

create or replace function public.record_qr_scan(
  requested_slug text,
  requested_table_number text default null,
  requested_source text default 'qr',
  requested_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_establishment uuid;
  target_table_id uuid;
  target_table_number text;
  target_table_name text;
  target_table_sector text;
  waiter_enabled boolean;
  normalized_number text := nullif(trim(requested_table_number), '');
  resolved_type text := case when nullif(trim(requested_table_number), '') is null then 'general' else 'table' end;
  safe_source text := case when requested_source in ('qr','print','counter','social','packaging') then requested_source else 'qr' end;
begin
  select e.id, s.waiter_calls_enabled
  into target_establishment, waiter_enabled
  from public.establishments e
  join public.establishment_settings s on s.establishment_id = e.id
  join public.subscriptions sub on sub.establishment_id = e.id
  where e.slug = requested_slug
    and e.active
    and e.onboarding_completed
    and (sub.status in ('active', 'trialing') or sub.current_period_end > now());

  if target_establishment is null then return null; end if;

  if normalized_number is not null then
    select rt.id, rt.table_number, rt.table_name, rt.sector
    into target_table_id, target_table_number, target_table_name, target_table_sector
    from public.restaurant_tables rt
    where rt.establishment_id = target_establishment
      and rt.table_number = normalized_number
      and rt.is_active;
    if target_table_id is null then return null; end if;
  end if;

  if not exists (
    select 1 from public.qr_code_scans scan
    where scan.establishment_id = target_establishment
      and scan.table_id is not distinct from target_table_id
      and scan.user_agent is not distinct from left(requested_user_agent, 500)
      and scan.created_at > now() - interval '30 seconds'
  ) then
    insert into public.qr_code_scans (
      establishment_id, table_id, scan_type, source, user_agent
    ) values (
      target_establishment, target_table_id, resolved_type, safe_source,
      nullif(left(requested_user_agent, 500), '')
    );
  end if;

  return jsonb_build_object(
    'table_id', target_table_id,
    'table_number', target_table_number,
    'table_name', target_table_name,
    'sector', target_table_sector,
    'waiter_calls_enabled', waiter_enabled
  );
end
$$;

revoke all on function public.record_qr_scan(text, text, text, text) from public;
grant execute on function public.record_qr_scan(text, text, text, text) to anon, authenticated;

create or replace function public.create_waiter_call(
  requested_slug text,
  requested_table_number text,
  requested_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_establishment uuid;
  target_table uuid;
  existing_call record;
  created_call uuid;
begin
  select e.id, rt.id
  into target_establishment, target_table
  from public.establishments e
  join public.establishment_settings s on s.establishment_id = e.id
  join public.subscriptions sub on sub.establishment_id = e.id
  join public.restaurant_tables rt on rt.establishment_id = e.id
  where e.slug = requested_slug
    and e.active
    and e.onboarding_completed
    and s.waiter_calls_enabled
    and rt.table_number = trim(requested_table_number)
    and rt.is_active
    and (sub.status in ('active', 'trialing') or sub.current_period_end > now());

  if target_table is null then raise exception 'table unavailable'; end if;
  if char_length(coalesce(requested_note, '')) > 300 then raise exception 'note too long'; end if;

  select wc.id, wc.created_at into existing_call
  from public.waiter_calls wc
  where wc.establishment_id = target_establishment
    and wc.table_id = target_table
    and wc.status = 'waiting'
    and wc.created_at > now() - interval '2 minutes'
  order by wc.created_at desc
  limit 1;

  if existing_call.id is not null then
    return jsonb_build_object('id', existing_call.id, 'created_at', existing_call.created_at, 'duplicate', true);
  end if;

  insert into public.waiter_calls (
    establishment_id, table_id, customer_note
  ) values (
    target_establishment, target_table, nullif(trim(requested_note), '')
  ) returning id into created_call;

  return jsonb_build_object('id', created_call, 'created_at', now(), 'duplicate', false);
end
$$;

revoke all on function public.create_waiter_call(text, text, text) from public;
grant execute on function public.create_waiter_call(text, text, text) to anon, authenticated;

drop function public.place_public_order(text, text, text, text, jsonb, text);

create function public.place_public_order(
  requested_slug text,
  buyer_name text,
  buyer_phone text,
  requested_fulfillment text,
  requested_items jsonb,
  order_notes text default null,
  requested_table_number text default null,
  requested_source text default 'direct'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_establishment uuid;
  target_table uuid;
  customer_record uuid;
  created_order uuid;
  created_number bigint;
  item jsonb;
  product_record record;
  item_quantity integer;
  subtotal integer := 0;
  minimum_total integer := 0;
  safe_source text := case when requested_source = 'qr' then 'qr' else 'direct' end;
begin
  if char_length(trim(buyer_name)) < 2 or char_length(regexp_replace(buyer_phone, '\D', '', 'g')) < 8 then
    raise exception 'invalid customer information';
  end if;
  if requested_fulfillment not in ('pickup', 'delivery', 'dine_in') then raise exception 'invalid fulfillment type'; end if;
  if jsonb_typeof(requested_items) <> 'array' or jsonb_array_length(requested_items) < 1 or jsonb_array_length(requested_items) > 50 then
    raise exception 'invalid order items';
  end if;

  select e.id, s.minimum_order_cents into target_establishment, minimum_total
  from public.establishments e
  join public.establishment_settings s on s.establishment_id = e.id
  join public.subscriptions sub on sub.establishment_id = e.id
  where e.slug = requested_slug and e.active
    and (sub.status in ('active', 'trialing') or sub.current_period_end > now());
  if target_establishment is null then raise exception 'store unavailable'; end if;

  if nullif(trim(requested_table_number), '') is not null then
    select rt.id into target_table
    from public.restaurant_tables rt
    where rt.establishment_id = target_establishment
      and rt.table_number = trim(requested_table_number)
      and rt.is_active;
    if target_table is null then raise exception 'table unavailable'; end if;
  end if;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item ->> 'quantity')::integer, 1), 1), 20);
    select id, name, price_cents into product_record
    from public.products
    where id = (item ->> 'product_id')::uuid and establishment_id = target_establishment and active;
    if product_record.id is null then raise exception 'product unavailable'; end if;
    subtotal := subtotal + (product_record.price_cents * item_quantity);
  end loop;
  if subtotal < minimum_total then raise exception 'minimum order value not reached'; end if;

  insert into public.customers (establishment_id, name, phone, last_order_at)
  values (target_establishment, trim(buyer_name), trim(buyer_phone), now())
  on conflict (establishment_id, phone) do update set name = excluded.name, last_order_at = now()
  returning id into customer_record;

  insert into public.orders (
    establishment_id, customer_id, fulfillment_type, customer_name, customer_phone,
    notes, subtotal_cents, total_cents, restaurant_table_id, source
  ) values (
    target_establishment, customer_record, requested_fulfillment, trim(buyer_name), trim(buyer_phone),
    nullif(trim(order_notes), ''), subtotal, subtotal, target_table, safe_source
  ) returning id, order_number into created_order, created_number;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item ->> 'quantity')::integer, 1), 1), 20);
    select id, name, price_cents into product_record
    from public.products
    where id = (item ->> 'product_id')::uuid and establishment_id = target_establishment and active;
    insert into public.order_items (
      establishment_id, order_id, product_id, product_name, quantity, unit_price_cents, total_cents
    ) values (
      target_establishment, created_order, product_record.id, product_record.name,
      item_quantity, product_record.price_cents, product_record.price_cents * item_quantity
    );
  end loop;

  update public.customers set
    total_orders = total_orders + 1,
    total_spent_cents = total_spent_cents + subtotal,
    last_order_at = now()
  where id = customer_record;

  return jsonb_build_object('order_id', created_order, 'order_number', created_number, 'total_cents', subtotal);
end
$$;

revoke all on function public.place_public_order(text, text, text, text, jsonb, text, text, text) from public;
grant execute on function public.place_public_order(text, text, text, text, jsonb, text, text, text) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'waiter_calls'
  ) then
    alter publication supabase_realtime add table public.waiter_calls;
  end if;
end
$$;
