alter table public.addon_groups
  add column if not exists description text,
  add column if not exists active boolean not null default true;

create index if not exists addon_groups_establishment_active_order_idx
  on public.addon_groups (establishment_id, active, sort_order);
