alter table public.waiters
  add column payment_cycle text not null default 'monthly'
  check (payment_cycle in ('daily','weekly','biweekly','monthly'));

alter table public.kitchen_operators
  add column payment_cycle text not null default 'monthly'
  check (payment_cycle in ('daily','weekly','biweekly','monthly'));

update public.waiters set payment_cycle = 'daily' where employment_type = 'daily';
update public.kitchen_operators set payment_cycle = 'daily' where access_type = 'daily';

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
  requested_payment_cycle text := coalesce(requested_values ->> 'payment_cycle', case when requested_employment_type = 'daily' then 'daily' else 'monthly' end);
begin
  if actor is null or not private.has_role(requested_establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para gerenciar garçons.';
  end if;
  if requested_employment_type not in ('fixed','daily') then raise exception 'Tipo de vínculo inválido.'; end if;
  if requested_employment_type = 'daily' and requested_work_date is null then raise exception 'Informe a data de trabalho do diarista.'; end if;
  if requested_payment_cycle not in ('daily','weekly','biweekly','monthly') then raise exception 'Forma de pagamento inválida.'; end if;

  if requested_waiter_id is null then
    insert into public.waiters (
      establishment_id, name, phone, email, sector, status, active_now, shift_start, shift_end,
      permissions, employment_type, work_date, payment_cycle
    ) values (
      requested_establishment_id, btrim(requested_values ->> 'name'), nullif(btrim(requested_values ->> 'phone'), ''), null,
      nullif(btrim(requested_values ->> 'sector'), ''), coalesce(requested_values ->> 'status', 'inactive'),
      coalesce((requested_values ->> 'active_now')::boolean, false), nullif(requested_values ->> 'shift_start', '')::time,
      nullif(requested_values ->> 'shift_end', '')::time, coalesce(requested_values -> 'permissions', '{}'::jsonb),
      requested_employment_type, case when requested_employment_type = 'daily' then requested_work_date else null end,
      requested_payment_cycle
    ) returning * into saved;
  else
    update public.waiters set
      name = coalesce(nullif(btrim(requested_values ->> 'name'), ''), name),
      phone = nullif(btrim(requested_values ->> 'phone'), ''), email = null,
      sector = nullif(btrim(requested_values ->> 'sector'), ''),
      status = coalesce(requested_values ->> 'status', status),
      active_now = coalesce((requested_values ->> 'active_now')::boolean, active_now),
      shift_start = nullif(requested_values ->> 'shift_start', '')::time,
      shift_end = nullif(requested_values ->> 'shift_end', '')::time,
      permissions = coalesce(requested_values -> 'permissions', permissions),
      employment_type = requested_employment_type,
      work_date = case when requested_employment_type = 'daily' then requested_work_date else null end,
      payment_cycle = requested_payment_cycle,
      updated_at = now()
    where id = requested_waiter_id and establishment_id = requested_establishment_id
    returning * into saved;
  end if;
  if saved.id is null then raise exception 'Garçom não encontrado.'; end if;
  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (requested_establishment_id, actor, 'waiter.updated', 'waiters', saved.id,
    jsonb_build_object('status',saved.status,'active_now',saved.active_now,'sector',saved.sector,'employment_type',saved.employment_type,'work_date',saved.work_date,'payment_cycle',saved.payment_cycle));
  return to_jsonb(saved);
end
$$;

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
  selected_payment_cycle text := coalesce(requested_values ->> 'payment_cycle', case when selected_access_type = 'daily' then 'daily' else 'monthly' end);
  normalized_phone text := regexp_replace(coalesce(requested_values ->> 'phone', ''), '\D', '', 'g');
begin
  if actor is null or not private.has_role(requested_establishment_id, array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para gerenciar a cozinha.'; end if;
  if length(normalized_phone) not between 10 and 15 then raise exception 'Informe um WhatsApp válido.'; end if;
  if selected_access_type not in ('fixed','daily') then raise exception 'Tipo de acesso inválido.'; end if;
  if selected_access_type = 'daily' and selected_work_date is null then raise exception 'Informe a data do acesso diário.'; end if;
  if selected_status not in ('active','inactive','blocked') then raise exception 'Status inválido.'; end if;
  if selected_device_mode not in ('shared','dedicated') then raise exception 'Modo de tela inválido.'; end if;
  if selected_payment_cycle not in ('daily','weekly','biweekly','monthly') then raise exception 'Forma de pagamento inválida.'; end if;

  if requested_operator_id is null then
    insert into public.kitchen_operators(establishment_id,name,phone,status,access_type,work_date,device_mode,permissions,payment_cycle)
    values (requested_establishment_id,btrim(requested_values ->> 'name'),normalized_phone,selected_status,selected_access_type,
      case when selected_access_type='daily' then selected_work_date else null end,selected_device_mode,
      coalesce(requested_values -> 'permissions','{"accept_orders":true,"print_orders":true,"mark_ready":true}'::jsonb),selected_payment_cycle)
    returning * into saved;
  else
    update public.kitchen_operators set
      name=coalesce(nullif(btrim(requested_values ->> 'name'),''),name), phone=normalized_phone,
      status=selected_status, access_type=selected_access_type,
      work_date=case when selected_access_type='daily' then selected_work_date else null end,
      device_mode=selected_device_mode, permissions=coalesce(requested_values -> 'permissions',permissions),
      payment_cycle=selected_payment_cycle, updated_at=now()
    where id=requested_operator_id and establishment_id=requested_establishment_id returning * into saved;
  end if;
  if saved.id is null then raise exception 'Operador da cozinha não encontrado.'; end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values (requested_establishment_id,actor,'kitchen.operator_updated','kitchen_operators',saved.id,
    jsonb_build_object('status',saved.status,'access_type',saved.access_type,'device_mode',saved.device_mode,'payment_cycle',saved.payment_cycle));
  return to_jsonb(saved);
end
$$;

revoke all on function public.manage_waiter(uuid,uuid,jsonb) from public, anon;
revoke all on function public.manage_kitchen_operator(uuid,uuid,jsonb) from public, anon;
grant execute on function public.manage_waiter(uuid,uuid,jsonb) to authenticated;
grant execute on function public.manage_kitchen_operator(uuid,uuid,jsonb) to authenticated;
