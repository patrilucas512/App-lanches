create table public.driver_locations (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  driver_profile_id uuid not null,
  delivery_id uuid,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters between 0 and 5000),
  heading_degrees double precision check (heading_degrees is null or heading_degrees between 0 and 360),
  speed_mps double precision check (speed_mps is null or speed_mps between 0 and 120),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null default 'browser' check (source in ('browser','native','network')),
  session_id uuid not null,
  constraint driver_locations_driver_tenant_fk
    foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete cascade,
  constraint driver_locations_delivery_tenant_fk
    foreign key (delivery_id, establishment_id)
    references public.deliveries(id, establishment_id) on delete cascade
);

create index driver_locations_driver_timeline_idx
  on public.driver_locations(driver_profile_id, captured_at desc);
create index driver_locations_delivery_timeline_idx
  on public.driver_locations(delivery_id, captured_at desc)
  where delivery_id is not null;
create index driver_locations_retention_idx
  on public.driver_locations(received_at);

alter table public.driver_locations enable row level security;
create policy driver_locations_admin_read on public.driver_locations for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

revoke all on table public.driver_locations from anon, authenticated;
grant select on table public.driver_locations to authenticated;

create or replace function public.update_driver_location(
  requested_latitude double precision,
  requested_longitude double precision,
  requested_accuracy_meters double precision,
  requested_heading_degrees double precision,
  requested_speed_mps double precision,
  requested_captured_at timestamptz,
  requested_session_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype;
  delivery public.deliveries%rowtype;
  last_received timestamptz;
  location_id bigint;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if requested_latitude not between -90 and 90 or requested_longitude not between -180 and 180 then
    raise exception 'Coordenadas inválidas.';
  end if;
  if requested_accuracy_meters is not null and requested_accuracy_meters not between 0 and 5000 then
    raise exception 'Precisão de localização inválida.';
  end if;
  if requested_captured_at < now() - interval '10 minutes' or requested_captured_at > now() + interval '1 minute' then
    raise exception 'Horário da localização inválido.';
  end if;

  select * into driver from public.driver_profiles
  where user_id = actor and active and approval_status = 'approved';
  if driver.id is null then raise exception 'Perfil de motoboy não autorizado.'; end if;

  select * into assignment from public.delivery_assignments
  where driver_profile_id = driver.id and status = 'accepted'
  order by accepted_at desc limit 1;
  if assignment.id is null then raise exception 'Nenhuma entrega ativa para compartilhar localização.'; end if;

  select * into delivery from public.deliveries where id = assignment.delivery_id;
  if delivery.status not in ('driver_to_pickup','picked_up','on_route','arrived','returning_to_store') then
    raise exception 'A entrega não está em uma etapa que permita localização.';
  end if;

  select received_at into last_received from public.driver_locations
  where driver_profile_id = driver.id order by received_at desc limit 1;
  if last_received is not null and last_received > now() - interval '8 seconds' then
    return jsonb_build_object('accepted',false,'reason','throttled','next_after',last_received + interval '8 seconds');
  end if;

  insert into public.driver_locations(
    establishment_id,driver_profile_id,delivery_id,latitude,longitude,accuracy_meters,
    heading_degrees,speed_mps,captured_at,source,session_id
  ) values (
    driver.establishment_id,driver.id,delivery.id,requested_latitude,requested_longitude,
    requested_accuracy_meters,requested_heading_degrees,requested_speed_mps,requested_captured_at,
    'browser',requested_session_id
  ) returning id into location_id;

  update public.driver_availability set last_location_at = now()
  where driver_profile_id = driver.id;
  return jsonb_build_object('accepted',true,'location_id',location_id,'delivery_id',delivery.id,'received_at',now());
end $$;

create or replace function public.get_customer_delivery_tracking(requested_tracking_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'delivery_status', delivery.status,
    'tracking_available', case
      when delivery.status in ('picked_up','on_route','arrived')
        and location.received_at >= now() - interval '5 minutes' then true else false end,
    'latitude', case
      when delivery.status in ('picked_up','on_route','arrived')
        and location.received_at >= now() - interval '5 minutes'
      then round(location.latitude::numeric,3) end,
    'longitude', case
      when delivery.status in ('picked_up','on_route','arrived')
        and location.received_at >= now() - interval '5 minutes'
      then round(location.longitude::numeric,3) end,
    'accuracy_label', case
      when location.accuracy_meters is null then null
      when location.accuracy_meters <= 50 then 'boa'
      when location.accuracy_meters <= 200 then 'aproximada'
      else 'baixa' end,
    'last_updated_at', case
      when delivery.status in ('picked_up','on_route','arrived')
      then location.received_at end
  )
  from public.orders order_record
  join public.deliveries delivery on delivery.order_id = order_record.id
  left join lateral (
    select point.latitude,point.longitude,point.accuracy_meters,point.received_at
    from public.driver_locations point
    where point.delivery_id = delivery.id
    order by point.received_at desc limit 1
  ) location on true
  where order_record.tracking_token = requested_tracking_token
$$;

create or replace function public.purge_old_driver_locations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  removed_count integer := 0;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if not exists (
    select 1 from public.establishment_members member
    where member.user_id = actor and member.role in ('owner','manager')
  ) then raise exception 'Sem permissão para limpar o histórico de localização.'; end if;
  delete from public.driver_locations location
  where location.received_at < now() - interval '30 days'
    and location.establishment_id in (
      select member.establishment_id from public.establishment_members member
      where member.user_id = actor and member.role in ('owner','manager')
    );
  get diagnostics removed_count = row_count;
  return jsonb_build_object('removed',removed_count,'retention_days',30);
end $$;

revoke all on function public.update_driver_location(double precision,double precision,double precision,double precision,double precision,timestamptz,uuid) from public,anon;
revoke all on function public.get_customer_delivery_tracking(uuid) from public,anon,authenticated;
revoke all on function public.purge_old_driver_locations() from public,anon;
grant execute on function public.update_driver_location(double precision,double precision,double precision,double precision,double precision,timestamptz,uuid) to authenticated;
grant execute on function public.get_customer_delivery_tracking(uuid) to anon,authenticated;
grant execute on function public.purge_old_driver_locations() to authenticated;
