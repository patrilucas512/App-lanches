-- Phase 25: enterprise security, continuity and disaster recovery controls.
create extension if not exists pgcrypto;

alter table public.plans add column if not exists mfa_enabled boolean not null default true;
alter table public.plans add column if not exists sso_enabled boolean not null default false;
alter table public.plans add column if not exists advanced_audit_enabled boolean not null default false;
alter table public.plans add column if not exists security_alerts_enabled boolean not null default false;
alter table public.plans add column if not exists enterprise_session_policy_enabled boolean not null default false;
alter table public.plans add column if not exists ip_allowlist_enabled boolean not null default false;

create table if not exists public.organization_security_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  mfa_requirement text not null default 'optional' check (mfa_requirement in ('optional','owners','admins','all')),
  mfa_grace_period_days smallint not null default 7 check (mfa_grace_period_days between 0 and 90),
  mfa_enforcement_starts_at timestamptz,
  sso_enabled boolean not null default false,
  sso_enforced boolean not null default false,
  break_glass_user_id uuid references auth.users(id) on delete set null,
  max_session_hours integer not null default 168 check (max_session_hours between 1 and 8760),
  inactivity_minutes integer not null default 720 check (inactivity_minutes between 5 and 43200),
  remember_me_enabled boolean not null default true,
  trusted_device_days smallint not null default 30 check (trusted_device_days between 1 and 90),
  admin_ip_allowlist cidr[] not null default '{}',
  audit_retention_days integer not null default 365 check (audit_retention_days between 30 and 3650),
  login_alerts_enabled boolean not null default true,
  maintenance_mode boolean not null default false,
  read_only_mode boolean not null default false,
  maintenance_message text not null default 'Estamos realizando manutenção.',
  rpo_target_minutes integer check (rpo_target_minutes is null or rpo_target_minutes > 0),
  rto_target_minutes integer check (rto_target_minutes is null or rto_target_minutes > 0),
  backup_retention_days integer not null default 30 check (backup_retention_days between 1 and 3650),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_security_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mfa_enabled boolean not null default false,
  mfa_enabled_at timestamptz,
  recovery_codes_generated_at timestamptz,
  last_password_change_at timestamptz,
  last_security_review_at timestamptz,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, code_hash)
);

create table if not exists public.security_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid,
  device_id_hash text not null,
  device_label text not null default 'Dispositivo desconhecido',
  browser_label text,
  ip_hash text,
  ip_region text,
  user_agent text,
  is_current boolean not null default false,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  unique(user_id, device_id_hash)
);
create index if not exists security_sessions_user_active_idx on public.security_sessions(user_id,last_seen_at desc) where revoked_at is null;

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id_hash text not null,
  label text,
  trusted_until timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,device_id_hash)
);

create table if not exists public.sso_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_type text not null check (provider_type in ('saml','oidc')),
  display_name text not null,
  issuer text,
  client_id text,
  metadata_url text,
  certificate_fingerprint text,
  domain text not null,
  status text not null default 'draft' check (status in ('draft','testing','active','disabled','error')),
  jit_provisioning boolean not null default false,
  default_role text not null default 'viewer',
  enforce_sso boolean not null default false,
  last_tested_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,domain)
);

create table if not exists public.sso_role_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sso_connection_id uuid not null references public.sso_connections(id) on delete cascade,
  external_group text not null,
  masterapp_role text not null check (masterapp_role in ('viewer','attendant','supervisor','manager','admin')),
  created_at timestamptz not null default now(),
  unique(sso_connection_id,external_group)
);

