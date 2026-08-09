create or replace function public.save_printer_settings(requested_establishment_id uuid, requested_connection text, requested_name text, requested_paper_width integer, requested_network_address text, requested_auto_print boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.service_modes%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente proprietário ou gerente pode configurar a impressora.'; end if;
  if requested_connection not in ('usb','bluetooth','network') then raise exception 'Tipo de conexão inválido.'; end if;
  if requested_paper_width not in (58,80) then raise exception 'Largura de papel inválida.'; end if;
  if char_length(btrim(coalesce(requested_name,''))) > 120 then raise exception 'Nome da impressora muito longo.'; end if;
  if char_length(btrim(coalesce(requested_network_address,''))) > 160 then raise exception 'Endereço de rede muito longo.'; end if;
  update public.service_modes set printer_connection=requested_connection,printer_name=nullif(btrim(requested_name),''),printer_paper_width=requested_paper_width,
    printer_network_address=case when requested_connection='network' then nullif(btrim(requested_network_address),'') else null end,
    auto_print_kitchen=requested_auto_print,printer_setup_completed=true,updated_at=now()
  where establishment_id=requested_establishment_id returning * into saved;
  if not found then raise exception 'Configuração do estabelecimento não encontrada.'; end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,auth.uid(),'printer.settings_updated','service_modes',saved.id,jsonb_build_object('connection',requested_connection,'paper_width',requested_paper_width,'auto_print',requested_auto_print));
  return to_jsonb(saved);
end; $$;
revoke all on function public.save_printer_settings(uuid,text,text,integer,text,boolean) from public,anon;
grant execute on function public.save_printer_settings(uuid,text,text,integer,text,boolean) to authenticated;
