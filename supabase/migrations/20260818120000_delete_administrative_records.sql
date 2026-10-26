create or replace function public.delete_printer_device(requested_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.printer_devices%rowtype;
begin
  select * into saved from public.printer_devices where id = requested_device_id;
  if saved.id is null or auth.uid() is null or not private.has_role(saved.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Impressora não encontrada.';
  end if;
  delete from public.printer_devices where id = saved.id;
  return jsonb_build_object('id', saved.id, 'name', saved.name, 'deleted', true);
end;
$$;

create or replace function public.remove_cash_register(requested_register_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.cash_registers%rowtype;
  archived boolean := false;
begin
  select * into saved from public.cash_registers where id = requested_register_id;
  if saved.id is null or auth.uid() is null or not private.has_role(saved.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Caixa não encontrado.';
  end if;
  if exists(select 1 from public.cash_shifts where cash_register_id = saved.id and status = 'open') then
    raise exception 'Feche o caixa antes de excluí-lo.';
  end if;
  if exists(select 1 from public.cash_shifts where cash_register_id = saved.id) then
    update public.cash_registers set active = false, updated_at = now() where id = saved.id;
    archived := true;
  else
    delete from public.cash_registers where id = saved.id;
  end if;
  return jsonb_build_object('id', saved.id, 'name', saved.name, 'deleted', not archived, 'archived', archived);
end;
$$;

revoke all on function public.delete_printer_device(uuid) from public, anon;
revoke all on function public.remove_cash_register(uuid) from public, anon;
grant execute on function public.delete_printer_device(uuid) to authenticated;
grant execute on function public.remove_cash_register(uuid) to authenticated;
