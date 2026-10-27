create index if not exists delivery_events_establishment_timeline_idx
  on public.delivery_events(establishment_id, occurred_at desc, id desc);

create index if not exists deliveries_establishment_delivered_idx
  on public.deliveries(establishment_id, delivered_at desc)
  where delivered_at is not null;

create or replace function public.get_delivery_operations_dashboard(
  requested_establishment_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  local_day_start timestamptz;
  result jsonb;
begin
  if actor is null then
    raise exception 'Autenticação necessária.';
  end if;
  if not private.has_role(
    requested_establishment_id,
    array['owner','manager']::public.member_role[]
  ) then
    raise exception 'Sem permissão para monitorar esta operação.';
  end if;

  local_day_start := date_trunc('day', now() at time zone 'America/Sao_Paulo')
    at time zone 'America/Sao_Paulo';

  select jsonb_build_object(
    'generated_at', now(),
    'stats', jsonb_build_object(
      'deliveries_today', count(*) filter (where delivery.created_at >= local_day_start),
      'preparing', count(*) filter (where delivery.status = 'pending'),
      'waiting_driver', count(*) filter (where delivery.status in ('ready_for_dispatch','searching_driver')),
      'collecting', count(*) filter (where delivery.status in ('driver_assigned','driver_to_pickup')),
      'on_route', count(*) filter (where delivery.status in ('picked_up','on_route','arrived')),
      'completed', count(*) filter (where delivery.status = 'delivered' and delivery.delivered_at >= local_day_start),
      'problems', count(*) filter (where delivery.status in ('failed','returning_to_store','returned_to_store'))
        + (select count(*) from public.delivery_incidents incident
           where incident.establishment_id = requested_establishment_id and incident.status = 'open'),
      'average_minutes', coalesce(round(avg(extract(epoch from (delivery.delivered_at - delivery.created_at)) / 60)
        filter (where delivery.delivered_at >= local_day_start), 0), 0),
      'delivery_fees_cents', coalesce(sum(delivery.customer_delivery_fee_cents)
        filter (where delivery.created_at >= local_day_start and delivery.status <> 'canceled'), 0)
    ),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'driver_profile_id', driver.id,
        'name', staff.name,
        'status', availability.status,
        'last_activity_at', greatest(availability.updated_at, availability.last_location_at, driver.last_access_at),
        'deliveries_today', (
          select count(*) from public.delivery_assignments assignment
          where assignment.driver_profile_id = driver.id
            and assignment.status = 'completed'
            and assignment.completed_at >= local_day_start
        ),
        'delivery_fees_cents', (
          select coalesce(sum(delivery_fee.customer_delivery_fee_cents), 0)
          from public.delivery_assignments assignment_fee
          join public.deliveries delivery_fee on delivery_fee.id = assignment_fee.delivery_id
          where assignment_fee.driver_profile_id = driver.id
            and assignment_fee.status = 'completed'
            and assignment_fee.completed_at >= local_day_start
        ),
        'location', case when location.id is null then null else jsonb_build_object(
          'latitude', location.latitude,
          'longitude', location.longitude,
          'accuracy_meters', location.accuracy_meters,
          'captured_at', location.captured_at,
          'received_at', location.received_at,
          'delivery_id', location.delivery_id
        ) end,
        'active_delivery', case when active_delivery.id is null then null else jsonb_build_object(
          'id', active_delivery.id,
          'status', active_delivery.status,
          'order_number', active_order.order_number,
          'customer_name', active_order.customer_name,
          'destination', active_order.delivery_address
        ) end
      ) order by
        case availability.status when 'delivering' then 1 when 'collecting' then 2 when 'offered' then 3
          when 'available' then 4 when 'paused' then 5 when 'offline' then 6 else 7 end,
        staff.name)
      from public.driver_profiles driver
      join public.custom_staff_members staff on staff.id = driver.custom_staff_member_id
      join public.driver_availability availability on availability.driver_profile_id = driver.id
      left join lateral (
        select point.* from public.driver_locations point
        where point.driver_profile_id = driver.id
        order by point.received_at desc limit 1
      ) location on true
      left join lateral (
        select delivery_record.*
        from public.delivery_assignments assignment_record
        join public.deliveries delivery_record on delivery_record.id = assignment_record.delivery_id
        where assignment_record.driver_profile_id = driver.id
          and assignment_record.status = 'accepted'
        order by assignment_record.accepted_at desc limit 1
      ) active_delivery on true
      left join public.orders active_order on active_order.id = active_delivery.order_id
      where driver.establishment_id = requested_establishment_id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(event_row.payload order by event_row.occurred_at desc, event_row.id desc)
      from (
        select event.id, event.occurred_at, jsonb_build_object(
          'id', event.id,
          'delivery_id', event.delivery_id,
          'order_number', order_record.order_number,
          'event_type', event.event_type,
          'from_status', event.from_status,
          'to_status', event.to_status,
          'actor_type', event.actor_type,
          'driver_name', staff.name,
          'occurred_at', event.occurred_at,
          'metadata', event.metadata
        ) payload
        from public.delivery_events event
        join public.deliveries delivery_record on delivery_record.id = event.delivery_id
        join public.orders order_record on order_record.id = delivery_record.order_id
        left join public.driver_profiles driver on driver.id = event.actor_driver_id
        left join public.custom_staff_members staff on staff.id = driver.custom_staff_member_id
        where event.establishment_id = requested_establishment_id
        order by event.occurred_at desc, event.id desc
        limit 40
      ) event_row
    ), '[]'::jsonb),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', incident.id,
        'delivery_id', incident.delivery_id,
        'order_number', order_record.order_number,
        'type', incident.incident_type,
        'description', incident.description,
        'status', incident.status,
        'driver_name', staff.name,
        'created_at', incident.created_at
      ) order by incident.created_at desc)
      from public.delivery_incidents incident
      join public.deliveries delivery_record on delivery_record.id = incident.delivery_id
      join public.orders order_record on order_record.id = delivery_record.order_id
      left join public.driver_profiles driver on driver.id = incident.driver_profile_id
      left join public.custom_staff_members staff on staff.id = driver.custom_staff_member_id
      where incident.establishment_id = requested_establishment_id
        and incident.status = 'open'
    ), '[]'::jsonb)
  ) into result
  from public.deliveries delivery
  where delivery.establishment_id = requested_establishment_id;

  return result;
end
$$;

revoke all on function public.get_delivery_operations_dashboard(uuid) from public, anon;
grant execute on function public.get_delivery_operations_dashboard(uuid) to authenticated;
