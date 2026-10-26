create index driver_locations_establishment_idx
  on public.driver_locations(establishment_id);

create index driver_locations_driver_tenant_idx
  on public.driver_locations(driver_profile_id, establishment_id);

create index driver_locations_delivery_tenant_idx
  on public.driver_locations(delivery_id, establishment_id)
  where delivery_id is not null;
