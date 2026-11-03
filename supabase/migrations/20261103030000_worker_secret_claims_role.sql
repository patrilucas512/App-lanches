-- With Supabase's new API keys, PostgREST no longer fills request.jwt.claim.role; the role is only inside request.jwt.claims.
-- verify_worker_secret read the old setting, so it refused every call from the server.
create or replace function public.verify_worker_secret(requested_name text, requested_token text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(current_setting('request.jwt.claim.role',true),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')='service_role'
  and requested_name in('cx_worker_secret')
  and coalesce(length(requested_token),0)>=32
  and exists(select 1 from vault.decrypted_secrets v where v.name=requested_name and v.decrypted_secret=requested_token)
$$;
revoke all on function public.verify_worker_secret(text,text) from public,anon,authenticated;
grant execute on function public.verify_worker_secret(text,text) to service_role;
