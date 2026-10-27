do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'delivery_status') then
    create type public.delivery_status as enum (
      'pending', 'ready_for_dispatch', 'searching_driver', 'driver_assigned',
      'driver_to_pickup', 'picked_up', 'on_route', 'arrived', 'delivered',
      'returning_to_store', 'returned_to_store', 'failed', 'canceled'
    );
  end if;
end
$$;

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status public.delivery_status not null default 'pending',
  customer_delivery_fee_cents integer not null default 0 check (customer_delivery_fee_cents >= 0),
  ready_at timestamptz,
  dispatch_started_at timestamptz,
  picked_up_at timestamptz,
  arrived_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_events (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 3 and 80),
  from_status public.delivery_status,
  to_status public.delivery_status,
  actor_type text not null default 'system' check (actor_type in ('system','user','driver','customer')),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists deliveries_establishment_status_idx
  on public.deliveries(establishment_id, status, created_at);
create index if not exists delivery_events_delivery_timeline_idx
  on public.delivery_events(delivery_id, occurred_at, id);

drop trigger if exists deliveries_touch on public.deliveries;
create trigger deliveries_touch before update on public.deliveries
for each row execute function public.touch_updated_at();

alter table public.deliveries enable row level security;
alter table public.delivery_events enable row level security;

drop policy if exists deliveries_operations_select on public.deliveries;
create policy deliveries_operations_select on public.deliveries
for select to authenticated using (
  private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[])
);

drop policy if exists delivery_events_operations_select on public.delivery_events;
create policy delivery_events_operations_select on public.delivery_events
for select to authenticated using (
  private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[])
);

revoke all on table public.deliveries, public.delivery_events from anon, authenticated;
grant select on table public.deliveries, public.delivery_events to authenticated;

create or replace function private.ensure_delivery_for_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfillment_type = 'delivery' then
    insert into public.deliveries(
      establishment_id, order_id, status, customer_delivery_fee_cents, ready_at,
      picked_up_at, delivered_at, canceled_at
    ) values (
      new.establishment_id,
      new.id,
      case new.status
        when 'ready' then 'ready_for_dispatch'::public.delivery_status
        when 'out_for_delivery' then 'on_route'::public.delivery_status
        when 'completed' then 'delivered'::public.delivery_status
        when 'canceled' then 'canceled'::public.delivery_status
        else 'pending'::public.delivery_status
      end,
      new.delivery_fee_cents,
      case when new.status in ('ready','out_for_delivery','completed') then coalesce(new.updated_at, now()) end,
      case when new.status in ('out_for_delivery','completed') then coalesce(new.updated_at, now()) end,
      case when new.status = 'completed' then coalesce(new.updated_at, now()) end,
      case when new.status = 'canceled' then coalesce(new.updated_at, now()) end
    )
    on conflict (order_id) do update set
      customer_delivery_fee_cents = excluded.customer_delivery_fee_cents,
      updated_at = now();
  end if;
  return new;
end
$$;

drop trigger if exists orders_ensure_delivery on public.orders;
create trigger orders_ensure_delivery
after insert or update of fulfillment_type, delivery_fee_cents on public.orders
for each row execute function private.ensure_delivery_for_order();

insert into public.deliveries(
  establishment_id, order_id, status, customer_delivery_fee_cents, ready_at,
  picked_up_at, delivered_at, canceled_at, created_at, updated_at
)
select
  o.establishment_id,
  o.id,
  case o.status
    when 'ready' then 'ready_for_dispatch'::public.delivery_status
    when 'out_for_delivery' then 'on_route'::public.delivery_status
    when 'completed' then 'delivered'::public.delivery_status
    when 'canceled' then 'canceled'::public.delivery_status
    else 'pending'::public.delivery_status
  end,
  o.delivery_fee_cents,
  case when o.status in ('ready','out_for_delivery','completed') then coalesce(kt.ready_at,o.updated_at) end,
  case when o.status in ('out_for_delivery','completed') then o.updated_at end,
  case when o.status='completed' then o.updated_at end,
  case when o.status='canceled' then o.updated_at end,
  o.created_at,
  o.updated_at
