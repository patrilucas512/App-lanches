-- Avoid duplicate permissive SELECT evaluation while preserving granular writes.
drop policy if exists organization_members_admin on public.organization_members;
create policy organization_members_admin_insert on public.organization_members for insert to authenticated with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_members_admin_update on public.organization_members for update to authenticated using(private.has_organization_role(organization_id,array['owner','admin'])) with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_members_admin_delete on public.organization_members for delete to authenticated using(private.has_organization_role(organization_id,array['owner','admin']));

drop policy if exists organization_store_access_admin on public.organization_member_store_access;
create policy organization_store_access_admin_insert on public.organization_member_store_access for insert to authenticated with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_store_access_admin_update on public.organization_member_store_access for update to authenticated using(private.has_organization_role(organization_id,array['owner','admin'])) with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_store_access_admin_delete on public.organization_member_store_access for delete to authenticated using(private.has_organization_role(organization_id,array['owner','admin']));

drop policy if exists organization_ai_admin on public.organization_ai_settings;
create policy organization_ai_admin_insert on public.organization_ai_settings for insert to authenticated with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_ai_admin_update on public.organization_ai_settings for update to authenticated using(private.has_organization_role(organization_id,array['owner','admin'])) with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_ai_admin_delete on public.organization_ai_settings for delete to authenticated using(private.has_organization_role(organization_id,array['owner','admin']));

drop policy if exists store_flags_admin on public.store_feature_flags;
create policy store_flags_admin_insert on public.store_feature_flags for insert to authenticated with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy store_flags_admin_update on public.store_feature_flags for update to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy store_flags_admin_delete on public.store_feature_flags for delete to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));

drop policy if exists store_areas_admin on public.store_service_areas;
create policy store_areas_admin_insert on public.store_service_areas for insert to authenticated with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy store_areas_admin_update on public.store_service_areas for update to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy store_areas_admin_delete on public.store_service_areas for delete to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
