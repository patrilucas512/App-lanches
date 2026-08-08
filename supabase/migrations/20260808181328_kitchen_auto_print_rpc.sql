create or replace function public.set_kitchen_auto_print(requested_establishment_id uuid, requested_enabled boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare saved public.service_modes%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then
    raise exception 'Somente proprietário ou gerente pode alterar a impressão.';
  end if;
  update public.service_modes set auto_print_kitchen=requested_enabled,updated_at=now()
  where establishment_id=requested_establishment_id returning * into saved;
  if not found then raise exception 'Configuração de atendimento não encontrada.'; end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,auth.uid(),'kitchen.auto_print_updated','service_modes',saved.id,jsonb_build_object('enabled',requested_enabled));
  return to_jsonb(saved);
end $$;
revoke all on function public.set_kitchen_auto_print(uuid,boolean) from public,anon;
grant execute on function public.set_kitchen_auto_print(uuid,boolean) to authenticated;