from public.orders o
left join public.kitchen_tickets kt on kt.public_order_id=o.id
where o.fulfillment_type='delivery'
on conflict (order_id) do nothing;

insert into public.delivery_events(
  establishment_id, delivery_id, event_type, to_status, actor_type, metadata, occurred_at
)
select d.establishment_id, d.id, 'delivery_backfilled', d.status, 'system',
  jsonb_build_object('order_id',d.order_id), d.created_at
from public.deliveries d
where not exists (select 1 from public.delivery_events e where e.delivery_id=d.id);

create or replace function public.update_kitchen_ticket(
  requested_ticket_id uuid,
  requested_status public.kitchen_ticket_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.kitchen_tickets%rowtype;
  target_order public.table_orders%rowtype;
  target_session public.table_sessions%rowtype;
  public_order_record public.orders%rowtype;
  delivery_record public.deliveries%rowtype;
  waiter_record public.waiters%rowtype;
  kitchen_record public.kitchen_operators%rowtype;
  actor uuid := auth.uid();
  actor_name text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into target_ticket from public.kitchen_tickets where id=requested_ticket_id for update;
  if not found or not private.has_role(target_ticket.establishment_id,array['owner','manager','attendant','kitchen']::public.member_role[]) then
    raise exception 'Comanda não encontrada.';
  end if;

  if target_ticket.public_order_id is not null then
    select * into public_order_record from public.orders where id=target_ticket.public_order_id for update;
    if public_order_record.fulfillment_type='delivery' and requested_status='delivered' then
      raise exception 'Pedidos de entrega são concluídos pelo fluxo do motoboy, não pela cozinha.';
    end if;
  end if;

  select * into waiter_record from public.waiters where establishment_id=target_ticket.establishment_id and user_id=actor;
  select * into kitchen_record from public.kitchen_operators where establishment_id=target_ticket.establishment_id and user_id=actor;
  select coalesce(nullif(btrim(kitchen_record.name),''),nullif(btrim(waiter_record.name),''),nullif(btrim(p.full_name),''),'Equipe')
    into actor_name from public.profiles p where p.id=actor;
  actor_name := coalesce(actor_name,nullif(btrim(kitchen_record.name),''),nullif(btrim(waiter_record.name),''),'Equipe');

  if private.has_role(target_ticket.establishment_id,array['kitchen']::public.member_role[]) then
    if kitchen_record.id is null or kitchen_record.status <> 'active'
      or (kitchen_record.access_type='daily' and kitchen_record.work_date<>(now() at time zone 'America/Sao_Paulo')::date) then
      raise exception 'O acesso da cozinha está inativo ou fora da data liberada.';
    end if;
    if requested_status='preparing' and not coalesce((kitchen_record.permissions->>'accept_orders')::boolean,false) then
      raise exception 'Sem permissão para aceitar pedidos.';
    end if;
    if requested_status='ready' and not coalesce((kitchen_record.permissions->>'mark_ready')::boolean,false) then
      raise exception 'Sem permissão para marcar pedidos como prontos.';
    end if;
    if requested_status not in ('preparing','ready') then raise exception 'Ação não permitida para a cozinha.'; end if;
  end if;

  if requested_status='canceled' then
    if not private.has_role(target_ticket.establishment_id,array['owner','manager']::public.member_role[]) then
      raise exception 'Somente proprietário ou gerente pode cancelar.';
    end if;
  elsif not ((target_ticket.status='received' and requested_status='preparing')
    or (target_ticket.status='preparing' and requested_status='ready')
    or (target_ticket.status='ready' and requested_status='delivered')) then
    raise exception 'Mudança de status inválida.';
  end if;

  if public_order_record.fulfillment_type='delivery' then
    insert into public.deliveries(establishment_id,order_id,customer_delivery_fee_cents)
    values(public_order_record.establishment_id,public_order_record.id,public_order_record.delivery_fee_cents)
    on conflict(order_id) do nothing;
    select * into delivery_record from public.deliveries where order_id=public_order_record.id for update;
    if requested_status='ready' and delivery_record.status<>'pending' then
      raise exception 'Esta entrega não pode voltar para a etapa de despacho.';
    end if;
  end if;

  update public.kitchen_tickets set
    status=requested_status,
    started_at=case when requested_status='preparing' then now() else started_at end,
    ready_at=case when requested_status='ready' then now() else ready_at end,
    delivered_at=case when requested_status='delivered' then now() else delivered_at end,
    delivered_by=case when requested_status='delivered' then actor else delivered_by end,
    delivered_by_name=case when requested_status='delivered' then actor_name else delivered_by_name end,
    updated_at=now()
  where id=requested_ticket_id returning * into target_ticket;

  if target_ticket.public_order_id is not null then
    update public.orders set
      status=(case requested_status when 'received' then 'new' when 'preparing' then 'preparing' when 'ready' then 'ready' when 'delivered' then 'completed' else 'canceled' end)::public.order_status,
      updated_at=now()
    where id=target_ticket.public_order_id returning * into public_order_record;

    if public_order_record.fulfillment_type='delivery' and requested_status='ready' then
      update public.deliveries set status='ready_for_dispatch',ready_at=now(),updated_at=now()
      where id=delivery_record.id returning * into delivery_record;
      insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,metadata)
      values(delivery_record.establishment_id,delivery_record.id,'kitchen_marked_ready','pending','ready_for_dispatch','user',actor,
        jsonb_build_object('kitchen_ticket_id',target_ticket.id,'order_id',public_order_record.id,'operator_name',actor_name));
      insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
      values(delivery_record.establishment_id,actor,'delivery.ready_for_dispatch','deliveries',delivery_record.id,
        jsonb_build_object('order_id',public_order_record.id,'kitchen_ticket_id',target_ticket.id,'operator_name',actor_name));
    elsif public_order_record.fulfillment_type='delivery' and requested_status='preparing' then
      insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,metadata)
      values(delivery_record.establishment_id,delivery_record.id,'kitchen_started_preparing','pending','pending','user',actor,
        jsonb_build_object('kitchen_ticket_id',target_ticket.id,'order_id',public_order_record.id,'operator_name',actor_name));
    elsif public_order_record.fulfillment_type='delivery' and requested_status='canceled' then
      update public.deliveries set status='canceled',canceled_at=now(),updated_at=now()
      where id=delivery_record.id and status in ('pending','ready_for_dispatch') returning * into delivery_record;
      if found then
        insert into public.delivery_events(establishment_id,delivery_id,event_type,from_status,to_status,actor_type,actor_user_id,metadata)
        values(delivery_record.establishment_id,delivery_record.id,'delivery_canceled_by_kitchen',null,'canceled','user',actor,
          jsonb_build_object('kitchen_ticket_id',target_ticket.id,'order_id',public_order_record.id,'operator_name',actor_name));
      end if;
    end if;
  else
    update public.table_orders set kitchen_status=requested_status,updated_at=now()
    where id=target_ticket.table_order_id returning * into target_order;
    select * into target_session from public.table_sessions where id=target_order.table_session_id;
    update public.restaurant_tables set
      status=case requested_status when 'preparing' then 'preparing'::public.restaurant_table_status when 'ready' then 'ready'::public.restaurant_table_status else 'occupied'::public.restaurant_table_status end,
      updated_at=now()
    where id=target_session.table_id and status not in ('awaiting_payment','paid','blocked');
  end if;
  return to_jsonb(target_ticket) || jsonb_build_object('delivery_status',delivery_record.status);
end
$$;

revoke all on function public.update_kitchen_ticket(uuid,public.kitchen_ticket_status) from public,anon;
grant execute on function public.update_kitchen_ticket(uuid,public.kitchen_ticket_status) to authenticated;

revoke all on function private.ensure_delivery_for_order() from public,anon,authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='deliveries'
  ) then
    alter publication supabase_realtime add table public.deliveries;
  end if;
end
$$;
