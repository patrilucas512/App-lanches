create table public.driver_availability (
  driver_profile_id uuid primary key references public.driver_profiles(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  status text not null default 'offline'
    check (status in ('offline','available','offered','collecting','delivering','paused','blocked')),
  available_since timestamptz,
  paused_at timestamptz,
  pause_reason text,
  last_completed_at timestamptz,
  active_delivery_count integer not null default 0 check (active_delivery_count >= 0),
  last_location_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint driver_availability_profile_tenant_fk
    foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete cascade
);

create index driver_availability_dispatch_queue_idx
  on public.driver_availability(establishment_id, status, available_since, last_completed_at, driver_profile_id);

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deliveries'::regclass
      and conname = 'deliveries_id_establishment_unique'
  ) then
    alter table public.deliveries
      add constraint deliveries_id_establishment_unique unique (id, establishment_id);
  end if;
end $$;

create table public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  delivery_id uuid not null,
  driver_profile_id uuid not null,
  status text not null default 'offered'
    check (status in ('offered','accepted','rejected','expired','canceled','completed')),
  offer_rank integer not null default 1 check (offer_rank > 0),
  dispatch_score numeric(12,4),
  score_breakdown jsonb not null default '{}'::jsonb,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  rejection_reason text,
  canceled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_assignments_delivery_tenant_fk
    foreign key (delivery_id, establishment_id)
    references public.deliveries(id, establishment_id) on delete cascade,
  constraint delivery_assignments_driver_tenant_fk
    foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete cascade
);

create unique index delivery_assignments_one_offered_delivery_idx
  on public.delivery_assignments(delivery_id) where status = 'offered';
create unique index delivery_assignments_one_accepted_delivery_idx
  on public.delivery_assignments(delivery_id) where status = 'accepted';
create unique index delivery_assignments_one_offered_driver_idx
  on public.delivery_assignments(driver_profile_id) where status = 'offered';
create index delivery_assignments_driver_timeline_idx
  on public.delivery_assignments(driver_profile_id, offered_at desc);
create index delivery_assignments_delivery_timeline_idx
  on public.delivery_assignments(delivery_id, offered_at desc);

alter table public.delivery_events
  add column if not exists actor_driver_id uuid references public.driver_profiles(id) on delete set null;

create trigger driver_availability_touch before update on public.driver_availability
for each row execute function public.touch_updated_at();
create trigger delivery_assignments_touch before update on public.delivery_assignments
for each row execute function public.touch_updated_at();

create or replace function private.ensure_driver_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.driver_availability(driver_profile_id, establishment_id, status)
  values(new.id, new.establishment_id,
    case when new.active and new.approval_status = 'approved' then 'offline' else 'blocked' end)
  on conflict(driver_profile_id) do update set
    establishment_id = excluded.establishment_id,
    status = case
      when not new.active or new.approval_status <> 'approved' then 'blocked'
      when public.driver_availability.status = 'blocked' then 'offline'
      else public.driver_availability.status end;
  return new;
end $$;

drop trigger if exists driver_profiles_ensure_availability on public.driver_profiles;
create trigger driver_profiles_ensure_availability
after insert or update of active, approval_status on public.driver_profiles
for each row execute function private.ensure_driver_availability();

insert into public.driver_availability(driver_profile_id, establishment_id, status)
select id, establishment_id,
  case when active and approval_status = 'approved' then 'offline' else 'blocked' end
from public.driver_profiles
on conflict(driver_profile_id) do nothing;

alter table public.driver_availability enable row level security;
alter table public.delivery_assignments enable row level security;

create policy driver_availability_admin_read on public.driver_availability for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy driver_availability_self_read on public.driver_availability for select to authenticated
using (exists (
  select 1 from public.driver_profiles driver
  where driver.id = driver_profile_id and driver.user_id = (select auth.uid())
));

create policy delivery_assignments_admin_read on public.delivery_assignments for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy delivery_assignments_self_read on public.delivery_assignments for select to authenticated
using (exists (
  select 1 from public.driver_profiles driver
  where driver.id = driver_profile_id and driver.user_id = (select auth.uid())
));

