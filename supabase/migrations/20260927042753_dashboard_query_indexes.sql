create index if not exists orders_establishment_created_at_idx
  on public.orders (establishment_id, created_at desc);

create index if not exists deliveries_establishment_created_at_idx
  on public.deliveries (establishment_id, created_at desc);
