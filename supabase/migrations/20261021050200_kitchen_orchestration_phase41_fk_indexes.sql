-- Phase 41: one-column covering indexes required by store/station foreign keys.
-- Composite tenant indexes remain for tenant-scoped queries; these indexes cover
-- referential actions whose foreign key starts at the individual column.
create index if not exists product_station_store_fk_idx
  on public.product_station_assignments(store_id);
create index if not exists production_steps_store_fk_idx
  on public.product_production_steps(store_id);
create index if not exists kitchen_batches_store_fk_idx
  on public.kitchen_batches(store_id);
create index if not exists kitchen_tasks_station_fk_idx
  on public.kitchen_tasks(station_id);
create index if not exists kitchen_equipment_store_fk_idx
  on public.kitchen_equipment(store_id);
create index if not exists station_routing_store_fk_idx
  on public.station_routing_rules(store_id);
create index if not exists expedition_checks_store_fk_idx
  on public.expedition_checks(store_id);
create index if not exists kitchen_exceptions_store_fk_idx
  on public.kitchen_exceptions(store_id);
create index if not exists kitchen_change_requests_store_fk_idx
  on public.kitchen_change_requests(store_id);
