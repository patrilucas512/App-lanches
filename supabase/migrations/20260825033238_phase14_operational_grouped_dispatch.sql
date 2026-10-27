alter table public.delivery_assignments
  add column group_suggestion_id uuid references public.delivery_group_suggestions(id) on delete set null;

create index delivery_assignments_group_timeline_idx
  on public.delivery_assignments(group_suggestion_id, offered_at desc)
  where group_suggestion_id is not null;

create or replace function private.offer_next_delivery_group_locked(
  requested_suggestion_id uuid,
  requested_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  suggestion public.delivery_group_suggestions%rowtype;
  first_delivery public.deliveries%rowtype;
  second_delivery public.deliveries%rowtype;
  first_order public.orders%rowtype;
  second_order public.orders%rowtype;
  candidate public.driver_availability%rowtype;
  assignment public.delivery_assignments%rowtype;
  next_rank integer;
begin
  select * into suggestion from public.delivery_group_suggestions
  where id = requested_suggestion_id for update;
  if suggestion.id is null or suggestion.status <> 'approved' then
    raise exception 'Agrupamento aprovado nao encontrado.';
  end if;

  select * into first_delivery from public.deliveries
  where id = suggestion.first_delivery_id for update;
  select * into second_delivery from public.deliveries
  where id = suggestion.second_delivery_id for update;
  if first_delivery.status <> 'searching_driver' or second_delivery.status <> 'searching_driver' then
    raise exception 'As duas entregas precisam estar procurando motoboy.';
  end if;

  update public.delivery_assignments set status = 'expired', responded_at = now()
  where group_suggestion_id = suggestion.id and status = 'offered' and expires_at <= now();

  update public.driver_availability availability set status = 'available', available_since = now()
  where availability.status = 'offered'
    and exists (
      select 1 from public.delivery_assignments expired
      where expired.driver_profile_id = availability.driver_profile_id
        and expired.group_suggestion_id = suggestion.id and expired.status = 'expired'
    );

  select * into assignment from public.delivery_assignments
  where group_suggestion_id = suggestion.id and status = 'offered'
  order by offered_at desc limit 1;
  if assignment.id is not null then
    return jsonb_build_object('offered', true, 'grouped', true, 'assignment', to_jsonb(assignment));
  end if;

  select availability.* into candidate
  from public.driver_availability availability
  join public.driver_profiles driver on driver.id = availability.driver_profile_id
  join public.custom_staff_members member on member.id = driver.custom_staff_member_id
  where availability.establishment_id = suggestion.establishment_id
    and availability.status = 'available'
    and availability.active_delivery_count = 0
    and driver.active and driver.approval_status = 'approved'
    and member.status = 'active'
    and (member.employment_type <> 'daily'
      or member.work_date = (now() at time zone 'America/Sao_Paulo')::date)
    and not exists (
      select 1 from public.delivery_assignments previous
      where previous.group_suggestion_id = suggestion.id
        and previous.driver_profile_id = availability.driver_profile_id
        and previous.status in ('rejected','expired','canceled')
    )
  order by availability.available_since asc nulls last,
    availability.last_completed_at asc nulls first,
    availability.driver_profile_id
  for update of availability skip locked
  limit 1;

  if candidate.driver_profile_id is null then
    return jsonb_build_object('offered', false, 'grouped', true,
      'reason', 'Nenhum motoboy disponivel para as duas entregas no momento.');
  end if;

  select * into first_order from public.orders where id = first_delivery.order_id;
  select * into second_order from public.orders where id = second_delivery.order_id;
  select coalesce(max(offer_rank), 0) + 1 into next_rank
  from public.delivery_assignments where group_suggestion_id = suggestion.id;

  insert into public.delivery_assignments(
    establishment_id, delivery_id, driver_profile_id, group_suggestion_id,
    offer_rank, dispatch_score, score_breakdown, expires_at
  ) values (
    suggestion.establishment_id, first_delivery.id, candidate.driver_profile_id, suggestion.id,
    next_rank, suggestion.compatibility_score,
    jsonb_build_object(
      'strategy', 'approved_delivery_group',
      'group_size', 2,
      'paired_delivery_id', second_delivery.id,
      'paired_order_number', second_order.order_number,
      'paired_customer_name', second_order.customer_name,
      'paired_total_cents', second_order.total_cents,
      'paired_delivery_fee_cents', second_delivery.customer_delivery_fee_cents,
      'available_since', candidate.available_since
    ),
    now() + interval '60 seconds'
  ) returning * into assignment;

  update public.driver_availability set status = 'offered'
  where driver_profile_id = candidate.driver_profile_id;

  insert into public.delivery_events(
    establishment_id, delivery_id, event_type, from_status, to_status,
    actor_type, actor_user_id, actor_driver_id, metadata
  ) values
    (suggestion.establishment_id, first_delivery.id, 'driver_group_offer_created',
      first_delivery.status, first_delivery.status,
      case when requested_actor is null then 'system' else 'user' end,
      requested_actor, candidate.driver_profile_id,
      jsonb_build_object('assignment_id', assignment.id, 'suggestion_id', suggestion.id,
        'paired_delivery_id', second_delivery.id, 'offer_rank', next_rank, 'expires_at', assignment.expires_at)),
    (suggestion.establishment_id, second_delivery.id, 'driver_group_offer_created',
      second_delivery.status, second_delivery.status,
      case when requested_actor is null then 'system' else 'user' end,
      requested_actor, candidate.driver_profile_id,
      jsonb_build_object('assignment_id', assignment.id, 'suggestion_id', suggestion.id,
        'paired_delivery_id', first_delivery.id, 'offer_rank', next_rank, 'expires_at', assignment.expires_at));

  return jsonb_build_object('offered', true, 'grouped', true,
    'assignment', to_jsonb(assignment), 'delivery_count', 2);
end $$;

create or replace function public.start_delivery_group_dispatch(requested_suggestion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  suggestion public.delivery_group_suggestions%rowtype;
  first_delivery public.deliveries%rowtype;
  second_delivery public.deliveries%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Autenticacao necessaria.'; end if;
  select * into suggestion from public.delivery_group_suggestions
  where id = requested_suggestion_id for update;
  if suggestion.id is null or suggestion.status <> 'approved'
    or not private.has_role(suggestion.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Agrupamento nao encontrado ou sem permissao.';
  end if;

  select * into first_delivery from public.deliveries where id = suggestion.first_delivery_id for update;
  select * into second_delivery from public.deliveries where id = suggestion.second_delivery_id for update;
  if first_delivery.status not in ('ready_for_dispatch','searching_driver')
    or second_delivery.status not in ('ready_for_dispatch','searching_driver') then
    raise exception 'Os dois pedidos precisam estar prontos e sem motoboy atribuido.';
  end if;

  if first_delivery.status = 'ready_for_dispatch' then
    update public.deliveries set status = 'searching_driver', dispatch_started_at = now()
    where id in (first_delivery.id, second_delivery.id);
    insert into public.delivery_events(
      establishment_id, delivery_id, event_type, from_status, to_status,
      actor_type, actor_user_id, metadata
    ) values
      (suggestion.establishment_id, first_delivery.id, 'group_dispatch_started',
        'ready_for_dispatch', 'searching_driver', 'user', actor,
        jsonb_build_object('suggestion_id', suggestion.id, 'paired_delivery_id', second_delivery.id)),
      (suggestion.establishment_id, second_delivery.id, 'group_dispatch_started',
        'ready_for_dispatch', 'searching_driver', 'user', actor,
        jsonb_build_object('suggestion_id', suggestion.id, 'paired_delivery_id', first_delivery.id));
  end if;

  result := private.offer_next_delivery_group_locked(suggestion.id, actor);
  return result || jsonb_build_object('suggestion_id', suggestion.id,
    'delivery_ids', jsonb_build_array(first_delivery.id, second_delivery.id));
end $$;

create or replace function public.accept_delivery_assignment(requested_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  assignment public.delivery_assignments%rowtype;
  paired_assignment public.delivery_assignments%rowtype;
  delivery public.deliveries%rowtype;
  paired_delivery public.deliveries%rowtype;
  suggestion public.delivery_group_suggestions%rowtype;
  availability public.driver_availability%rowtype;
  driver public.driver_profiles%rowtype;
begin
  if actor is null then raise exception 'Autenticacao necessaria.'; end if;
  select * into assignment from public.delivery_assignments where id = requested_assignment_id for update;
  if assignment.id is null then raise exception 'Chamada nao encontrada.'; end if;
  select * into driver from public.driver_profiles where id = assignment.driver_profile_id;
  if driver.user_id <> actor then raise exception 'Esta chamada pertence a outro motoboy.'; end if;
  select * into delivery from public.deliveries where id = assignment.delivery_id for update;
  select * into availability from public.driver_availability
    where driver_profile_id = assignment.driver_profile_id for update;

  if assignment.status <> 'offered' or assignment.expires_at <= now() then
    raise exception 'Esta chamada expirou ou ja foi respondida.';
  end if;

  if assignment.group_suggestion_id is null then
    if delivery.status <> 'searching_driver'
      or exists (select 1 from public.delivery_assignments where delivery_id = delivery.id and status = 'accepted') then
      raise exception 'Esta entrega ja foi assumida.';
    end if;
    update public.delivery_assignments set status = 'accepted', responded_at = now(), accepted_at = now()
    where id = assignment.id returning * into assignment;
    update public.deliveries set status = 'driver_assigned'
    where id = delivery.id returning * into delivery;
    update public.driver_availability set status = 'collecting', active_delivery_count = active_delivery_count + 1
    where driver_profile_id = driver.id returning * into availability;
    insert into public.delivery_events(
      establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
    ) values (delivery.establishment_id,delivery.id,'driver_offer_accepted','searching_driver','driver_assigned',
      'driver',actor,driver.id,jsonb_build_object('assignment_id',assignment.id));
    insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
    values(delivery.establishment_id,actor,'delivery.assignment_accepted','delivery_assignments',assignment.id,
      jsonb_build_object('delivery_id',delivery.id,'driver_profile_id',driver.id));
    return jsonb_build_object('assignment',to_jsonb(assignment),'delivery',to_jsonb(delivery),
      'availability',to_jsonb(availability),'grouped',false);
  end if;

  select * into suggestion from public.delivery_group_suggestions
  where id = assignment.group_suggestion_id for update;
  if suggestion.id is null or suggestion.status <> 'approved' then
    raise exception 'O agrupamento nao esta mais ativo.';
  end if;
  select * into paired_delivery from public.deliveries
  where id = case when delivery.id = suggestion.first_delivery_id
    then suggestion.second_delivery_id else suggestion.first_delivery_id end for update;
  if delivery.status <> 'searching_driver' or paired_delivery.status <> 'searching_driver'
    or exists (select 1 from public.delivery_assignments
      where delivery_id in (delivery.id, paired_delivery.id) and status = 'accepted') then
    raise exception 'Uma das entregas agrupadas ja foi assumida.';
  end if;

  update public.delivery_assignments set status = 'accepted', responded_at = now(), accepted_at = now()
  where id = assignment.id returning * into assignment;
  insert into public.delivery_assignments(
    establishment_id, delivery_id, driver_profile_id, group_suggestion_id,
    status, offer_rank, dispatch_score, score_breakdown,
    offered_at, expires_at, responded_at, accepted_at
  ) values (
    assignment.establishment_id, paired_delivery.id, assignment.driver_profile_id,
    assignment.group_suggestion_id, 'accepted', assignment.offer_rank,
    assignment.dispatch_score, assignment.score_breakdown,
    assignment.offered_at, assignment.expires_at, now(), now()
  ) returning * into paired_assignment;
  update public.deliveries set status = 'driver_assigned'
  where id in (delivery.id, paired_delivery.id);
  update public.driver_availability set status = 'collecting', active_delivery_count = active_delivery_count + 2
  where driver_profile_id = driver.id returning * into availability;

  insert into public.delivery_events(
    establishment_id, delivery_id, event_type, from_status, to_status,
    actor_type, actor_user_id, actor_driver_id, metadata
  ) values
    (delivery.establishment_id, delivery.id, 'driver_group_offer_accepted',
      'searching_driver', 'driver_assigned', 'driver', actor, driver.id,
      jsonb_build_object('assignment_id', assignment.id, 'suggestion_id', suggestion.id,
        'paired_delivery_id', paired_delivery.id)),
    (paired_delivery.establishment_id, paired_delivery.id, 'driver_group_offer_accepted',
      'searching_driver', 'driver_assigned', 'driver', actor, driver.id,
      jsonb_build_object('assignment_id', paired_assignment.id, 'suggestion_id', suggestion.id,
        'paired_delivery_id', delivery.id));
  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values(delivery.establishment_id, actor, 'delivery.group_assignment_accepted',
    'delivery_group_suggestions', suggestion.id,
    jsonb_build_object('delivery_ids', jsonb_build_array(delivery.id, paired_delivery.id),
      'driver_profile_id', driver.id, 'assignment_ids', jsonb_build_array(assignment.id, paired_assignment.id)));

  return jsonb_build_object('assignment', to_jsonb(assignment),
    'paired_assignment', to_jsonb(paired_assignment), 'delivery', to_jsonb(delivery),
    'paired_delivery', to_jsonb(paired_delivery), 'availability', to_jsonb(availability),
    'grouped', true, 'delivery_count', 2);
end $$;

create or replace function public.reject_delivery_assignment(
  requested_assignment_id uuid,
  requested_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  assignment public.delivery_assignments%rowtype;
  driver public.driver_profiles%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Autenticacao necessaria.'; end if;
  select * into assignment from public.delivery_assignments where id = requested_assignment_id for update;
  select * into driver from public.driver_profiles where id = assignment.driver_profile_id;
  if assignment.id is null or driver.user_id <> actor then raise exception 'Chamada nao encontrada.'; end if;
  if assignment.status <> 'offered' then raise exception 'Esta chamada ja foi respondida.'; end if;
  update public.delivery_assignments set status = 'rejected', responded_at = now(),
    rejection_reason = nullif(btrim(requested_reason),'')
  where id = assignment.id returning * into assignment;
  update public.driver_availability set status = 'available', available_since = now()
  where driver_profile_id = driver.id;
  insert into public.delivery_events(
    establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
  ) values (assignment.establishment_id,assignment.delivery_id,
    case when assignment.group_suggestion_id is null then 'driver_offer_rejected' else 'driver_group_offer_rejected' end,
    'searching_driver','searching_driver','driver',actor,driver.id,
    jsonb_build_object('assignment_id',assignment.id,'reason',assignment.rejection_reason,
      'suggestion_id',assignment.group_suggestion_id));
  result := case when assignment.group_suggestion_id is null
    then private.offer_next_driver_locked(assignment.delivery_id, actor)
    else private.offer_next_delivery_group_locked(assignment.group_suggestion_id, actor) end;
  return result || jsonb_build_object('rejected',true,'assignment_id',assignment.id);
end $$;

create or replace function public.expire_delivery_offer(requested_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  assignment public.delivery_assignments%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Autenticacao necessaria.'; end if;
  select * into assignment from public.delivery_assignments where id = requested_assignment_id for update;
  if assignment.id is null or not private.has_role(assignment.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissao para expirar esta chamada.';
  end if;
  if assignment.status <> 'offered' then
    return jsonb_build_object('expired',false,'status',assignment.status);
  end if;
  update public.delivery_assignments set status = 'expired', responded_at = now()
  where id = assignment.id returning * into assignment;
  update public.driver_availability set status = 'available', available_since = now()
  where driver_profile_id = assignment.driver_profile_id and status = 'offered';
  insert into public.delivery_events(
    establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
  ) values (assignment.establishment_id,assignment.delivery_id,
    case when assignment.group_suggestion_id is null then 'driver_offer_expired' else 'driver_group_offer_expired' end,
    'searching_driver','searching_driver','user',actor,assignment.driver_profile_id,
    jsonb_build_object('assignment_id',assignment.id,'suggestion_id',assignment.group_suggestion_id));
  result := case when assignment.group_suggestion_id is null
    then private.offer_next_driver_locked(assignment.delivery_id, actor)
    else private.offer_next_delivery_group_locked(assignment.group_suggestion_id, actor) end;
  return result || jsonb_build_object('expired',true,'assignment_id',assignment.id);
end $$;

revoke all on function private.offer_next_delivery_group_locked(uuid,uuid) from public, anon, authenticated;
revoke all on function public.start_delivery_group_dispatch(uuid) from public, anon;
grant execute on function public.start_delivery_group_dispatch(uuid) to authenticated;
