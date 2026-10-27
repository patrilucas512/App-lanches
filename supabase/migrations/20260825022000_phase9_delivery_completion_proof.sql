alter table public.deliveries
  add column if not exists delivery_confirmation_method text,
  add column if not exists delivery_pin_verified boolean not null default false,
  add column if not exists delivery_completion_reason text,
  add column if not exists delivered_driver_profile_id uuid,
  add column if not exists delivery_latitude double precision,
  add column if not exists delivery_longitude double precision,
  add column if not exists delivery_accuracy_meters double precision,
  add column if not exists delivery_location_captured_at timestamptz;

update public.deliveries
set delivery_confirmation_method = 'legacy'
where status = 'delivered' and delivery_confirmation_method is null;

alter table public.deliveries
  add constraint deliveries_confirmation_method_check
    check (delivery_confirmation_method is null or delivery_confirmation_method in ('pin','admin_exception','legacy')),
  add constraint deliveries_completion_reason_check
    check (delivery_completion_reason is null or char_length(delivery_completion_reason) between 5 and 300),
  add constraint deliveries_delivery_latitude_check
    check (delivery_latitude is null or delivery_latitude between -90 and 90),
  add constraint deliveries_delivery_longitude_check
    check (delivery_longitude is null or delivery_longitude between -180 and 180),
  add constraint deliveries_delivery_accuracy_check
    check (delivery_accuracy_meters is null or delivery_accuracy_meters between 0 and 5000),
  add constraint deliveries_delivery_location_pair_check
    check ((delivery_latitude is null) = (delivery_longitude is null)),
  add constraint deliveries_delivered_driver_tenant_fk
    foreign key (delivered_driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id);

create index deliveries_delivered_driver_tenant_idx
  on public.deliveries(delivered_driver_profile_id, establishment_id)
  where delivered_driver_profile_id is not null;

create index deliveries_delivered_timeline_idx
  on public.deliveries(establishment_id, delivered_at desc)
  where delivered_at is not null;

