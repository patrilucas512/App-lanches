-- Keep the kitchen board aligned with the canonical completion records.
-- A delivery is only completed after the motoboy flow validates the customer PIN
-- (or an authorized administrative exception). Pickup and waiter flows already
-- complete the kitchen ticket directly; these triggers make that invariant
-- durable even if another trusted workflow completes the parent order first.

create or replace function private.sync_completed_public_order_to_kitchen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  driver_name text;
  completed_at timestamptz;
begin
  if new.status <> 'completed' or old.status is not distinct from new.status then
    return new;
  end if;

  if new.fulfillment_type = 'delivery' then
    select
      nullif(btrim(staff.name), ''),
      delivery.delivered_at
    into driver_name, completed_at
    from public.deliveries delivery
    left join public.driver_profiles driver
      on driver.id = delivery.delivered_driver_profile_id
    left join public.custom_staff_members staff
      on staff.id = driver.custom_staff_member_id
    where delivery.order_id = new.id
      and delivery.status = 'delivered';

    -- Never move a delivery out of "Prontos" before the secure delivery flow
    -- has actually recorded it as delivered.
    if completed_at is null then
      return new;
    end if;
  end if;

  update public.kitchen_tickets
  set
    status = 'delivered',
    delivered_at = coalesce(completed_at, now()),
    delivered_by_name = case
      when new.fulfillment_type = 'delivery'
        then coalesce('Motoboy · ' || driver_name, 'Entrega confirmada pelo motoboy')
      else coalesce(delivered_by_name, 'Retirada confirmada')
    end,
    updated_at = now()
  where public_order_id = new.id
    and status = 'ready';

  return new;
end;
$$;

revoke all on function private.sync_completed_public_order_to_kitchen()
  from public, anon, authenticated;

drop trigger if exists sync_completed_public_order_to_kitchen
  on public.orders;
create trigger sync_completed_public_order_to_kitchen
after update of status on public.orders
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function private.sync_completed_public_order_to_kitchen();

create or replace function private.sync_delivered_table_order_to_kitchen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  waiter_name text;
begin
  if new.kitchen_status <> 'delivered'
    or old.kitchen_status is not distinct from new.kitchen_status then
    return new;
  end if;

  select nullif(btrim(waiter.name), '')
  into waiter_name
  from public.waiters waiter
  where waiter.establishment_id = new.establishment_id
    and waiter.user_id = new.waiter_id
  limit 1;

  update public.kitchen_tickets
  set
    status = 'delivered',
    delivered_at = coalesce(delivered_at, now()),
    delivered_by = coalesce(delivered_by, new.waiter_id),
    delivered_by_name = coalesce(delivered_by_name, waiter_name, 'Retirado pelo garçom'),
    updated_at = now()
  where table_order_id = new.id
    and status = 'ready';

  return new;
end;
$$;

revoke all on function private.sync_delivered_table_order_to_kitchen()
  from public, anon, authenticated;

drop trigger if exists sync_delivered_table_order_to_kitchen
  on public.table_orders;
create trigger sync_delivered_table_order_to_kitchen
after update of kitchen_status on public.table_orders
for each row
when (new.kitchen_status = 'delivered' and old.kitchen_status is distinct from new.kitchen_status)
execute function private.sync_delivered_table_order_to_kitchen();

-- Recover historical tickets that were left in "Prontos" even though their
-- delivery or pickup had already been conclusively completed.
update public.kitchen_tickets ticket
set
  status = 'delivered',
  delivered_at = coalesce(source.delivered_at, source.order_updated_at, now()),
  delivered_by_name = case
    when source.fulfillment_type = 'delivery'
      then coalesce('Motoboy · ' || source.driver_name, 'Entrega confirmada pelo motoboy')
    else coalesce(ticket.delivered_by_name, 'Retirada confirmada')
  end,
  updated_at = now()
from (
  select
    orders.id as order_id,
    orders.fulfillment_type,
    orders.updated_at as order_updated_at,
    delivery.delivered_at,
    nullif(btrim(staff.name), '') as driver_name
  from public.orders orders
  left join public.deliveries delivery
    on delivery.order_id = orders.id
   and delivery.status = 'delivered'
  left join public.driver_profiles driver
    on driver.id = delivery.delivered_driver_profile_id
  left join public.custom_staff_members staff
    on staff.id = driver.custom_staff_member_id
  where orders.status = 'completed'
    and (orders.fulfillment_type <> 'delivery' or delivery.delivered_at is not null)
) source
where ticket.public_order_id = source.order_id
  and ticket.status = 'ready';

update public.kitchen_tickets ticket
set
  status = 'delivered',
  delivered_at = coalesce(ticket.delivered_at, table_order.updated_at, now()),
  delivered_by = coalesce(ticket.delivered_by, table_order.waiter_id),
  delivered_by_name = coalesce(ticket.delivered_by_name, waiter.name, 'Retirado pelo garçom'),
  updated_at = now()
from public.table_orders table_order
left join public.waiters waiter
  on waiter.establishment_id = table_order.establishment_id
 and waiter.user_id = table_order.waiter_id
where ticket.table_order_id = table_order.id
  and table_order.kitchen_status = 'delivered'
  and ticket.status = 'ready';
