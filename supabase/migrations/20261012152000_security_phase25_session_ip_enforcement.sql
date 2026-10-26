create or replace function public.security_ip_allowed(requested_organization_id uuid, requested_ip inet)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when coalesce(cardinality(s.admin_ip_allowlist),0)=0 then true
    else exists(select 1 from unnest(s.admin_ip_allowlist) allowed where requested_ip <<= allowed)
  end
  from public.organization_security_settings s where s.organization_id=requested_organization_id
$$;
revoke all on function public.security_ip_allowed(uuid,inet) from public,anon,authenticated;
grant execute on function public.security_ip_allowed(uuid,inet) to service_role;

create unique index if not exists security_sessions_auth_session_idx on public.security_sessions(auth_session_id) where auth_session_id is not null;
