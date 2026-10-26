-- Phase 27: quality engineering, controlled releases and regression prevention.
-- Expand-only migration: no DROP/RENAME and no production test data is created.
-- quality: allow-nonconcurrent-index reason=new-empty-quality-tables

alter table public.organizations add column if not exists is_test_organization boolean not null default false;
alter table public.organizations add column if not exists test_safety_profile text not null default 'production'
  check (test_safety_profile in ('production','development','staging','synthetic'));

alter table public.plans add column if not exists e2e_testing_enabled boolean not null default false;
alter table public.plans add column if not exists preview_environments_enabled boolean not null default false;
alter table public.plans add column if not exists canary_releases_enabled boolean not null default false;
alter table public.plans add column if not exists visual_regression_enabled boolean not null default false;

create table if not exists public.qa_environments (
  id uuid primary key default gen_random_uuid(),
  environment_key text not null unique check (environment_key in ('development','staging','production')),
  display_name text not null,
  base_url text,
  database_reference text,
  status text not null default 'configuration_required' check (status in ('configuration_required','provisioning','healthy','degraded','offline')),
  production_data_allowed boolean not null default false,
  real_payments_allowed boolean not null default false,
  real_fiscal_allowed boolean not null default false,
  real_customer_messages_allowed boolean not null default false,
  outbound_email_mode text not null default 'intercept' check (outbound_email_mode in ('intercept','sandbox','production')),
  gateway_mode text not null default 'sandbox' check (gateway_mode in ('mock','sandbox','production')),
  last_health_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qa_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'github_actions',
  external_run_id text,
  commit_sha text not null,
  branch_name text not null,
  trigger_event text not null,
  environment_key text not null default 'development',
  status text not null check (status in ('queued','running','passed','failed','cancelled','blocked')),
  test_total integer not null default 0,
  test_passed integer not null default 0,
  test_failed integer not null default 0,
  flaky_count integer not null default 0,
  coverage_percent numeric(6,2),
  duration_seconds integer,
  artifacts jsonb not null default '[]',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider,external_run_id)
);

