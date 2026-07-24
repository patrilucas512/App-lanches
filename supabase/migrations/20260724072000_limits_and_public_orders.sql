create or replace function private.enforce_product_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare allowed integer; current_count integer;
begin
  select p.max_products into allowed
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.establishment_id = new.establishment_id;
  if allowed is null then return new; end if;
  select count(*) into current_count from public.products where establishment_id = new.establishment_id;
  if current_count >= allowed then raise exception 'product limit reached for current plan'; end if;
  return new;
end
$$;

create trigger products_plan_limit before insert on public.products
for each row execute function private.enforce_product_limit();

create or replace function private.enforce_team_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare allowed integer; current_count integer;
begin
  if new.role = 'owner' and not exists (select 1 from public.subscriptions where establishment_id = new.establishment_id) then return new; end if;
  select p.max_team_members into allowed
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.establishment_id = new.establishment_id;
  if allowed is null then return new; end if;
  select count(*) into current_count from public.establishment_members where establishment_id = new.establishment_id;
  if current_count >= allowed then raise exception 'team member limit reached for current plan'; end if;
  return new;
end
$$;

create trigger members_plan_limit before insert on public.establishment_members
for each row execute function private.enforce_team_limit();

create or replace function public.place_public_order(
  requested_slug text,
  buyer_name text,
  buyer_phone text,
  requested_fulfillment text,
  requested_items jsonb,
  order_notes text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  target_establishment uuid;
  customer_record uuid;
  created_order uuid;
  created_number bigint;
  item jsonb;
  product_record record;
  item_quantity integer;
  subtotal integer := 0;
  minimum_total integer := 0;
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
    notes, subtotal_cents, total_cents
  ) values (
    target_establishment, customer_record, requested_fulfillment, trim(buyer_name), trim(buyer_phone),
    nullif(trim(order_notes), ''), subtotal, subtotal
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

revoke all on function public.place_public_order(text, text, text, text, jsonb, text) from public;
grant execute on function public.place_public_order(text, text, text, text, jsonb, text) to anon, authenticated;
