drop policy if exists orders_operations on public.orders;
drop policy if exists orders_kitchen_read on public.orders;
create policy orders_operations_select on public.orders for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[]));
create policy orders_operations_insert on public.orders for insert to authenticated
  with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy orders_operations_update on public.orders for update to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]))
  with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy orders_operations_delete on public.orders for delete to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));

drop policy if exists order_items_operations on public.order_items;
drop policy if exists order_items_kitchen_read on public.order_items;
create policy order_items_operations_select on public.order_items for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[]));
create policy order_items_operations_insert on public.order_items for insert to authenticated
  with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy order_items_operations_update on public.order_items for update to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]))
  with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy order_items_operations_delete on public.order_items for delete to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));

drop policy if exists table_orders_operations_read on public.table_orders;
drop policy if exists table_orders_kitchen_read on public.table_orders;
create policy table_orders_operations_read on public.table_orders for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[]));

drop policy if exists table_order_items_operations_read on public.table_order_items;
drop policy if exists table_order_items_kitchen_read on public.table_order_items;
create policy table_order_items_operations_read on public.table_order_items for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[]));

drop policy if exists table_sessions_operations_read on public.table_sessions;
drop policy if exists table_sessions_kitchen_read on public.table_sessions;
create policy table_sessions_operations_read on public.table_sessions for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager','attendant','kitchen']::public.member_role[]));
