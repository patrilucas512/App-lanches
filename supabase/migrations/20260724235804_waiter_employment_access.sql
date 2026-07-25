alter table public.waiters
  add column employment_type text not null default 'fixed',
  add column work_date date;

alter table public.waiters
  add constraint waiters_employment_type_check
    check (employment_type in ('fixed', 'daily')),
  add constraint waiters_work_date_check
    check (
      (employment_type = 'fixed' and work_date is null)
      or (employment_type = 'daily' and work_date is not null)
    );

create index waiters_daily_work_date_idx
  on public.waiters (establishment_id, work_date)
  where employment_type = 'daily';

create or replace function public.manage_waiter(
  requested_establishment_id uuid,
  requested_waiter_id uuid,
  requested_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  saved public.waiters%rowtype;
  requested_employment_type text := coalesce(requested_values ->> 'employment_type', 'fixed');
  requested_work_date date := nullif(requested_values ->> 'work_date', '')::date;
begin
  if actor is null or not private.has_role(
    requested_establishment_id,
    array['owner','manager']::public.member_role[]
  ) then
    raise exception 'Sem permissão para gerenciar garçons.';
  end if;

  if requested_employment_type not in ('fixed', 'daily') then
    raise exception 'Tipo de vínculo inválido.';
  end if;
  if requested_employment_type = 'daily' and requested_work_date is null then
    raise exception 'Informe a data de trabalho do diarista.';
  end if;

  if requested_waiter_id is null then
    insert into public.waiters (
      establishment_id, name, phone, email, sector, status, active_now,
      shift_start, shift_end, permissions, employment_type, work_date
    )
    values (
      requested_establishment_id,
      btrim(requested_values ->> 'name'),
      nullif(btrim(requested_values ->> 'phone'), ''),
      null,
      nullif(btrim(requested_values ->> 'sector'), ''),
      coalesce(requested_values ->> 'status', 'inactive'),
      coalesce((requested_values ->> 'active_now')::boolean, false),
      nullif(requested_values ->> 'shift_start', '')::time,
      nullif(requested_values ->> 'shift_end', '')::time,
      coalesce(requested_values -> 'permissions', '{}'::jsonb),
      requested_employment_type,
      case when requested_employment_type = 'daily' then requested_work_date else null end
    )
    returning * into saved;
  else
    update public.waiters
    set
      name = coalesce(nullif(btrim(requested_values ->> 'name'), ''), name),
      phone = nullif(btrim(requested_values ->> 'phone'), ''),
      email = null,
      sector = nullif(btrim(requested_values ->> 'sector'), ''),
      status = coalesce(requested_values ->> 'status', status),
      active_now = coalesce((requested_values ->> 'active_now')::boolean, active_now),
      shift_start = nullif(requested_values ->> 'shift_start', '')::time,
      shift_end = nullif(requested_values ->> 'shift_end', '')::time,
      permissions = coalesce(requested_values -> 'permissions', permissions),
      employment_type = requested_employment_type,
      work_date = case when requested_employment_type = 'daily' then requested_work_date else null end,
      updated_at = now()
    where id = requested_waiter_id
      and establishment_id = requested_establishment_id
    returning * into saved;
  end if;

  if saved.id is null then
    raise exception 'Garçom não encontrado.';
  end if;

  insert into public.audit_logs (
    establishment_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    requested_establishment_id,
    actor,
    'waiter.updated',
    'waiters',
    saved.id,
    jsonb_build_object(
      'status', saved.status,
      'active_now', saved.active_now,
      'sector', saved.sector,
      'employment_type', saved.employment_type,
      'work_date', saved.work_date
    )
  );

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
  invite_expires_at timestamptz;
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into target
  from public.waiters
  where id = requested_waiter_id;

  if actor is null or target.id is null or not private.has_role(
    target.establishment_id,
    array['owner','manager']::public.member_role[]
  ) then
    raise exception 'Sem permissão para gerar convite.';
  end if;
  if target.phone is null or btrim(target.phone) = '' then
    raise exception 'Cadastre o WhatsApp do garçom antes de gerar o acesso.';
  end if;
  if target.employment_type = 'daily' and target.work_date < local_today then
    raise exception 'A data da diária já passou. Escolha uma nova data.';
  end if;

  invite_expires_at := case
    when target.employment_type = 'daily'
      then ((target.work_date + 1)::timestamp at time zone 'America/Sao_Paulo')
    else now() + interval '48 hours'
  end;

  update public.waiter_access_links
  set used_at = now()
  where waiter_id = target.id
    and used_at is null;

  insert into public.waiter_access_links (
    establishment_id, waiter_id, created_by, expires_at
  )
  values (
    target.establishment_id, target.id, actor, invite_expires_at
  )
  returning * into created;

  insert into public.audit_logs (
    establishment_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    target.establishment_id,
    actor,
    'waiter.invite_created',
    'waiters',
    target.id,
    jsonb_build_object(
      'expires_at', created.expires_at,
      'employment_type', target.employment_type,
      'work_date', target.work_date
    )
  );

  return jsonb_build_object(
    'token', created.token,
    'expires_at', created.expires_at,
    'employment_type', target.employment_type,
    'work_date', target.work_date
  );
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
      select count(*)
      from public.waiters w
      where w.establishment_id = e.id
        and w.active_now
        and w.status in ('active','serving')
        and (
          w.employment_type = 'fixed'
          or w.work_date = (now() at time zone 'America/Sao_Paulo')::date
        )
    ))
  )
  from public.establishments e
  join public.service_modes sm on sm.establishment_id = e.id
  where e.slug = requested_slug
    and e.active
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
  permission_key text := case tg_table_name
    when 'table_sessions' then 'open_tables'
    when 'table_orders' then 'create_orders'
    when 'table_payments' then 'register_payments'
    else null
  end;
begin
  if actor is not null and private.has_role(
    establishment,
    array['attendant']::public.member_role[]
  ) then
    if not exists (
      select 1
      from public.service_modes sm
      join public.waiters w
        on w.establishment_id = sm.establishment_id
       and w.user_id = actor
      where sm.establishment_id = establishment
        and sm.waiter_mode_enabled
        and w.active_now
        and w.status in ('active','serving')
        and (
          w.employment_type = 'fixed'
          or w.work_date = (now() at time zone 'America/Sao_Paulo')::date
        )
        and (
          permission_key is null
          or coalesce((w.permissions ->> permission_key)::boolean, false)
        )
    ) then
      raise exception 'Seu acesso está inativo, fora da data liberada ou sem permissão.';
    end if;
  end if;
  return new;
end
$$;

create or replace function private.enforce_waiter_session_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is not null
    and private.has_role(new.establishment_id, array['attendant']::public.member_role[])
    and new.status = 'awaiting_payment'
    and old.status <> new.status
    and not exists (
      select 1
      from public.waiters w
      where w.establishment_id = new.establishment_id
        and w.user_id = actor
        and w.active_now
        and w.status in ('active','serving')
        and (
          w.employment_type = 'fixed'
          or w.work_date = (now() at time zone 'America/Sao_Paulo')::date
        )
        and coalesce((w.permissions ->> 'close_bills')::boolean, false)
    )
  then
    raise exception 'Você não pode fechar contas fora da data liberada ou sem permissão.';
  end if;
  return new;
end
$$;
