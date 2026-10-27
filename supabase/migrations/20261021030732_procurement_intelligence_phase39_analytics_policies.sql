-- Phase 39 hardening: analytical procurement objects are explicitly readable only
-- by authenticated users that already have access to the organization/store.
create policy analytics_dim_suppliers_procurement_read on public.analytics_dim_suppliers for select to authenticated using(procurement_private.can_access(organization_id,null));
create policy analytics_dim_procurement_categories_read on public.analytics_dim_procurement_categories for select to authenticated using(procurement_private.can_access(organization_id,null));
create policy analytics_fact_purchase_orders_read on public.analytics_fact_purchase_orders for select to authenticated using(procurement_private.can_access(organization_id,store_id));
create policy analytics_fact_purchase_items_read on public.analytics_fact_purchase_items for select to authenticated using(procurement_private.can_access(organization_id,store_id));
create policy analytics_fact_supplier_quotes_read on public.analytics_fact_supplier_quotes for select to authenticated using(procurement_private.can_access(organization_id,store_id));
create policy analytics_fact_receivings_read on public.analytics_fact_receivings for select to authenticated using(procurement_private.can_access(organization_id,store_id));
create policy analytics_fact_supplier_issues_read on public.analytics_fact_supplier_issues for select to authenticated using(procurement_private.can_access(organization_id,store_id));
grant select on public.analytics_dim_suppliers,public.analytics_dim_procurement_categories,public.analytics_fact_purchase_orders,public.analytics_fact_purchase_items,public.analytics_fact_supplier_quotes,public.analytics_fact_receivings,public.analytics_fact_supplier_issues to authenticated;
