do $$
declare item record;
begin
  for item in
    select c.conrelid::regclass table_ref,c.conname||'_idx' index_name,string_agg(quote_ident(a.attname),', ' order by k.ord) columns
    from pg_constraint c
    join unnest(c.conkey) with ordinality k(attnum,ord) on true
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    where c.contype='f' and c.connamespace='public'::regnamespace and c.conrelid::regclass::text=any(array[
      'asset_categories','assets','asset_documents','asset_service_provider_profiles','maintenance_plans',
      'maintenance_work_orders','asset_failures','asset_inspections','asset_calibrations','maintenance_quotes',
      'maintenance_parts_usage','asset_warranties','asset_downtime_events','maintenance_costs','asset_transfers',
      'asset_operational_links','asset_alerts','asset_offline_events','asset_audit_events'
    ]) group by c.conrelid,c.conname
  loop execute format('create index if not exists %I on %s (%s)',item.index_name,item.table_ref,item.columns); end loop;
end $$;
