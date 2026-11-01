-- Phase 77 advisor hardening: cover every foreign key used by Feature Management.
-- Generated as a separate additive migration after production advisor review.
do $$
declare fk record; index_name text;
begin
 for fk in
  select c.conname,n.nspname,t.relname,
   string_agg(quote_ident(a.attname),',' order by keys.ordinality) columns_sql
  from pg_constraint c
  join pg_class t on t.oid=c.conrelid
  join pg_namespace n on n.oid=t.relnamespace
  cross join lateral unnest(c.conkey) with ordinality keys(attnum,ordinality)
  join pg_attribute a on a.attrelid=t.oid and a.attnum=keys.attnum
  where c.contype='f' and n.nspname='public' and (t.relname like 'feature\_%' escape '\' or t.relname like 'configuration\_%' escape '\')
  and not exists(
   select 1 from pg_index i where i.indrelid=t.oid and i.indisvalid and
   c.conkey=array(select (i.indkey::smallint[])[position] from generate_series(0,cardinality(c.conkey)-1) position)
  )
  group by c.conname,n.nspname,t.relname
 loop
  index_name:=left(fk.conname,55)||'_idx';
  execute format('create index if not exists %I on %I.%I(%s)',index_name,fk.nspname,fk.relname,fk.columns_sql);
 end loop;
end$$;
