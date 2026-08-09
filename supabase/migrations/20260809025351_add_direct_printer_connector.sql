create table public.printer_devices (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  printer_name text not null check (length(btrim(printer_name)) between 2 and 160),
  token_hash bytea not null unique,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.printer_jobs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  kitchen_ticket_id uuid references public.kitchen_tickets(id) on delete set null,
  device_id uuid references public.printer_devices(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  job_kind text not null default 'original' check (job_kind in ('original','reprint','test')),
  status text not null default 'queued' check (status in ('queued','processing','printed','failed')),
  payload jsonb not null,
  error_message text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

create index printer_devices_establishment_active_idx on public.printer_devices(establishment_id, active);
create index printer_devices_created_by_idx on public.printer_devices(created_by);
create index printer_jobs_queue_idx on public.printer_jobs(establishment_id, status, created_at);
create index printer_jobs_device_id_idx on public.printer_jobs(device_id);
create index printer_jobs_requested_by_idx on public.printer_jobs(requested_by);
create unique index printer_jobs_original_ticket_unique on public.printer_jobs(kitchen_ticket_id)
  where job_kind = 'original' and kitchen_ticket_id is not null;

alter table public.printer_devices enable row level security;
alter table public.printer_jobs enable row level security;

create or replace function public.register_printer_connector(
  requested_establishment_id uuid,
  requested_name text,
  requested_printer_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  saved public.printer_devices%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Somente o administrador pode instalar o conector.';
  end if;
  insert into public.printer_devices(establishment_id,name,printer_name,token_hash,created_by)
  values (requested_establishment_id,btrim(requested_name),btrim(requested_printer_name),extensions.digest(raw_token,'sha256'),auth.uid())
  returning * into saved;
  return jsonb_build_object('id',saved.id,'token',raw_token,'name',saved.name,'printer_name',saved.printer_name);
end
$$;

create or replace function public.get_printer_connector_status(requested_establishment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected public.printer_devices%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id, null) then
    raise exception 'Acesso não autorizado.';
  end if;
  select * into selected from public.printer_devices
  where establishment_id=requested_establishment_id and active
  order by last_seen_at desc nulls last,created_at desc limit 1;
  if selected.id is null then return jsonb_build_object('configured',false,'online',false); end if;
  return jsonb_build_object('configured',true,'online',selected.last_seen_at > now()-interval '20 seconds',
    'name',selected.name,'printer_name',selected.printer_name,'last_seen_at',selected.last_seen_at);
end
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
  saved public.printer_jobs%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into ticket from public.kitchen_tickets where id=requested_ticket_id;
  if ticket.id is null or not private.has_role(ticket.establishment_id,array['owner','manager','kitchen']::public.member_role[]) then
    raise exception 'Comanda não encontrada.';
  end if;
  if private.has_role(ticket.establishment_id,array['kitchen']::public.member_role[]) then
    select * into operator from public.kitchen_operators where establishment_id=ticket.establishment_id and user_id=actor;
    if operator.id is null or operator.status <> 'active' or not coalesce((operator.permissions->>'print_orders')::boolean,false) then
      raise exception 'Este operador não possui permissão para imprimir.';
    end if;
  end if;
  if length(coalesce(requested_text,'')) not between 10 and 12000 then raise exception 'Conteúdo da impressão inválido.'; end if;

  if not requested_reprint then
    select * into saved from public.printer_jobs where kitchen_ticket_id=ticket.id and job_kind='original' limit 1;
    if saved.id is not null then return to_jsonb(saved); end if;
  end if;

  insert into public.printer_jobs(establishment_id,kitchen_ticket_id,requested_by,job_kind,payload)
  values(ticket.establishment_id,ticket.id,actor,case when requested_reprint then 'reprint' else 'original' end,jsonb_build_object('text',requested_text))
  on conflict (kitchen_ticket_id) where job_kind='original' and kitchen_ticket_id is not null do nothing
  returning * into saved;
  if saved.id is null then select * into saved from public.printer_jobs where kitchen_ticket_id=ticket.id and job_kind='original' limit 1; end if;
  return to_jsonb(saved);
end
$$;

create or replace function public.fetch_printer_jobs(requested_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.printer_devices%rowtype;
  claimed public.printer_jobs%rowtype;
begin
  if length(coalesce(requested_token,'')) <> 64 then raise exception 'Conector inválido.'; end if;
  select * into device from public.printer_devices where token_hash=extensions.digest(requested_token,'sha256') and active for update;
  if device.id is null then raise exception 'Conector inválido ou desativado.'; end if;
  update public.printer_devices set last_seen_at=now(),updated_at=now() where id=device.id;
  update public.printer_jobs set status='queued',device_id=null,claimed_at=null
    where establishment_id=device.establishment_id and status='processing' and claimed_at < now()-interval '2 minutes';
  update public.printer_jobs set status='processing',device_id=device.id,claimed_at=now(),error_message=null
  where id=(select id from public.printer_jobs where establishment_id=device.establishment_id and status='queued'
    order by created_at limit 1 for update skip locked)
  returning * into claimed;
  if claimed.id is null then return jsonb_build_object('jobs','[]'::jsonb,'printer_name',device.printer_name); end if;
  return jsonb_build_object('jobs',jsonb_build_array(jsonb_build_object('id',claimed.id,'text',claimed.payload->>'text')),'printer_name',device.printer_name);
end
$$;

create or replace function public.complete_printer_job(
  requested_token text,
  requested_job_id uuid,
  requested_success boolean,
  requested_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.printer_devices%rowtype;
  saved public.printer_jobs%rowtype;
begin
  if length(coalesce(requested_token,'')) <> 64 then raise exception 'Conector inválido.'; end if;
  select * into device from public.printer_devices where token_hash=extensions.digest(requested_token,'sha256') and active;
  if device.id is null then raise exception 'Conector inválido ou desativado.'; end if;
  update public.printer_jobs set status=case when requested_success then 'printed' else 'failed' end,
    completed_at=now(),error_message=case when requested_success then null else left(coalesce(requested_error,'Falha na impressora.'),500) end
  where id=requested_job_id and device_id=device.id and status='processing' returning * into saved;
  if saved.id is null then raise exception 'Trabalho de impressão não encontrado.'; end if;
  return to_jsonb(saved);
end
$$;

revoke all on public.printer_devices,public.printer_jobs from anon,authenticated;
revoke all on function public.register_printer_connector(uuid,text,text) from public,anon;
revoke all on function public.get_printer_connector_status(uuid) from public,anon;
revoke all on function public.queue_kitchen_print(uuid,text,boolean) from public,anon;
revoke all on function public.fetch_printer_jobs(text) from public,authenticated;
revoke all on function public.complete_printer_job(text,uuid,boolean,text) from public,authenticated;
grant execute on function public.register_printer_connector(uuid,text,text) to authenticated;
grant execute on function public.get_printer_connector_status(uuid) to authenticated;
grant execute on function public.queue_kitchen_print(uuid,text,boolean) to authenticated;
grant execute on function public.fetch_printer_jobs(text) to anon;
grant execute on function public.complete_printer_job(text,uuid,boolean,text) to anon;
