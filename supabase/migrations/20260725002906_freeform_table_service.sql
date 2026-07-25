alter table public.restaurant_tables
  drop constraint if exists restaurant_tables_number_length;

alter table public.restaurant_tables
  add constraint restaurant_tables_number_length
  check (char_length(btrim(table_number)) between 1 and 40);

create or replace function private.resolve_operational_table(
  requested_establishment_id uuid,
  requested_table_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_label text := upper(btrim(regexp_replace(coalesce(requested_table_label, ''), '\s+', ' ', 'g')));
  resolved_table_id uuid;
begin
  if requested_establishment_id is null then
    raise exception 'Estabelecimento inválido.';
  end if;
  if char_length(normalized_label) < 1 or char_length(normalized_label) > 40 then
    raise exception 'Informe o número ou nome da mesa (até 40 caracteres).';
  end if;

  insert into public.restaurant_tables (
    establishment_id,
    table_number,
    is_active,
    status
  )
  values (
    requested_establishment_id,
    normalized_label,
    true,
    'free'
  )
  on conflict (establishment_id, table_number)
  do update set
    is_active = true,
    updated_at = now()
  returning id into resolved_table_id;

  return resolved_table_id;
end
$$;

revoke all on function private.resolve_operational_table(uuid, text)
from public, anon, authenticated;

create or replace function public.open_table_session_by_label(
  requested_table_label text,
  requested_customer_name text,
  requested_people_count integer default 1,
  requested_opening_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_establishment uuid;
  target_table_id uuid;
  target_table public.restaurant_tables%rowtype;
  new_session public.table_sessions%rowtype;
  normalized_customer_name text := btrim(regexp_replace(coalesce(requested_customer_name, ''), '\s+', ' ', 'g'));
begin
  if actor is null then
    raise exception 'Autenticação necessária.';
  end if;
  if normalized_customer_name !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+' or char_length(normalized_customer_name) > 120 then
    raise exception 'Informe o nome e sobrenome da pessoa responsável pela mesa.';
  end if;
  if requested_people_count is null or requested_people_count < 1 or requested_people_count > 99 then
    raise exception 'Quantidade de pessoas inválida.';
  end if;

  select em.establishment_id
  into target_establishment
  from public.establishment_members em
  where em.user_id = actor
    and em.role in ('owner','manager','attendant')
  limit 1;

  if target_establishment is null then
    raise exception 'Você não possui acesso a este estabelecimento.';
  end if;

  target_table_id := private.resolve_operational_table(
    target_establishment,
    requested_table_label
  );

  select *
  into target_table
  from public.restaurant_tables
  where id = target_table_id
  for update;

  if target_table.status <> 'free' or exists (
    select 1
    from public.table_sessions ts
    where ts.table_id = target_table.id
      and ts.status in ('open', 'awaiting_payment', 'paid')
  ) then
    raise exception 'Esta mesa já possui um atendimento aberto.';
  end if;

  insert into public.table_sessions (
    establishment_id,
    table_id,
    waiter_id,
    customer_name,
    people_count,
    opening_note
  )
  values (
    target_establishment,
    target_table.id,
    actor,
    normalized_customer_name,
    requested_people_count,
    nullif(btrim(requested_opening_note), '')
  )
  returning * into new_session;

  update public.restaurant_tables
  set status = 'awaiting_order',
      updated_at = now()
  where id = target_table.id;

  return to_jsonb(new_session);
end
$$;

revoke all on function public.open_table_session_by_label(text, text, integer, text)
from public, anon;
grant execute on function public.open_table_session_by_label(text, text, integer, text)
to authenticated;

create or replace function public.place_public_order(
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
  normalized_buyer_name text := btrim(regexp_replace(coalesce(buyer_name, ''), '\s+', ' ', 'g'));
  normalized_table_label text := upper(btrim(regexp_replace(coalesce(requested_table_number, ''), '\s+', ' ', 'g')));
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
  if char_length(normalized_buyer_name) < 2
    or char_length(normalized_buyer_name) > 120
    or char_length(regexp_replace(buyer_phone, '\D', '', 'g')) < 8
  then
    raise exception 'Informe corretamente o nome e o WhatsApp.';
  end if;
  if requested_fulfillment not in ('pickup', 'delivery', 'dine_in') then
    raise exception 'Forma de recebimento inválida.';
  end if;
  if requested_fulfillment = 'dine_in' and (
    normalized_buyer_name !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+'
    or char_length(normalized_table_label) < 1
    or char_length(normalized_table_label) > 40
  ) then
    raise exception 'Para consumir no local, informe nome e sobrenome e o número ou nome da mesa.';
  end if;
  if jsonb_typeof(requested_items) <> 'array'
    or jsonb_array_length(requested_items) < 1
    or jsonb_array_length(requested_items) > 50
  then
    raise exception 'Itens do pedido inválidos.';
  end if;

  select e.id, s.minimum_order_cents
  into target_establishment, minimum_total
  from public.establishments e
  join public.establishment_settings s on s.establishment_id = e.id
  join public.subscriptions sub on sub.establishment_id = e.id
  where e.slug = requested_slug
    and e.active
    and (
      sub.status in ('active', 'trialing')
      or sub.current_period_end > now()
    );

  if target_establishment is null then
    raise exception 'Estabelecimento indisponível.';
  end if;

  for item in select value from jsonb_array_elements(requested_items)
  loop
    item_quantity := least(greatest(coalesce((item ->> 'quantity')::integer, 1), 1), 20);
    select id, name, price_cents
    into product_record
    from public.products
    where id = (item ->> 'product_id')::uuid
      and establishment_id = target_establishment
      and active;
    if product_record.id is null then
      raise exception 'Produto indisponível.';
    end if;
    subtotal := subtotal + (product_record.price_cents * item_quantity);
  end loop;

  if subtotal < minimum_total then
    raise exception 'O pedido não atingiu o valor mínimo.';
  end if;

  if requested_fulfillment = 'dine_in' then
    target_table := private.resolve_operational_table(
      target_establishment,
      normalized_table_label
    );
  end if;

  insert into public.customers (
    establishment_id,
    name,
    phone,
    last_order_at
  )
  values (
    target_establishment,
    normalized_buyer_name,
    btrim(buyer_phone),
    now()
  )
  on conflict (establishment_id, phone)
  do update set
    name = excluded.name,
    last_order_at = now()
  returning id into customer_record;

  insert into public.orders (
    establishment_id,
    customer_id,
    fulfillment_type,
    customer_name,
    customer_phone,
    notes,
    subtotal_cents,
    total_cents,
    restaurant_table_id,
    source
  )
  values (
    target_establishment,
    customer_record,
    requested_fulfillment,
    normalized_buyer_name,
    btrim(buyer_phone),
    nullif(btrim(order_notes), ''),
    subtotal,
    subtotal,
    target_table,
    safe_source
  )
  returning id, order_number
  into created_order, created_number;

  for item in select value from jsonb_array_elements(requested_items)
  loop
    item_quantity := least(greatest(coalesce((item ->> 'quantity')::integer, 1), 1), 20);
    select id, name, price_cents
    into product_record
    from public.products
    where id = (item ->> 'product_id')::uuid
      and establishment_id = target_establishment
      and active;

    insert into public.order_items (
      establishment_id,
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price_cents,
      total_cents
    )
    values (
      target_establishment,
      created_order,
      product_record.id,
      product_record.name,
      item_quantity,
      product_record.price_cents,
      product_record.price_cents * item_quantity
    );
  end loop;

  update public.customers
  set total_orders = total_orders + 1,
      total_spent_cents = total_spent_cents + subtotal,
      last_order_at = now()
  where id = customer_record;

  return jsonb_build_object(
    'order_id', created_order,
    'order_number', created_number,
    'total_cents', subtotal,
    'table_number', nullif(normalized_table_label, '')
  );
end
$$;

revoke all on function public.place_public_order(
  text, text, text, text, jsonb, text, text, text
) from public;
grant execute on function public.place_public_order(
  text, text, text, text, jsonb, text, text, text
) to anon, authenticated;