create table if not exists public.security_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  action text not null,
  target_type text,
  target_id text,
  ip_hash text,
  user_agent text,
  before_state jsonb not null default '{}',
  after_state jsonb not null default '{}',
  correlation_id text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now()
);
create index if not exists security_audit_org_created_idx on public.security_audit_logs(organization_id,created_at desc);
create index if not exists security_audit_action_idx on public.security_audit_logs(action,created_at desc);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('suspicious_login','brute_force','mfa_disabled','api_key_abuse','repeated_permission_denied','webhook_signature_failure','unusual_export','session_hijack_suspected','new_device','mfa_reset','backup_failed','restore_test_overdue','secret_rotation_due')),
  severity text not null check (severity in ('info','warning','high','critical')),
  title text not null,
  description text not null,
  source text not null default 'masterapp',
  metadata jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','acknowledged','resolved','false_positive')),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists security_events_org_detected_idx on public.security_events(organization_id,detected_at desc);

create table if not exists public.backup_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  database_frequency text not null default 'provider_managed',
  storage_frequency text not null default 'daily',
  configuration_frequency text not null default 'daily',
  encryption_required boolean not null default true,
  retention_days integer not null default 30 check (retention_days between 1 and 3650),
  point_in_time_recovery boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  backup_type text not null check (backup_type in ('database','storage','configuration','full')),
  provider text not null default 'supabase',
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null check (status in ('scheduled','running','succeeded','failed','expired')),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  location_reference text,
  checksum text,
  encrypted boolean not null default true,
  retention_until timestamptz,
  error_summary text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists backup_runs_org_started_idx on public.backup_runs(organization_id,started_at desc);

create table if not exists public.restore_test_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  backup_run_id uuid references public.backup_runs(id) on delete set null,
  test_environment text not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null check (status in ('scheduled','running','passed','failed','partial')),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  inconsistencies jsonb not null default '[]',
  validation_summary text,
  executed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.secret_rotation_register (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  secret_type text not null,
  reference_name text not null,
  provider text,
  last_rotated_at timestamptz,
  rotate_by timestamptz,
  status text not null default 'active' check (status in ('active','due','overdue','revoked')),
  owner_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,secret_type,reference_name)
);

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  title text not null,
  severity text not null check (severity in ('info','warning','high','critical')),
  status text not null default 'investigating' check (status in ('investigating','contained','monitoring','resolved')),
  detected_at timestamptz not null default now(),
  affected_components text[] not null default '{}',
  impact text,
  containment text,
  resolution text,
  postmortem jsonb not null default '{}',
  owner_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.security_rate_limit_buckets (
  bucket_key text not null,
  subject_hash text not null,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default now(),
  primary key(bucket_key,subject_hash)
);

