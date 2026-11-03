-- With Supabase's new API keys (sb_secret_/sb_publishable_), PostgREST no longer fills request.jwt.claim.role.
-- The role only comes inside request.jwt.claims, so every function that compared the old setting to 'service_role'
-- refused calls from the server (reservations, marketplace, webhooks, integrations, workers).
-- request_role() reads both forms. Each function that used the old setting is rewritten to call it; nothing else in
-- the function changes, and since the role is compared the same way, no caller gains access it did not have before.

create or replace function public.request_role() returns text language sql stable set search_path='' as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')
$$;

do $$
declare f record; definition text; rewritten integer := 0;
begin
 for f in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind in('f','p') and p.prosrc like '%current_setting(''request.jwt.claim.role'',true)%'
   and not (n.nspname='public' and p.proname='request_role')
   and n.nspname not in('pg_catalog','information_schema','auth','storage','extensions','realtime','graphql','graphql_public','vault','net','cron','supabase_functions','pgsodium')
 loop
  definition := pg_get_functiondef(f.oid);
  execute replace(definition,'current_setting(''request.jwt.claim.role'',true)','public.request_role()');
  rewritten := rewritten + 1;
 end loop;
 raise notice 'request_role: % function(s) rewritten', rewritten;
end $$;
