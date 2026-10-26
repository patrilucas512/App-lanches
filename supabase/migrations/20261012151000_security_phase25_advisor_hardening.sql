revoke all on function public.get_security_summary(uuid) from public,anon;
grant execute on function public.get_security_summary(uuid) to authenticated,service_role;

drop policy if exists security_settings_admin_write on public.organization_security_settings;
create policy security_settings_admin_insert on public.organization_security_settings for insert to authenticated with check (private.security_org_access(organization_id,true));
create policy security_settings_admin_update on public.organization_security_settings for update to authenticated using (private.security_org_access(organization_id,true)) with check (private.security_org_access(organization_id,true));
create policy security_settings_admin_delete on public.organization_security_settings for delete to authenticated using (private.security_org_access(organization_id,true));