create table if not exists public.access_review_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_type text not null check (review_type in ('admins','roles','api_keys','integrations','full')),
  status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  due_at timestamptz,
  completed_at timestamptz,
  summary jsonb not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function private.security_org_access(target_org uuid, admin_only boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_superadmin() or exists(
    select 1 from public.organization_members m
    where m.organization_id=target_org and m.user_id=(select auth.uid()) and m.active
      and (not admin_only or m.role in ('owner','admin'))
  )
$$;
revoke all on function private.security_org_access(uuid,boolean) from public;
grant execute on function private.security_org_access(uuid,boolean) to authenticated,service_role;

create or replace function private.prevent_security_audit_mutation()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'security audit logs are append-only'; end $$;
drop trigger if exists security_audit_immutable on public.security_audit_logs;
create trigger security_audit_immutable before update or delete on public.security_audit_logs for each row execute function private.prevent_security_audit_mutation();

create or replace function public.get_security_summary(requested_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.security_org_access(requested_organization_id,false) then raise exception 'access denied'; end if;
  select jsonb_build_object(
    'members',count(*),
    'mfa_enabled',count(*) filter(where coalesce(usp.mfa_enabled,false)),
    'owners_total',count(*) filter(where om.role='owner'),
    'owners_mfa',count(*) filter(where om.role='owner' and coalesce(usp.mfa_enabled,false)),
    'admins_total',count(*) filter(where om.role in ('owner','admin')),
    'admins_mfa',count(*) filter(where om.role in ('owner','admin') and coalesce(usp.mfa_enabled,false)),
    'active_sessions',(select count(*) from public.security_sessions s where s.organization_id=requested_organization_id and s.revoked_at is null and (s.expires_at is null or s.expires_at>now())),
    'open_events',(select count(*) from public.security_events e where e.organization_id=requested_organization_id and e.status='open'),
    'critical_events',(select count(*) from public.security_events e where e.organization_id=requested_organization_id and e.status='open' and e.severity='critical'),
    'active_api_keys',(select count(*) from public.api_clients a where a.organization_id=requested_organization_id and a.status='active'),
    'last_backup',(select to_jsonb(b) from public.backup_runs b where b.organization_id=requested_organization_id order by b.started_at desc limit 1),
    'last_restore_test',(select to_jsonb(r) from public.restore_test_runs r where r.organization_id=requested_organization_id order by r.started_at desc limit 1),
    'sso',(select to_jsonb(s) from public.sso_connections s where s.organization_id=requested_organization_id order by s.updated_at desc limit 1)
  ) into result
  from public.organization_members om left join public.user_security_profiles usp on usp.user_id=om.user_id
  where om.organization_id=requested_organization_id and om.active;
  return result;
end $$;
revoke all on function public.get_security_summary(uuid) from public;
grant execute on function public.get_security_summary(uuid) to authenticated,service_role;

create or replace function public.consume_security_rate_limit(
  requested_bucket text,
  requested_subject_hash text,
  requested_limit integer default 5,
  requested_window_seconds integer default 900,
  requested_block_seconds integer default 900,
  requested_success boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare row_data public.security_rate_limit_buckets; now_at timestamptz:=now(); retry_seconds integer:=0;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service role required'; end if;
  if requested_success then
    delete from public.security_rate_limit_buckets where bucket_key=requested_bucket and subject_hash=requested_subject_hash;
    return jsonb_build_object('allowed',true,'attempts',0,'delay_ms',0);
  end if;
  insert into public.security_rate_limit_buckets(bucket_key,subject_hash,attempts,last_attempt_at)
  values(requested_bucket,requested_subject_hash,1,now_at)
  on conflict(bucket_key,subject_hash) do update set
    attempts=case when public.security_rate_limit_buckets.window_started_at < now_at-make_interval(secs=>requested_window_seconds) then 1 else public.security_rate_limit_buckets.attempts+1 end,
    window_started_at=case when public.security_rate_limit_buckets.window_started_at < now_at-make_interval(secs=>requested_window_seconds) then now_at else public.security_rate_limit_buckets.window_started_at end,
    last_attempt_at=now_at,
    blocked_until=case when public.security_rate_limit_buckets.attempts+1 >= requested_limit then now_at+make_interval(secs=>requested_block_seconds) else public.security_rate_limit_buckets.blocked_until end
  returning * into row_data;
  if row_data.blocked_until is not null and row_data.blocked_until>now_at then retry_seconds:=ceil(extract(epoch from row_data.blocked_until-now_at)); end if;
  return jsonb_build_object('allowed',retry_seconds=0,'attempts',row_data.attempts,'retry_after_seconds',retry_seconds,'delay_ms',least(5000,greatest(0,(row_data.attempts-1)*500)));
end $$;
revoke all on function public.consume_security_rate_limit(text,text,integer,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.consume_security_rate_limit(text,text,integer,integer,integer,boolean) to service_role;

alter table public.organization_security_settings enable row level security;
alter table public.user_security_profiles enable row level security;
alter table public.mfa_recovery_codes enable row level security;
alter table public.security_sessions enable row level security;
alter table public.trusted_devices enable row level security;
alter table public.sso_connections enable row level security;
alter table public.sso_role_mappings enable row level security;
alter table public.security_audit_logs enable row level security;
alter table public.security_events enable row level security;
alter table public.backup_policies enable row level security;
alter table public.backup_runs enable row level security;
alter table public.restore_test_runs enable row level security;
alter table public.secret_rotation_register enable row level security;
alter table public.security_incidents enable row level security;
alter table public.security_rate_limit_buckets enable row level security;
alter table public.access_review_runs enable row level security;

create policy security_settings_member_read on public.organization_security_settings for select to authenticated using (private.security_org_access(organization_id,false));
create policy security_settings_admin_write on public.organization_security_settings for all to authenticated using (private.security_org_access(organization_id,true)) with check (private.security_org_access(organization_id,true));
create policy user_security_self_read on public.user_security_profiles for select to authenticated using (user_id=(select auth.uid()));
create policy recovery_codes_self_read on public.mfa_recovery_codes for select to authenticated using (user_id=(select auth.uid()));
create policy security_sessions_self_read on public.security_sessions for select to authenticated using (user_id=(select auth.uid()) or private.security_org_access(organization_id,true));
create policy trusted_devices_self_read on public.trusted_devices for select to authenticated using (user_id=(select auth.uid()));
create policy sso_connections_admin_all on public.sso_connections for all to authenticated using (private.security_org_access(organization_id,true)) with check (private.security_org_access(organization_id,true));
create policy sso_role_mapping_admin_all on public.sso_role_mappings for all to authenticated using (private.security_org_access(organization_id,true)) with check (private.security_org_access(organization_id,true));
create policy security_audit_admin_read on public.security_audit_logs for select to authenticated using (organization_id is not null and private.security_org_access(organization_id,true));
create policy security_events_admin_all on public.security_events for all to authenticated using (organization_id is not null and private.security_org_access(organization_id,true)) with check (organization_id is not null and private.security_org_access(organization_id,true));
create policy backup_policies_admin_all on public.backup_policies for all to authenticated using (private.security_org_access(organization_id,true)) with check (private.security_org_access(organization_id,true));
create policy backup_runs_admin_read on public.backup_runs for select to authenticated using (organization_id is not null and private.security_org_access(organization_id,true));
create policy restore_tests_admin_read on public.restore_test_runs for select to authenticated using (organization_id is not null and private.security_org_access(organization_id,true));
create policy secret_rotation_admin_read on public.secret_rotation_register for select to authenticated using (organization_id is not null and private.security_org_access(organization_id,true));
create policy security_incidents_admin_all on public.security_incidents for all to authenticated using (organization_id is not null and private.security_org_access(organization_id,true)) with check (organization_id is not null and private.security_org_access(organization_id,true));
create policy access_reviews_admin_all on public.access_review_runs for all to authenticated using (private.security_org_access(organization_id,true)) with check (private.security_org_access(organization_id,true));

grant select,insert,update on public.organization_security_settings,public.sso_connections,public.sso_role_mappings,public.security_events,public.backup_policies,public.security_incidents,public.access_review_runs to authenticated;
grant select on public.user_security_profiles,public.mfa_recovery_codes,public.security_sessions,public.trusted_devices,public.security_audit_logs,public.backup_runs,public.restore_test_runs,public.secret_rotation_register to authenticated;
revoke all on public.security_rate_limit_buckets from anon,authenticated;
revoke update,delete on public.security_audit_logs from anon,authenticated;

insert into public.organization_security_settings(organization_id)
select id from public.organizations on conflict(organization_id) do nothing;
insert into public.backup_policies(organization_id)
select id from public.organizations on conflict(organization_id) do nothing;

insert into public.saas_support_components(component_key,name,status,public_message)
values
 ('database','Banco de dados','operational','Serviço operacional'),
 ('queue','Filas','operational','Serviço operacional'),
 ('billing','Billing SaaS','operational','Serviço operacional'),
 ('integrations','Integrações','operational','Serviço operacional'),
 ('fiscal','Fiscal','operational','Serviço operacional')
on conflict(component_key) do update set name=excluded.name;
