-- Phase 42: close the remaining pre-existing dining-area FK index gaps.
create index if not exists dining_areas_organization_idx on public.dining_areas(organization_id);
create index if not exists reservation_exceptions_dining_area_idx on public.reservation_exceptions(dining_area_id) where dining_area_id is not null;
create index if not exists restaurant_tables_dining_area_idx on public.restaurant_tables(dining_area_id) where dining_area_id is not null;
