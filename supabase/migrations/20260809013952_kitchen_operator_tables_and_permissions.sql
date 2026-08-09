create table public.kitchen_operators (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(btrim(name)) between 2 and 120),
  phone text not null check (length(regexp_replace(phone, '\D', '', 'g')) between 10 and 15),
  status text not null default 'active' check (status in ('active','inactive','blocked')),
  access_type text not null default 'fixed' check (access_type in ('fixed','daily')),
  work_date date,
  device_mode text not null default 'dedicated' check (device_mode in ('shared','dedicated')),
  permissions jsonb not null default '{"accept_orders":true,"print_orders":true,"mark_ready":true}'::jsonb,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_operators_work_date_check check (
    (access_type = 'fixed' and work_date is null)
    or (access_type = 'daily' and work_date is not null)
  ),
  unique (establishment_id, phone)
);

create unique index kitchen_operators_user_unique
  on public.kitchen_operators(user_id) where user_id is not null;
create index kitchen_operators_establishment_status_idx
  on public.kitchen_operators(establishment_id, status);
create index kitchen_operators_daily_work_date_idx
  on public.kitchen_operators(establishment_id, work_date) where access_type = 'daily';

create table public.kitchen_access_links (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  operator_id uuid not null references public.kitchen_operators(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  used_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index kitchen_access_links_operator_idx on public.kitchen_access_links(operator_id);
create index kitchen_access_links_active_idx on public.kitchen_access_links(token, expires_at) where used_at is null;

alter table public.kitchen_operators enable row level security;
alter table public.kitchen_access_links enable row level security;

create policy kitchen_operators_manager_or_self_read on public.kitchen_operators
  for select to authenticated
  using (
    private.has_role(establishment_id, array['owner','manager']::public.member_role[])
    or user_id = (select auth.uid())
  );

create policy kitchen_access_links_manager_read on public.kitchen_access_links
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

revoke all on public.kitchen_operators, public.kitchen_access_links from anon, authenticated;
grant select on public.kitchen_operators, public.kitchen_access_links to authenticated;

create or replace function public.manage_kitchen_operator(
  requested_establishment_id uuid,
  requested_operator_id uuid,
  requested_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  saved public.kitchen_operators%rowtype;
  selected_access_type text := coalesce(requested_values ->> 'access_type', 'fixed');
  selected_work_date date := nullif(requested_values ->> 'work_date', '')::date;
  selected_status text := coalesce(requested_values ->> 'status', 'active');
  selected_device_mode text := coalesce(requested_values ->> 'device_mode', 'dedicated');
  normalized_phone text := regexp_replace(coalesce(requested_values ->> 'phone', ''), '\D', '', 'g');
begin
  if actor is null or not private.has_role(requested_establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para gerenciar a cozinha.';
  end if;
  if length(normalized_phone) not between 10 and 15 then raise exception 'Informe um WhatsApp válido.'; end if;
  if selected_access_type not in ('fixed','daily') then raise exception 'Tipo de acesso inválido.'; end if;
  if selected_access_type = 'daily' and selected_work_date is null then raise exception 'Informe a data do acesso diário.'; end if;
  if selected_status not in ('active','inactive','blocked') then raise exception 'Status inválido.'; end if;
  if selected_device_mode not in ('shared','dedicated') then raise exception 'Modo de tela inválido.'; end if;

  if requested_operator_id is null then
    insert into public.kitchen_operators (
      establishment_id, name, phone, status, access_type, work_date, device_mode, permissions
    ) values (
      requested_establishment_id,
      btrim(requested_values ->> 'name'),
      normalized_phone,
      selected_status,
      selected_access_type,
      case when selected_access_type = 'daily' then selected_work_date else null end,
      selected_device_mode,
      coalesce(requested_values -> 'permissions', '{"accept_orders":true,"print_orders":true,"mark_ready":true}'::jsonb)
    ) returning * into saved;
  else
    update public.kitchen_operators set
      name = coalesce(nullif(btrim(requested_values ->> 'name'), ''), name),
      phone = normalized_phone,
      status = selected_status,
      access_type = selected_access_type,
      work_date = case when selected_access_type = 'daily' then selected_work_date else null end,
      device_mode = selected_device_mode,
      permissions = coalesce(requested_values -> 'permissions', permissions),
      updated_at = now()
    where id = requested_operator_id and establishment_id = requested_establishment_id
    returning * into saved;
  end if;
  if saved.id is null then raise exception 'Operador da cozinha não encontrado.'; end if;

  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (requested_establishment_id, actor, 'kitchen.operator_updated', 'kitchen_operators', saved.id,
    jsonb_build_object('status', saved.status, 'access_type', saved.access_type, 'device_mode', saved.device_mode));
  return to_jsonb(saved);
end
$$;

create or replace function public.create_kitchen_invite(requested_operator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.kitchen_operators%rowtype;
  created public.kitchen_access_links%rowtype;
  invite_expires_at timestamptz;
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into target from public.kitchen_operators where id = requested_operator_id;
  if actor is null or target.id is null or not private.has_role(target.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para gerar o acesso da cozinha.';
  end if;
  if target.access_type = 'daily' and target.work_date < local_today then
    raise exception 'A data deste acesso já passou.';
  end if;
  invite_expires_at := case when target.access_type = 'daily'
    then ((target.work_date + 1)::timestamp at time zone 'America/Sao_Paulo')
    else now() + interval '48 hours' end;
  update public.kitchen_access_links set used_at = now() where operator_id = target.id and used_at is null;
  insert into public.kitchen_access_links(establishment_id, operator_id, expires_at, created_by)
  values (target.establishment_id, target.id, invite_expires_at, actor) returning * into created;
  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.establishment_id, actor, 'kitchen.invite_created', 'kitchen_operators', target.id,
    jsonb_build_object('expires_at', created.expires_at, 'access_type', target.access_type, 'work_date', target.work_date));
  return jsonb_build_object('token', created.token, 'expires_at', created.expires_at, 'access_type', target.access_type, 'work_date', target.work_date);
end
$$;

create or replace function public.claim_kitchen_invite_as_user(requested_token uuid, requested_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_record public.kitchen_access_links%rowtype;
  operator_record public.kitchen_operators%rowtype;
begin
  if requested_user_id is null or not exists (select 1 from auth.users where id = requested_user_id) then
    raise exception 'Usuário de acesso inválido.';
  end if;
  select * into link_record from public.kitchen_access_links
  where token = requested_token and used_at is null and expires_at > now() for update;
  if not found then raise exception 'Acesso inválido ou expirado.'; end if;
  select * into operator_record from public.kitchen_operators where id = link_record.operator_id for update;
  if exists (
    select 1 from public.establishment_members
    where user_id = requested_user_id and establishment_id <> link_record.establishment_id
  ) then raise exception 'Este WhatsApp já pertence a outro estabelecimento.'; end if;
  insert into public.establishment_members(establishment_id, user_id, role)
  values (link_record.establishment_id, requested_user_id, 'kitchen')
  on conflict (establishment_id, user_id) do update set role = 'kitchen';
  update public.kitchen_operators set user_id = requested_user_id, status = 'active', last_access_at = now(), updated_at = now()
  where id = operator_record.id returning * into operator_record;
  update public.kitchen_access_links set used_at = now() where id = link_record.id;
  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (link_record.establishment_id, requested_user_id, 'kitchen.phone_access_activated', 'kitchen_operators', operator_record.id, '{}');
  return to_jsonb(operator_record);
end
$$;

drop policy if exists kitchen_tickets_operations_read on public.kitchen_tickets;
create policy kitchen_tickets_operations_read on public.kitchen_tickets
  for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[]));
create policy orders_kitchen_read on public.orders for select to authenticated
  using (private.has_role(establishment_id, array['kitchen']::public.member_role[]));
create policy order_items_kitchen_read on public.order_items for select to authenticated
  using (private.has_role(establishment_id, array['kitchen']::public.member_role[]));
create policy table_orders_kitchen_read on public.table_orders for select to authenticated
  using (private.has_role(establishment_id, array['kitchen']::public.member_role[]));
create policy table_order_items_kitchen_read on public.table_order_items for select to authenticated
  using (private.has_role(establishment_id, array['kitchen']::public.member_role[]));
create policy table_sessions_kitchen_read on public.table_sessions for select to authenticated
  using (private.has_role(establishment_id, array['kitchen']::public.member_role[]));

create or replace function public.update_kitchen_ticket(requested_ticket_id uuid, requested_status public.kitchen_ticket_status)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.kitchen_tickets%rowtype;
  target_order public.table_orders%rowtype;
  target_session public.table_sessions%rowtype;
  waiter_record public.waiters%rowtype;
  kitchen_record public.kitchen_operators%rowtype;
  actor uuid := auth.uid();
  actor_name text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into target_ticket from public.kitchen_tickets where id = requested_ticket_id for update;
  if not found or not private.has_role(target_ticket.establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[]) then
    raise exception 'Comanda não encontrada.';
  end if;
  select * into waiter_record from public.waiters where establishment_id = target_ticket.establishment_id and user_id = actor;
  select * into kitchen_record from public.kitchen_operators where establishment_id = target_ticket.establishment_id and user_id = actor;
  select coalesce(nullif(btrim(kitchen_record.name),''), nullif(btrim(waiter_record.name),''), nullif(btrim(p.full_name),''), 'Equipe')
    into actor_name from public.profiles p where p.id = actor;
  actor_name := coalesce(actor_name, nullif(btrim(kitchen_record.name),''), nullif(btrim(waiter_record.name),''), 'Equipe');

  if private.has_role(target_ticket.establishment_id, array['kitchen']::public.member_role[]) then
    if kitchen_record.id is null or kitchen_record.status <> 'active'
      or (kitchen_record.access_type = 'daily' and kitchen_record.work_date <> (now() at time zone 'America/Sao_Paulo')::date) then
      raise exception 'O acesso da cozinha está inativo ou fora da data liberada.';
    end if;
    if requested_status = 'preparing' and not coalesce((kitchen_record.permissions ->> 'accept_orders')::boolean, false) then
      raise exception 'Sem permissão para aceitar pedidos.';
    end if;
    if requested_status = 'ready' and not coalesce((kitchen_record.permissions ->> 'mark_ready')::boolean, false) then
      raise exception 'Sem permissão para marcar pedidos como prontos.';
    end if;
    if requested_status not in ('preparing','ready') then raise exception 'Ação não permitida para a cozinha.'; end if;
  end if;

  if requested_status = 'canceled' then
    if not private.has_role(target_ticket.establishment_id, array['owner','manager']::public.member_role[]) then
      raise exception 'Somente proprietário ou gerente pode cancelar.';
    end if;
  elsif not ((target_ticket.status='received' and requested_status='preparing') or (target_ticket.status='preparing' and requested_status='ready') or (target_ticket.status='ready' and requested_status='delivered')) then
    raise exception 'Mudança de status inválida.';
  end if;

  update public.kitchen_tickets set status = requested_status,
    started_at = case when requested_status='preparing' then now() else started_at end,
    ready_at = case when requested_status='ready' then now() else ready_at end,
    delivered_at = case when requested_status='delivered' then now() else delivered_at end,
    delivered_by = case when requested_status='delivered' then actor else delivered_by end,
    delivered_by_name = case when requested_status='delivered' then actor_name else delivered_by_name end,
    updated_at = now()
  where id = requested_ticket_id returning * into target_ticket;
  if target_ticket.public_order_id is not null then
    update public.orders set status = (case requested_status when 'received' then 'new' when 'preparing' then 'preparing' when 'ready' then 'ready' when 'delivered' then 'completed' else 'canceled' end)::public.order_status, updated_at = now()
    where id = target_ticket.public_order_id;
  else
    update public.table_orders set kitchen_status = requested_status, updated_at = now()
    where id = target_ticket.table_order_id returning * into target_order;
    select * into target_session from public.table_sessions where id = target_order.table_session_id;
    update public.restaurant_tables set status = case requested_status when 'preparing' then 'preparing'::public.restaurant_table_status when 'ready' then 'ready'::public.restaurant_table_status else 'occupied'::public.restaurant_table_status end, updated_at = now()
    where id = target_session.table_id and status not in ('awaiting_payment','paid','blocked');
  end if;
  return to_jsonb(target_ticket);
end
$$;

revoke all on function public.manage_kitchen_operator(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_kitchen_invite(uuid) from public, anon;
revoke all on function public.claim_kitchen_invite_as_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.manage_kitchen_operator(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_kitchen_invite(uuid) to authenticated;
grant execute on function public.claim_kitchen_invite_as_user(uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='kitchen_operators'
  ) then alter publication supabase_realtime add table public.kitchen_operators; end if;
end
$$;
