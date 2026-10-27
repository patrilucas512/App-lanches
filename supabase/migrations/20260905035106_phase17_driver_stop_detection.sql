-- Optional, customer-confirmed destination; existing addresses remain valid.
alter table public.delivery_destinations
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_confirmed_at timestamptz,
  add constraint delivery_destination_coordinates_check check (
    (latitude is null and longitude is null and location_confirmed_at is null)
    or (latitude is not null and longitude is not null and location_confirmed_at is not null
      and latitude between -90 and 90 and longitude between -180 and 180)
  );
alter table public.delivery_settings
  add column if not exists alert_driver_stopped_minutes integer not null default 8
    check (alert_driver_stopped_minutes between 3 and 60);
alter table public.delivery_operational_alerts
  drop constraint delivery_operational_alerts_alert_type_check;
alter table public.delivery_operational_alerts
  add constraint delivery_operational_alerts_alert_type_check check (
    alert_type in ('kitchen_delayed','waiting_driver','driver_location_stale','route_delayed','driver_stopped')
  );

create or replace function public.confirm_delivery_destination_location(
  requested_tracking_token uuid, requested_latitude double precision, requested_longitude double precision
) returns boolean language plpgsql security definer set search_path = '' as $$
declare target_order uuid;
begin
  if requested_latitude is null or requested_longitude is null
    or requested_latitude not between -90 and 90 or requested_longitude not between -180 and 180 then
    raise exception 'Localização inválida.';
  end if;
  select o.id into target_order from public.orders o
  join public.deliveries d on d.order_id = o.id
  where o.tracking_token = requested_tracking_token
    and o.fulfillment_type = 'delivery' and d.status = 'pending'
    and o.created_at >= now() - interval '30 minutes'
  for update of d;
  if target_order is null then raise exception 'Pedido indisponível para confirmar localização.'; end if;
  update public.delivery_destinations set latitude = requested_latitude,
    longitude = requested_longitude, location_confirmed_at = now()
    where delivery_order_id = target_order;
  return found;
end $$;
revoke all on function public.confirm_delivery_destination_location(uuid,double precision,double precision) from public, anon, authenticated;
grant execute on function public.confirm_delivery_destination_location(uuid,double precision,double precision) to anon, authenticated;

-- Bounded GPS sample comparisons need no new extension or spatial data store.
create function private.delivery_distance_meters(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable strict set search_path = '' as $$
  select 12742000 * asin(sqrt(least(1.0, greatest(0.0,
    power(sin(radians(lat2-lat1)/2),2)
    + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)
  ))))
$$;
revoke all on function private.delivery_distance_meters(double precision,double precision,double precision,double precision) from public, anon, authenticated;

-- Keep Phase 16 calculations intact and compose the additional signal.
alter function private.current_delivery_operational_alerts(uuid) rename to phase16_delivery_operational_alerts;
create function private.current_delivery_operational_alerts(target_establishment uuid)
returns table (delivery_id uuid, alert_type text, severity text, title text, message text,
  age_minutes integer, threshold_minutes integer, detection_data jsonb)
language sql stable security invoker set search_path = '' as $$
  select * from private.phase16_delivery_operational_alerts(target_establishment)
  union all
  select d.id, 'driver_stopped'::text, 'warning'::text, 'Possível atraso'::text,
    format('Pedido #%s: GPS indica pouca movimentação há pelo menos %s minutos, longe do destino. Confira com o entregador.', o.order_number, cfg.minutes),
    cfg.minutes, cfg.minutes,
    jsonb_build_object('order_number',o.order_number,'driver_profile_id',a.driver_profile_id,
      'sample_count',samples.sample_count,'reason','stationary_away_from_destination')
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  join public.delivery_destinations dest on dest.delivery_order_id = d.order_id
    and dest.establishment_id = d.establishment_id and dest.location_confirmed_at is not null
  left join public.delivery_settings settings on settings.establishment_id = d.establishment_id
  cross join lateral (select coalesce(settings.alert_driver_stopped_minutes,8) minutes) cfg
  join public.delivery_assignments a on a.delivery_id = d.id and a.status = 'accepted'
  join lateral (
    select p.* from public.driver_locations p
    where p.driver_profile_id = a.driver_profile_id and p.establishment_id = d.establishment_id
      and p.delivery_id = d.id and p.captured_at >= greatest(d.picked_up_at,a.accepted_at)
    order by p.captured_at desc limit 1
  ) latest on latest.captured_at >= now() - interval '90 seconds'
    and latest.received_at >= now() - interval '90 seconds'
    and latest.accuracy_meters <= 50
  join lateral (
    select count(*) sample_count, min(points.captured_at) first_at,
      max(points.captured_at - points.previous_at) largest_gap,
      bool_and(points.accuracy_meters is not null and points.accuracy_meters <= 50
        and coalesce(points.speed_mps,0) <= 1.5
        and private.delivery_distance_meters(latest.latitude,latest.longitude,points.latitude,points.longitude) <= 75) stationary
    from (
      select p.*, lag(p.captured_at) over (order by p.captured_at) previous_at
      from public.driver_locations p
      where p.driver_profile_id = a.driver_profile_id and p.establishment_id = d.establishment_id
        and p.delivery_id = d.id
        and p.captured_at >= greatest(d.picked_up_at,a.accepted_at,latest.captured_at - make_interval(mins => cfg.minutes) - interval '90 seconds')
        and p.captured_at <= latest.captured_at
    ) points
  ) samples on samples.sample_count >= 4 and samples.stationary
    and samples.first_at <= latest.captured_at - make_interval(mins => cfg.minutes)
    and samples.largest_gap <= interval '90 seconds'
  where d.establishment_id = target_establishment and d.status in ('picked_up','on_route')
    and private.delivery_distance_meters(latest.latitude,latest.longitude,dest.latitude,dest.longitude) > 250
    -- A grouped driver may legitimately be at the other delivery's destination.
    and not exists (
      select 1 from public.delivery_assignments other_assignment
      join public.deliveries other_delivery on other_delivery.id = other_assignment.delivery_id
      left join public.delivery_destinations other_dest on other_dest.delivery_order_id = other_delivery.order_id
      where other_assignment.driver_profile_id = a.driver_profile_id and other_assignment.status = 'accepted'
        and other_assignment.delivery_id <> d.id
        and (other_dest.latitude is null or private.delivery_distance_meters(
          latest.latitude,latest.longitude,other_dest.latitude,other_dest.longitude) <= 250)
    )
$$;
revoke all on function private.current_delivery_operational_alerts(uuid) from public, anon, authenticated;

-- Prevent an alert refresh from writing identical rows and triggering itself
-- repeatedly through the existing Realtime subscription.
create function private.skip_unchanged_delivery_alert_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'last_detected_at') = (to_jsonb(old) - 'last_detected_at') then
    return null;
  end if;
  return new;
end $$;
revoke all on function private.skip_unchanged_delivery_alert_update() from public, anon, authenticated;
create trigger skip_unchanged_delivery_alert_update before update on public.delivery_operational_alerts
for each row execute function private.skip_unchanged_delivery_alert_update();
