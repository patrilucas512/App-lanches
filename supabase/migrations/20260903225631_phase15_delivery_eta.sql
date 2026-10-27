alter table public.delivery_zones
  add column if not exists distance_km numeric(6,2)
    check (distance_km is null or distance_km between 0.1 and 500);

alter table public.deliveries
  add column if not exists estimated_min_minutes integer,
  add column if not exists estimated_max_minutes integer,
  add column if not exists estimated_arrival_at timestamptz,
  add column if not exists eta_calculated_at timestamptz,
  add column if not exists eta_factors jsonb not null default '{}'::jsonb;

alter table public.deliveries
  drop constraint if exists deliveries_eta_range_check;
alter table public.deliveries
  add constraint deliveries_eta_range_check check (
    (estimated_min_minutes is null and estimated_max_minutes is null)
    or (
      estimated_min_minutes between 5 and 720
      and estimated_max_minutes between estimated_min_minutes and 720
    )
  );

-- Qualify every column in the existing quote resolver. The previous version used
-- an unqualified `estimated_minutes`, which conflicts with the output column name
-- in PL/pgSQL and can make public delivery quotes fail at runtime.
create or replace function private.resolve_public_delivery_quote(
  target_establishment uuid,
  requested_neighborhood text,
  requested_subtotal_cents integer
) returns table (
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
  select setting.* into saved_settings
  from public.delivery_settings setting
  where setting.establishment_id = target_establishment;

  if not found then
    raise exception 'A entrega ainda não foi configurada pelo estabelecimento.';
  end if;

  select setting.estimated_minutes into resolved_estimate
  from public.establishment_settings setting
  where setting.establishment_id = target_establishment;

  if saved_settings.fee_model = 'neighborhood' then
    select zone.* into saved_zone
    from public.delivery_zones zone
    where zone.establishment_id = target_establishment
      and zone.active
      and private.normalize_delivery_area(zone.name) = private.normalize_delivery_area(requested_neighborhood)
    order by zone.id
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

create or replace function private.calculate_delivery_eta(
  target_establishment uuid,
  target_zone uuid default null,
  target_delivery uuid default null
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  configured_total integer := 45;
  configured_distance numeric := null;
  kitchen_queue integer := 0;
  kitchen_capacity integer := 1;
  available_drivers integer := 0;
  active_drivers integer := 0;
  history_count integer := 0;
  historical_prep numeric := null;
  historical_dispatch numeric := null;
  historical_travel numeric := null;
  preparation_minutes integer;
  queue_minutes integer;
  dispatch_minutes integer;
  travel_minutes integer;
  operational_total integer;
  minimum_minutes integer;
  maximum_minutes integer;
begin
  select coalesce(zone.estimated_minutes, settings.estimated_minutes, 45), zone.distance_km
    into configured_total, configured_distance
  from public.establishment_settings settings
  left join public.delivery_zones zone
    on zone.id = target_zone and zone.establishment_id = settings.establishment_id
  where settings.establishment_id = target_establishment;

  configured_total := least(greatest(coalesce(configured_total, 45), 10), 360);

  select
    count(*) filter (where delivery.delivered_at is not null),
    avg(extract(epoch from (delivery.ready_at - delivery.created_at)) / 60)
      filter (where delivery.ready_at is not null and delivery.ready_at > delivery.created_at),
    avg(extract(epoch from (delivery.picked_up_at - delivery.ready_at)) / 60)
      filter (where delivery.picked_up_at is not null and delivery.ready_at is not null and delivery.picked_up_at > delivery.ready_at),
    avg(extract(epoch from (delivery.delivered_at - delivery.picked_up_at)) / 60)
      filter (where delivery.delivered_at is not null and delivery.picked_up_at is not null and delivery.delivered_at > delivery.picked_up_at)
  into history_count, historical_prep, historical_dispatch, historical_travel
  from public.deliveries delivery
  where delivery.establishment_id = target_establishment
    and delivery.created_at >= now() - interval '60 days'
    and delivery.status = 'delivered';

  select count(*) into kitchen_queue
  from public.kitchen_tickets ticket
  join public.orders order_record on order_record.id = ticket.public_order_id
  where ticket.establishment_id = target_establishment
    and order_record.fulfillment_type = 'delivery'
    and ticket.status in ('received', 'preparing')
    and (target_delivery is null or not exists (
      select 1 from public.deliveries current_delivery
      where current_delivery.id = target_delivery
        and current_delivery.order_id = order_record.id
    ));

  select greatest(count(*), 1) into kitchen_capacity
  from public.kitchen_operators operator
  where operator.establishment_id = target_establishment
    and operator.status = 'active'
    and (operator.access_type <> 'daily' or operator.work_date = (now() at time zone 'America/Sao_Paulo')::date);

  select
    count(*) filter (where availability.status = 'available'),
    count(*) filter (where availability.status in ('available','offered','collecting','delivering'))
  into available_drivers, active_drivers
  from public.driver_availability availability
  join public.driver_profiles driver on driver.id = availability.driver_profile_id
  where availability.establishment_id = target_establishment
    and driver.active and driver.approval_status = 'approved';

  preparation_minutes := case
    when history_count >= 5 and historical_prep is not null
      then least(greatest(round(historical_prep)::integer, 8), 120)
    else greatest(10, round(configured_total * 0.55)::integer)
  end;
  queue_minutes := least(45, ceil(greatest(kitchen_queue - kitchen_capacity, 0)::numeric / kitchen_capacity)::integer * 4);
  dispatch_minutes := case
    when available_drivers > 0 then 2
    when active_drivers > 0 then 8
    else 15
  end;
  if history_count >= 5 and historical_dispatch is not null then
    dispatch_minutes := greatest(dispatch_minutes, least(round(historical_dispatch)::integer, 45));
  end if;

  travel_minutes := case
    when configured_distance is not null and history_count >= 5 and historical_travel is not null
      then round((least(greatest(historical_travel, 5), 120) * 0.6) + (least(greatest(configured_distance * 3, 5), 120) * 0.4))::integer
    when configured_distance is not null
      then least(greatest(ceil(configured_distance * 3)::integer, 5), 120)
    when history_count >= 5 and historical_travel is not null
      then least(greatest(round(historical_travel)::integer, 5), 120)
    else greatest(8, configured_total - greatest(10, round(configured_total * 0.55)::integer))
  end;

  operational_total := preparation_minutes + queue_minutes + dispatch_minutes + travel_minutes;
  minimum_minutes := greatest(10, round(greatest(configured_total, operational_total) * 0.9)::integer);
  maximum_minutes := least(720, greatest(
    minimum_minutes + 8,
    ceil(greatest(configured_total, operational_total) * 1.18)::integer
  ));

  return jsonb_build_object(
    'minimum_minutes', minimum_minutes,
    'maximum_minutes', maximum_minutes,
    'midpoint_minutes', round((minimum_minutes + maximum_minutes) / 2.0)::integer,
    'factors', jsonb_build_object(
      'configured_minutes', configured_total,
      'distance_km', configured_distance,
      'kitchen_queue', kitchen_queue,
      'kitchen_capacity', kitchen_capacity,
      'available_drivers', available_drivers,
      'preparation_minutes', preparation_minutes,
      'queue_minutes', queue_minutes,
      'dispatch_minutes', dispatch_minutes,
      'travel_minutes', travel_minutes,
      'historical_deliveries', history_count
    )
  );
end
$$;

create or replace function private.assign_delivery_eta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  estimate jsonb;
begin
  estimate := private.calculate_delivery_eta(new.establishment_id, null, new.id);
  new.estimated_min_minutes := (estimate->>'minimum_minutes')::integer;
  new.estimated_max_minutes := (estimate->>'maximum_minutes')::integer;
  new.estimated_arrival_at := new.created_at + make_interval(mins => (estimate->>'maximum_minutes')::integer);
  new.eta_calculated_at := now();
  new.eta_factors := estimate->'factors';
  return new;
end
$$;

drop trigger if exists deliveries_assign_eta on public.deliveries;
create trigger deliveries_assign_eta
before insert on public.deliveries
for each row execute function private.assign_delivery_eta();

create or replace function private.refresh_delivery_eta_from_destination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_record public.deliveries%rowtype;
  estimate jsonb;
begin
  select * into delivery_record
  from public.deliveries
  where order_id = new.delivery_order_id
  for update;
  if delivery_record.id is null then return new; end if;

  estimate := private.calculate_delivery_eta(
    delivery_record.establishment_id,
    new.delivery_zone_id,
    delivery_record.id
  );
  update public.deliveries set
    estimated_min_minutes = (estimate->>'minimum_minutes')::integer,
    estimated_max_minutes = (estimate->>'maximum_minutes')::integer,
    estimated_arrival_at = delivery_record.created_at + make_interval(mins => (estimate->>'maximum_minutes')::integer),
    eta_calculated_at = now(),
    eta_factors = estimate->'factors'
  where id = delivery_record.id;
  return new;
end
$$;

drop trigger if exists delivery_destinations_refresh_eta on public.delivery_destinations;
create trigger delivery_destinations_refresh_eta
after insert or update of delivery_zone_id on public.delivery_destinations
for each row execute function private.refresh_delivery_eta_from_destination();

do $$
declare
  delivery_record record;
  estimate jsonb;
begin
  for delivery_record in
    select delivery.id, delivery.establishment_id, delivery.created_at, destination.delivery_zone_id
    from public.deliveries delivery
    left join public.delivery_destinations destination on destination.delivery_order_id = delivery.order_id
    where delivery.estimated_min_minutes is null or delivery.estimated_max_minutes is null
  loop
    estimate := private.calculate_delivery_eta(
      delivery_record.establishment_id,
      delivery_record.delivery_zone_id,
      delivery_record.id
    );
    update public.deliveries set
      estimated_min_minutes = (estimate->>'minimum_minutes')::integer,
      estimated_max_minutes = (estimate->>'maximum_minutes')::integer,
      estimated_arrival_at = delivery_record.created_at + make_interval(mins => (estimate->>'maximum_minutes')::integer),
      eta_calculated_at = now(),
      eta_factors = estimate->'factors'
    where id = delivery_record.id;
  end loop;
end
$$;

create or replace function public.quote_public_delivery(
  requested_slug text,
  requested_neighborhood text,
  requested_subtotal_cents integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_establishment uuid;
  quoted record;
  estimate jsonb;
begin
  if requested_subtotal_cents is null or requested_subtotal_cents < 0 or requested_subtotal_cents > 100000000 then
    raise exception 'Valor do pedido inválido.';
  end if;
  if char_length(btrim(coalesce(requested_neighborhood,''))) < 2 then
    raise exception 'Informe o bairro para calcular a entrega.';
  end if;

  select establishment.id into target_establishment
  from public.establishments establishment
  join public.service_modes service on service.establishment_id = establishment.id
  join public.subscriptions subscription on subscription.establishment_id = establishment.id
  where establishment.slug = lower(btrim(requested_slug))
    and establishment.active and service.delivery_enabled and service.store_open
    and (subscription.status in ('active','trialing') or subscription.current_period_end > now());

  if target_establishment is null then
    raise exception 'A entrega está indisponível no momento.';
  end if;

  select * into quoted
  from private.resolve_public_delivery_quote(
    target_establishment, requested_neighborhood, requested_subtotal_cents
  );
  estimate := private.calculate_delivery_eta(target_establishment, quoted.delivery_zone_id, null);

  return jsonb_build_object(
    'zone_id', quoted.delivery_zone_id,
    'zone_name', quoted.delivery_zone_name,
    'fee_cents', quoted.delivery_fee_cents,
    'minimum_order_cents', quoted.minimum_order_cents,
    'estimated_minutes', (estimate->>'midpoint_minutes')::integer,
    'estimated_min_minutes', (estimate->>'minimum_minutes')::integer,
    'estimated_max_minutes', (estimate->>'maximum_minutes')::integer,
    'total_cents', requested_subtotal_cents + quoted.delivery_fee_cents
  );
end
$$;

create or replace function public.get_public_order_status(requested_tracking_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'order_number', order_record.order_number,
    'status', order_record.status,
    'fulfillment_type', order_record.fulfillment_type,
    'created_at', order_record.created_at,
    'updated_at', order_record.updated_at,
    'estimated_minutes', coalesce(delivery.estimated_max_minutes, settings.estimated_minutes),
    'estimated_min_minutes', coalesce(delivery.estimated_min_minutes, settings.estimated_minutes),
    'estimated_max_minutes', coalesce(delivery.estimated_max_minutes, settings.estimated_minutes),
    'estimated_arrival_at', delivery.estimated_arrival_at,
    'table_number', restaurant_table.table_number,
    'payment_method', order_record.payment_method,
    'online_payment_status', order_record.online_payment_status,
    'kitchen_status', kitchen_ticket.status,
    'started_at', kitchen_ticket.started_at,
    'ready_at', kitchen_ticket.ready_at,
    'delivered_at', coalesce(delivery.delivered_at, kitchen_ticket.delivered_at),
    'delivery_status', delivery.status,
    'delivery_confirmation', case
      when delivery.status = 'delivered' and delivery.delivery_confirmation_method = 'pin' then 'pin'
      when delivery.status = 'delivered' then 'assisted'
      else null
    end,
    'delivery_pin', case
      when delivery.delivery_pin_required and delivery.status in ('on_route','arrived')
        then private.delivery_pin_for_token(order_record.tracking_token, delivery.id)
      else null
    end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', order_item.id,
        'product_name', order_item.product_name,
        'quantity', order_item.quantity,
        'addons', order_item.addons,
        'removed_ingredients', order_item.removed_ingredients
      ) order by order_item.id)
      from public.order_items order_item where order_item.order_id = order_record.id
    ), '[]'::jsonb)
  )
  from public.orders order_record
  join public.establishment_settings settings on settings.establishment_id = order_record.establishment_id
  left join public.restaurant_tables restaurant_table on restaurant_table.id = order_record.restaurant_table_id
  left join public.kitchen_tickets kitchen_ticket on kitchen_ticket.public_order_id = order_record.id
  left join public.deliveries delivery on delivery.order_id = order_record.id
  where order_record.tracking_token = requested_tracking_token
$$;

revoke all on function private.calculate_delivery_eta(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function private.assign_delivery_eta() from public, anon, authenticated;
revoke all on function private.refresh_delivery_eta_from_destination() from public, anon, authenticated;
revoke all on function public.quote_public_delivery(text,text,integer) from public, anon, authenticated;
revoke all on function public.get_public_order_status(uuid) from public, anon, authenticated;
grant execute on function public.quote_public_delivery(text,text,integer) to anon, authenticated;
grant execute on function public.get_public_order_status(uuid) to anon, authenticated;
