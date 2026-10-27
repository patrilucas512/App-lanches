-- Complete only the FK indexes still reported for the Phase 26 cache registry.
create index if not exists cache_namespaces_org_idx on public.cache_namespaces(organization_id) where organization_id is not null;
create index if not exists cache_namespaces_store_idx on public.cache_namespaces(store_id) where store_id is not null;
create index if not exists cache_namespaces_invalidated_by_idx on public.cache_namespaces(invalidated_by) where invalidated_by is not null;
