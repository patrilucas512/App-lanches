-- Workers called by pg_cron already read their token from Vault. This lets the app check that token against Vault too,
-- so a worker works without the same value also being copied into the hosting environment.
-- Only the named secrets below can be checked, and only by service_role.
create or replace function public.verify_worker_secret(requested_name text, requested_token text) returns boolean language sql stable security definer set search_path='' as $$
 select current_setting('request.jwt.claim.role',true)='service_role'
  and requested_name in('cx_worker_secret')
  and coalesce(length(requested_token),0)>=32
  and exists(select 1 from vault.decrypted_secrets v where v.name=requested_name and v.decrypted_secret=requested_token)
$$;
revoke all on function public.verify_worker_secret(text,text) from public,anon,authenticated;
grant execute on function public.verify_worker_secret(text,text) to service_role;
