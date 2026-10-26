-- Keep printer registrations and route each order to the active kitchen and cashier printers.

drop index if exists public.printer_jobs_original_ticket_unique;
create unique index if not exists printer_jobs_original_ticket_device_unique
  on public.printer_jobs(kitchen_ticket_id, target_device_id)
  where job_kind = 'original' and kitchen_ticket_id is not null and target_device_id is not null;

create or replace function public.set_printer_device_active(
  requested_device_id uuid,
  requested_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.printer_devices%rowtype;
  replacement_id uuid;
begin
  select * into saved from public.printer_devices where id = requested_device_id for update;
  if saved.id is null or auth.uid() is null
    or not private.has_role(saved.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Impressora não encontrada.';
  end if;

  if requested_active then
    update public.printer_devices
    set active = true,
        auto_print = case when sector in ('kitchen','cashier') then true else auto_print end,
        is_default = is_default or not exists (
          select 1 from public.printer_devices other
          where other.establishment_id = saved.establishment_id
            and other.sector = saved.sector
            and other.id <> saved.id
            and other.active and other.is_default
        ),
        updated_at = now()
    where id = saved.id
    returning * into saved;

    if saved.sector = 'kitchen' then
      update public.service_modes
      set auto_print_kitchen = true, updated_at = now()
      where establishment_id = saved.establishment_id;
    end if;
  else
    update public.printer_devices
    set active = false, is_default = false, updated_at = now()
    where id = saved.id
    returning * into saved;

    select id into replacement_id
    from public.printer_devices
    where establishment_id = saved.establishment_id
      and sector = saved.sector and active and id <> saved.id
    order by last_seen_at desc nulls last, created_at
    limit 1;
    if replacement_id is not null then
      update public.printer_devices set is_default = true, updated_at = now()
      where id = replacement_id;
    end if;
  end if;

  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values(saved.establishment_id, auth.uid(), 'printer.active_updated', 'printer_devices', saved.id,
    jsonb_build_object('active', saved.active, 'sector', saved.sector));
  return to_jsonb(saved);
end;
$$;

create or replace function public.queue_kitchen_print(
  requested_ticket_id uuid,
  requested_text text,
  requested_reprint boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  ticket public.kitchen_tickets%rowtype;
  operator public.kitchen_operators%rowtype;
  device public.printer_devices%rowtype;
  saved public.printer_jobs%rowtype;
  kitchen_job public.printer_jobs%rowtype;
  kitchen_found boolean := false;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into ticket from public.kitchen_tickets where id = requested_ticket_id;
  if ticket.id is null
    or not private.has_role(ticket.establishment_id, array['owner','manager','kitchen']::public.member_role[]) then
    raise exception 'Comanda não encontrada.';
  end if;
  if private.has_role(ticket.establishment_id, array['kitchen']::public.member_role[]) then
    select * into operator from public.kitchen_operators
    where establishment_id = ticket.establishment_id and user_id = actor;
    if operator.id is null or operator.status <> 'active'
      or not coalesce((operator.permissions->>'print_orders')::boolean, false) then
      raise exception 'Este operador não possui permissão para imprimir.';
    end if;
  end if;
  if length(coalesce(requested_text, '')) not between 10 and 12000 then
    raise exception 'Conteúdo da impressão inválido.';
  end if;

  for device in
    select distinct on (printer.sector) printer.*
    from public.printer_devices printer
    where printer.establishment_id = ticket.establishment_id
      and printer.active and printer.sector in ('kitchen','cashier')
    order by printer.sector, printer.is_default desc,
      printer.last_seen_at desc nulls last, printer.created_at
  loop
    if device.sector = 'kitchen' then kitchen_found := true; end if;
    saved := null;
    if requested_reprint then
      insert into public.printer_jobs(
        establishment_id, kitchen_ticket_id, target_device_id, requested_by, job_kind, payload
      ) values (
        ticket.establishment_id, ticket.id, device.id, actor, 'reprint',
        jsonb_build_object('text', requested_text, 'sector', device.sector)
      ) returning * into saved;
    else
      insert into public.printer_jobs(
        establishment_id, kitchen_ticket_id, target_device_id, requested_by, job_kind, payload
      ) values (
        ticket.establishment_id, ticket.id, device.id, actor, 'original',
        jsonb_build_object('text', requested_text, 'sector', device.sector)
      )
      on conflict (kitchen_ticket_id, target_device_id)
        where job_kind = 'original' and kitchen_ticket_id is not null and target_device_id is not null
      do nothing
      returning * into saved;
      if saved.id is null then
        select * into saved from public.printer_jobs
        where kitchen_ticket_id = ticket.id and target_device_id = device.id and job_kind = 'original'
        limit 1;
      end if;
    end if;
    if device.sector = 'kitchen' then kitchen_job := saved; end if;
  end loop;

  if not kitchen_found then raise exception 'Ative uma impressora para a cozinha.'; end if;
  return to_jsonb(kitchen_job);
end;
$$;

revoke all on function public.set_printer_device_active(uuid, boolean) from public, anon;
grant execute on function public.set_printer_device_active(uuid, boolean) to authenticated;
revoke all on function public.queue_kitchen_print(uuid, text, boolean) from public, anon;
grant execute on function public.queue_kitchen_print(uuid, text, boolean) to authenticated;