create or replace function private.complete_delivery_locked(
  requested_delivery_id uuid,
  requested_actor uuid,
  requested_driver_id uuid,
  requested_event text,
  requested_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  delivery public.deliveries%rowtype;
  assignment public.delivery_assignments%rowtype;
  latest_location public.driver_locations%rowtype;
  proof_driver_id uuid;
  confirmation_method text;
  completion_reason text;
begin
  select * into delivery from public.deliveries
  where id = requested_delivery_id for update;
  if delivery.id is null then raise exception 'Entrega não encontrada.'; end if;
  if delivery.status = 'delivered' then
    return jsonb_build_object(
      'delivery_id', delivery.id,
      'status', delivery.status,
      'confirmation_method', delivery.delivery_confirmation_method,
      'location_recorded', delivery.delivery_latitude is not null
    );
  end if;
  if delivery.status <> 'arrived' then
    raise exception 'A entrega precisa estar marcada como chegada.';
  end if;

  select * into assignment from public.delivery_assignments
  where delivery_id = delivery.id and status = 'accepted' for update;
  if assignment.id is null then raise exception 'Atribuição ativa não encontrada.'; end if;
  if requested_driver_id is not null and requested_driver_id <> assignment.driver_profile_id then
    raise exception 'O motoboy informado não é o responsável pela entrega.';
  end if;

  proof_driver_id := assignment.driver_profile_id;
  confirmation_method := case
    when requested_event = 'delivery_pin_verified' then 'pin'
    else 'admin_exception'
  end;
  completion_reason := case
    when confirmation_method = 'admin_exception'
      then left(nullif(btrim(coalesce(requested_metadata->>'reason','')), ''), 300)
    else null
  end;
  if confirmation_method = 'admin_exception' and completion_reason is null then
    raise exception 'Informe o motivo da finalização sem PIN.';
  end if;

  select * into latest_location from public.driver_locations
  where delivery_id = delivery.id
    and driver_profile_id = proof_driver_id
    and received_at >= now() - interval '10 minutes'
  order by received_at desc limit 1;

  update public.deliveries set
    status = 'delivered',
    delivered_at = now(),
    delivery_verified_by = requested_actor,
    delivery_confirmation_method = confirmation_method,
    delivery_pin_verified = confirmation_method = 'pin',
    delivery_completion_reason = completion_reason,
    delivered_driver_profile_id = proof_driver_id,
    delivery_latitude = latest_location.latitude,
    delivery_longitude = latest_location.longitude,
    delivery_accuracy_meters = latest_location.accuracy_meters,
    delivery_location_captured_at = latest_location.captured_at
  where id = delivery.id returning * into delivery;

  update public.delivery_assignments set status = 'completed', completed_at = now()
  where id = assignment.id;
  update public.driver_availability set
    status = 'available',
    available_since = now(),
    last_completed_at = now(),
    active_delivery_count = greatest(active_delivery_count - 1, 0)
  where driver_profile_id = assignment.driver_profile_id;
  update public.orders set status = 'completed', updated_at = now()
  where id = delivery.order_id;

  insert into public.delivery_events(
    establishment_id, delivery_id, event_type, from_status, to_status,
    actor_type, actor_user_id, actor_driver_id, metadata
  ) values (
    delivery.establishment_id, delivery.id, requested_event, 'arrived', 'delivered',
    case when requested_driver_id is null then 'user' else 'driver' end,
    requested_actor, proof_driver_id,
    coalesce(requested_metadata, '{}'::jsonb) || jsonb_build_object(
      'confirmation_method', confirmation_method,
      'location_recorded', latest_location.id is not null,
      'location_captured_at', latest_location.captured_at
    )
  );

  return jsonb_build_object(
    'delivery_id', delivery.id,
    'status', delivery.status,
    'confirmation_method', confirmation_method,
    'pin_verified', delivery.delivery_pin_verified,
    'location_recorded', latest_location.id is not null,
    'driver_profile_id', proof_driver_id,
    'delivered_at', delivery.delivered_at
  );
end $$;

create or replace function public.verify_delivery_pin(requested_delivery_id uuid, requested_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype;
  delivery public.deliveries%rowtype;
  supplied_hash text;
  completed jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if delivery.id is null then raise exception 'Entrega não encontrada.'; end if;
  if delivery.status = 'delivered' then
    return jsonb_build_object('verified', true, 'delivery_status', 'delivered', 'already_completed', true);
  end if;
  if delivery.status <> 'arrived' then raise exception 'Confirme a chegada antes de validar o PIN.'; end if;

  select * into driver from public.driver_profiles
  where user_id = actor and active and approval_status = 'approved';
  select * into assignment from public.delivery_assignments
  where delivery_id = delivery.id and driver_profile_id = driver.id and status = 'accepted' for update;
  if driver.id is null or assignment.id is null then raise exception 'Entrega não pertence a este motoboy.'; end if;
  if not delivery.delivery_pin_required then raise exception 'Esta entrega deve ser concluída pela administração.'; end if;
  if delivery.delivery_pin_attempts >= 5 then
    return jsonb_build_object('verified', false, 'reason', 'Limite de tentativas atingido. Solicite ajuda ao estabelecimento.');
  end if;

  supplied_hash := encode(extensions.digest(delivery.id::text || ':' || btrim(coalesce(requested_pin,'')), 'sha256'), 'hex');
  if requested_pin !~ '^[0-9]{4}$' or supplied_hash <> delivery.delivery_pin_hash then
    update public.deliveries
    set delivery_pin_attempts = least(delivery_pin_attempts + 1, 10)
    where id = delivery.id returning * into delivery;
    insert into public.delivery_events(
      establishment_id, delivery_id, event_type, from_status, to_status,
      actor_type, actor_user_id, actor_driver_id, metadata
    ) values (
      delivery.establishment_id, delivery.id, 'delivery_pin_failed', 'arrived', 'arrived',
      'driver', actor, driver.id, jsonb_build_object('attempts', delivery.delivery_pin_attempts)
    );
    return jsonb_build_object('verified', false, 'reason', 'PIN incorreto.', 'attempts', delivery.delivery_pin_attempts);
  end if;

  completed := private.complete_delivery_locked(
    delivery.id, actor, driver.id, 'delivery_pin_verified',
    jsonb_build_object('assignment_id', assignment.id)
  );
  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    delivery.establishment_id, actor, 'delivery.completed_with_pin', 'deliveries', delivery.id,
    jsonb_build_object('driver_profile_id', driver.id, 'proof', completed)
  );
  return jsonb_build_object('verified', true, 'delivery_status', 'delivered', 'proof', completed);
end $$;

create or replace function public.complete_delivery_without_pin(requested_delivery_id uuid, requested_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  delivery public.deliveries%rowtype;
  assignment public.delivery_assignments%rowtype;
  completed jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if delivery.id is null or not private.has_role(
    delivery.establishment_id, array['owner','manager']::public.member_role[]
  ) then raise exception 'Sem permissão para finalizar sem PIN.'; end if;
  if delivery.status = 'delivered' then
    return jsonb_build_object('delivery_id', delivery.id, 'status', 'delivered', 'already_completed', true);
  end if;
  if delivery.status <> 'arrived' then raise exception 'A entrega precisa estar marcada como chegada.'; end if;
  if char_length(btrim(coalesce(requested_reason,''))) < 5 then
    raise exception 'Informe o motivo da finalização sem PIN.';
  end if;
  select * into assignment from public.delivery_assignments
  where delivery_id = delivery.id and status = 'accepted';
  if assignment.id is null then raise exception 'Atribuição ativa não encontrada.'; end if;

  completed := private.complete_delivery_locked(
    delivery.id, actor, null, 'delivery_completed_without_pin',
    jsonb_build_object(
      'reason', left(btrim(requested_reason), 300),
      'driver_profile_id', assignment.driver_profile_id
    )
  );
  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    delivery.establishment_id, actor, 'delivery.completed_without_pin', 'deliveries', delivery.id,
    jsonb_build_object(
      'reason', left(btrim(requested_reason), 300),
      'driver_profile_id', assignment.driver_profile_id,
      'proof', completed
    )
  );
  return completed;
end $$;

create or replace function public.get_public_order_status(requested_tracking_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'order_number', order_record.order_number,
    'status', order_record.status,
    'fulfillment_type', order_record.fulfillment_type,
    'created_at', order_record.created_at,
    'updated_at', order_record.updated_at,
    'estimated_minutes', settings.estimated_minutes,
    'table_number', restaurant_table.table_number,
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

revoke all on function private.complete_delivery_locked(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.verify_delivery_pin(uuid,text) from public, anon;
revoke all on function public.complete_delivery_without_pin(uuid,text) from public, anon;
revoke all on function public.get_public_order_status(uuid) from public, anon, authenticated;
grant execute on function public.verify_delivery_pin(uuid,text) to authenticated;
grant execute on function public.complete_delivery_without_pin(uuid,text) to authenticated;
grant execute on function public.get_public_order_status(uuid) to anon, authenticated;
