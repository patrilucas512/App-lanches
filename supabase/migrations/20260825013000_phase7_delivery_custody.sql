alter table public.delivery_settings
  add column if not exists delivery_pin_required boolean not null default true;

alter table public.deliveries
  add column if not exists pickup_code_hash text,
  add column if not exists pickup_code_expires_at timestamptz,
  add column if not exists pickup_code_attempts integer not null default 0 check (pickup_code_attempts between 0 and 10),
  add column if not exists pickup_verified_by uuid references auth.users(id) on delete set null,
  add column if not exists delivery_pin_hash text,
  add column if not exists delivery_pin_required boolean not null default true,
  add column if not exists delivery_pin_attempts integer not null default 0 check (delivery_pin_attempts between 0 and 10),
  add column if not exists delivery_verified_by uuid references auth.users(id) on delete set null;

create table public.delivery_incidents (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  delivery_id uuid not null,
  driver_profile_id uuid not null,
  incident_type text not null check (incident_type in (
    'customer_absent','wrong_address','payment','vehicle','accident','return','other'
  )),
  description text not null check (char_length(btrim(description)) between 3 and 500),
  status text not null default 'open' check (status in ('open','resolved','canceled')),
  resolution text,
  created_by uuid not null references auth.users(id) on delete restrict,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_incidents_delivery_tenant_fk
    foreign key (delivery_id, establishment_id)
    references public.deliveries(id, establishment_id) on delete cascade,
  constraint delivery_incidents_driver_tenant_fk
    foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete restrict
);

create index delivery_incidents_establishment_status_idx
  on public.delivery_incidents(establishment_id, status, created_at desc);
create index delivery_incidents_delivery_idx
  on public.delivery_incidents(delivery_id, created_at desc);
create index delivery_incidents_driver_idx
  on public.delivery_incidents(driver_profile_id, created_at desc);

create trigger delivery_incidents_touch before update on public.delivery_incidents
for each row execute function public.touch_updated_at();

alter table public.delivery_incidents enable row level security;

create policy delivery_incidents_admin_read on public.delivery_incidents for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy delivery_incidents_driver_read on public.delivery_incidents for select to authenticated
using (exists (
  select 1 from public.driver_profiles driver
  where driver.id = driver_profile_id and driver.user_id = (select auth.uid())
));

revoke all on table public.delivery_incidents from anon, authenticated;
grant select on table public.delivery_incidents to authenticated;

create or replace function private.delivery_pin_for_token(
  requested_tracking_token uuid,
  requested_delivery_id uuid
) returns text language sql immutable security invoker set search_path = '' as $$
  select (
    1000 + (
      ('x' || substr(encode(extensions.digest(
        requested_tracking_token::text || ':' || requested_delivery_id::text,
        'sha256'
      ), 'hex'), 1, 8))::bit(32)::bigint % 9000
    )
  )::text
$$;

