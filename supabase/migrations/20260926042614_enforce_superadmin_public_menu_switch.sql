create or replace function public.superadmin_set_public_menu(
  target_establishment_id uuid,
  is_enabled boolean,
  confirmation text,
  reason text default null
) returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare old_value boolean; old_active boolean; is_blocked boolean;
begin
  if not private.is_superadmin() then raise exception 'Acesso negado'; end if;
  if confirmation <> (case when is_enabled then 'REATIVAR' else 'SUSPENDER' end) then raise exception 'Confirmação inválida'; end if;
  select public_menu_active,active,(blocked_at is not null) into old_value,old_active,is_blocked from public.establishments where id=target_establishment_id for update;
  if is_enabled and is_blocked then raise exception 'Desbloqueie o estabelecimento antes de reativar o cardápio'; end if;
  update public.establishments set public_menu_active=is_enabled, active=case when is_blocked then active else is_enabled end, updated_at=now() where id=target_establishment_id;
  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,establishment_id,old_value,new_value,reason)
  values(auth.uid(),'establishment.public_menu_changed','establishment',target_establishment_id,target_establishment_id,jsonb_build_object('enabled',old_value,'active',old_active),jsonb_build_object('enabled',is_enabled,'active',case when is_blocked then old_active else is_enabled end),reason);
end $$;

revoke all on function public.superadmin_set_public_menu(uuid,boolean,text,text) from public, anon;
grant execute on function public.superadmin_set_public_menu(uuid,boolean,text,text) to authenticated;
