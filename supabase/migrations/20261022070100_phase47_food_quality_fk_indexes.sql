do $$
declare item record;
begin
  for item in
    select c.conrelid::regclass table_ref,c.conname||'_idx' index_name,string_agg(quote_ident(a.attname),', ' order by k.ord) columns
    from pg_constraint c
    join unnest(c.conkey) with ordinality k(attnum,ord) on true
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    where c.contype='f' and c.connamespace='public'::regnamespace and c.conrelid::regclass::text=any(array[
      'inventory_locations','inventory_lots','quality_settings','quality_receiving_requirements',
      'quality_temperature_rules','temperature_logs','receiving_quality_checks','shelf_life_rules',
      'production_batches','production_batch_inputs','order_item_lot_consumptions',
      'quality_nonconformities','quality_corrective_actions','quality_inspections','quality_recalls',
      'quality_recall_scope','quality_recall_store_status','quality_recall_tasks','quality_audit_events','quality_offline_events'
    ]) group by c.conrelid,c.conname
  loop execute format('create index if not exists %I on %s (%s)',item.index_name,item.table_ref,item.columns); end loop;
end $$;