create or replace function public.mark_driver_to_pickup(requested_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype;
  delivery public.deliveries%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where user_id = actor;
  select * into assignment from public.delivery_assignments
    where delivery_id = requested_delivery_id and driver_profile_id = driver.id and status = 'accepted'
    for update;
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if assignment.id is null or delivery.id is null then raise exception 'Entrega não encontrada para este motoboy.'; end if;
  if delivery.status = 'driver_to_pickup' then return to_jsonb(delivery); end if;
  if delivery.status <> 'driver_assigned' then raise exception 'Esta entrega não pode iniciar a retirada.'; end if;
  update public.deliveries set status = 'driver_to_pickup'
  where id = delivery.id returning * into delivery;
  insert into public.delivery_events(
    establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
  ) values (
    delivery.establishment_id,delivery.id,'driver_started_pickup','driver_assigned','driver_to_pickup',
    'driver',actor,driver.id,jsonb_build_object('assignment_id',assignment.id)
  );
  return to_jsonb(delivery);
end $$;

create or replace function public.issue_pickup_code(requested_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  delivery public.deliveries%rowtype;
  raw_code text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if delivery.id is null or not private.has_role(
    delivery.establishment_id,
    array['owner','manager','attendant','kitchen']::public.member_role[]
  ) then raise exception 'Sem permissão para gerar o código de retirada.'; end if;
  if delivery.status not in ('driver_assigned','driver_to_pickup') then
    raise exception 'O código só pode ser gerado após um motoboy aceitar a entrega.';
  end if;
  raw_code := (
    100000 + (
      ('x' || substr(encode(extensions.gen_random_bytes(4),'hex'),1,8))::bit(32)::bigint % 900000
    )
  )::text;
  update public.deliveries set
    pickup_code_hash = encode(extensions.digest(id::text || ':' || raw_code,'sha256'),'hex'),
    pickup_code_expires_at = now() + interval '30 minutes',
    pickup_code_attempts = 0
  where id = delivery.id returning * into delivery;
  insert into public.delivery_events(
    establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,metadata
  ) values (
    delivery.establishment_id,delivery.id,'pickup_code_issued',delivery.status,delivery.status,
    'user',actor,jsonb_build_object('expires_at',delivery.pickup_code_expires_at)
  );
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(delivery.establishment_id,actor,'delivery.pickup_code_issued','deliveries',delivery.id,
    jsonb_build_object('expires_at',delivery.pickup_code_expires_at));
  return jsonb_build_object('code',raw_code,'expires_at',delivery.pickup_code_expires_at,'delivery_id',delivery.id);
end $$;

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
  if delivery.status not in ('driver_assigned','driver_to_pickup') then
    raise exception 'Esta entrega não está aguardando retirada.';
  end if;
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
  select coalesce(settings.delivery_pin_required,true) into required_pin
  from public.delivery_settings settings where settings.establishment_id = delivery.establishment_id;
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
  where id = order_record.id;
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

create or replace function public.get_driver_delivery_detail(requested_delivery_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where user_id = actor;
  select jsonb_build_object(
    'delivery_id',delivery.id,'status',delivery.status,
    'order_number',orders.order_number,'customer_name',orders.customer_name,
    'recipient_name',destination.recipient_name,'recipient_phone',destination.recipient_phone,
    'postal_code',destination.postal_code,'street',destination.street,
    'street_number',destination.street_number,'complement',destination.complement,
    'neighborhood',destination.neighborhood,'city',destination.city,
    'state',destination.state,'reference',destination.reference
  ) into result
  from public.deliveries delivery
  join public.orders orders on orders.id = delivery.order_id
  join public.delivery_destinations destination on destination.delivery_order_id = orders.id
  join public.delivery_assignments assignment on assignment.delivery_id = delivery.id
  where delivery.id = requested_delivery_id
    and assignment.driver_profile_id = driver.id and assignment.status = 'accepted'
    and delivery.status in ('picked_up','on_route','arrived','returning_to_store');
  if result is null then raise exception 'O endereço será liberado somente depois da retirada validada.'; end if;
  return result;
end $$;

create or replace function public.start_delivery_route(requested_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype; delivery public.deliveries%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where user_id = actor;
  select * into assignment from public.delivery_assignments where delivery_id=requested_delivery_id and driver_profile_id=driver.id and status='accepted' for update;
  select * into delivery from public.deliveries where id=requested_delivery_id for update;
  if assignment.id is null or delivery.id is null then raise exception 'Entrega não encontrada.'; end if;
  if delivery.status='on_route' then return to_jsonb(delivery); end if;
  if delivery.status<>'picked_up' then raise exception 'Confirme a retirada antes de iniciar a rota.'; end if;
  update public.deliveries set status='on_route' where id=delivery.id returning * into delivery;
  insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id)
  values(delivery.establishment_id,delivery.id,'delivery_route_started','picked_up','on_route','driver',actor,driver.id);
  return to_jsonb(delivery);
end $$;

create or replace function public.mark_driver_arrived(requested_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype; delivery public.deliveries%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where user_id=actor;
  select * into assignment from public.delivery_assignments where delivery_id=requested_delivery_id and driver_profile_id=driver.id and status='accepted' for update;
  select * into delivery from public.deliveries where id=requested_delivery_id for update;
  if assignment.id is null or delivery.id is null then raise exception 'Entrega não encontrada.'; end if;
  if delivery.status='arrived' then return to_jsonb(delivery); end if;
  if delivery.status<>'on_route' then raise exception 'A entrega ainda não está em rota.'; end if;
  update public.deliveries set status='arrived',arrived_at=now() where id=delivery.id returning * into delivery;
  insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id)
  values(delivery.establishment_id,delivery.id,'driver_arrived','on_route','arrived','driver',actor,driver.id);
  return to_jsonb(delivery);
end $$;

create or replace function private.complete_delivery_locked(
  requested_delivery_id uuid,
  requested_actor uuid,
  requested_driver_id uuid,
  requested_event text,
  requested_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare delivery public.deliveries%rowtype; assignment public.delivery_assignments%rowtype;
begin
  select * into delivery from public.deliveries where id=requested_delivery_id for update;
  select * into assignment from public.delivery_assignments where delivery_id=delivery.id and status='accepted' for update;
  if delivery.id is null or assignment.id is null then raise exception 'Entrega ativa não encontrada.'; end if;
  update public.deliveries set status='delivered',delivered_at=now(),delivery_verified_by=requested_actor
    where id=delivery.id returning * into delivery;
  update public.delivery_assignments set status='completed',completed_at=now()
    where id=assignment.id;
  update public.driver_availability set status='available',available_since=now(),
    last_completed_at=now(),active_delivery_count=greatest(active_delivery_count-1,0)
    where driver_profile_id=assignment.driver_profile_id;
  update public.orders set status='completed',updated_at=now() where id=delivery.order_id;
  insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata)
  values(delivery.establishment_id,delivery.id,requested_event,'arrived','delivered',
    case when requested_driver_id is null then 'user' else 'driver' end,
    requested_actor,requested_driver_id,requested_metadata);
  return to_jsonb(delivery);
end $$;

create or replace function public.verify_delivery_pin(requested_delivery_id uuid, requested_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype; delivery public.deliveries%rowtype;
  supplied_hash text; completed jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where user_id=actor;
  select * into assignment from public.delivery_assignments where delivery_id=requested_delivery_id and driver_profile_id=driver.id and status='accepted' for update;
  select * into delivery from public.deliveries where id=requested_delivery_id for update;
  if assignment.id is null or delivery.id is null then raise exception 'Entrega não encontrada.'; end if;
  if delivery.status='delivered' then return jsonb_build_object('verified',true,'delivery_status','delivered'); end if;
  if delivery.status<>'arrived' then raise exception 'Confirme a chegada antes de validar o PIN.'; end if;
  if not delivery.delivery_pin_required then raise exception 'Esta entrega deve ser concluída pela administração.'; end if;
  if delivery.delivery_pin_attempts>=5 then return jsonb_build_object('verified',false,'reason','Limite de tentativas atingido. Solicite ajuda ao estabelecimento.'); end if;
  supplied_hash:=encode(extensions.digest(delivery.id::text||':'||btrim(requested_pin),'sha256'),'hex');
  if supplied_hash<>delivery.delivery_pin_hash then
    update public.deliveries set delivery_pin_attempts=least(delivery_pin_attempts+1,10) where id=delivery.id returning * into delivery;
    insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata)
    values(delivery.establishment_id,delivery.id,'delivery_pin_failed','arrived','arrived','driver',actor,driver.id,jsonb_build_object('attempts',delivery.delivery_pin_attempts));
    return jsonb_build_object('verified',false,'reason','PIN incorreto.','attempts',delivery.delivery_pin_attempts);
  end if;
  completed:=private.complete_delivery_locked(delivery.id,actor,driver.id,'delivery_pin_verified',jsonb_build_object('assignment_id',assignment.id));
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(delivery.establishment_id,actor,'delivery.completed_with_pin','deliveries',delivery.id,jsonb_build_object('driver_profile_id',driver.id));
  return jsonb_build_object('verified',true,'delivery_status','delivered','delivery',completed);
end $$;

create or replace function public.complete_delivery_without_pin(requested_delivery_id uuid, requested_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); delivery public.deliveries%rowtype; assignment public.delivery_assignments%rowtype; completed jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into delivery from public.deliveries where id=requested_delivery_id for update;
  if delivery.id is null or not private.has_role(delivery.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para finalizar sem PIN.'; end if;
  if delivery.status<>'arrived' then raise exception 'A entrega precisa estar marcada como chegada.'; end if;
  if char_length(btrim(coalesce(requested_reason,'')))<5 then raise exception 'Informe o motivo da finalização sem PIN.'; end if;
  select * into assignment from public.delivery_assignments where delivery_id=delivery.id and status='accepted';
  completed:=private.complete_delivery_locked(delivery.id,actor,null,'delivery_completed_without_pin',jsonb_build_object('reason',left(btrim(requested_reason),300),'driver_profile_id',assignment.driver_profile_id));
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(delivery.establishment_id,actor,'delivery.completed_without_pin','deliveries',delivery.id,jsonb_build_object('reason',left(btrim(requested_reason),300),'driver_profile_id',assignment.driver_profile_id));
  return completed;
end $$;

create or replace function public.report_delivery_incident(
  requested_delivery_id uuid, requested_type text, requested_description text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid:=auth.uid(); driver public.driver_profiles%rowtype;
  assignment public.delivery_assignments%rowtype; delivery public.deliveries%rowtype;
  incident public.delivery_incidents%rowtype; previous_status public.delivery_status;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if requested_type not in ('customer_absent','wrong_address','payment','vehicle','accident','return','other') then raise exception 'Tipo de ocorrência inválido.'; end if;
  if char_length(btrim(coalesce(requested_description,'')))<3 then raise exception 'Descreva a ocorrência.'; end if;
  select * into driver from public.driver_profiles where user_id=actor;
  select * into assignment from public.delivery_assignments where delivery_id=requested_delivery_id and driver_profile_id=driver.id and status='accepted' for update;
  select * into delivery from public.deliveries where id=requested_delivery_id for update;
  if assignment.id is null or delivery.id is null or delivery.status not in ('driver_assigned','driver_to_pickup','picked_up','on_route','arrived','returning_to_store') then raise exception 'Entrega ativa não encontrada.'; end if;
  insert into public.delivery_incidents(establishment_id,delivery_id,driver_profile_id,incident_type,description,created_by)
  values(delivery.establishment_id,delivery.id,driver.id,requested_type,left(btrim(requested_description),500),actor)
  returning * into incident;
  previous_status:=delivery.status;
  if delivery.status in ('picked_up','on_route','arrived') then
    update public.deliveries set status='returning_to_store' where id=delivery.id returning * into delivery;
  end if;
  insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata)
  values(delivery.establishment_id,delivery.id,'delivery_incident_reported',previous_status,delivery.status,'driver',actor,driver.id,
    jsonb_build_object('incident_id',incident.id,'incident_type',incident.incident_type));
  return jsonb_build_object('incident',to_jsonb(incident),'delivery_status',delivery.status);
end $$;

create or replace function public.confirm_return_to_store(requested_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); delivery public.deliveries%rowtype; assignment public.delivery_assignments%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into delivery from public.deliveries where id=requested_delivery_id for update;
  if delivery.id is null or not private.has_role(delivery.establishment_id,array['owner','manager','attendant','kitchen']::public.member_role[]) then raise exception 'Sem permissão para confirmar o retorno.'; end if;
  if delivery.status<>'returning_to_store' then raise exception 'Esta entrega não está retornando ao estabelecimento.'; end if;
  select * into assignment from public.delivery_assignments where delivery_id=delivery.id and status='accepted' for update;
  update public.deliveries set status='returned_to_store' where id=delivery.id returning * into delivery;
  update public.delivery_assignments set status='completed',completed_at=now() where id=assignment.id;
  update public.driver_availability set status='available',available_since=now(),active_delivery_count=greatest(active_delivery_count-1,0)
    where driver_profile_id=assignment.driver_profile_id;
  update public.orders set status='canceled',updated_at=now() where id=delivery.order_id;
  update public.delivery_incidents set status='resolved',resolution='Pedido devolvido ao estabelecimento.',resolved_by=actor,resolved_at=now()
    where delivery_id=delivery.id and status='open';
  insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata)
  values(delivery.establishment_id,delivery.id,'return_to_store_confirmed','returning_to_store','returned_to_store','user',actor,assignment.driver_profile_id,jsonb_build_object('assignment_id',assignment.id));
  return to_jsonb(delivery);
end $$;

create or replace function public.get_public_order_status(requested_tracking_token uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'order_number',o.order_number,'status',o.status,'fulfillment_type',o.fulfillment_type,
    'created_at',o.created_at,'updated_at',o.updated_at,'estimated_minutes',s.estimated_minutes,
    'table_number',rt.table_number,
    'kitchen_status',kt.status,'started_at',kt.started_at,'ready_at',kt.ready_at,'delivered_at',coalesce(d.delivered_at,kt.delivered_at),
    'delivery_status',d.status,
    'delivery_pin',case when d.delivery_pin_required and d.status in ('on_route','arrived')
      then private.delivery_pin_for_token(o.tracking_token,d.id) end,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',oi.id,'product_name',oi.product_name,'quantity',oi.quantity,
      'addons',oi.addons,'removed_ingredients',oi.removed_ingredients
    ) order by oi.id) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb)
  )
  from public.orders o
  join public.establishment_settings s on s.establishment_id=o.establishment_id
  left join public.restaurant_tables rt on rt.id=o.restaurant_table_id
  left join public.kitchen_tickets kt on kt.public_order_id=o.id
  left join public.deliveries d on d.order_id=o.id
  where o.tracking_token=requested_tracking_token
