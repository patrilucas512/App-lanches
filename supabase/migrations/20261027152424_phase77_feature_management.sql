-- Phase 77 - Central Feature Management and typed configuration.
-- Entitlements (Phase 22), releases (Phase 27), experiments (Phase 28) and network inheritance (Phase 46) remain authoritative.

create schema if not exists feature_management_private;
revoke all on schema feature_management_private from public,anon,authenticated;
grant usage on schema feature_management_private to service_role;

create table public.feature_definitions(
 id uuid primary key default gen_random_uuid(), feature_key text not null unique check(feature_key ~ '^[a-z][a-z0-9_.-]{2,119}$'), name text not null, description text,
 category text not null default 'platform', value_type text not null check(value_type in('boolean','string','number','enum','structured')), default_value jsonb not null, safe_default jsonb not null,
 client_safe boolean not null default false, entitlement_key text, experiment_key text, release_id uuid references public.platform_releases(id) on delete set null,
 owner_label text not null, lifecycle_status text not null default 'draft' check(lifecycle_status in('draft','active','deprecated','retired')), cleanup_due_at timestamptz,
 tags text[] not null default '{}', documentation_url text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(feature_key !~* '(secret|password|credential|access_token|private_key)')
);
create table public.feature_value_schemas(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, schema_version integer not null check(schema_version>0),
 enum_values text[], json_schema jsonb, schema_hash text not null, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(feature_id,schema_version)
);
create table public.feature_environments(
 id uuid primary key default gen_random_uuid(), environment_key text not null unique check(environment_key in('development','preview','staging','production')), name text not null,
 protected boolean not null default false, approval_required boolean not null default false, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.feature_versions(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 version integer not null check(version>0), value jsonb not null, status text not null default 'draft' check(status in('draft','review','published','superseded','rolled_back')),
 fingerprint text not null, reason text, release_id uuid references public.platform_releases(id) on delete set null, created_by uuid references auth.users(id), published_by uuid references auth.users(id), created_at timestamptz not null default now(), published_at timestamptz, unique(feature_id,environment_id,version), unique(feature_id,environment_id,fingerprint)
);
create table public.feature_targeting_rules(
 id uuid primary key default gen_random_uuid(), feature_version_id uuid not null references public.feature_versions(id) on delete cascade, priority integer not null check(priority>=0), name text not null,
 conditions jsonb not null default '{}' check(jsonb_typeof(conditions)='object'), value jsonb not null, percentage_bps integer check(percentage_bps between 0 and 10000), enabled boolean not null default true,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(feature_version_id,priority)
);
create table public.feature_dependencies(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, depends_on_feature_id uuid not null references public.feature_definitions(id) on delete restrict,
 expected_value jsonb not null default 'true', dependency_type text not null default 'required' check(dependency_type in('required','conflicts_with')), created_at timestamptz not null default now(), check(feature_id<>depends_on_feature_id), unique(feature_id,depends_on_feature_id,dependency_type)
);
create table public.feature_rollouts(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 feature_version_id uuid not null references public.feature_versions(id) on delete restrict, name text not null, strategy text not null default 'percentage' check(strategy in('percentage','canary','ring','scheduled')),
 status text not null default 'draft' check(status in('draft','scheduled','active','paused','completed','rolling_back','rolled_back','cancelled')), sticky boolean not null default true,
 starts_at timestamptz, ends_at timestamptz, health_policy jsonb not null default '{}', previous_version_id uuid references public.feature_versions(id), owner_label text not null,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.feature_rollout_stages(
 id uuid primary key default gen_random_uuid(), rollout_id uuid not null references public.feature_rollouts(id) on delete cascade, stage_order integer not null check(stage_order>=0), name text not null,
 percentage_bps integer not null check(percentage_bps between 0 and 10000), minimum_duration_minutes integer not null default 30 check(minimum_duration_minutes>=0),
 approval_required boolean not null default false, status text not null default 'pending' check(status in('pending','active','healthy','paused','failed','completed','skipped')),
 activated_at timestamptz, completed_at timestamptz, approved_by uuid references auth.users(id), approval_reason text, unique(rollout_id,stage_order)
);
create table public.feature_canary_releases(
 id uuid primary key default gen_random_uuid(), rollout_id uuid not null references public.feature_rollouts(id) on delete cascade, release_id uuid references public.platform_releases(id) on delete set null,
 cohort_definition jsonb not null default '{}', baseline_ref text, candidate_ref text not null, status text not null default 'draft' check(status in('draft','running','passed','failed','promoted','rolled_back')),
 started_at timestamptz, finished_at timestamptz, evidence jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.feature_access_programs(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 program_type text not null check(program_type in('allowlist','blocklist','beta','early_access')), subject_type text not null check(subject_type in('user','organization','brand','region','store','device')),
 subject_ids text[] not null default '{}', expires_at timestamptz, reason text not null, active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.feature_overrides(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 scope_type text not null check(scope_type in('global','organization','brand','region','store')), scope_id uuid, value jsonb not null, reason text not null,
 starts_at timestamptz not null default now(), expires_at timestamptz not null, status text not null default 'active' check(status in('active','expired','revoked')), ticket_ref text,
 created_by uuid references auth.users(id), revoked_by uuid references auth.users(id), revoked_at timestamptz, created_at timestamptz not null default now(), check(expires_at>starts_at), check(scope_type='global' or scope_id is not null)
);
create table public.feature_kill_switches(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 active boolean not null default false, safe_value jsonb not null, severity text not null default 'critical' check(severity in('warning','high','critical')), reason text,
 activated_by uuid references auth.users(id), activated_at timestamptz, deactivated_by uuid references auth.users(id), deactivated_at timestamptz, updated_at timestamptz not null default now(), unique(feature_id,environment_id)
);
create table public.configuration_definitions(
 id uuid primary key default gen_random_uuid(), config_key text not null unique check(config_key ~ '^[a-z][a-z0-9_.-]{2,119}$'), name text not null, description text,
 value_type text not null check(value_type in('boolean','string','number','enum','structured')), default_value jsonb not null, safe_default jsonb not null, enum_values text[], json_schema jsonb,
 client_safe boolean not null default false, owner_label text not null, lifecycle_status text not null default 'active' check(lifecycle_status in('draft','active','deprecated','retired')),
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(config_key !~* '(secret|password|credential|access_token|private_key)')
);
create table public.configuration_values(
 id uuid primary key default gen_random_uuid(), definition_id uuid not null references public.configuration_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 scope_type text not null check(scope_type in('global','organization','brand','region','store')), scope_id uuid, value jsonb not null, version integer not null check(version>0),
 status text not null default 'draft' check(status in('draft','review','published','superseded','revoked')), effective_from timestamptz not null default now(), effective_until timestamptz,
 reason text, created_by uuid references auth.users(id), published_by uuid references auth.users(id), created_at timestamptz not null default now(), published_at timestamptz,
 check(scope_type='global' or scope_id is not null), check(effective_until is null or effective_until>effective_from), unique(definition_id,environment_id,scope_type,scope_id,version)
);
create table public.feature_scheduled_changes(
 id uuid primary key default gen_random_uuid(), entity_type text not null check(entity_type in('feature_version','configuration_value','rollout','kill_switch','override')), entity_id uuid not null,
 action text not null check(action in('publish','activate','pause','advance','rollback','deactivate','expire')), execute_at timestamptz not null, status text not null default 'pending' check(status in('pending','running','completed','failed','cancelled')),
 payload jsonb not null default '{}', idempotency_key text not null unique, attempts integer not null default 0, last_error text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.feature_changesets(
 id uuid primary key default gen_random_uuid(), name text not null, description text, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 status text not null default 'draft' check(status in('draft','review','approved','published','rejected','cancelled')), impact_preview jsonb not null default '{}', reason text,
 created_by uuid references auth.users(id), approved_by uuid references auth.users(id), published_by uuid references auth.users(id), created_at timestamptz not null default now(), published_at timestamptz
);
create table public.feature_changeset_items(
 id uuid primary key default gen_random_uuid(), changeset_id uuid not null references public.feature_changesets(id) on delete cascade, entity_type text not null check(entity_type in('feature','configuration','rollout','override','kill_switch')),
 entity_id uuid, operation text not null check(operation in('create','update','publish','activate','deactivate','rollback','delete')), before_state jsonb, after_state jsonb not null, validation_status text not null default 'pending', validation_errors jsonb not null default '[]', item_order integer not null default 0
);
create table public.feature_scope_policies(
 id uuid primary key default gen_random_uuid(), scope_type text not null check(scope_type in('global','organization','brand','region','store')), scope_id uuid, environment_id uuid references public.feature_environments(id) on delete cascade,
 require_approval boolean not null default false, max_rollout_bps_without_approval integer not null default 1000 check(max_rollout_bps_without_approval between 0 and 10000), max_override_hours integer not null default 168 check(max_override_hours>0),
 allowed_roles text[] not null default '{}', policy jsonb not null default '{}', active boolean not null default true, updated_by uuid references auth.users(id), updated_at timestamptz not null default now(), check(scope_type='global' or scope_id is not null)
);
create table public.feature_rollout_health(
 id uuid primary key default gen_random_uuid(), rollout_id uuid not null references public.feature_rollouts(id) on delete cascade, stage_id uuid references public.feature_rollout_stages(id) on delete cascade,
 window_started_at timestamptz not null, window_ended_at timestamptz not null, status text not null check(status in('healthy','degraded','critical','insufficient_data','unknown')),
 sample_size bigint not null default 0, error_rate numeric, latency_p95_ms numeric, conversion_delta numeric, metrics jsonb not null default '{}', breaches text[] not null default '{}', evaluated_at timestamptz not null default now()
);
create table public.feature_exposure_aggregates(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 bucket_started_at timestamptz not null, scope_type text, scope_id uuid, variant_key text, evaluation_reason text, evaluation_count bigint not null default 0, enabled_count bigint not null default 0,
 error_count bigint not null default 0, latency_sum_ms bigint not null default 0, sampled boolean not null default true, created_at timestamptz not null default now(), unique(feature_id,environment_id,bucket_started_at,scope_type,scope_id,variant_key,evaluation_reason)
);
create table public.feature_evaluation_snapshots(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, environment_id uuid not null references public.feature_environments(id) on delete cascade,
 scope_type text not null, scope_id text not null, effective_value jsonb not null, decision_source text not null, configuration_version text not null, valid_until timestamptz,
 last_known_good boolean not null default false, created_at timestamptz not null default now(), unique(feature_id,environment_id,scope_type,scope_id,configuration_version)
);
create table public.feature_audit_events(
 id uuid primary key default gen_random_uuid(), actor_user_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid, environment_key text,
 scope_type text, scope_id uuid, reason text, before_state jsonb, after_state jsonb, correlation_id uuid not null default gen_random_uuid(), ip_hash text, user_agent_hash text,
 metadata_redacted jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.feature_member_permissions(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, permissions text[] not null default '{}', environment_keys text[] not null default '{}', category_filters text[] not null default '{}',
 active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(user_id)
);
create table public.feature_legacy_mappings(
 id uuid primary key default gen_random_uuid(), feature_id uuid not null references public.feature_definitions(id) on delete cascade, legacy_source text not null, legacy_key text not null,
 migration_status text not null default 'observed' check(migration_status in('observed','shadow','migrated','retired')), notes text, created_at timestamptz not null default now(), unique(legacy_source,legacy_key)
);

create index if not exists feature_versions_lookup_idx on public.feature_versions(feature_id,environment_id,status,published_at desc);
create index if not exists feature_rules_version_idx on public.feature_targeting_rules(feature_version_id,priority) where enabled;
create index if not exists feature_rollouts_active_idx on public.feature_rollouts(environment_id,status,updated_at desc) where status in('scheduled','active','paused');
create index if not exists feature_overrides_active_idx on public.feature_overrides(feature_id,environment_id,scope_type,scope_id,expires_at) where status='active';
create index if not exists configuration_values_resolution_idx on public.configuration_values(definition_id,environment_id,scope_type,scope_id,status,version desc);
create index if not exists feature_scheduled_due_idx on public.feature_scheduled_changes(status,execute_at) where status='pending';
create index if not exists feature_health_rollout_idx on public.feature_rollout_health(rollout_id,evaluated_at desc);
create index if not exists feature_exposure_time_idx on public.feature_exposure_aggregates(feature_id,environment_id,bucket_started_at desc);
create index if not exists feature_audit_entity_idx on public.feature_audit_events(entity_type,entity_id,created_at desc);

insert into public.feature_environments(environment_key,name,protected,approval_required) values
('development','Desenvolvimento',false,false),('preview','Preview',false,false),('staging','Homologação',true,true),('production','Produção',true,true)
on conflict(environment_key) do update set name=excluded.name,protected=excluded.protected,approval_required=excluded.approval_required,active=true;

insert into public.feature_definitions(feature_key,name,description,category,value_type,default_value,safe_default,client_safe,owner_label,lifecycle_status,tags,cleanup_due_at)
select flag_key,initcap(replace(flag_key,'_',' ')),description,'platform','boolean',to_jsonb(enabled),to_jsonb(false),false,'Platform Engineering','active',array['phase27','migrated'],expires_at
from public.quality_feature_flags
on conflict(feature_key) do nothing;
insert into public.feature_legacy_mappings(feature_id,legacy_source,legacy_key,migration_status,notes)
select id,'quality_feature_flags',feature_key,'shadow','Phase 27 remains readable during migration; Phase 77 is the target registry.' from public.feature_definitions where 'phase27'=any(tags)
on conflict(legacy_source,legacy_key) do nothing;

insert into public.saas_features(key,name,description,value_type,hard_limit,fallback_behavior,public) values
('feature_management','Feature Management','Registry, typed configuration and safe evaluation.','boolean',true,'upgrade_prompt',false),
('feature_management_advanced_rollouts','Feature Management · rollouts avançados','Canary, staged rollout and health gates.','boolean',true,'upgrade_prompt',false),
('feature_management_ai','Feature Management · IA assistiva','Copiloto explicativo sem poder de publicação.','boolean',false,'human_handoff',false)
on conflict(key) do update set name=excluded.name,description=excluded.description,value_type=excluded.value_type,hard_limit=excluded.hard_limit,fallback_behavior=excluded.fallback_behavior,public=false;

create or replace function feature_management_private.detect_dependency_cycle(start_feature uuid, candidate_dependency uuid)
returns boolean language sql stable security definer set search_path=''
as $$with recursive deps(feature_id,depends_on_feature_id) as(select feature_id,depends_on_feature_id from public.feature_dependencies where feature_id=candidate_dependency union all select d.feature_id,d.depends_on_feature_id from public.feature_dependencies d join deps x on d.feature_id=x.depends_on_feature_id) select exists(select 1 from deps where depends_on_feature_id=start_feature)$$;
revoke all on function feature_management_private.detect_dependency_cycle(uuid,uuid) from public,anon,authenticated;
grant execute on function feature_management_private.detect_dependency_cycle(uuid,uuid) to service_role;

create or replace function feature_management_private.reject_dependency_cycle()
returns trigger language plpgsql security definer set search_path='' as $$begin if (select feature_management_private.detect_dependency_cycle(new.feature_id,new.depends_on_feature_id)) then raise exception 'FEATURE_DEPENDENCY_CYCLE'; end if; return new; end$$;
revoke all on function feature_management_private.reject_dependency_cycle() from public,anon,authenticated;
create trigger feature_dependencies_cycle_guard before insert or update on public.feature_dependencies for each row execute function feature_management_private.reject_dependency_cycle();

do $$declare t text;begin foreach t in array array['feature_definitions','feature_value_schemas','feature_environments','feature_versions','feature_targeting_rules','feature_dependencies','feature_rollouts','feature_rollout_stages','feature_canary_releases','feature_access_programs','feature_overrides','feature_kill_switches','configuration_definitions','configuration_values','feature_scheduled_changes','feature_changesets','feature_changeset_items','feature_scope_policies','feature_rollout_health','feature_exposure_aggregates','feature_evaluation_snapshots','feature_audit_events','feature_member_permissions','feature_legacy_mappings'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t); execute format('create policy %I on public.%I for all to service_role using(true) with check(true)','service_role_only_'||t,t);
end loop;end$$;

create or replace view public.feature_management_health_overview with(security_invoker=true) as
select d.id feature_id,d.feature_key,d.name,d.category,d.owner_label,d.lifecycle_status,d.cleanup_due_at,
 (select count(*) from public.feature_rollouts r where r.feature_id=d.id and r.status in('scheduled','active','paused')) active_rollouts,
 (select count(*) from public.feature_overrides o where o.feature_id=d.id and o.status='active' and o.expires_at>now()) active_overrides,
 (select bool_or(k.active) from public.feature_kill_switches k where k.feature_id=d.id) kill_switch_active,
 (select h.status from public.feature_rollout_health h join public.feature_rollouts r on r.id=h.rollout_id where r.feature_id=d.id order by h.evaluated_at desc limit 1) latest_health
from public.feature_definitions d;
revoke all on public.feature_management_health_overview from public,anon,authenticated;
grant select on public.feature_management_health_overview to service_role;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,certified,sensitive,allowed_dimensions) values
('feature_evaluation_count','Feature Evaluation Count','Avaliações agregadas por feature, ambiente e motivo.','sum(evaluation_count)','feature_exposure_aggregates','feature/environment/hour','Platform Engineering','hourly','count','fact',true,false,array['feature','environment','reason']),
('feature_rollout_health_rate','Feature Rollout Health Rate','Proporção de janelas saudáveis por rollout.','healthy windows / evaluated windows','feature_rollout_health','rollout/day','Platform Engineering','hourly','percent','calculation',true,false,array['feature','environment','rollout']),
('feature_override_active_count','Feature Override Active Count','Overrides temporários ativos e não expirados.','count(active overrides)','feature_overrides','environment/scope/day','Platform Engineering','hourly','count','fact',true,true,array['environment','scope_type']),
('feature_cleanup_overdue_count','Feature Cleanup Overdue Count','Features com prazo de limpeza vencido.','count(cleanup_due_at < now)','feature_definitions','category/day','Platform Engineering','daily','count','fact',true,false,array['category','owner'])
on conflict(metric_key) do update set description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,grain=excluded.grain,owner_label=excluded.owner_label,refresh_frequency=excluded.refresh_frequency,unit=excluded.unit,evidence_class=excluded.evidence_class,certified=excluded.certified,sensitive=excluded.sensitive,allowed_dimensions=excluded.allowed_dimensions,updated_at=now();

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position,customer_visible) values
('feature-management','Feature Management','/superadmin/feature-management',array['features','flags','rollout','canary','kill switch','configuração','override'],'feature_management','search:global','⚑',26,false)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,icon=excluded.icon,position=excluded.position,customer_visible=false;
