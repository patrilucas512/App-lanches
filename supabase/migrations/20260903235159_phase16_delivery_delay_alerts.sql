alter table public.delivery_settings
  add column if not exists alert_kitchen_delay_minutes integer not null default 10,
  add column if not exists alert_waiting_driver_minutes integer not null default 10,
  add column if not exists alert_driver_stale_minutes integer not null default 8,
  add column if not exists alert_route_delay_minutes integer not null default 5;

alter table public.delivery_settings
  drop constraint if exists delivery_settings_alert_thresholds_check;
alter table public.delivery_settings
  add constraint delivery_settings_alert_thresholds_check check (
    alert_kitchen_delay_minutes between 3 and 180
    and alert_waiting_driver_minutes between 3 and 180
    and alert_driver_stale_minutes between 3 and 180
    and alert_route_delay_minutes between 3 and 180
  );

create table if not exists public.delivery_operational_alerts (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  alert_type text not null check (alert_type in ('kitchen_delayed','waiting_driver','driver_location_stale','route_delayed')),
  severity text not null check (severity in ('warning','critical')),
  title text not null check (char_length(title) between 3 and 120),
  message text not null check (char_length(message) between 3 and 300),
  age_minutes integer not null check (age_minutes >= 0),
  threshold_minutes integer not null check (threshold_minutes between 3 and 180),
  detection_data jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists delivery_operational_alerts_active_unique
  on public.delivery_operational_alerts(delivery_id, alert_type)
  where resolved_at is null;
create index if not exists delivery_operational_alerts_establishment_active_idx
  on public.delivery_operational_alerts(establishment_id, severity, last_detected_at desc)
  where resolved_at is null;

alter table public.delivery_operational_alerts enable row level security;
drop policy if exists delivery_operational_alerts_manager_read on public.delivery_operational_alerts;
create policy delivery_operational_alerts_manager_read on public.delivery_operational_alerts
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
revoke all on table public.delivery_operational_alerts from public, anon, authenticated;
grant select on table public.delivery_operational_alerts to authenticated;
grant select, insert, update on table public.delivery_operational_alerts to service_role;

create or replace function private.current_delivery_operational_alerts(target_establishment uuid)
returns table (
  delivery_id uuid,
  alert_type text,
  severity text,
  title text,
  message text,
  age_minutes integer,
  threshold_minutes integer,
  detection_data jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select
      coalesce(setting.alert_kitchen_delay_minutes, 10) kitchen_delay,
      coalesce(setting.alert_waiting_driver_minutes, 10) waiting_driver,
      coalesce(setting.alert_driver_stale_minutes, 8) driver_stale,
      coalesce(setting.alert_route_delay_minutes, 5) route_delay
    from (select target_establishment establishment_id) requested
    left join public.delivery_settings setting using (establishment_id)
  ), base as (
    select delivery.*, order_record.order_number, setting.*,
      greatest(
        setting.kitchen_delay,
        coalesce((delivery.eta_factors->>'preparation_minutes')::integer, 0)
          + coalesce((delivery.eta_factors->>'queue_minutes')::integer, 0)
      ) kitchen_threshold,
      assignment.driver_profile_id,
      coalesce(location.received_at, assignment.accepted_at, delivery.updated_at) location_reference
    from public.deliveries delivery
    join public.orders order_record on order_record.id = delivery.order_id
    cross join settings setting
    left join lateral (
      select candidate.driver_profile_id, candidate.accepted_at
      from public.delivery_assignments candidate
      where candidate.delivery_id = delivery.id and candidate.status = 'accepted'
      order by candidate.accepted_at desc nulls last
      limit 1
    ) assignment on true
    left join lateral (
      select point.received_at
      from public.driver_locations point
      where point.driver_profile_id = assignment.driver_profile_id
        and (point.delivery_id is null or point.delivery_id = delivery.id)
      order by point.received_at desc
      limit 1
    ) location on true
    where delivery.establishment_id = target_establishment
  ), candidates as (
    select base.id delivery_id, 'kitchen_delayed'::text alert_type,
      case when floor(extract(epoch from (now() - base.created_at)) / 60)::integer >= base.kitchen_threshold * 2 then 'critical' else 'warning' end severity,
      'Preparo acima da previsão'::text title,
      format('Pedido #%s está na cozinha há %s minutos.', base.order_number, floor(extract(epoch from (now() - base.created_at)) / 60)::integer) message,
      floor(extract(epoch from (now() - base.created_at)) / 60)::integer age_minutes,
      base.kitchen_threshold threshold_minutes,
      jsonb_build_object('status', base.status, 'order_number', base.order_number) detection_data
    from base
    where base.status = 'pending'
      and now() >= base.created_at + make_interval(mins => base.kitchen_threshold)

    union all

    select base.id, 'waiting_driver',
      case when floor(extract(epoch from (now() - coalesce(base.dispatch_started_at, base.ready_at, base.updated_at))) / 60)::integer >= base.waiting_driver * 2 then 'critical' else 'warning' end,
      'Pedido aguardando motoboy',
      format('Pedido #%s está aguardando motoboy há %s minutos.', base.order_number, floor(extract(epoch from (now() - coalesce(base.dispatch_started_at, base.ready_at, base.updated_at))) / 60)::integer),
      floor(extract(epoch from (now() - coalesce(base.dispatch_started_at, base.ready_at, base.updated_at))) / 60)::integer,
      base.waiting_driver,
      jsonb_build_object('status', base.status, 'order_number', base.order_number)
    from base
    where base.status in ('ready_for_dispatch','searching_driver')
      and now() >= coalesce(base.dispatch_started_at, base.ready_at, base.updated_at) + make_interval(mins => base.waiting_driver)

    union all

    select base.id, 'driver_location_stale',
      case when floor(extract(epoch from (now() - base.location_reference)) / 60)::integer >= base.driver_stale * 2 then 'critical' else 'warning' end,
      'Localização sem atualização',
      format('Pedido #%s está sem atualização de localização há %s minutos.', base.order_number, floor(extract(epoch from (now() - base.location_reference)) / 60)::integer),
      floor(extract(epoch from (now() - base.location_reference)) / 60)::integer,
      base.driver_stale,
      jsonb_build_object('status', base.status, 'order_number', base.order_number, 'driver_profile_id', base.driver_profile_id)
    from base
    where base.status in ('driver_assigned','driver_to_pickup','picked_up','on_route','arrived')
      and base.driver_profile_id is not null
      and now() >= base.location_reference + make_interval(mins => base.driver_stale)

    union all

    select base.id, 'route_delayed',
      case when floor(extract(epoch from (now() - base.estimated_arrival_at)) / 60)::integer >= base.route_delay * 2 then 'critical' else 'warning' end,
      'Rota acima da previsão',
      format('Pedido #%s ultrapassou a previsão de entrega em %s minutos.', base.order_number, floor(extract(epoch from (now() - base.estimated_arrival_at)) / 60)::integer),
      floor(extract(epoch from (now() - base.estimated_arrival_at)) / 60)::integer,
      base.route_delay,
      jsonb_build_object('status', base.status, 'order_number', base.order_number, 'estimated_arrival_at', base.estimated_arrival_at)
    from base
    where base.status in ('picked_up','on_route','arrived')
      and base.estimated_arrival_at is not null
      and now() >= base.estimated_arrival_at + make_interval(mins => base.route_delay)
  )
  select * from candidates
$$;
revoke all on function private.current_delivery_operational_alerts(uuid) from public, anon, authenticated;

create or replace function public.refresh_delivery_operational_alerts(requested_establishment_id uuid)
returns setof public.delivery_operational_alerts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_role(
    requested_establishment_id,
    array['owner','manager']::public.member_role[]
  ) then
    raise exception 'Sem permissão para consultar alertas operacionais.';
  end if;

  update public.delivery_operational_alerts existing
  set resolved_at = now(), last_detected_at = now()
  where existing.establishment_id = requested_establishment_id
    and existing.resolved_at is null
    and not exists (
      select 1
      from private.current_delivery_operational_alerts(requested_establishment_id) current_alert
      where current_alert.delivery_id = existing.delivery_id
        and current_alert.alert_type = existing.alert_type
    );

  insert into public.delivery_operational_alerts (
    establishment_id, delivery_id, alert_type, severity, title, message,
    age_minutes, threshold_minutes, detection_data
  )
  select requested_establishment_id, current_alert.delivery_id, current_alert.alert_type,
    current_alert.severity, current_alert.title, current_alert.message,
    current_alert.age_minutes, current_alert.threshold_minutes, current_alert.detection_data
  from private.current_delivery_operational_alerts(requested_establishment_id) current_alert
  on conflict (delivery_id, alert_type) where resolved_at is null
  do update set
    severity = excluded.severity,
    title = excluded.title,
    message = excluded.message,
    age_minutes = excluded.age_minutes,
    threshold_minutes = excluded.threshold_minutes,
    detection_data = excluded.detection_data,
    last_detected_at = now();

  return query
  select alert.*
  from public.delivery_operational_alerts alert
  where alert.establishment_id = requested_establishment_id
    and alert.resolved_at is null
  order by case alert.severity when 'critical' then 0 else 1 end,
    alert.age_minutes desc, alert.detected_at;
end
$$;
revoke all on function public.refresh_delivery_operational_alerts(uuid) from public, anon;
grant execute on function public.refresh_delivery_operational_alerts(uuid) to authenticated;

alter table public.delivery_push_notification_events
  add column if not exists alert_id uuid references public.delivery_operational_alerts(id) on delete cascade;
alter table public.delivery_push_notification_events
  drop constraint if exists delivery_push_notification_events_event_name_check;
alter table public.delivery_push_notification_events
  add constraint delivery_push_notification_events_event_name_check check (
    event_name in ('new_delivery_offer','driver_assigned','picked_up','on_route','driver_arrived','delivered','delivery_incident','delivery_delay_alert')
  );
drop index if exists public.delivery_push_events_dedupe_idx;
create unique index delivery_push_events_dedupe_idx
  on public.delivery_push_notification_events(
    delivery_id, event_name,
    coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(incident_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(alert_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create or replace function private.dispatch_delivery_delay_alert_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  select value into webhook_secret
  from private.app_secrets
  where name = 'push_webhook_secret';
  if webhook_secret is null then return new; end if;

  perform net.http_post(
    url := 'https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret',webhook_secret),
    body := jsonb_build_object('delivery_id',new.delivery_id,'alert_id',new.id,'event','delivery_delay_alert'),
    timeout_milliseconds := 5000
  );
  return new;
end
$$;
revoke all on function private.dispatch_delivery_delay_alert_push() from public, anon, authenticated;

drop trigger if exists delivery_operational_alert_push on public.delivery_operational_alerts;
create trigger delivery_operational_alert_push
  after insert on public.delivery_operational_alerts
  for each row execute function private.dispatch_delivery_delay_alert_push();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'delivery_operational_alerts'
  ) then
    alter publication supabase_realtime add table public.delivery_operational_alerts;
  end if;
end
$$;
