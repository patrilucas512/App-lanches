create type public.restaurant_table_status as enum (
  'free', 'occupied', 'awaiting_order', 'order_sent', 'preparing',
  'ready', 'awaiting_payment', 'paid', 'blocked'
);
create type public.table_session_status as enum (
  'open', 'awaiting_payment', 'paid', 'closed', 'canceled'
);
create type public.kitchen_ticket_status as enum (
  'received', 'preparing', 'ready', 'delivered', 'canceled'
);
create type public.table_payment_status as enum ('pending', 'confirmed', 'canceled');

alter table public.restaurant_tables
  add column status public.restaurant_table_status not null default 'free';

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete restrict,
  waiter_id uuid not null references auth.users(id) on delete restrict,
  customer_name text,
  people_count integer not null default 1 check (people_count between 1 and 99),
  opening_note text,
  status public.table_session_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  service_fee_cents integer not null default 0 check (service_fee_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  payment_status public.table_payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.table_orders (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  waiter_id uuid not null references auth.users(id) on delete restrict,
  kitchen_status public.kitchen_ticket_status not null default 'received',
  order_number bigint generated always as identity,
  notes text,
  sent_to_kitchen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, order_number)
);

create table public.table_order_items (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_order_id uuid not null references public.table_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  variations jsonb not null default '[]'::jsonb,
  addons jsonb not null default '[]'::jsonb,
  removed_ingredients jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create table public.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_order_id uuid not null unique references public.table_orders(id) on delete cascade,
  status public.kitchen_ticket_status not null default 'received',
  started_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.table_payments (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_session_id uuid not null references public.table_sessions(id) on delete restrict,
  payment_method text not null check (payment_method in ('pix', 'cash', 'credit_card', 'debit_card', 'mixed')),
  amount_cents integer not null check (amount_cents > 0),
  pix_payload text,
  pix_copy_paste text,
  receiver_name text,
  receiver_document_masked text,
  status public.table_payment_status not null default 'pending',
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.pix_settings (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references public.establishments(id) on delete cascade,
  pix_key_type text not null check (pix_key_type in ('cpf', 'cnpj', 'email', 'phone', 'random')),
  pix_key text not null check (length(btrim(pix_key)) > 0),
  receiver_name text not null check (length(btrim(receiver_name)) > 0),
  receiver_document_masked text,
  receiver_city text not null check (length(btrim(receiver_city)) > 0),
  institution_name text,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index table_sessions_one_active_per_table_idx
  on public.table_sessions (table_id)
  where status in ('open', 'awaiting_payment', 'paid');
create index table_sessions_establishment_status_idx
  on public.table_sessions (establishment_id, status, opened_at desc);
create index table_sessions_waiter_idx on public.table_sessions (waiter_id);
create index table_orders_session_idx on public.table_orders (table_session_id, created_at);
create index table_orders_establishment_status_idx
  on public.table_orders (establishment_id, kitchen_status, created_at);
create index table_orders_waiter_idx on public.table_orders (waiter_id);
create index table_order_items_order_idx on public.table_order_items (table_order_id);
create index table_order_items_product_idx on public.table_order_items (product_id);
create index kitchen_tickets_establishment_status_idx
  on public.kitchen_tickets (establishment_id, status, created_at);
create index table_payments_session_idx on public.table_payments (table_session_id, created_at);
create index table_payments_establishment_status_idx
  on public.table_payments (establishment_id, status, created_at);
create index table_payments_confirmed_by_idx on public.table_payments (confirmed_by);
create index pix_settings_updated_by_idx on public.pix_settings (updated_by);

alter table public.table_sessions enable row level security;
alter table public.table_orders enable row level security;
alter table public.table_order_items enable row level security;
alter table public.kitchen_tickets enable row level security;
alter table public.table_payments enable row level security;
alter table public.pix_settings enable row level security;

create policy table_sessions_operations_read on public.table_sessions
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy table_orders_operations_read on public.table_orders
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy table_order_items_operations_read on public.table_order_items
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy kitchen_tickets_operations_read on public.kitchen_tickets
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy table_payments_operations_read on public.table_payments
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy pix_settings_manager_read on public.pix_settings
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

revoke all on public.table_sessions, public.table_orders, public.table_order_items,
  public.kitchen_tickets, public.table_payments, public.pix_settings from anon, authenticated;
grant select on public.table_sessions, public.table_orders, public.table_order_items,
  public.kitchen_tickets, public.table_payments to authenticated;
grant select on public.pix_settings to authenticated;

create or replace function public.open_table_session(
  requested_table_id uuid,
  requested_customer_name text default null,
  requested_people_count integer default 1,
  requested_opening_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_table public.restaurant_tables%rowtype;
  new_session public.table_sessions%rowtype;
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if requested_people_count is null or requested_people_count < 1 or requested_people_count > 99 then
    raise exception 'Quantidade de pessoas inválida.';
  end if;

  select * into target_table
  from public.restaurant_tables
  where id = requested_table_id
  for update;

  if not found or not private.has_role(
    target_table.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then
    raise exception 'Mesa não encontrada.';
  end if;
  if not target_table.is_active or target_table.status <> 'free' then
    raise exception 'Esta mesa não está livre.';
  end if;

  insert into public.table_sessions (
    establishment_id, table_id, waiter_id, customer_name, people_count, opening_note
  ) values (
    target_table.establishment_id,
    target_table.id,
    actor,
    nullif(btrim(requested_customer_name), ''),
    requested_people_count,
    nullif(btrim(requested_opening_note), '')
  ) returning * into new_session;

  update public.restaurant_tables
  set status = 'awaiting_order', updated_at = now()
  where id = target_table.id;

  return to_jsonb(new_session);
end
$$;

create or replace function public.submit_table_order(
  requested_session_id uuid,
  requested_items jsonb,
  requested_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.table_sessions%rowtype;
  new_order public.table_orders%rowtype;
  new_ticket public.kitchen_tickets%rowtype;
  actor uuid := auth.uid();
  item jsonb;
  product_row public.products%rowtype;
  variation_row public.product_variations%rowtype;
  quantity_value integer;
  addon_ids uuid[];
  normalized_addons jsonb;
  normalized_variations jsonb;
  addons_cents integer;
  unit_cents integer;
  order_cents integer := 0;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if jsonb_typeof(requested_items) <> 'array'
    or jsonb_array_length(requested_items) < 1
    or jsonb_array_length(requested_items) > 50 then
    raise exception 'O pedido deve conter de 1 a 50 itens.';
  end if;

  select * into target_session
  from public.table_sessions
  where id = requested_session_id
  for update;

  if not found or not private.has_role(
    target_session.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then
    raise exception 'Conta da mesa não encontrada.';
  end if;
  if target_session.status <> 'open' then
    raise exception 'Esta conta não aceita novos pedidos.';
  end if;

  insert into public.table_orders (
    establishment_id, table_session_id, waiter_id, notes
  ) values (
    target_session.establishment_id, target_session.id, actor,
    nullif(btrim(requested_notes), '')
  ) returning * into new_order;

  for item in select value from jsonb_array_elements(requested_items)
  loop
    begin
      quantity_value := (item ->> 'quantity')::integer;
    exception when others then
      raise exception 'Quantidade inválida.';
    end;
    if quantity_value < 1 or quantity_value > 99 then
      raise exception 'Quantidade inválida.';
    end if;

    select * into product_row
    from public.products
    where id = (item ->> 'product_id')::uuid
      and establishment_id = target_session.establishment_id
      and active = true;
    if not found then raise exception 'Produto inválido ou indisponível.'; end if;

    variation_row := null;
    normalized_variations := '[]'::jsonb;
    if nullif(item ->> 'variation_id', '') is not null then
      select * into variation_row
      from public.product_variations
      where id = (item ->> 'variation_id')::uuid
        and establishment_id = target_session.establishment_id
        and product_id = product_row.id
        and active = true;
      if not found then raise exception 'Variação inválida.'; end if;
      normalized_variations := jsonb_build_array(jsonb_build_object(
        'id', variation_row.id, 'name', variation_row.name,
        'price_delta_cents', variation_row.price_delta_cents
      ));
    end if;

    addon_ids := coalesce(array(
      select value::uuid
      from jsonb_array_elements_text(coalesce(item -> 'addon_ids', '[]'::jsonb))
    ), array[]::uuid[]);
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'price_cents', a.price_cents
      ) order by a.sort_order), '[]'::jsonb),
      coalesce(sum(a.price_cents), 0)::integer
    into normalized_addons, addons_cents
    from public.addons a
    join public.product_addon_groups pag
      on pag.addon_group_id = a.addon_group_id
      and pag.product_id = product_row.id
      and pag.establishment_id = target_session.establishment_id
    where a.id = any(addon_ids)
      and a.establishment_id = target_session.establishment_id
      and a.active = true;

    unit_cents := product_row.price_cents
      + coalesce(variation_row.price_delta_cents, 0)
      + addons_cents;
    order_cents := order_cents + (unit_cents * quantity_value);

    insert into public.table_order_items (
      establishment_id, table_order_id, product_id, product_name,
      quantity, unit_price_cents, total_cents, variations, addons,
      removed_ingredients, notes
    ) values (
      target_session.establishment_id, new_order.id, product_row.id, product_row.name,
      quantity_value, unit_cents, unit_cents * quantity_value,
      normalized_variations, normalized_addons,
      case when jsonb_typeof(item -> 'removed_ingredients') = 'array'
        then item -> 'removed_ingredients' else '[]'::jsonb end,
      nullif(btrim(item ->> 'notes'), '')
    );
  end loop;

  insert into public.kitchen_tickets (establishment_id, table_order_id)
  values (target_session.establishment_id, new_order.id)
  returning * into new_ticket;

  update public.table_sessions
  set subtotal_cents = subtotal_cents + order_cents,
      total_cents = greatest(0, subtotal_cents + order_cents + service_fee_cents - discount_cents),
      updated_at = now()
  where id = target_session.id;

  update public.restaurant_tables
  set status = 'order_sent', updated_at = now()
  where id = target_session.table_id;

  return jsonb_build_object(
    'order', to_jsonb(new_order),
    'ticket', to_jsonb(new_ticket),
    'order_total_cents', order_cents
  );
end
$$;

create or replace function public.update_kitchen_ticket(
  requested_ticket_id uuid,
  requested_status public.kitchen_ticket_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.kitchen_tickets%rowtype;
  target_order public.table_orders%rowtype;
  target_session public.table_sessions%rowtype;
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into target_ticket from public.kitchen_tickets
  where id = requested_ticket_id for update;
  if not found or not private.has_role(
    target_ticket.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then raise exception 'Comanda não encontrada.'; end if;

  if requested_status = 'canceled' then
    if not private.has_role(target_ticket.establishment_id, array['owner','manager']::public.member_role[]) then
      raise exception 'Somente proprietário ou gerente pode cancelar.';
    end if;
  elsif not (
    (target_ticket.status = 'received' and requested_status = 'preparing') or
    (target_ticket.status = 'preparing' and requested_status = 'ready') or
    (target_ticket.status = 'ready' and requested_status = 'delivered')
  ) then
    raise exception 'Mudança de status inválida.';
  end if;

  update public.kitchen_tickets set
    status = requested_status,
    started_at = case when requested_status = 'preparing' then now() else started_at end,
    ready_at = case when requested_status = 'ready' then now() else ready_at end,
    delivered_at = case when requested_status = 'delivered' then now() else delivered_at end,
    updated_at = now()
  where id = requested_ticket_id returning * into target_ticket;

  update public.table_orders
  set kitchen_status = requested_status, updated_at = now()
  where id = target_ticket.table_order_id
  returning * into target_order;
  select * into target_session from public.table_sessions where id = target_order.table_session_id;

  update public.restaurant_tables
  set status = case requested_status
    when 'preparing' then 'preparing'::public.restaurant_table_status
    when 'ready' then 'ready'::public.restaurant_table_status
    else 'occupied'::public.restaurant_table_status
  end,
  updated_at = now()
  where id = target_session.table_id
    and status not in ('awaiting_payment', 'paid', 'blocked');

  return to_jsonb(target_ticket);
end
$$;

create or replace function public.request_table_closure(
  requested_session_id uuid,
  requested_service_percent integer default 0,
  requested_discount_cents integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.table_sessions%rowtype;
  actor uuid := auth.uid();
  fee_cents integer;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if requested_service_percent < 0 or requested_service_percent > 20 then
    raise exception 'A taxa de serviço deve ficar entre zero e vinte por cento.';
  end if;
  if requested_discount_cents < 0 then raise exception 'Desconto inválido.'; end if;

  select * into target_session from public.table_sessions
  where id = requested_session_id for update;
  if not found or not private.has_role(
    target_session.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then raise exception 'Conta da mesa não encontrada.'; end if;
  if target_session.status <> 'open' or target_session.subtotal_cents <= 0 then
    raise exception 'A conta não pode ser fechada agora.';
  end if;
  if requested_discount_cents > 0 and not private.has_role(
    target_session.establishment_id,
    array['owner','manager']::public.member_role[]
  ) then raise exception 'Somente proprietário ou gerente pode conceder desconto.'; end if;

  fee_cents := round(target_session.subtotal_cents * requested_service_percent / 100.0);
  update public.table_sessions set
    service_fee_cents = fee_cents,
    discount_cents = least(requested_discount_cents, subtotal_cents + fee_cents),
    total_cents = greatest(0, subtotal_cents + fee_cents - requested_discount_cents),
    status = 'awaiting_payment',
    updated_at = now()
  where id = target_session.id returning * into target_session;

  update public.restaurant_tables set status = 'awaiting_payment', updated_at = now()
  where id = target_session.table_id;
  return to_jsonb(target_session);
end
$$;

create or replace function public.get_table_pix_data(requested_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.table_sessions%rowtype;
  target_table public.restaurant_tables%rowtype;
  target_pix public.pix_settings%rowtype;
  target_establishment public.establishments%rowtype;
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into target_session from public.table_sessions where id = requested_session_id;
  if not found or not private.has_role(
    target_session.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then raise exception 'Conta da mesa não encontrada.'; end if;
  if target_session.status <> 'awaiting_payment' then
    raise exception 'A conta ainda não está aguardando pagamento.';
  end if;
  select * into target_pix from public.pix_settings
  where establishment_id = target_session.establishment_id;
  if not found then raise exception 'O Pix oficial ainda não foi configurado pelo responsável.'; end if;
  select * into target_table from public.restaurant_tables where id = target_session.table_id;
  select * into target_establishment from public.establishments where id = target_session.establishment_id;

  insert into public.audit_logs (
    establishment_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    target_session.establishment_id, actor, 'pix.generated', 'table_session', target_session.id,
    jsonb_build_object('table_id', target_session.table_id, 'amount_cents', target_session.total_cents)
  );

  return jsonb_build_object(
    'pix_key_type', target_pix.pix_key_type,
    'pix_key', target_pix.pix_key,
    'receiver_name', target_pix.receiver_name,
    'receiver_document_masked', target_pix.receiver_document_masked,
    'receiver_city', target_pix.receiver_city,
    'institution_name', target_pix.institution_name,
    'amount_cents', target_session.total_cents,
    'establishment_name', target_establishment.name,
    'table_number', target_table.table_number,
    'session_id', target_session.id
  );
end
$$;

create or replace function public.confirm_table_payment(
  requested_session_id uuid,
  requested_payment_method text,
  requested_pix_payload text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.table_sessions%rowtype;
  target_pix public.pix_settings%rowtype;
  new_payment public.table_payments%rowtype;
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if requested_payment_method not in ('pix', 'cash', 'credit_card', 'debit_card') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  select * into target_session from public.table_sessions
  where id = requested_session_id for update;
  if not found or not private.has_role(
    target_session.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then raise exception 'Conta da mesa não encontrada.'; end if;
  if target_session.status <> 'awaiting_payment' or target_session.payment_status = 'confirmed' then
    raise exception 'Esta conta não está disponível para confirmação.';
  end if;

  if requested_payment_method = 'pix' then
    select * into target_pix from public.pix_settings
    where establishment_id = target_session.establishment_id;
    if not found or nullif(btrim(requested_pix_payload), '') is null then
      raise exception 'Pix oficial não configurado ou código inválido.';
    end if;
  end if;

  insert into public.table_payments (
    establishment_id, table_session_id, payment_method, amount_cents,
    pix_payload, pix_copy_paste, receiver_name, receiver_document_masked,
    status, confirmed_by, confirmed_at
  ) values (
    target_session.establishment_id, target_session.id, requested_payment_method,
    target_session.total_cents,
    case when requested_payment_method = 'pix' then requested_pix_payload end,
    case when requested_payment_method = 'pix' then requested_pix_payload end,
    case when requested_payment_method = 'pix' then target_pix.receiver_name end,
    case when requested_payment_method = 'pix' then target_pix.receiver_document_masked end,
    'confirmed', actor, now()
  ) returning * into new_payment;

  update public.table_sessions set
    status = 'paid', payment_status = 'confirmed', updated_at = now()
  where id = target_session.id;
  update public.restaurant_tables set status = 'paid', updated_at = now()
  where id = target_session.table_id;

  return jsonb_build_object('payment', to_jsonb(new_payment), 'session', to_jsonb(target_session));
end
$$;

create or replace function public.release_table_session(requested_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.table_sessions%rowtype;
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into target_session from public.table_sessions
  where id = requested_session_id for update;
  if not found or not private.has_role(
    target_session.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then raise exception 'Conta da mesa não encontrada.'; end if;
  if target_session.status <> 'paid' or target_session.payment_status <> 'confirmed' then
    raise exception 'Confirme o pagamento antes de liberar a mesa.';
  end if;
  update public.table_sessions set status = 'closed', closed_at = now(), updated_at = now()
  where id = target_session.id returning * into target_session;
  update public.restaurant_tables set status = 'free', updated_at = now()
  where id = target_session.table_id;
  return to_jsonb(target_session);
end
$$;

create or replace function public.update_pix_settings(
  requested_establishment_id uuid,
  requested_key_type text,
  requested_key text,
  requested_receiver_name text,
  requested_receiver_document text,
  requested_receiver_city text,
  requested_institution_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  old_pix public.pix_settings%rowtype;
  saved_pix public.pix_settings%rowtype;
  digits text;
  masked_document text;
begin
  if actor is null or not private.has_role(
    requested_establishment_id,
    array['owner','manager']::public.member_role[]
  ) then raise exception 'Apenas proprietário ou gerente pode alterar o Pix.'; end if;
  if requested_key_type not in ('cpf', 'cnpj', 'email', 'phone', 'random') then
    raise exception 'Tipo de chave inválido.';
  end if;
  if nullif(btrim(requested_key), '') is null
    or nullif(btrim(requested_receiver_name), '') is null
    or nullif(btrim(requested_receiver_city), '') is null then
    raise exception 'Preencha chave, recebedor e cidade.';
  end if;

  digits := regexp_replace(coalesce(requested_receiver_document, ''), '\D', '', 'g');
  masked_document := case
    when length(digits) = 11 then '***.' || substr(digits, 4, 3) || '.' || substr(digits, 7, 3) || '-**'
    when length(digits) = 14 then '**.' || substr(digits, 3, 3) || '.' || substr(digits, 6, 3) || '/****-**'
    else null
  end;
  select * into old_pix from public.pix_settings
  where establishment_id = requested_establishment_id;

  insert into public.pix_settings (
    establishment_id, pix_key_type, pix_key, receiver_name,
    receiver_document_masked, receiver_city, institution_name, updated_by
  ) values (
    requested_establishment_id, requested_key_type, btrim(requested_key),
    btrim(requested_receiver_name), masked_document, upper(btrim(requested_receiver_city)),
    nullif(btrim(requested_institution_name), ''), actor
  )
  on conflict (establishment_id) do update set
    pix_key_type = excluded.pix_key_type,
    pix_key = excluded.pix_key,
    receiver_name = excluded.receiver_name,
    receiver_document_masked = excluded.receiver_document_masked,
    receiver_city = excluded.receiver_city,
    institution_name = excluded.institution_name,
    updated_by = actor,
    updated_at = now()
  returning * into saved_pix;

  insert into public.audit_logs (
    establishment_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    requested_establishment_id, actor,
    case when old_pix.id is null then 'pix.created' else 'pix.updated' end,
    'pix_settings', saved_pix.id,
    jsonb_build_object(
      'old_key_type', old_pix.pix_key_type,
      'new_key_type', saved_pix.pix_key_type,
      'old_key_last4', right(coalesce(old_pix.pix_key, ''), 4),
      'new_key_last4', right(saved_pix.pix_key, 4),
      'receiver_name', saved_pix.receiver_name
    )
  );
  return to_jsonb(saved_pix) - 'pix_key';
end
$$;

revoke all on function public.open_table_session(uuid, text, integer, text) from public, anon;
revoke all on function public.submit_table_order(uuid, jsonb, text) from public, anon;
revoke all on function public.update_kitchen_ticket(uuid, public.kitchen_ticket_status) from public, anon;
revoke all on function public.request_table_closure(uuid, integer, integer) from public, anon;
revoke all on function public.get_table_pix_data(uuid) from public, anon;
revoke all on function public.confirm_table_payment(uuid, text, text) from public, anon;
revoke all on function public.release_table_session(uuid) from public, anon;
revoke all on function public.update_pix_settings(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.open_table_session(uuid, text, integer, text) to authenticated;
grant execute on function public.submit_table_order(uuid, jsonb, text) to authenticated;
grant execute on function public.update_kitchen_ticket(uuid, public.kitchen_ticket_status) to authenticated;
grant execute on function public.request_table_closure(uuid, integer, integer) to authenticated;
grant execute on function public.get_table_pix_data(uuid) to authenticated;
grant execute on function public.confirm_table_payment(uuid, text, text) to authenticated;
grant execute on function public.release_table_session(uuid) to authenticated;
grant execute on function public.update_pix_settings(uuid, text, text, text, text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'restaurant_tables'
  ) then alter publication supabase_realtime add table public.restaurant_tables; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_sessions'
  ) then alter publication supabase_realtime add table public.table_sessions; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_orders'
  ) then alter publication supabase_realtime add table public.table_orders; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kitchen_tickets'
  ) then alter publication supabase_realtime add table public.kitchen_tickets; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_payments'
  ) then alter publication supabase_realtime add table public.table_payments; end if;
end
$$;
