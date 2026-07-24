-- Generated with Supabase CLI; timestamp adjusted to follow the existing waiter migrations.

create table public.service_modes (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references public.establishments(id) on delete cascade,
  mode text not null default 'mixed' check (mode in ('counter', 'delivery', 'waiter', 'mixed')),
  waiter_mode_enabled boolean not null default true,
  table_service_enabled boolean not null default true,
  counter_pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  customer_self_order_enabled boolean not null default true,
  waiter_call_enabled boolean not null default true,
  bill_closing_enabled boolean not null default true,
  card_proof_required boolean not null default false,
  manual_active_waiters integer check (manual_active_waiters is null or manual_active_waiters between 0 and 999),
  accepted_payment_methods jsonb not null default '["pix","cash","credit_card","debit_card"]'::jsonb,
  manager_approval_for_discount boolean not null default true,
  manager_approval_for_cancellation boolean not null default true,
  audit_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.waiters (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(btrim(name)) between 2 and 120),
  phone text,
  email text,
  status text not null default 'inactive' check (status in ('active','inactive','serving','paused','blocked')),
  sector text,
  active_now boolean not null default false,
  shift_start time,
  shift_end time,
  permissions jsonb not null default '{
    "open_tables": true,
    "create_orders": true,
    "close_bills": true,
    "register_payments": true,
    "apply_discount": false,
    "cancel_items": false
  }'::jsonb,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, email)
);

create table public.waiter_access_links (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  waiter_id uuid not null references public.waiters(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  used_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.restaurant_tables
  add column assigned_waiter_id uuid references public.waiters(id) on delete set null;

alter table public.table_payments
  add column waiter_id uuid references public.waiters(id) on delete set null,
  add column waiter_name text,
  add column table_id uuid references public.restaurant_tables(id) on delete set null,
  add column table_number text,
  add column card_proof_image_url text,
  add column card_machine_name text,
  add column card_transaction_reference text,
  add column cash_received_cents integer check (cash_received_cents is null or cash_received_cents >= 0),
  add column cash_change_cents integer check (cash_change_cents is null or cash_change_cents >= 0),
  add column notes text,
  add column device_info text;

create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  table_payment_id uuid not null references public.table_payments(id) on delete cascade,
  waiter_id uuid references public.waiters(id) on delete set null,
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete restrict,
  payment_method text not null check (payment_method in ('credit_card','debit_card')),
  amount_cents integer not null check (amount_cents > 0),
  image_path text not null,
  notes text,
  device_info text,
  created_at timestamptz not null default now()
);

create index waiters_establishment_status_idx on public.waiters (establishment_id, status, active_now);
create index waiters_user_idx on public.waiters (user_id) where user_id is not null;
create index waiter_access_links_waiter_idx on public.waiter_access_links (waiter_id);
create index waiter_access_links_active_idx on public.waiter_access_links (token, expires_at) where used_at is null;
create index restaurant_tables_assigned_waiter_idx on public.restaurant_tables (assigned_waiter_id) where assigned_waiter_id is not null;
create index table_payments_waiter_idx on public.table_payments (waiter_id) where waiter_id is not null;
create index table_payments_table_idx on public.table_payments (table_id) where table_id is not null;
create index payment_proofs_establishment_created_idx on public.payment_proofs (establishment_id, created_at desc);
create index payment_proofs_payment_idx on public.payment_proofs (table_payment_id);
create index payment_proofs_waiter_idx on public.payment_proofs (waiter_id) where waiter_id is not null;
create index payment_proofs_session_idx on public.payment_proofs (table_session_id);
create index payment_proofs_table_idx on public.payment_proofs (table_id);

alter table public.service_modes enable row level security;
alter table public.waiters enable row level security;
alter table public.waiter_access_links enable row level security;
alter table public.payment_proofs enable row level security;

create policy service_modes_member_read on public.service_modes for select to authenticated
  using (private.has_role(establishment_id, null));
create policy waiters_member_read on public.waiters for select to authenticated
  using (private.has_role(establishment_id, null));
create policy waiter_links_manager_read on public.waiter_access_links for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy payment_proofs_manager_read on public.payment_proofs for select to authenticated
  using (
    private.has_role(establishment_id, array['owner','manager']::public.member_role[])
    or waiter_id in (select w.id from public.waiters w where w.user_id = (select auth.uid()))
  );

revoke all on public.service_modes, public.waiters, public.waiter_access_links, public.payment_proofs
  from anon, authenticated;
grant select on public.service_modes, public.waiters, public.waiter_access_links, public.payment_proofs
  to authenticated;

insert into public.service_modes (establishment_id, mode, waiter_mode_enabled, table_service_enabled,
  counter_pickup_enabled, delivery_enabled, customer_self_order_enabled, waiter_call_enabled, bill_closing_enabled)
select e.id, 'mixed', true, true,
  coalesce(s.pickup_enabled, true), coalesce(s.delivery_enabled, true), true,
  coalesce(s.waiter_calls_enabled, true), true
from public.establishments e
left join public.establishment_settings s on s.establishment_id = e.id
on conflict (establishment_id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy payment_proofs_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] in (
    select m.establishment_id::text
    from public.establishment_members m
    where m.user_id = (select auth.uid())
      and m.role in ('owner','manager','attendant')
  )
);
create policy payment_proofs_storage_read on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] in (
    select m.establishment_id::text
    from public.establishment_members m
    where m.user_id = (select auth.uid())
      and m.role in ('owner','manager','attendant')
  )
);

