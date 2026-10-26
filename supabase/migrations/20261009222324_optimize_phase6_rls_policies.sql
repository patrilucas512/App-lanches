-- Keep a single SELECT policy per Phase 6 table while preserving granular writes.
drop policy if exists ai_permissions_owner_write on public.ai_member_permissions;
drop policy if exists ai_knowledge_write on public.ai_knowledge_items;
drop policy if exists ai_faq_write on public.ai_faqs;
drop policy if exists ai_rules_write on public.ai_custom_rules;
drop policy if exists ai_retention_write on public.ai_retention_settings;

create policy ai_knowledge_insert on public.ai_knowledge_items for insert to authenticated
with check(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_knowledge_update on public.ai_knowledge_items for update to authenticated
using(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'))
with check(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_knowledge_delete on public.ai_knowledge_items for delete to authenticated
using(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));

create policy ai_faq_insert on public.ai_faqs for insert to authenticated
with check(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_faq_update on public.ai_faqs for update to authenticated
using(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'))
with check(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_faq_delete on public.ai_faqs for delete to authenticated
using(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));

create policy ai_rules_insert on public.ai_custom_rules for insert to authenticated
with check(private.has_ai_permission(establishment_id,'edit_rules') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_rules_update on public.ai_custom_rules for update to authenticated
using(private.has_ai_permission(establishment_id,'edit_rules') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'))
with check(private.has_ai_permission(establishment_id,'edit_rules') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_rules_delete on public.ai_custom_rules for delete to authenticated
using(private.has_ai_permission(establishment_id,'edit_rules') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));

create policy ai_retention_insert on public.ai_retention_settings for insert to authenticated
with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy ai_retention_update on public.ai_retention_settings for update to authenticated
using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]))
with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
