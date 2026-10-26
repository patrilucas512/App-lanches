create or replace function public.register_printer_device(
  requested_establishment_id uuid, requested_name text, requested_sector text, requested_connection_type text,
  requested_paper_width integer, requested_network_address text default null, requested_auto_print boolean default false,
  requested_is_default boolean default false, requested_cash_register_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(32),'hex');
  saved public.printer_devices%rowtype;
  make_default boolean;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then
    raise exception 'Somente o administrador pode cadastrar impressoras.';
  end if;
  if requested_sector not in ('kitchen','counter','cashier','bar','delivery','other')
    or requested_connection_type not in ('usb','bluetooth','network') or requested_paper_width not in (58,80) then
    raise exception 'Configuração de impressora inválida.';
  end if;
  if requested_cash_register_id is not null and not exists(
    select 1 from public.cash_registers where id=requested_cash_register_id
      and establishment_id=requested_establishment_id and active
  ) then raise exception 'Caixa inválido.'; end if;

  make_default := requested_is_default or not exists(
    select 1 from public.printer_devices
    where establishment_id=requested_establishment_id and sector=requested_sector and active and is_default
  );
  if make_default then
    update public.printer_devices set is_default=false,updated_at=now()
    where establishment_id=requested_establishment_id and sector=requested_sector and active;
  end if;

  insert into public.printer_devices(
    establishment_id,name,printer_name,token_hash,created_by,sector,connection_type,paper_width,
    network_address,auto_print,is_default,cash_register_id,active
  ) values (
    requested_establishment_id,btrim(requested_name),'Impressora do Windows',extensions.digest(raw_token,'sha256'),
    auth.uid(),requested_sector,requested_connection_type,requested_paper_width,nullif(btrim(requested_network_address),''),
    case when requested_sector in ('kitchen','cashier') then true else requested_auto_print end,
    make_default,requested_cash_register_id,true
  ) returning * into saved;

  if requested_sector='kitchen' then
    update public.service_modes set auto_print_kitchen=true,updated_at=now()
    where establishment_id=requested_establishment_id;
  end if;
  return jsonb_build_object('id',saved.id,'token',raw_token,'name',saved.name);
end $$;

create or replace function public.prepare_printer_device_activation(requested_device_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(32),'hex');
  saved public.printer_devices%rowtype;
begin
  select * into saved from public.printer_devices where id=requested_device_id for update;
  if saved.id is null or auth.uid() is null
    or not private.has_role(saved.establishment_id,array['owner','manager']::public.member_role[]) then
    raise exception 'Impressora não encontrada.';
  end if;
  if saved.sector <> 'kitchen' then raise exception 'Selecione uma impressora da cozinha.'; end if;

  update public.printer_devices set is_default=false,updated_at=now()
  where establishment_id=saved.establishment_id and sector='kitchen' and id<>saved.id;
  update public.printer_devices
  set token_hash=extensions.digest(raw_token,'sha256'),active=true,auto_print=true,is_default=true,updated_at=now()
  where id=saved.id returning * into saved;
  update public.service_modes set auto_print_kitchen=true,updated_at=now()
  where establishment_id=saved.establishment_id;

  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(saved.establishment_id,auth.uid(),'printer.activation_prepared','printer_devices',saved.id,
    jsonb_build_object('sector','kitchen','auto_start',true));
  return jsonb_build_object('id',saved.id,'token',raw_token,'name',saved.name);
end $$;

revoke all on function public.register_printer_device(uuid,text,text,text,integer,text,boolean,boolean,uuid) from public,anon;
grant execute on function public.register_printer_device(uuid,text,text,text,integer,text,boolean,boolean,uuid) to authenticated;
revoke all on function public.prepare_printer_device_activation(uuid) from public,anon;
grant execute on function public.prepare_printer_device_activation(uuid) to authenticated;
