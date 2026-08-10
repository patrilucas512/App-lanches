create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cash_registers_establishment_name_unique
  on public.cash_registers(establishment_id, lower(name));
create index if not exists cash_registers_establishment_active_idx
  on public.cash_registers(establishment_id, active);
alter table public.cash_registers enable row level security;

alter table public.printer_devices
  add column if not exists sector text not null default 'kitchen',
  add column if not exists connection_type text not null default 'usb',
  add column if not exists paper_width integer not null default 58,
  add column if not exists network_address text,
  add column if not exists auto_print boolean not null default false,
  add column if not exists is_default boolean not null default false,
  add column if not exists cash_register_id uuid references public.cash_registers(id) on delete set null;

alter table public.printer_devices drop constraint if exists printer_devices_sector_check;
alter table public.printer_devices add constraint printer_devices_sector_check
  check (sector in ('kitchen','counter','cashier','bar','delivery','other'));
alter table public.printer_devices drop constraint if exists printer_devices_connection_type_check;
alter table public.printer_devices add constraint printer_devices_connection_type_check
  check (connection_type in ('usb','bluetooth','network'));
alter table public.printer_devices drop constraint if exists printer_devices_paper_width_check;
alter table public.printer_devices add constraint printer_devices_paper_width_check check (paper_width in (58,80));
create unique index if not exists printer_devices_default_sector_unique
  on public.printer_devices(establishment_id, sector) where active and is_default;
create index if not exists printer_devices_register_idx on public.printer_devices(cash_register_id) where active;

alter table public.printer_jobs add column if not exists target_device_id uuid references public.printer_devices(id) on delete set null;
create index if not exists printer_jobs_target_queue_idx on public.printer_jobs(target_device_id,status,created_at);

insert into public.cash_registers(establishment_id,name,created_by)
select e.id,'Caixa 1',m.user_id
from public.establishments e
left join lateral (select user_id from public.establishment_members where establishment_id=e.id and role='owner' limit 1) m on true
where not exists (select 1 from public.cash_registers r where r.establishment_id=e.id);

alter table public.cash_shifts add column if not exists cash_register_id uuid references public.cash_registers(id) on delete restrict;
update public.cash_shifts s set cash_register_id=(select r.id from public.cash_registers r where r.establishment_id=s.establishment_id order by r.created_at limit 1) where cash_register_id is null;
alter table public.cash_shifts alter column cash_register_id set not null;
drop index if exists public.cash_shifts_one_open_per_establishment;
create unique index if not exists cash_shifts_one_open_per_register on public.cash_shifts(cash_register_id) where status='open';
create unique index if not exists cash_shifts_one_open_per_operator on public.cash_shifts(staff_member_id) where status='open';
create index if not exists cash_shifts_register_opened_idx on public.cash_shifts(cash_register_id,opened_at desc);

drop policy if exists cash_registers_admin_all on public.cash_registers;
create policy cash_registers_admin_all on public.cash_registers for all to authenticated
using (private.has_role(establishment_id,array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
drop policy if exists cash_registers_employee_read on public.cash_registers;
create policy cash_registers_employee_read on public.cash_registers for select to authenticated
using (private.is_financial_employee(establishment_id));
grant select on public.cash_registers to authenticated;

create or replace function public.list_printer_devices(requested_establishment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Acesso não autorizado.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'printer_name',p.printer_name,'sector',p.sector,'connection_type',p.connection_type,
    'paper_width',p.paper_width,'network_address',p.network_address,'auto_print',p.auto_print,'is_default',p.is_default,
    'cash_register_id',p.cash_register_id,'active',p.active,'online',p.last_seen_at>now()-interval '20 seconds','last_seen_at',p.last_seen_at
  ) order by p.active desc,p.sector,p.name),'[]'::jsonb) into result from public.printer_devices p where p.establishment_id=requested_establishment_id;
  return result;
end $$;