create policy deliveries_driver_assigned_read on public.deliveries for select to authenticated
using (exists (
  select 1 from public.delivery_assignments assignment
  join public.driver_profiles driver on driver.id = assignment.driver_profile_id
  where assignment.delivery_id = deliveries.id
    and assignment.status in ('offered','accepted','completed')
    and driver.user_id = (select auth.uid())
));

create policy orders_driver_assigned_read on public.orders for select to authenticated
using (exists (
  select 1 from public.deliveries delivery
  join public.delivery_assignments assignment on assignment.delivery_id = delivery.id
  join public.driver_profiles driver on driver.id = assignment.driver_profile_id
  where delivery.order_id = orders.id
    and assignment.status in ('offered','accepted','completed')
    and driver.user_id = (select auth.uid())
));

create policy delivery_events_driver_read on public.delivery_events for select to authenticated
using (exists (
  select 1 from public.delivery_assignments assignment
  join public.driver_profiles driver on driver.id = assignment.driver_profile_id
  where assignment.delivery_id = delivery_events.delivery_id
    and assignment.status in ('offered','accepted','completed')
    and driver.user_id = (select auth.uid())
));

create or replace function public.set_driver_availability(
  requested_status text,
  requested_pause_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  member public.custom_staff_members%rowtype;
  availability public.driver_availability%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if requested_status not in ('available','paused','offline') then
    raise exception 'Status de disponibilidade inválido.';
  end if;

  select * into driver from public.driver_profiles where user_id = actor for update;
  if driver.id is null then raise exception 'Perfil de motoboy não encontrado.'; end if;
  select * into member from public.custom_staff_members where id = driver.custom_staff_member_id;
  if not driver.active or driver.approval_status <> 'approved' or member.status <> 'active'
    or (member.employment_type = 'daily' and member.work_date <> (now() at time zone 'America/Sao_Paulo')::date) then
    raise exception 'Seu acesso não está ativo para este turno.';
  end if;

  select * into availability from public.driver_availability
  where driver_profile_id = driver.id for update;
  if availability.active_delivery_count > 0 or availability.status in ('collecting','delivering') then
    raise exception 'Finalize a entrega ativa antes de mudar sua disponibilidade.';
  end if;

  update public.driver_availability set
    status = requested_status,
    available_since = case when requested_status = 'available' then now() else null end,
    paused_at = case when requested_status = 'paused' then now() else null end,
    pause_reason = case when requested_status = 'paused' then nullif(btrim(requested_pause_reason),'') else null end
  where driver_profile_id = driver.id returning * into availability;

  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values(driver.establishment_id, actor, 'driver.availability_changed', 'driver_profiles', driver.id,
    jsonb_build_object('status', requested_status, 'pause_reason', availability.pause_reason));
  return to_jsonb(availability);
end $$;

create or replace function private.offer_next_driver_locked(
  requested_delivery_id uuid,
  requested_actor uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  delivery public.deliveries%rowtype;
  candidate public.driver_availability%rowtype;
  assignment public.delivery_assignments%rowtype;
  next_rank integer;
begin
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if delivery.id is null then raise exception 'Entrega não encontrada.'; end if;
  if delivery.status <> 'searching_driver' then
    raise exception 'A entrega não está procurando motoboy.';
  end if;

  update public.delivery_assignments set status = 'expired', responded_at = now()
  where delivery_id = delivery.id and status = 'offered' and expires_at <= now();

  update public.driver_availability availability set
    status = 'available', available_since = now()
  where availability.status = 'offered'
    and exists (
      select 1 from public.delivery_assignments expired
      where expired.driver_profile_id = availability.driver_profile_id
        and expired.delivery_id = delivery.id and expired.status = 'expired'
    );

  if exists (select 1 from public.delivery_assignments where delivery_id = delivery.id and status = 'offered') then
    select * into assignment from public.delivery_assignments
    where delivery_id = delivery.id and status = 'offered';
    return jsonb_build_object('offered', true, 'assignment', to_jsonb(assignment));
  end if;

  select availability.* into candidate
  from public.driver_availability availability
  join public.driver_profiles driver on driver.id = availability.driver_profile_id
  join public.custom_staff_members member on member.id = driver.custom_staff_member_id
  where availability.establishment_id = delivery.establishment_id
    and availability.status = 'available'
    and availability.active_delivery_count = 0
    and driver.active and driver.approval_status = 'approved'
    and member.status = 'active'
    and (member.employment_type <> 'daily'
      or member.work_date = (now() at time zone 'America/Sao_Paulo')::date)
  order by availability.available_since asc nulls last,
    availability.last_completed_at asc nulls first,
    availability.driver_profile_id
  for update of availability skip locked
  limit 1;

  if candidate.driver_profile_id is null then
    return jsonb_build_object('offered', false, 'reason', 'Nenhum motoboy disponível no momento.');
  end if;

  select coalesce(max(offer_rank),0) + 1 into next_rank
  from public.delivery_assignments where delivery_id = delivery.id;

  insert into public.delivery_assignments(
    establishment_id, delivery_id, driver_profile_id, offer_rank,
    dispatch_score, score_breakdown, expires_at
  ) values (
    delivery.establishment_id, delivery.id, candidate.driver_profile_id, next_rank,
    0, jsonb_build_object('strategy','fair_queue','available_since',candidate.available_since),
    now() + interval '60 seconds'
  ) returning * into assignment;

  update public.driver_availability set status = 'offered'
  where driver_profile_id = candidate.driver_profile_id;

  insert into public.delivery_events(
    establishment_id, delivery_id, event_type, from_status, to_status,
    actor_type, actor_user_id, actor_driver_id, metadata
  ) values (
    delivery.establishment_id, delivery.id, 'driver_offer_created', delivery.status, delivery.status,
    case when requested_actor is null then 'system' else 'user' end,
    requested_actor, candidate.driver_profile_id,
    jsonb_build_object('assignment_id',assignment.id,'offer_rank',next_rank,'expires_at',assignment.expires_at)
  );
  return jsonb_build_object('offered', true, 'assignment', to_jsonb(assignment));
end $$;

create or replace function public.start_delivery_dispatch(requested_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  delivery public.deliveries%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into delivery from public.deliveries where id = requested_delivery_id for update;
  if delivery.id is null or not private.has_role(delivery.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para iniciar este despacho.';
  end if;
  if delivery.status not in ('ready_for_dispatch','searching_driver') then
    raise exception 'Esta entrega não está pronta para despacho.';
  end if;

  if delivery.status = 'ready_for_dispatch' then
    update public.deliveries set status = 'searching_driver', dispatch_started_at = now()
    where id = delivery.id returning * into delivery;
    insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id)
    values(delivery.establishment_id,delivery.id,'dispatch_started','ready_for_dispatch','searching_driver','user',actor);
  end if;
  result := private.offer_next_driver_locked(delivery.id, actor);
  return result || jsonb_build_object('delivery_id',delivery.id,'delivery_status','searching_driver');
end $$;

create or replace function public.accept_delivery_assignment(requested_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  assignment public.delivery_assignments%rowtype;
  delivery public.deliveries%rowtype;
  availability public.driver_availability%rowtype;
  driver public.driver_profiles%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into assignment from public.delivery_assignments where id = requested_assignment_id for update;
  if assignment.id is null then raise exception 'Chamada não encontrada.'; end if;
  select * into driver from public.driver_profiles where id = assignment.driver_profile_id;
  if driver.user_id <> actor then raise exception 'Esta chamada pertence a outro motoboy.'; end if;
  select * into delivery from public.deliveries where id = assignment.delivery_id for update;
  select * into availability from public.driver_availability
    where driver_profile_id = assignment.driver_profile_id for update;

  if assignment.status <> 'offered' or assignment.expires_at <= now() then
    raise exception 'Esta chamada expirou ou já foi respondida.';
  end if;
  if delivery.status <> 'searching_driver'
    or exists (select 1 from public.delivery_assignments where delivery_id = delivery.id and status = 'accepted') then
    raise exception 'Esta entrega já foi assumida.';
  end if;

  update public.delivery_assignments set
    status = 'accepted', responded_at = now(), accepted_at = now()
  where id = assignment.id returning * into assignment;
  update public.deliveries set status = 'driver_assigned'
  where id = delivery.id returning * into delivery;
  update public.driver_availability set status = 'collecting', active_delivery_count = active_delivery_count + 1
  where driver_profile_id = driver.id returning * into availability;

  insert into public.delivery_events(
    establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
  ) values (
    delivery.establishment_id,delivery.id,'driver_offer_accepted','searching_driver','driver_assigned',
    'driver',actor,driver.id,jsonb_build_object('assignment_id',assignment.id)
  );
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(delivery.establishment_id,actor,'delivery.assignment_accepted','delivery_assignments',assignment.id,
    jsonb_build_object('delivery_id',delivery.id,'driver_profile_id',driver.id));
  return jsonb_build_object('assignment',to_jsonb(assignment),'delivery',to_jsonb(delivery),'availability',to_jsonb(availability));
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
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into assignment from public.delivery_assignments where id = requested_assignment_id for update;
  select * into driver from public.driver_profiles where id = assignment.driver_profile_id;
  if assignment.id is null or driver.user_id <> actor then raise exception 'Chamada não encontrada.'; end if;
  if assignment.status <> 'offered' then raise exception 'Esta chamada já foi respondida.'; end if;

  update public.delivery_assignments set status = 'rejected', responded_at = now(),
    rejection_reason = nullif(btrim(requested_reason),'')
  where id = assignment.id returning * into assignment;
  update public.driver_availability set status = 'available', available_since = now()
  where driver_profile_id = driver.id;
  insert into public.delivery_events(
    establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,actor_driver_id,metadata
  ) values (
    assignment.establishment_id,assignment.delivery_id,'driver_offer_rejected','searching_driver','searching_driver',
    'driver',actor,driver.id,jsonb_build_object('assignment_id',assignment.id,'reason',assignment.rejection_reason)
  );
  result := private.offer_next_driver_locked(assignment.delivery_id, actor);
  return result || jsonb_build_object('rejected',true,'assignment_id',assignment.id);
end $$;

create or replace function public.expire_delivery_offer(requested_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  assignment public.delivery_assignments%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into assignment from public.delivery_assignments where id = requested_assignment_id for update;
  if assignment.id is null or not private.has_role(assignment.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para expirar esta chamada.';
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
  ) values (
    assignment.establishment_id,assignment.delivery_id,'driver_offer_expired','searching_driver','searching_driver',
    'user',actor,assignment.driver_profile_id,jsonb_build_object('assignment_id',assignment.id)
  );
  result := private.offer_next_driver_locked(assignment.delivery_id, actor);
  return result || jsonb_build_object('expired',true,'assignment_id',assignment.id);
end $$;

revoke all on public.driver_availability, public.delivery_assignments from anon, authenticated;
grant select on public.driver_availability, public.delivery_assignments to authenticated;

revoke all on function private.ensure_driver_availability() from public,anon,authenticated;
revoke all on function private.offer_next_driver_locked(uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_driver_availability(text,text) from public,anon;
revoke all on function public.start_delivery_dispatch(uuid) from public,anon;
revoke all on function public.accept_delivery_assignment(uuid) from public,anon;
revoke all on function public.reject_delivery_assignment(uuid,text) from public,anon;
revoke all on function public.expire_delivery_offer(uuid) from public,anon;
grant execute on function public.set_driver_availability(text,text) to authenticated;
grant execute on function public.start_delivery_dispatch(uuid) to authenticated;
grant execute on function public.accept_delivery_assignment(uuid) to authenticated;
grant execute on function public.reject_delivery_assignment(uuid,text) to authenticated;
grant execute on function public.expire_delivery_offer(uuid) to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='driver_availability'
  ) then alter publication supabase_realtime add table public.driver_availability; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_assignments'
  ) then alter publication supabase_realtime add table public.delivery_assignments; end if;
end $$;
