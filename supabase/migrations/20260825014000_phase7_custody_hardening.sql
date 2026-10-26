create or replace function public.verify_pickup_code(requested_delivery_id uuid, requested_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype;
  delivery public.deliveries%rowtype;
  order_record public.orders%rowtype;
  required_pin boolean := true;
  raw_pin text;
  supplied_hash text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where user_id = actor;
  select * into assignment from public.delivery_assignments
    where delivery_id = requested_delivery_id and driver_profile_id = driver.id and status = 'accepted'
    for update;
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if assignment.id is null or delivery.id is null then raise exception 'Entrega não encontrada para este motoboy.'; end if;
  if delivery.status = 'picked_up' then return jsonb_build_object('verified',true,'delivery_status',delivery.status); end if;
  if delivery.status not in ('driver_assigned','driver_to_pickup') then raise exception 'Esta entrega não está aguardando retirada.'; end if;
  if delivery.pickup_code_hash is null or delivery.pickup_code_expires_at <= now() then
    return jsonb_build_object('verified',false,'reason','Código ausente ou expirado. Solicite um novo ao estabelecimento.');
  end if;
  if delivery.pickup_code_attempts >= 5 then
    return jsonb_build_object('verified',false,'reason','Limite de tentativas atingido. Solicite um novo código.');
  end if;
  supplied_hash := encode(extensions.digest(delivery.id::text || ':' || btrim(requested_code),'sha256'),'hex');
  if supplied_hash <> delivery.pickup_code_hash then
    update public.deliveries set pickup_code_attempts = least(pickup_code_attempts + 1,10)
      where id = delivery.id returning * into delivery;
    insert into public.delivery_events(
      establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
    ) values (
      delivery.establishment_id,delivery.id,'pickup_code_failed',delivery.status,delivery.status,
      'driver',actor,driver.id,jsonb_build_object('attempts',delivery.pickup_code_attempts)
    );
    return jsonb_build_object('verified',false,'reason','Código incorreto.','attempts',delivery.pickup_code_attempts);
  end if;

  select * into order_record from public.orders where id = delivery.order_id for update;
  select coalesce((
    select settings.delivery_pin_required from public.delivery_settings settings
    where settings.establishment_id = delivery.establishment_id
  ), true) into required_pin;
  raw_pin := private.delivery_pin_for_token(order_record.tracking_token,delivery.id);
  update public.deliveries set
    status = 'picked_up', picked_up_at = now(), pickup_verified_by = actor,
    delivery_pin_required = required_pin,
    delivery_pin_hash = case when required_pin then encode(extensions.digest(id::text || ':' || raw_pin,'sha256'),'hex') end,
    delivery_pin_attempts = 0
  where id = delivery.id returning * into delivery;
  update public.driver_availability set status = 'delivering'
    where driver_profile_id = driver.id;
  update public.orders set status = 'out_for_delivery', updated_at = now()
    where id = delivery.order_id;
  insert into public.delivery_events(
    establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
  ) values (
    delivery.establishment_id,delivery.id,'pickup_verified','driver_to_pickup','picked_up',
    'driver',actor,driver.id,jsonb_build_object('assignment_id',assignment.id,'pin_required',required_pin)
  );
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(delivery.establishment_id,actor,'delivery.pickup_verified','deliveries',delivery.id,
    jsonb_build_object('assignment_id',assignment.id,'driver_profile_id',driver.id));
  return jsonb_build_object('verified',true,'delivery_status',delivery.status,'pin_required',required_pin);
end $$;

revoke all on function public.verify_pickup_code(uuid,text) from public,anon;
grant execute on function public.verify_pickup_code(uuid,text) to authenticated;

drop policy if exists delivery_incidents_admin_read on public.delivery_incidents;
drop policy if exists delivery_incidents_driver_read on public.delivery_incidents;
create policy delivery_incidents_authorized_read on public.delivery_incidents for select to authenticated
using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
  or exists (
    select 1 from public.driver_profiles driver
    where driver.id = driver_profile_id and driver.user_id = (select auth.uid())
  )
);