create or replace function public.register_printer_device(
  requested_establishment_id uuid, requested_name text, requested_sector text, requested_connection_type text,
  requested_paper_width integer, requested_network_address text default null, requested_auto_print boolean default false,
  requested_is_default boolean default false, requested_cash_register_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare raw_token text:=encode(extensions.gen_random_bytes(32),'hex'); saved public.printer_devices%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente o administrador pode cadastrar impressoras.'; end if;
  if requested_sector not in ('kitchen','counter','cashier','bar','delivery','other') or requested_connection_type not in ('usb','bluetooth','network') or requested_paper_width not in (58,80) then raise exception 'Configuração de impressora inválida.'; end if;
  if requested_cash_register_id is not null and not exists(select 1 from public.cash_registers where id=requested_cash_register_id and establishment_id=requested_establishment_id and active) then raise exception 'Caixa inválido.'; end if;
  if requested_is_default then update public.printer_devices set is_default=false,updated_at=now() where establishment_id=requested_establishment_id and sector=requested_sector and active; end if;
  insert into public.printer_devices(establishment_id,name,printer_name,token_hash,created_by,sector,connection_type,paper_width,network_address,auto_print,is_default,cash_register_id)
  values(requested_establishment_id,btrim(requested_name),'Impressora do Windows',extensions.digest(raw_token,'sha256'),auth.uid(),requested_sector,requested_connection_type,requested_paper_width,nullif(btrim(requested_network_address),''),requested_auto_print,requested_is_default,requested_cash_register_id)
  returning * into saved;
  return jsonb_build_object('id',saved.id,'token',raw_token,'name',saved.name);
end $$;

create or replace function public.update_printer_device(requested_device_id uuid,requested_name text,requested_sector text,requested_auto_print boolean,requested_is_default boolean,requested_cash_register_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.printer_devices%rowtype;
begin
  select * into saved from public.printer_devices where id=requested_device_id;
  if saved.id is null or auth.uid() is null or not private.has_role(saved.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Impressora não encontrada.'; end if;
  if requested_cash_register_id is not null and not exists(select 1 from public.cash_registers where id=requested_cash_register_id and establishment_id=saved.establishment_id and active) then raise exception 'Caixa inválido.'; end if;
  if requested_is_default then update public.printer_devices set is_default=false,updated_at=now() where establishment_id=saved.establishment_id and sector=requested_sector and active and id<>saved.id; end if;
  update public.printer_devices set name=btrim(requested_name),sector=requested_sector,auto_print=requested_auto_print,is_default=requested_is_default,cash_register_id=requested_cash_register_id,updated_at=now() where id=saved.id returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.deactivate_printer_device(requested_device_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.printer_devices%rowtype;
begin
  select * into saved from public.printer_devices where id=requested_device_id;
  if saved.id is null or auth.uid() is null or not private.has_role(saved.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Impressora não encontrada.'; end if;
  update public.printer_devices set active=false,is_default=false,updated_at=now() where id=saved.id returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.queue_printer_test_device(requested_device_id uuid,requested_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare device public.printer_devices%rowtype; saved public.printer_jobs%rowtype;
begin
  select * into device from public.printer_devices where id=requested_device_id and active;
  if device.id is null or auth.uid() is null or not private.has_role(device.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Impressora não encontrada.'; end if;
  if device.last_seen_at is null or device.last_seen_at<=now()-interval '20 seconds' then raise exception 'Esta impressora está offline.'; end if;
  if length(coalesce(requested_text,'')) not between 10 and 4000 then raise exception 'Conteúdo inválido.'; end if;
  insert into public.printer_jobs(establishment_id,target_device_id,requested_by,job_kind,payload) values(device.establishment_id,device.id,auth.uid(),'test',jsonb_build_object('text',requested_text)) returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.create_cash_register(requested_establishment_id uuid,requested_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.cash_registers%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Acesso não autorizado.'; end if;
  insert into public.cash_registers(establishment_id,name,created_by) values(requested_establishment_id,btrim(requested_name),auth.uid()) returning * into saved;
  return to_jsonb(saved);
exception when unique_violation then raise exception 'Já existe um caixa com esse nome.';
end $$;

create or replace function public.set_cash_register_active(requested_register_id uuid,requested_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.cash_registers%rowtype;
begin
  select * into saved from public.cash_registers where id=requested_register_id;
  if saved.id is null or auth.uid() is null or not private.has_role(saved.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Caixa não encontrado.'; end if;
  if not requested_active and exists(select 1 from public.cash_shifts where cash_register_id=saved.id and status='open') then raise exception 'Feche o expediente antes de desativar este caixa.'; end if;
  update public.cash_registers set active=requested_active,updated_at=now() where id=saved.id returning * into saved;
  return to_jsonb(saved);
end $$;

drop function if exists public.open_cash_shift(integer);
create function public.open_cash_shift(requested_opening_cash_cents integer,requested_cash_register_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); employee public.custom_staff_members%rowtype; register_record public.cash_registers%rowtype; new_shift public.cash_shifts%rowtype;
begin
  select member.* into employee from public.custom_staff_members member join public.staff_roles role on role.id=member.role_id where member.user_id=actor and member.status='active' and role.financial_role=true limit 1;
  select * into register_record from public.cash_registers where id=requested_cash_register_id and establishment_id=employee.establishment_id and active;
  if employee.id is null then raise exception 'Acesso de caixa não autorizado.'; end if;
  if register_record.id is null then raise exception 'Selecione um caixa ativo.'; end if;
  if requested_opening_cash_cents<0 then raise exception 'Valor inicial inválido.'; end if;
  insert into public.cash_shifts(establishment_id,staff_member_id,operator_name,opening_cash_cents,opened_by,cash_register_id) values(employee.establishment_id,employee.id,employee.name,requested_opening_cash_cents,actor,register_record.id) returning * into new_shift;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(employee.establishment_id,actor,'cash.shift_opened','cash_shifts',new_shift.id,jsonb_build_object('operator',employee.name,'register',register_record.name,'opening_cash_cents',requested_opening_cash_cents));
  return to_jsonb(new_shift)||jsonb_build_object('cash_register_name',register_record.name);
exception when unique_violation then
  if exists(select 1 from public.cash_shifts where staff_member_id=employee.id and status='open') then raise exception 'Você já possui um caixa aberto.'; end if;
  raise exception 'Este caixa já está aberto por outro operador.';
end $$;

create or replace function public.fetch_printer_jobs(requested_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare device public.printer_devices%rowtype; claimed public.printer_jobs%rowtype;
begin
  if length(coalesce(requested_token,''))<>64 then raise exception 'Conector inválido.'; end if;
  select * into device from public.printer_devices where token_hash=extensions.digest(requested_token,'sha256') and active for update;
  if device.id is null then raise exception 'Conector inválido ou desativado.'; end if;
  update public.printer_devices set last_seen_at=now(),updated_at=now() where id=device.id;
  update public.printer_jobs set status='queued',device_id=null,claimed_at=null where target_device_id=device.id and status='processing' and claimed_at<now()-interval '2 minutes';
  update public.printer_jobs set status='processing',device_id=device.id,claimed_at=now(),error_message=null
  where id=(select id from public.printer_jobs where target_device_id=device.id and status='queued' order by created_at limit 1 for update skip locked) returning * into claimed;
  if claimed.id is null then return jsonb_build_object('jobs','[]'::jsonb,'printer_name',device.printer_name); end if;
  return jsonb_build_object('jobs',jsonb_build_array(jsonb_build_object('id',claimed.id,'text',claimed.payload->>'text')),'printer_name',device.printer_name);
end $$;

create or replace function public.queue_kitchen_print(requested_ticket_id uuid,requested_text text,requested_reprint boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ticket public.kitchen_tickets%rowtype; operator public.kitchen_operators%rowtype; device public.printer_devices%rowtype; saved public.printer_jobs%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into ticket from public.kitchen_tickets where id=requested_ticket_id;
  if ticket.id is null or not private.has_role(ticket.establishment_id,array['owner','manager','kitchen']::public.member_role[]) then raise exception 'Comanda não encontrada.'; end if;
  if private.has_role(ticket.establishment_id,array['kitchen']::public.member_role[]) then select * into operator from public.kitchen_operators where establishment_id=ticket.establishment_id and user_id=actor; if operator.id is null or operator.status<>'active' or not coalesce((operator.permissions->>'print_orders')::boolean,false) then raise exception 'Este operador não possui permissão para imprimir.'; end if; end if;
  select * into device from public.printer_devices where establishment_id=ticket.establishment_id and active and sector='kitchen' order by is_default desc,last_seen_at desc nulls last,created_at limit 1;
  if device.id is null then raise exception 'Cadastre uma impressora para a cozinha.'; end if;
  if length(coalesce(requested_text,'')) not between 10 and 12000 then raise exception 'Conteúdo da impressão inválido.'; end if;
  if not requested_reprint then select * into saved from public.printer_jobs where kitchen_ticket_id=ticket.id and job_kind='original' limit 1; if saved.id is not null then return to_jsonb(saved); end if; end if;
  insert into public.printer_jobs(establishment_id,kitchen_ticket_id,target_device_id,requested_by,job_kind,payload) values(ticket.establishment_id,ticket.id,device.id,actor,case when requested_reprint then 'reprint' else 'original' end,jsonb_build_object('text',requested_text)) on conflict (kitchen_ticket_id) where job_kind='original' and kitchen_ticket_id is not null do nothing returning * into saved;
  if saved.id is null then select * into saved from public.printer_jobs where kitchen_ticket_id=ticket.id and job_kind='original' limit 1; end if;
  return to_jsonb(saved);
end $$;

revoke all on function public.list_printer_devices(uuid) from public,anon;
revoke all on function public.register_printer_device(uuid,text,text,text,integer,text,boolean,boolean,uuid) from public,anon;
revoke all on function public.update_printer_device(uuid,text,text,boolean,boolean,uuid) from public,anon;
revoke all on function public.deactivate_printer_device(uuid) from public,anon;
revoke all on function public.queue_printer_test_device(uuid,text) from public,anon;
revoke all on function public.create_cash_register(uuid,text) from public,anon;
revoke all on function public.set_cash_register_active(uuid,boolean) from public,anon;
revoke all on function public.open_cash_shift(integer,uuid) from public,anon;
revoke all on function public.fetch_printer_jobs(text) from public,authenticated;
grant execute on function public.list_printer_devices(uuid) to authenticated;
grant execute on function public.register_printer_device(uuid,text,text,text,integer,text,boolean,boolean,uuid) to authenticated;
grant execute on function public.update_printer_device(uuid,text,text,boolean,boolean,uuid) to authenticated;
grant execute on function public.deactivate_printer_device(uuid) to authenticated;
grant execute on function public.queue_printer_test_device(uuid,text) to authenticated;
grant execute on function public.create_cash_register(uuid,text) to authenticated;
grant execute on function public.set_cash_register_active(uuid,boolean) to authenticated;
grant execute on function public.open_cash_shift(integer,uuid) to authenticated;
grant execute on function public.fetch_printer_jobs(text) to anon;