create or replace function public.update_service_mode(requested_establishment_id uuid, requested_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  saved public.service_modes%rowtype;
  old_config jsonb;
  selected_mode text := coalesce(requested_config ->> 'mode', 'mixed');
begin
  if actor is null or not private.has_role(requested_establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Somente proprietário ou gerente pode alterar o atendimento.';
  end if;
  if selected_mode not in ('counter','delivery','waiter','mixed') then raise exception 'Modo inválido.'; end if;
  select to_jsonb(sm) into old_config from public.service_modes sm where establishment_id = requested_establishment_id;
  insert into public.service_modes (
    establishment_id, mode, waiter_mode_enabled, table_service_enabled, counter_pickup_enabled,
    delivery_enabled, customer_self_order_enabled, waiter_call_enabled, bill_closing_enabled,
    card_proof_required, manual_active_waiters, accepted_payment_methods,
    manager_approval_for_discount, manager_approval_for_cancellation, audit_enabled
  ) values (
    requested_establishment_id, selected_mode,
    coalesce((requested_config ->> 'waiter_mode_enabled')::boolean, false),
    coalesce((requested_config ->> 'table_service_enabled')::boolean, false),
    coalesce((requested_config ->> 'counter_pickup_enabled')::boolean, false),
    coalesce((requested_config ->> 'delivery_enabled')::boolean, false),
    coalesce((requested_config ->> 'customer_self_order_enabled')::boolean, false),
    coalesce((requested_config ->> 'waiter_call_enabled')::boolean, false),
    coalesce((requested_config ->> 'bill_closing_enabled')::boolean, false),
    coalesce((requested_config ->> 'card_proof_required')::boolean, false),
    nullif(requested_config ->> 'manual_active_waiters', '')::integer,
    case when jsonb_typeof(requested_config -> 'accepted_payment_methods') = 'array'
      then requested_config -> 'accepted_payment_methods' else '[]'::jsonb end,
    coalesce((requested_config ->> 'manager_approval_for_discount')::boolean, true),
    coalesce((requested_config ->> 'manager_approval_for_cancellation')::boolean, true),
    coalesce((requested_config ->> 'audit_enabled')::boolean, true)
  )
  on conflict (establishment_id) do update set
    mode = excluded.mode,
    waiter_mode_enabled = excluded.waiter_mode_enabled,
    table_service_enabled = excluded.table_service_enabled,
    counter_pickup_enabled = excluded.counter_pickup_enabled,
    delivery_enabled = excluded.delivery_enabled,
    customer_self_order_enabled = excluded.customer_self_order_enabled,
    waiter_call_enabled = excluded.waiter_call_enabled,
    bill_closing_enabled = excluded.bill_closing_enabled,
    card_proof_required = excluded.card_proof_required,
    manual_active_waiters = excluded.manual_active_waiters,
    accepted_payment_methods = excluded.accepted_payment_methods,
    manager_approval_for_discount = excluded.manager_approval_for_discount,
    manager_approval_for_cancellation = excluded.manager_approval_for_cancellation,
    audit_enabled = excluded.audit_enabled,
    updated_at = now()
  returning * into saved;
  update public.establishment_settings set
    pickup_enabled = saved.counter_pickup_enabled,
    delivery_enabled = saved.delivery_enabled,
    dine_in_enabled = saved.table_service_enabled,
    waiter_calls_enabled = saved.waiter_call_enabled
  where establishment_id = requested_establishment_id;
  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (requested_establishment_id, actor, 'service_mode.updated', 'service_modes', saved.id,
    jsonb_build_object('old', old_config - 'id' - 'establishment_id', 'new', to_jsonb(saved) - 'id' - 'establishment_id'));
  return to_jsonb(saved);
end
$$;

create or replace function public.manage_waiter(requested_establishment_id uuid, requested_waiter_id uuid, requested_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  saved public.waiters%rowtype;
begin
  if actor is null or not private.has_role(requested_establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para gerenciar garçons.';
  end if;
  if requested_waiter_id is null then
    insert into public.waiters (establishment_id, name, phone, email, sector, status, active_now, shift_start, shift_end, permissions)
    values (
      requested_establishment_id, btrim(requested_values ->> 'name'),
      nullif(btrim(requested_values ->> 'phone'), ''), nullif(lower(btrim(requested_values ->> 'email')), ''),
      nullif(btrim(requested_values ->> 'sector'), ''),
      coalesce(requested_values ->> 'status', 'inactive'),
      coalesce((requested_values ->> 'active_now')::boolean, false),
      nullif(requested_values ->> 'shift_start', '')::time,
      nullif(requested_values ->> 'shift_end', '')::time,
      coalesce(requested_values -> 'permissions', '{}'::jsonb)
    ) returning * into saved;
  else
    update public.waiters set
      name = coalesce(nullif(btrim(requested_values ->> 'name'), ''), name),
      phone = nullif(btrim(requested_values ->> 'phone'), ''),
      email = nullif(lower(btrim(requested_values ->> 'email')), ''),
      sector = nullif(btrim(requested_values ->> 'sector'), ''),
      status = coalesce(requested_values ->> 'status', status),
      active_now = coalesce((requested_values ->> 'active_now')::boolean, active_now),
      shift_start = nullif(requested_values ->> 'shift_start', '')::time,
      shift_end = nullif(requested_values ->> 'shift_end', '')::time,
      permissions = coalesce(requested_values -> 'permissions', permissions),
      updated_at = now()
    where id = requested_waiter_id and establishment_id = requested_establishment_id
    returning * into saved;
  end if;
  if saved.id is null then raise exception 'Garçom não encontrado.'; end if;
  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (requested_establishment_id, actor, 'waiter.updated', 'waiters', saved.id,
    jsonb_build_object('status', saved.status, 'active_now', saved.active_now, 'sector', saved.sector));
  return to_jsonb(saved);
end
$$;

create or replace function public.create_waiter_invite(requested_waiter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.waiters%rowtype;
  created public.waiter_access_links%rowtype;
begin
  select * into target from public.waiters where id = requested_waiter_id;
  if actor is null or target.id is null or not private.has_role(target.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para gerar convite.';
  end if;
  update public.waiter_access_links set used_at = now()
  where waiter_id = target.id and used_at is null;
  insert into public.waiter_access_links (establishment_id, waiter_id, created_by)
  values (target.establishment_id, target.id, actor) returning * into created;
  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.establishment_id, actor, 'waiter.invite_created', 'waiters', target.id,
    jsonb_build_object('expires_at', created.expires_at));
  return jsonb_build_object('token', created.token, 'expires_at', created.expires_at);
end
$$;

create or replace function public.claim_waiter_invite(requested_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  link_record public.waiter_access_links%rowtype;
  waiter_record public.waiters%rowtype;
begin
  if actor is null then raise exception 'Entre ou crie sua conta para aceitar o convite.'; end if;
  select * into link_record from public.waiter_access_links
  where token = requested_token and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'Convite inválido ou expirado.'; end if;
  select * into waiter_record from public.waiters where id = link_record.waiter_id for update;
  if exists (select 1 from public.establishment_members where user_id = actor and establishment_id <> link_record.establishment_id) then
    raise exception 'Esta conta já pertence a outro estabelecimento.';
  end if;
  insert into public.establishment_members (establishment_id, user_id, role)
  values (link_record.establishment_id, actor, 'attendant')
  on conflict (establishment_id, user_id) do update set role = 'attendant';
  update public.waiters set user_id = actor, status = 'active', active_now = true, last_access_at = now(), updated_at = now()
  where id = waiter_record.id returning * into waiter_record;
  update public.waiter_access_links set used_at = now() where id = link_record.id;
  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (link_record.establishment_id, actor, 'waiter.invite_claimed', 'waiters', waiter_record.id, '{}'::jsonb);
  return to_jsonb(waiter_record);
end
$$;

create or replace function public.get_public_service_mode(requested_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', sm.mode,
    'waiter_mode_enabled', sm.waiter_mode_enabled,
    'table_service_enabled', sm.table_service_enabled,
    'counter_pickup_enabled', sm.counter_pickup_enabled,
    'delivery_enabled', sm.delivery_enabled,
    'customer_self_order_enabled', sm.customer_self_order_enabled,
    'waiter_call_enabled', sm.waiter_call_enabled,
    'bill_closing_enabled', sm.bill_closing_enabled,
    'accepted_payment_methods', sm.accepted_payment_methods,
    'active_waiters', coalesce(sm.manual_active_waiters, (
      select count(*) from public.waiters w
      where w.establishment_id = e.id and w.active_now and w.status in ('active','serving')
    ))
  )
  from public.establishments e
  join public.service_modes sm on sm.establishment_id = e.id
  where e.slug = requested_slug and e.active
$$;

create or replace function public.register_table_payment(
  requested_session_id uuid,
  requested_payment_method text,
  requested_pix_payload text default null,
  requested_proof_path text default null,
  requested_card_machine text default null,
  requested_transaction_reference text default null,
  requested_cash_received_cents integer default null,
  requested_notes text default null,
  requested_device_info text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session_record public.table_sessions%rowtype;
  table_record public.restaurant_tables%rowtype;
  waiter_record public.waiters%rowtype;
  pix_record public.pix_settings%rowtype;
  mode_record public.service_modes%rowtype;
  payment_record public.table_payments%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into session_record from public.table_sessions where id = requested_session_id for update;
  if not found or not private.has_role(session_record.establishment_id, array['owner','manager','attendant']::public.member_role[]) then
    raise exception 'Conta não encontrada.';
  end if;
  if session_record.status <> 'awaiting_payment' or session_record.payment_status = 'confirmed' then
    raise exception 'Esta conta não aceita pagamento.';
  end if;
  select * into mode_record from public.service_modes where establishment_id = session_record.establishment_id;
  if not (mode_record.accepted_payment_methods ? requested_payment_method) then
    raise exception 'Forma de pagamento não aceita pelo estabelecimento.';
  end if;
  select * into waiter_record from public.waiters
  where establishment_id = session_record.establishment_id and user_id = actor;
  if private.has_role(session_record.establishment_id, array['attendant']::public.member_role[])
    and (waiter_record.id is null or waiter_record.status in ('inactive','paused','blocked') or not waiter_record.active_now) then
    raise exception 'Seu acesso está inativo. Fale com o administrador.';
  end if;
  select * into table_record from public.restaurant_tables where id = session_record.table_id;
  if requested_payment_method = 'pix' then
    select * into pix_record from public.pix_settings where establishment_id = session_record.establishment_id;
    if pix_record.id is null or nullif(btrim(requested_pix_payload), '') is null then raise exception 'Pix oficial inválido.'; end if;
  end if;
  if requested_payment_method in ('credit_card','debit_card') and mode_record.card_proof_required
    and nullif(btrim(requested_proof_path), '') is null then
    raise exception 'Anexe a foto do comprovante da maquininha.';
  end if;
  if requested_payment_method = 'cash' and requested_cash_received_cents is not null
    and requested_cash_received_cents < session_record.total_cents then
    raise exception 'O valor recebido é menor que o total.';
  end if;

  insert into public.table_payments (
    establishment_id, table_session_id, payment_method, amount_cents,
    pix_payload, pix_copy_paste, receiver_name, receiver_document_masked,
    status, confirmed_by, confirmed_at, waiter_id, waiter_name, table_id, table_number,
    card_proof_image_url, card_machine_name, card_transaction_reference,
    cash_received_cents, cash_change_cents, notes, device_info
  ) values (
    session_record.establishment_id, session_record.id, requested_payment_method, session_record.total_cents,
    case when requested_payment_method = 'pix' then requested_pix_payload end,
    case when requested_payment_method = 'pix' then requested_pix_payload end,
    case when requested_payment_method = 'pix' then pix_record.receiver_name end,
    case when requested_payment_method = 'pix' then pix_record.receiver_document_masked end,
    'confirmed', actor, now(), waiter_record.id, waiter_record.name, table_record.id, table_record.table_number,
    nullif(btrim(requested_proof_path), ''), nullif(btrim(requested_card_machine), ''),
    nullif(btrim(requested_transaction_reference), ''), requested_cash_received_cents,
    case when requested_payment_method = 'cash' and requested_cash_received_cents is not null
      then greatest(0, requested_cash_received_cents - session_record.total_cents) end,
    nullif(btrim(requested_notes), ''), left(requested_device_info, 500)
  ) returning * into payment_record;

  if requested_payment_method in ('credit_card','debit_card') and payment_record.card_proof_image_url is not null then
    insert into public.payment_proofs (
      establishment_id, table_payment_id, waiter_id, table_session_id, table_id,
      payment_method, amount_cents, image_path, notes, device_info
    ) values (
      session_record.establishment_id, payment_record.id, waiter_record.id, session_record.id, table_record.id,
      requested_payment_method, session_record.total_cents, payment_record.card_proof_image_url,
      payment_record.notes, payment_record.device_info
    );
  end if;
  update public.table_sessions set status = 'paid', payment_status = 'confirmed', updated_at = now()
  where id = session_record.id;
  update public.restaurant_tables set status = 'paid', updated_at = now() where id = table_record.id;
  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (session_record.establishment_id, actor, 'payment.registered', 'table_payments', payment_record.id,
    jsonb_build_object('waiter_id', waiter_record.id, 'table_id', table_record.id,
      'payment_method', requested_payment_method, 'amount_cents', session_record.total_cents,
      'proof_uploaded', payment_record.card_proof_image_url is not null, 'device_info', left(requested_device_info, 500)));
  return to_jsonb(payment_record);
end
$$;

create or replace function private.enforce_active_waiter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  establishment uuid := new.establishment_id;
begin
  if actor is not null and private.has_role(establishment, array['attendant']::public.member_role[]) then
    if not exists (
      select 1 from public.service_modes sm
      join public.waiters w on w.establishment_id = sm.establishment_id and w.user_id = actor
      where sm.establishment_id = establishment and sm.waiter_mode_enabled
        and w.active_now and w.status in ('active','serving')
    ) then raise exception 'Seu acesso está inativo. Fale com o administrador.'; end if;
  end if;
  return new;
end
$$;
create trigger table_sessions_active_waiter_guard before insert on public.table_sessions
for each row execute function private.enforce_active_waiter();
create trigger table_orders_active_waiter_guard before insert on public.table_orders
for each row execute function private.enforce_active_waiter();

create or replace function private.audit_table_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare action_name text;
begin
  if tg_table_name = 'table_sessions' and tg_op = 'INSERT' then action_name := 'table.opened';
  elsif tg_table_name = 'table_orders' and tg_op = 'INSERT' then action_name := 'table_order.created';
  elsif tg_table_name = 'table_sessions' and tg_op = 'UPDATE' and new.status = 'awaiting_payment' and old.status <> new.status then action_name := 'table.bill_closed';
  elsif tg_table_name = 'table_sessions' and tg_op = 'UPDATE' and new.status = 'closed' and old.status <> new.status then action_name := 'table.released';
  else return new; end if;
  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (new.establishment_id, auth.uid(), action_name, tg_table_name, new.id,
    jsonb_build_object(
      'old_status', case when tg_op = 'UPDATE' then to_jsonb(old) ->> 'status' else null end,
      'new_status', coalesce(to_jsonb(new) ->> 'status', to_jsonb(new) ->> 'kitchen_status')
    ));
  return new;
end
$$;
create trigger table_sessions_audit after insert or update on public.table_sessions
for each row execute function private.audit_table_operation();
create trigger table_orders_audit after insert on public.table_orders
for each row execute function private.audit_table_operation();

revoke all on function public.update_service_mode(uuid, jsonb) from public, anon;
revoke all on function public.manage_waiter(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_waiter_invite(uuid) from public, anon;
revoke all on function public.claim_waiter_invite(uuid) from public, anon;
revoke all on function public.register_table_payment(uuid, text, text, text, text, text, integer, text, text) from public, anon;
revoke all on function public.get_public_service_mode(text) from public;
grant execute on function public.update_service_mode(uuid, jsonb) to authenticated;
grant execute on function public.manage_waiter(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_waiter_invite(uuid) to authenticated;
grant execute on function public.claim_waiter_invite(uuid) to authenticated;
grant execute on function public.register_table_payment(uuid, text, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.get_public_service_mode(text) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'waiters'
  ) then alter publication supabase_realtime add table public.waiters; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_modes'
  ) then alter publication supabase_realtime add table public.service_modes; end if;
end
$$;