$$;

create or replace function public.confirm_public_order_received(requested_tracking_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_ticket public.kitchen_tickets%rowtype; target_order public.orders%rowtype;
begin
  select * into target_order from public.orders where tracking_token=requested_tracking_token for update;
  if target_order.id is null then raise exception 'Pedido não encontrado.'; end if;
  if target_order.fulfillment_type='delivery' then raise exception 'A entrega é confirmada pelo PIN informado ao motoboy.'; end if;
  select * into target_ticket from public.kitchen_tickets where public_order_id=target_order.id for update;
  if target_ticket.id is null then raise exception 'Comanda não encontrada.'; end if;
  if target_ticket.status not in ('ready','delivered') then raise exception 'O pedido ainda não está pronto para retirada.'; end if;
  if target_ticket.status='ready' then
    update public.kitchen_tickets set status='delivered',delivered_at=now(),delivered_by=null,
      delivered_by_name='Confirmado pelo cliente',updated_at=now() where id=target_ticket.id;
    update public.orders set status='completed',updated_at=now() where id=target_order.id;
  end if;
  return jsonb_build_object('confirmed',true,'order_number',target_order.order_number,'status','delivered');
end $$;

revoke all on function private.delivery_pin_for_token(uuid,uuid) from public,anon,authenticated;
revoke all on function private.complete_delivery_locked(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.mark_driver_to_pickup(uuid) from public,anon;
revoke all on function public.issue_pickup_code(uuid) from public,anon;
revoke all on function public.verify_pickup_code(uuid,text) from public,anon;
revoke all on function public.get_driver_delivery_detail(uuid) from public,anon;
revoke all on function public.start_delivery_route(uuid) from public,anon;
revoke all on function public.mark_driver_arrived(uuid) from public,anon;
revoke all on function public.verify_delivery_pin(uuid,text) from public,anon;
revoke all on function public.complete_delivery_without_pin(uuid,text) from public,anon;
revoke all on function public.report_delivery_incident(uuid,text,text) from public,anon;
revoke all on function public.confirm_return_to_store(uuid) from public,anon;
revoke all on function public.get_public_order_status(uuid) from public,anon,authenticated;
revoke all on function public.confirm_public_order_received(uuid) from public,anon,authenticated;

grant execute on function public.mark_driver_to_pickup(uuid) to authenticated;
grant execute on function public.issue_pickup_code(uuid) to authenticated;
grant execute on function public.verify_pickup_code(uuid,text) to authenticated;
grant execute on function public.get_driver_delivery_detail(uuid) to authenticated;
grant execute on function public.start_delivery_route(uuid) to authenticated;
grant execute on function public.mark_driver_arrived(uuid) to authenticated;
grant execute on function public.verify_delivery_pin(uuid,text) to authenticated;
grant execute on function public.complete_delivery_without_pin(uuid,text) to authenticated;
grant execute on function public.report_delivery_incident(uuid,text,text) to authenticated;
grant execute on function public.confirm_return_to_store(uuid) to authenticated;
grant execute on function public.get_public_order_status(uuid) to anon,authenticated;
grant execute on function public.confirm_public_order_received(uuid) to anon,authenticated;
