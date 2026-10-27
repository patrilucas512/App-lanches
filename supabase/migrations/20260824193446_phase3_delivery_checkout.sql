create table if not exists public.delivery_settings (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references public.establishments(id) on delete cascade,
  fee_model text not null default 'fixed' check (fee_model in ('fixed','neighborhood')),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  free_delivery_above_cents integer check (free_delivery_above_cents is null or free_delivery_above_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.delivery_settings (
  establishment_id, fee_model, fixed_fee_cents, free_delivery_above_cents
)
select
  e.id,
  case when (select count(*) from public.delivery_zones z where z.establishment_id=e.id and z.active) > 1
    then 'neighborhood' else 'fixed' end,
  coalesce((select z.fee_cents from public.delivery_zones z where z.establishment_id=e.id and z.active order by z.id limit 1),0),
  (select z.free_delivery_above_cents from public.delivery_zones z where z.establishment_id=e.id and z.active order by z.id limit 1)
from public.establishments e
on conflict (establishment_id) do nothing;

create table if not exists public.delivery_destinations (
  delivery_order_id uuid primary key references public.orders(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  delivery_zone_id uuid references public.delivery_zones(id) on delete set null,
  recipient_name text not null check (char_length(btrim(recipient_name)) between 2 and 120),
  recipient_phone text not null check (char_length(recipient_phone) between 10 and 15),
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  street text not null check (char_length(btrim(street)) between 3 and 120),
  street_number text not null check (char_length(btrim(street_number)) between 1 and 20),
  complement text,
  neighborhood text not null check (char_length(btrim(neighborhood)) between 2 and 80),
  city text not null check (char_length(btrim(city)) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists delivery_destinations_establishment_idx
  on public.delivery_destinations(establishment_id, created_at desc);
create index if not exists delivery_destinations_zone_idx
  on public.delivery_destinations(delivery_zone_id) where delivery_zone_id is not null;

create trigger delivery_settings_touch before update on public.delivery_settings
for each row execute function public.touch_updated_at();

alter table public.delivery_settings enable row level security;
alter table public.delivery_destinations enable row level security;

drop policy if exists delivery_settings_admin_select on public.delivery_settings;
create policy delivery_settings_admin_select on public.delivery_settings
for select to authenticated using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);
drop policy if exists delivery_settings_admin_insert on public.delivery_settings;
create policy delivery_settings_admin_insert on public.delivery_settings
for insert to authenticated with check (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);
drop policy if exists delivery_settings_admin_update on public.delivery_settings;
create policy delivery_settings_admin_update on public.delivery_settings
for update to authenticated using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
) with check (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);
drop policy if exists delivery_settings_admin_delete on public.delivery_settings;
create policy delivery_settings_admin_delete on public.delivery_settings
for delete to authenticated using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);

drop policy if exists delivery_destinations_admin_select on public.delivery_destinations;
create policy delivery_destinations_admin_select on public.delivery_destinations
for select to authenticated using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);

revoke all on table public.delivery_settings, public.delivery_destinations from anon, authenticated;
grant select, insert, update, delete on table public.delivery_settings to authenticated;
grant select on table public.delivery_destinations to authenticated;

create or replace function private.normalize_delivery_area(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select regexp_replace(
    translate(lower(btrim(coalesce(value,''))),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'),
    '\s+', ' ', 'g'
  )
$$;

create or replace function private.resolve_public_delivery_quote(
  target_establishment uuid,
  requested_neighborhood text,
  requested_subtotal_cents integer
)
returns table (
  delivery_zone_id uuid,
  delivery_zone_name text,
  delivery_fee_cents integer,
  minimum_order_cents integer,
  estimated_minutes integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_settings public.delivery_settings%rowtype;
  saved_zone public.delivery_zones%rowtype;
  resolved_fee integer := 0;
  resolved_minimum integer := 0;
  resolved_free_above integer;
  resolved_estimate integer := 45;
begin
  select * into saved_settings
  from public.delivery_settings
  where establishment_id = target_establishment;

  if not found then
    raise exception 'A entrega ainda não foi configurada pelo estabelecimento.';
  end if;

  select estimated_minutes into resolved_estimate
  from public.establishment_settings
  where establishment_id = target_establishment;

  if saved_settings.fee_model = 'neighborhood' then
    select * into saved_zone
    from public.delivery_zones
    where establishment_id = target_establishment
      and active
      and private.normalize_delivery_area(name) = private.normalize_delivery_area(requested_neighborhood)
    order by id
    limit 1;

    if not found then
      raise exception 'Este bairro ainda não está na área de entrega do estabelecimento.';
    end if;

    resolved_fee := saved_zone.fee_cents;
    resolved_minimum := saved_zone.minimum_order_cents;
    resolved_free_above := coalesce(saved_zone.free_delivery_above_cents, saved_settings.free_delivery_above_cents);
    resolved_estimate := coalesce(saved_zone.estimated_minutes, resolved_estimate);
  else
    resolved_fee := saved_settings.fixed_fee_cents;
    resolved_free_above := saved_settings.free_delivery_above_cents;
  end if;

  if requested_subtotal_cents < resolved_minimum then
    raise exception 'O pedido mínimo para esta região é de R$ %.',
      trim(to_char(resolved_minimum / 100.0, 'FM999G999G990D00'));
  end if;

  if resolved_free_above is not null and requested_subtotal_cents >= resolved_free_above then
    resolved_fee := 0;
  end if;

  return query select
    saved_zone.id,
    saved_zone.name,
    resolved_fee,
    resolved_minimum,
    resolved_estimate;
end
$$;

create or replace function public.quote_public_delivery(
  requested_slug text,
  requested_neighborhood text,
  requested_subtotal_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_establishment uuid;
  quoted record;
begin
  if requested_subtotal_cents is null or requested_subtotal_cents < 0 or requested_subtotal_cents > 100000000 then
    raise exception 'Valor do pedido inválido.';
  end if;
  if char_length(btrim(coalesce(requested_neighborhood,''))) < 2 then
    raise exception 'Informe o bairro para calcular a entrega.';
  end if;

  select e.id into target_establishment
  from public.establishments e
  join public.service_modes sm on sm.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=lower(btrim(requested_slug))
    and e.active and sm.delivery_enabled and sm.store_open
    and (sub.status in ('active','trialing') or sub.current_period_end>now());

  if target_establishment is null then
    raise exception 'A entrega está indisponível no momento.';
  end if;

  select * into quoted
  from private.resolve_public_delivery_quote(
    target_establishment, requested_neighborhood, requested_subtotal_cents
  );

  return jsonb_build_object(
    'zone_id', quoted.delivery_zone_id,
    'zone_name', quoted.delivery_zone_name,
    'fee_cents', quoted.delivery_fee_cents,
    'minimum_order_cents', quoted.minimum_order_cents,
    'estimated_minutes', quoted.estimated_minutes,
    'total_cents', requested_subtotal_cents + quoted.delivery_fee_cents
  );
end
$$;

create or replace function public.place_public_order_v2(
  requested_slug text,
  buyer_name text,
  buyer_phone text,
  requested_fulfillment text,
  requested_items jsonb,
  order_notes text default null,
  requested_table_number text default null,
  requested_source text default 'direct',
  requested_payment text default null,
  requested_cash_received_cents integer default null,
  requested_delivery_address jsonb default null
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
  created_tracking_token uuid;
  normalized_buyer_name text := btrim(regexp_replace(coalesce(buyer_name,''),'\s+',' ','g'));
  normalized_phone text := regexp_replace(coalesce(buyer_phone,''),'\D','','g');
  normalized_table_label text := upper(btrim(regexp_replace(coalesce(requested_table_number,''),'\s+',' ','g')));
  item jsonb;
  product_record record;
  item_quantity integer;
  subtotal integer := 0;
  delivery_fee integer := 0;
  order_total integer := 0;
  item_addons jsonb;
  item_removed jsonb;
  item_note text;
  resolved_addons jsonb;
  addon_total integer;
  safe_source text := case when requested_source='qr' then 'qr' else 'direct' end;
  table_service_allowed boolean := false;
  pickup_allowed boolean := false;
  takeaway_allowed boolean := false;
  delivery_allowed boolean := false;
  store_is_open boolean := false;
  estimated integer := 45;
  quoted record;
  address_postal_code text;
  address_street text;
  address_number text;
  address_complement text;
  address_neighborhood text;
  address_city text;
  address_state text;
  address_reference text;
  address_recipient text;
begin
  if char_length(normalized_buyer_name)<2 or char_length(normalized_buyer_name)>120 then
    raise exception 'Informe corretamente o nome.';
  end if;
  if normalized_phone<>'' and char_length(normalized_phone)<10 then
    raise exception 'Confira o WhatsApp ou deixe o campo vazio.';
  end if;
  if requested_fulfillment not in ('pickup','takeaway','delivery','dine_in') then
    raise exception 'Forma de atendimento inválida.';
  end if;
  if requested_fulfillment='dine_in' and (
    normalized_buyer_name !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+'
    or char_length(normalized_table_label)<1 or char_length(normalized_table_label)>40
  ) then
    raise exception 'Para consumir no local, informe nome e sobrenome e o número ou nome da mesa.';
  end if;
  if jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items)<1 or jsonb_array_length(requested_items)>50 then
    raise exception 'Itens do pedido inválidos.';
  end if;

  select e.id, sm.table_service_enabled, sm.counter_pickup_enabled,
    sm.takeaway_enabled, sm.delivery_enabled, sm.store_open, s.estimated_minutes
  into target_establishment, table_service_allowed, pickup_allowed,
    takeaway_allowed, delivery_allowed, store_is_open, estimated
  from public.establishments e
  join public.establishment_settings s on s.establishment_id=e.id
  join public.service_modes sm on sm.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=lower(btrim(requested_slug)) and e.active
    and (sub.status in ('active','trialing') or sub.current_period_end>now());

  if target_establishment is null then raise exception 'Estabelecimento indisponível.'; end if;
  if not store_is_open then raise exception 'A loja está fechada no momento.'; end if;
  if requested_fulfillment='dine_in' and not table_service_allowed then raise exception 'Consumo no local indisponível.'; end if;
  if requested_fulfillment='pickup' and not pickup_allowed then raise exception 'Retirada indisponível.'; end if;
  if requested_fulfillment='takeaway' and not takeaway_allowed then raise exception 'Pedido para viagem indisponível.'; end if;
  if requested_fulfillment='delivery' and not delivery_allowed then raise exception 'Entrega indisponível.'; end if;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item->>'quantity')::integer,1),1),999);
    select id,name,price_cents,ingredients into product_record
    from public.products
    where id=(item->>'product_id')::uuid
      and establishment_id=target_establishment and active;
    if product_record.id is null then raise exception 'Produto indisponível.'; end if;
    resolved_addons := private.resolve_public_order_addons(
      target_establishment, product_record.id, coalesce(item->'addons','[]'::jsonb)
    );
    subtotal := subtotal + ((product_record.price_cents + (resolved_addons->>'total_cents')::integer) * item_quantity);
  end loop;

  if requested_fulfillment='delivery' then
    if jsonb_typeof(requested_delivery_address) is distinct from 'object' then
      raise exception 'Informe o endereço completo para a entrega.';
    end if;
    if char_length(normalized_phone)<10 then
      raise exception 'Informe um WhatsApp válido para a entrega.';
    end if;

    address_postal_code := regexp_replace(coalesce(requested_delivery_address->>'postal_code',''),'\D','','g');
    address_street := left(btrim(coalesce(requested_delivery_address->>'street','')),120);
    address_number := left(btrim(coalesce(requested_delivery_address->>'number','')),20);
    address_complement := left(nullif(btrim(requested_delivery_address->>'complement'),''),120);
    address_neighborhood := left(btrim(coalesce(requested_delivery_address->>'neighborhood','')),80);
    address_city := left(btrim(coalesce(requested_delivery_address->>'city','')),80);
    address_state := upper(left(btrim(coalesce(requested_delivery_address->>'state','')),2));
    address_reference := left(nullif(btrim(requested_delivery_address->>'reference'),''),160);
    address_recipient := left(coalesce(nullif(btrim(requested_delivery_address->>'recipient_name'),''),normalized_buyer_name),120);

    if address_postal_code !~ '^[0-9]{8}$'
      or char_length(address_street)<3 or char_length(address_number)<1
      or char_length(address_neighborhood)<2 or char_length(address_city)<2
      or address_state !~ '^[A-Z]{2}$' then
      raise exception 'Confira CEP, rua, número, bairro, cidade e estado.';
    end if;

    select * into quoted from private.resolve_public_delivery_quote(
      target_establishment, address_neighborhood, subtotal
    );
    delivery_fee := quoted.delivery_fee_cents;
    estimated := quoted.estimated_minutes;
  end if;

  order_total := subtotal + delivery_fee;
  if requested_payment='cash' and (
    requested_cash_received_cents is null or requested_cash_received_cents < order_total
  ) then
    raise exception 'O valor em dinheiro deve ser igual ou maior que o total da compra.';
  end if;
  if requested_payment is distinct from 'cash' then requested_cash_received_cents := null; end if;
  if requested_fulfillment='dine_in' then
    target_table := private.resolve_operational_table(target_establishment,normalized_table_label);
  end if;

  if normalized_phone<>'' then
    insert into public.customers(establishment_id,name,phone,last_order_at)
    values(target_establishment,normalized_buyer_name,normalized_phone,now())
    on conflict(establishment_id,phone) do update
      set name=excluded.name,last_order_at=now()
    returning id into customer_record;
  end if;

  insert into public.orders(
    establishment_id,customer_id,fulfillment_type,customer_name,customer_phone,
    delivery_address,notes,subtotal_cents,delivery_fee_cents,total_cents,
    restaurant_table_id,source,payment_method,cash_received_cents,cash_change_cents
  ) values (
    target_establishment,customer_record,requested_fulfillment,normalized_buyer_name,
    nullif(normalized_phone,''),
    case when requested_fulfillment='delivery' then jsonb_build_object(
      'neighborhood',address_neighborhood,'city',address_city,'state',address_state
    ) end,
    nullif(left(btrim(order_notes),500),''),subtotal,delivery_fee,order_total,target_table,
    safe_source,nullif(btrim(requested_payment),''),requested_cash_received_cents,
    case when requested_payment='cash' then requested_cash_received_cents-order_total end
  ) returning id,order_number,tracking_token
  into created_order,created_number,created_tracking_token;

  if requested_fulfillment='delivery' then
    insert into public.delivery_destinations(
      delivery_order_id,establishment_id,delivery_zone_id,recipient_name,recipient_phone,
      postal_code,street,street_number,complement,neighborhood,city,state,reference
    ) values (
      created_order,target_establishment,quoted.delivery_zone_id,address_recipient,normalized_phone,
      address_postal_code,address_street,address_number,address_complement,address_neighborhood,
      address_city,address_state,address_reference
    );
  end if;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item->>'quantity')::integer,1),1),999);
    select id,name,price_cents,ingredients into product_record
    from public.products
    where id=(item->>'product_id')::uuid
      and establishment_id=target_establishment and active;
    resolved_addons := private.resolve_public_order_addons(
      target_establishment, product_record.id, coalesce(item->'addons','[]'::jsonb)
    );
    item_addons := resolved_addons->'items';
    addon_total := (resolved_addons->>'total_cents')::integer;
    select coalesce(jsonb_agg(value),'[]'::jsonb) into item_removed
    from jsonb_array_elements(coalesce(item->'removed_ingredients','[]'::jsonb))
    where value in (select value from jsonb_array_elements(product_record.ingredients));
    item_note := left(nullif(btrim(item->>'notes'),''),300);
    insert into public.order_items(
      establishment_id,order_id,product_id,product_name,quantity,unit_price_cents,
      addons,removed_ingredients,notes,total_cents
    ) values (
      target_establishment,created_order,product_record.id,product_record.name,item_quantity,
      product_record.price_cents,item_addons,item_removed,item_note,
      (product_record.price_cents+addon_total)*item_quantity
    );
  end loop;

  insert into public.kitchen_tickets(establishment_id,public_order_id)
  values(target_establishment,created_order);

  if customer_record is not null then
    update public.customers
    set total_orders=total_orders+1,total_spent_cents=total_spent_cents+order_total,last_order_at=now()
    where id=customer_record;
  end if;

  return jsonb_build_object(
    'order_id',created_order,'order_number',created_number,
    'subtotal_cents',subtotal,'delivery_fee_cents',delivery_fee,'total_cents',order_total,
    'cash_received_cents',requested_cash_received_cents,
    'cash_change_cents',case when requested_payment='cash' then requested_cash_received_cents-order_total end,
    'table_number',nullif(normalized_table_label,''),'tracking_token',created_tracking_token,
    'estimated_minutes',estimated,'sent_to_kitchen',true
  );
end
$$;

revoke all on function public.quote_public_delivery(text,text,integer) from public, anon, authenticated;
grant execute on function public.quote_public_delivery(text,text,integer) to anon, authenticated;
revoke all on function public.place_public_order_v2(text,text,text,text,jsonb,text,text,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.place_public_order_v2(text,text,text,text,jsonb,text,text,text,text,integer,jsonb) to anon, authenticated;
revoke all on function private.normalize_delivery_area(text) from public, anon, authenticated;
revoke all on function private.resolve_public_delivery_quote(uuid,text,integer) from public, anon, authenticated;