create table if not exists public.qa_suite_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_run_id uuid not null references public.qa_pipeline_runs(id) on delete cascade,
  suite_type text not null check (suite_type in ('unit','integration','e2e','contract','security','performance','visual','migration')),
  suite_name text not null,
  status text not null check (status in ('queued','running','passed','failed','skipped','quarantined')),
  total integer not null default 0,
  passed integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  flaky integer not null default 0,
  duration_ms bigint,
  report_reference text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.platform_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  commit_sha text not null,
  artifact_digest text,
  environment_key text not null check (environment_key in ('staging','production')),
  status text not null check (status in ('draft','candidate','awaiting_approval','deploying','healthy','degraded','failed','rolled_back')),
  rollout_percent integer not null default 0 check (rollout_percent between 0 and 100),
  pipeline_run_id uuid references public.qa_pipeline_runs(id) on delete set null,
  rollback_of uuid references public.platform_releases(id) on delete set null,
  changelog jsonb not null default '[]',
  release_notes text,
  health_snapshot jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  deployed_at timestamptz,
  deployed_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.release_audit_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.platform_releases(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  reason text,
  correlation_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.quality_feature_flags (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null unique,
  description text not null,
  enabled boolean not null default false,
  kill_switch boolean not null default false,
  internal_only boolean not null default true,
  rollout_percent integer not null default 0 check (rollout_percent between 0 and 100),
  target_organization_ids uuid[] not null default '{}',
  target_plan_codes text[] not null default '{}',
  expires_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deploy_controls (
  environment_key text primary key check (environment_key in ('staging','production')),
  deploy_frozen boolean not null default false,
  freeze_reason text,
  frozen_by uuid references public.profiles(id) on delete set null,
  frozen_at timestamptz,
  sensitive_release_requires_approval boolean not null default true,
  auto_rollback_enabled boolean not null default false,
  auto_rollback_error_rate_percent numeric(7,4),
  auto_rollback_p95_regression_percent numeric(7,2),
  updated_at timestamptz not null default now()
);

create table if not exists public.qa_regressions (
  id uuid primary key default gen_random_uuid(),
  release_id uuid references public.platform_releases(id) on delete set null,
  pipeline_run_id uuid references public.qa_pipeline_runs(id) on delete set null,
  severity text not null check (severity in ('low','medium','high','critical')),
  title text not null,
  status text not null default 'open' check (status in ('open','investigating','fixed','verified','closed')),
  regression_label text not null default 'release_regression',
  correlation_id text,
  test_reference text,
  detected_at timestamptz not null default now(),
  fixed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.flaky_test_registry (
  id uuid primary key default gen_random_uuid(),
  test_key text not null unique,
  suite_type text not null,
  status text not null default 'active' check (status in ('active','quarantined','fixed')),
  failure_count integer not null default 0,
  last_failed_at timestamptz,
  quarantine_until date,
  owner text,
  issue_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.synthetic_monitors (
  id uuid primary key default gen_random_uuid(),
  monitor_key text not null unique,
  organization_id uuid references public.organizations(id) on delete cascade,
  environment_key text not null default 'staging' check (environment_key in ('development','staging')),
  scenario_key text not null,
  enabled boolean not null default false,
  schedule_text text,
  last_status text check (last_status is null or last_status in ('passed','failed','degraded')),
  last_run_at timestamptz,
  last_correlation_id text,
  safeguards jsonb not null default '{"real_payment":false,"real_fiscal":false,"real_message":false}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qa_pipeline_commit_idx on public.qa_pipeline_runs(commit_sha,created_at desc);
create index if not exists qa_pipeline_status_idx on public.qa_pipeline_runs(status,created_at desc);
create index if not exists qa_suite_pipeline_idx on public.qa_suite_runs(pipeline_run_id,suite_type);
create index if not exists platform_release_status_idx on public.platform_releases(status,created_at desc);
create index if not exists platform_release_pipeline_idx on public.platform_releases(pipeline_run_id);
create index if not exists platform_release_rollback_idx on public.platform_releases(rollback_of);
create index if not exists platform_release_deployed_by_idx on public.platform_releases(deployed_by);
create index if not exists platform_release_approved_by_idx on public.platform_releases(approved_by);
create index if not exists release_audit_release_idx on public.release_audit_events(release_id,created_at desc);
create index if not exists release_audit_actor_idx on public.release_audit_events(actor_user_id,created_at desc);
create index if not exists quality_flags_updated_by_idx on public.quality_feature_flags(updated_by);
create index if not exists deploy_controls_frozen_by_idx on public.deploy_controls(frozen_by);
create index if not exists qa_regressions_release_idx on public.qa_regressions(release_id,detected_at desc);
create index if not exists qa_regressions_pipeline_idx on public.qa_regressions(pipeline_run_id);
create index if not exists synthetic_monitors_org_idx on public.synthetic_monitors(organization_id);

create or replace function public.get_quality_summary()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if current_user not in ('service_role','postgres') and not private.is_superadmin() then raise exception 'access denied'; end if;
  select jsonb_build_object(
    'latest_pipeline',(select to_jsonb(p) from public.qa_pipeline_runs p order by created_at desc limit 1),
    'pipelines',jsonb_build_object(
      'passed',(select count(*) from public.qa_pipeline_runs where status='passed'),
      'failed',(select count(*) from public.qa_pipeline_runs where status='failed'),
      'running',(select count(*) from public.qa_pipeline_runs where status in ('queued','running'))
    ),
    'releases',jsonb_build_object(
      'healthy',(select count(*) from public.platform_releases where status='healthy'),
      'degraded',(select count(*) from public.platform_releases where status='degraded'),
      'rolled_back',(select count(*) from public.platform_releases where status='rolled_back')
    ),
    'regressions',jsonb_build_object(
      'open',(select count(*) from public.qa_regressions where status in ('open','investigating')),
      'critical',(select count(*) from public.qa_regressions where severity='critical' and status in ('open','investigating'))
    ),
    'flaky',jsonb_build_object(
      'active',(select count(*) from public.flaky_test_registry where status='active'),
      'quarantined',(select count(*) from public.flaky_test_registry where status='quarantined')
    ),
    'environments',(select coalesce(jsonb_agg(to_jsonb(e) order by e.environment_key),'[]'::jsonb) from public.qa_environments e),
    'deploy_controls',(select coalesce(jsonb_agg(to_jsonb(d) order by d.environment_key),'[]'::jsonb) from public.deploy_controls d)
  ) into result;
  return result;
end $$;

create or replace function public.set_quality_feature_flag(
  requested_flag_key text, requested_enabled boolean, requested_kill_switch boolean,
  requested_rollout_percent integer, requested_internal_only boolean,
  requested_target_organizations uuid[] default '{}', requested_target_plans text[] default '{}'
) returns public.quality_feature_flags language plpgsql security definer set search_path='' as $$
declare saved public.quality_feature_flags;
begin
  if not private.is_superadmin() then raise exception 'access denied'; end if;
  update public.quality_feature_flags set
    enabled=requested_enabled,
    kill_switch=requested_kill_switch,
    rollout_percent=least(100,greatest(0,requested_rollout_percent)),
    internal_only=requested_internal_only,
    target_organization_ids=coalesce(requested_target_organizations,'{}'),
    target_plan_codes=coalesce(requested_target_plans,'{}'),
    updated_by=auth.uid(),updated_at=now()
  where flag_key=requested_flag_key returning * into saved;
  if saved.id is null then raise exception 'unknown feature flag'; end if;
  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,old_value,new_value,reason)
  values(auth.uid(),'quality.feature_flag_updated','quality_feature_flags',saved.id,null,to_jsonb(saved),'controlled rollout update');
  return saved;
end $$;

create or replace function public.set_deploy_freeze(requested_environment text,requested_frozen boolean,requested_reason text)
returns public.deploy_controls language plpgsql security definer set search_path='' as $$
declare saved public.deploy_controls;
begin
  if not private.is_superadmin() then raise exception 'access denied'; end if;
  if requested_environment not in ('staging','production') then raise exception 'invalid environment'; end if;
  update public.deploy_controls set deploy_frozen=requested_frozen,freeze_reason=nullif(left(requested_reason,500),''),frozen_by=case when requested_frozen then auth.uid() else null end,frozen_at=case when requested_frozen then now() else null end,updated_at=now()
  where environment_key=requested_environment returning * into saved;
  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,old_value,new_value,reason)
  values(auth.uid(),case when requested_frozen then 'release.deploy_frozen' else 'release.deploy_unfrozen' end,'deploy_controls',null,null,to_jsonb(saved),requested_reason);
  return saved;
end $$;

create or replace function public.request_release_rollback(requested_release_id uuid,requested_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare source_release public.platform_releases; rollback_id uuid;
begin
  if not private.is_superadmin() then raise exception 'access denied'; end if;
  if length(trim(coalesce(requested_reason,''))) < 10 then raise exception 'rollback reason required'; end if;
  select * into source_release from public.platform_releases where id=requested_release_id for update;
  if source_release.id is null or source_release.environment_key <> 'production' then raise exception 'production release not found'; end if;
  insert into public.platform_releases(version,commit_sha,artifact_digest,environment_key,status,rollout_percent,rollback_of,release_notes,started_at,deployed_by)
  values(source_release.version||'-rollback-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISS'),source_release.commit_sha,source_release.artifact_digest,'production','awaiting_approval',0,source_release.id,'Rollback solicitado: '||left(requested_reason,1000),now(),auth.uid()) returning id into rollback_id;
  insert into public.release_audit_events(release_id,actor_user_id,event_type,from_status,to_status,reason,correlation_id)
  values(rollback_id,auth.uid(),'rollback_requested',source_release.status,'awaiting_approval',requested_reason,gen_random_uuid()::text);
  return rollback_id;
end $$;

alter table public.qa_environments enable row level security;
alter table public.qa_pipeline_runs enable row level security;
alter table public.qa_suite_runs enable row level security;
alter table public.platform_releases enable row level security;
alter table public.release_audit_events enable row level security;
alter table public.quality_feature_flags enable row level security;
alter table public.deploy_controls enable row level security;
alter table public.qa_regressions enable row level security;
alter table public.flaky_test_registry enable row level security;
alter table public.synthetic_monitors enable row level security;

do $$ declare table_name text; begin
  foreach table_name in array array['qa_environments','qa_pipeline_runs','qa_suite_runs','platform_releases','release_audit_events','quality_feature_flags','deploy_controls','qa_regressions','flaky_test_registry','synthetic_monitors'] loop
    execute format('create policy %I on public.%I for all to authenticated using ((select private.is_superadmin())) with check ((select private.is_superadmin()))','quality_superadmin_'||table_name,table_name);
  end loop;
end $$;

revoke all on public.qa_environments,public.qa_pipeline_runs,public.qa_suite_runs,public.platform_releases,public.release_audit_events,public.quality_feature_flags,public.deploy_controls,public.qa_regressions,public.flaky_test_registry,public.synthetic_monitors from public,anon;
grant select,insert,update on public.qa_environments,public.qa_pipeline_runs,public.qa_suite_runs,public.platform_releases,public.release_audit_events,public.quality_feature_flags,public.deploy_controls,public.qa_regressions,public.flaky_test_registry,public.synthetic_monitors to authenticated;
grant all on public.qa_environments,public.qa_pipeline_runs,public.qa_suite_runs,public.platform_releases,public.release_audit_events,public.quality_feature_flags,public.deploy_controls,public.qa_regressions,public.flaky_test_registry,public.synthetic_monitors to service_role;

revoke all on function public.get_quality_summary() from public,anon;
revoke all on function public.set_quality_feature_flag(text,boolean,boolean,integer,boolean,uuid[],text[]) from public,anon;
revoke all on function public.set_deploy_freeze(text,boolean,text) from public,anon;
revoke all on function public.request_release_rollback(uuid,text) from public,anon;
grant execute on function public.get_quality_summary() to authenticated,service_role;
grant execute on function public.set_quality_feature_flag(text,boolean,boolean,integer,boolean,uuid[],text[]) to authenticated;
grant execute on function public.set_deploy_freeze(text,boolean,text) to authenticated;
grant execute on function public.request_release_rollback(uuid,text) to authenticated;

insert into public.qa_environments(environment_key,display_name,status,production_data_allowed,real_payments_allowed,real_fiscal_allowed,real_customer_messages_allowed,outbound_email_mode,gateway_mode)
values
 ('development','Desenvolvimento','healthy',false,false,false,false,'intercept','mock'),
 ('staging','Staging','configuration_required',false,false,false,false,'intercept','sandbox'),
 ('production','Produção','healthy',true,true,true,true,'production','production')
on conflict(environment_key) do nothing;

insert into public.deploy_controls(environment_key,deploy_frozen,sensitive_release_requires_approval,auto_rollback_enabled)
values ('staging',false,false,false),('production',false,true,false)
on conflict(environment_key) do nothing;

insert into public.quality_feature_flags(flag_key,description,enabled,internal_only,rollout_percent)
values
 ('e2e_testing_enabled','Habilita cenários sintéticos somente em ambientes seguros',false,true,0),
 ('preview_environments_enabled','Habilita ambientes temporários por pull request',false,true,0),
 ('canary_releases_enabled','Habilita rollout gradual de release',false,true,0),
 ('visual_regression_enabled','Habilita comparação visual das telas críticas',false,true,0)
on conflict(flag_key) do nothing;

insert into public.platform_releases(version,commit_sha,environment_key,status,rollout_percent,release_notes,deployed_at,completed_at)
select '171','d94235cec539d714b22784541e4acdc1aa1989a3','production','healthy',100,'Fase 26: performance e escalabilidade',r.deployed_at,r.deployed_at
from public.release_performance_snapshots r where r.release_version='171'
on conflict(version) do nothing;

