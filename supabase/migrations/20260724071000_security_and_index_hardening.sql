revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

create policy stripe_events_superadmin_read on public.stripe_events
for select to authenticated using (private.is_superadmin());

create index subscriptions_plan_idx on public.subscriptions (plan_id);
create index products_category_idx on public.products (category_id);
create index addons_group_idx on public.addons (addon_group_id);
create index product_addon_groups_group_idx on public.product_addon_groups (addon_group_id);
create index order_items_product_idx on public.order_items (product_id);

drop policy members_owner_manage on public.establishment_members;
create policy members_owner_insert on public.establishment_members for insert to authenticated
with check (private.has_role(establishment_id, array['owner']::public.member_role[]));
create policy members_owner_update on public.establishment_members for update to authenticated
using (private.has_role(establishment_id, array['owner']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner']::public.member_role[]));
create policy members_owner_delete on public.establishment_members for delete to authenticated
using (private.has_role(establishment_id, array['owner']::public.member_role[]));

drop policy categories_catalog_write on public.categories;
create policy categories_catalog_insert on public.categories for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy categories_catalog_update on public.categories for update to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy categories_catalog_delete on public.categories for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

drop policy products_catalog_write on public.products;
create policy products_catalog_insert on public.products for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy products_catalog_update on public.products for update to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy products_catalog_delete on public.products for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

drop policy addon_groups_catalog_write on public.addon_groups;
create policy addon_groups_catalog_insert on public.addon_groups for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy addon_groups_catalog_update on public.addon_groups for update to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy addon_groups_catalog_delete on public.addon_groups for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

drop policy addons_catalog_write on public.addons;
create policy addons_catalog_insert on public.addons for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy addons_catalog_update on public.addons for update to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy addons_catalog_delete on public.addons for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

drop policy product_addons_catalog_write on public.product_addon_groups;
create policy product_addons_catalog_insert on public.product_addon_groups for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy product_addons_catalog_update on public.product_addon_groups for update to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy product_addons_catalog_delete on public.product_addon_groups for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

drop policy business_hours_manager_write on public.business_hours;
create policy business_hours_manager_insert on public.business_hours for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy business_hours_manager_update on public.business_hours for update to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy business_hours_manager_delete on public.business_hours for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

drop policy delivery_zones_manager_write on public.delivery_zones;
create policy delivery_zones_manager_insert on public.delivery_zones for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy delivery_zones_manager_update on public.delivery_zones for update to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy delivery_zones_manager_delete on public.delivery_zones for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

drop policy coupons_manager_write on public.coupons;
create policy coupons_manager_insert on public.coupons for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy coupons_manager_update on public.coupons for update to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy coupons_manager_delete on public.coupons for delete to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
