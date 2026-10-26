create or replace function public.deactivate_driver_staff_member(requested_member_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member_record public.custom_staff_members%rowtype; driver public.driver_profiles%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into member_record from public.custom_staff_members where id=requested_member_id for update;
  select * into driver from public.driver_profiles where custom_staff_member_id=requested_member_id for update;
  if member_record.id is null or driver.id is null or not private.has_role(member_record.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para desativar este motoboy.'; end if;
  update public.custom_staff_members set status='inactive',updated_at=now() where id=member_record.id;
  update public.driver_profiles set active=false,approval_status='blocked',updated_at=now() where id=driver.id;
  update public.driver_availability set status='blocked',paused_at=now(),pause_reason='Cadastro desativado pela administração',updated_at=now() where driver_profile_id=driver.id;
  update public.driver_access_links set revoked_at=coalesce(revoked_at,now()) where driver_profile_id=driver.id and used_at is null;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(member_record.establishment_id,actor,'driver.deactivated','driver_profiles',driver.id,jsonb_build_object('staff_member_id',member_record.id,'financial_history_preserved',true));
  return jsonb_build_object('driver_profile_id',driver.id,'member_id',member_record.id,'status','inactive');
end $$;

revoke all on function public.deactivate_driver_staff_member(uuid) from public,anon;
grant execute on function public.deactivate_driver_staff_member(uuid) to authenticated;
