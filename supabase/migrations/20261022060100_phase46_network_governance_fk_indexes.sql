-- Index every foreign key introduced by Phase 46. This keeps deletes, joins and
-- scoped lookups predictable as the number of stores grows.
do $$
declare
  item record;
begin
  for item in
    select
      c.conrelid::regclass as table_ref,
      c.conname || '_idx' as index_name,
      string_agg(quote_ident(a.attname), ', ' order by key_column.ordinality) as columns
    from pg_constraint c
    join unnest(c.conkey) with ordinality as key_column(attnum, ordinality) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and c.conrelid::regclass::text = any(array[
        'network_brands','network_regions','network_clusters','network_cluster_stores',
        'network_role_templates','network_member_scopes','network_governance_policies',
        'network_config_overrides','network_rollouts','network_rollout_stages',
        'network_rollout_targets','network_catalog_products','network_catalog_store_state',
        'network_menu_templates','pricing_zones','pricing_zone_stores','network_price_policies',
        'network_price_history','network_approved_suppliers','network_supplier_agreements',
        'supplier_approval_requests','network_operational_standards','network_standard_executions',
        'network_internal_audits','network_corrective_actions','network_configuration_drift',
        'governance_exception_requests','network_announcements',
        'network_announcement_acknowledgements','store_opening_templates',
        'store_opening_projects','network_audit_events'
      ])
    group by c.conrelid, c.conname
  loop
    execute format('create index if not exists %I on %s (%s)', item.index_name, item.table_ref, item.columns);
  end loop;
end $$;
