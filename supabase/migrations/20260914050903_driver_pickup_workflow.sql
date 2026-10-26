-- Keep existing drivers on the secure partner workflow until an administrator classifies them.
alter table public.driver_profiles add column driver_kind text not null default 'partner' check(driver_kind in ('fixed','partner'));
CREATE OR REPLACE FUNCTION public.get_driver_delivery_detail(requested_delivery_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  result jsonb;
begin

  -- active_driver_address_guard
  if not exists (
    select 1 from public.driver_profiles current_driver
    join public.custom_staff_members current_member
      on current_member.id = current_driver.custom_staff_member_id
      and current_member.establishment_id = current_driver.establishment_id
    where current_driver.user_id = auth.uid()
      and current_member.user_id = auth.uid()
      and current_driver.active
      and current_driver.approval_status = 'approved'
      and current_member.status = 'active'
  ) then
    raise exception 'Motoboy inativo ou sem autorizacao para consultar endereco.';
  end if;
  if actor is null then raise exception 'AutenticaÃ§Ã£o necessÃ¡ria.'; end if;
  select * into driver from public.driver_profiles where user_id = actor;
  select jsonb_build_object(
    'delivery_id',delivery.id,'status',delivery.status,
    'order_number',orders.order_number,'customer_name',orders.customer_name,
    'recipient_name',destination.recipient_name,'recipient_phone',destination.recipient_phone,
    'postal_code',destination.postal_code,'street',destination.street,
    'street_number',destination.street_number,'complement',destination.complement,
    'neighborhood',destination.neighborhood,'city',destination.city,
    'state',destination.state,'reference',destination.reference,
    'driver_kind',driver.driver_kind,'payment_method',orders.payment_method,
    'total_cents',orders.total_cents,'cash_received_cents',orders.cash_received_cents,
    'cash_change_cents',orders.cash_change_cents,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity)),'[]'::jsonb) from public.order_items i where i.order_id=orders.id and i.establishment_id=driver.establishment_id)
  ) into result
  from public.deliveries delivery
  join public.orders orders on orders.id = delivery.order_id
  join public.delivery_destinations destination on destination.delivery_order_id = orders.id
  join public.delivery_assignments assignment on assignment.delivery_id = delivery.id
  where delivery.id = requested_delivery_id
    and assignment.driver_profile_id = driver.id and assignment.status = 'accepted'
    and delivery.status in ('driver_assigned','driver_to_pickup','picked_up','on_route','arrived','returning_to_store');
  if result is null then raise exception 'O endereÃ§o serÃ¡ liberado somente depois da retirada validada.'; end if;
  return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.verify_pickup_code(requested_delivery_id uuid, requested_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- active_driver_operation_guard
  if not exists (
    select 1 from public.driver_profiles current_driver
    join public.custom_staff_members current_member
      on current_member.id = current_driver.custom_staff_member_id
      and current_member.establishment_id = current_driver.establishment_id
    where current_driver.user_id = auth.uid()
      and current_member.user_id = auth.uid()
      and current_driver.active
      and current_driver.approval_status = 'approved'
      and current_member.status = 'active'
  ) then
    raise exception 'Motoboy inativo ou sem autorizacao para operar.';
  end if;
  if actor is null then raise exception 'AutenticaÃ§Ã£o necessÃ¡ria.'; end if;
  select * into driver from public.driver_profiles where user_id = actor;
  select * into assignment from public.delivery_assignments
    where delivery_id = requested_delivery_id and driver_profile_id = driver.id and status = 'accepted'
    for update;
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if assignment.id is null or delivery.id is null then raise exception 'Entrega nÃ£o encontrada para este motoboy.'; end if;
  if delivery.status = 'picked_up' then return jsonb_build_object('verified',true,'delivery_status',delivery.status); end if;
  if delivery.status not in ('driver_assigned','driver_to_pickup') then raise exception 'Esta entrega nÃ£o estÃ¡ aguardando retirada.'; end if;
  if driver.driver_kind = 'partner' then
  if delivery.pickup_code_hash is null or delivery.pickup_code_expires_at <= now() then
    return jsonb_build_object('verified',false,'reason','CÃ³digo ausente ou expirado. Solicite um novo ao estabelecimento.');
  end if;
  if delivery.pickup_code_attempts >= 5 then
    return jsonb_build_object('verified',false,'reason','Limite de tentativas atingido. Solicite um novo cÃ³digo.');
  end if;
  supplied_hash := encode(extensions.digest(delivery.id::text || ':' || btrim(requested_code),'sha256'),'hex');
  if supplied_hash is distinct from delivery.pickup_code_hash then
    update public.deliveries set pickup_code_attempts = least(pickup_code_attempts + 1,10)
      where id = delivery.id returning * into delivery;
    insert into public.delivery_events(
      establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
    ) values (
      delivery.establishment_id,delivery.id,'pickup_code_failed',delivery.status,delivery.status,
      'driver',actor,driver.id,jsonb_build_object('attempts',delivery.pickup_code_attempts)
    );
    return jsonb_build_object('verified',false,'reason','CÃ³digo incorreto.','attempts',delivery.pickup_code_attempts);
  end if;

  end if; -- partner custody code only; authenticated fixed drivers confirm pickup directly
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
    jsonb_build_object('assignment_id',assignment.id,'driver_profile_id',driver.id,'driver_kind',driver.driver_kind));
  return jsonb_build_object('verified',true,'delivery_status',delivery.status,'pin_required',required_pin);
end $function$
;
-- Internal triggers reuse the existing fair-queue and notification implementation.
create function private.auto_dispatch_ready_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='ready_for_dispatch' and old.status is distinct from new.status then
  update public.deliveries set status='searching_driver',dispatch_started_at=now() where id=new.id;
  perform private.offer_next_driver_locked(new.id,null);
 end if;
 return new;
end $$;
revoke all on function private.auto_dispatch_ready_delivery() from public,anon,authenticated;
create trigger auto_dispatch_ready_delivery after update of status on public.deliveries
for each row execute function private.auto_dispatch_ready_delivery();
create function private.auto_dispatch_available_driver() returns trigger
language plpgsql security definer set search_path='' as $$
declare pending record;
begin
 if new.status='available' and new.active_delivery_count=0 and
    (old.status is distinct from new.status or old.active_delivery_count is distinct from new.active_delivery_count) then
  for pending in select id from public.deliveries where establishment_id=new.establishment_id
   and status='searching_driver' order by ready_at,id for update skip locked loop
   perform private.offer_next_driver_locked(pending.id,null);
   exit when exists(select 1 from public.driver_availability where driver_profile_id=new.driver_profile_id and status<>'available');
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.auto_dispatch_available_driver() from public,anon,authenticated;
create trigger auto_dispatch_available_driver after update of status,active_delivery_count on public.driver_availability
for each row execute function private.auto_dispatch_available_driver();
