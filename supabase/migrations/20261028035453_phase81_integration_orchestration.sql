-- Fase 81: Enterprise Integration Orchestration / iPaaS control plane.
-- Additive only. Domain writes remain delegated to ActionEngine and credentials to Secret Management.

create table if not exists public.integration_orchestration_permissions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, permissions text[] not null default '{}', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,user_id)
);
create table if not exists public.integration_connector_registry(
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
 connector_key text not null, name text not null, provider text not null, connector_type text not null check(connector_type in('rest_api','webhook','oauth_api','file_import','file_export','sftp','queue','event_bus','database_readonly_adapter','custom_managed_connector')),
 category text not null check(category in('erp','accounting','crm','fiscal','supplier','hr','marketplace','payments','logistics','commerce','generic','internal','messaging','storage','file_transfer','custom_approved')),
 description text, owner_label text not null, status text not null default 'draft' check(status in('draft','review','active','deprecated','retired')),
 auth_type text not null check(auth_type in('none','api_key_ref','bearer_ref','oauth2_ref','basic_ref','mtls_ref','ssh_key_ref','managed_secret_ref','webhook_signature_ref')), risk_level text not null default 'medium' check(risk_level in('low','medium','high','critical')),
 capabilities text[] not null default '{}', allowed_hosts text[] not null default '{}', config_schema_version text not null, action_contract_set_version text not null,
 phase20_integration_type text, phase69_adapter_key text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique nulls not distinct(organization_id,connector_key)
);
create table if not exists public.integration_connector_versions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connector_id uuid not null references public.integration_connector_registry(id) on delete cascade, version integer not null check(version>0), status text not null default 'draft' check(status in('draft','published','deprecated')),
 manifest jsonb not null default '{}'::jsonb, manifest_hash text not null, compatibility text not null default 'backward' check(compatibility in('backward','forward','full','none')),
 data_contract_id uuid, published_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(connector_id,version)
);
create table if not exists public.integration_connector_actions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connector_version_id uuid not null references public.integration_connector_versions(id) on delete cascade, action_key text not null, name text not null,
 direction text not null check(direction in('read','write_intent','event')), risk_level text not null default 'medium' check(risk_level in('low','medium','high','critical')),
 input_contract_version text not null, output_contract_version text not null, timeout_ms integer not null default 30000 check(timeout_ms between 100 and 300000), idempotent boolean not null default false,
 status text not null default 'draft' check(status in('draft','active','deprecated')), unique(connector_version_id,action_key)
);
create table if not exists public.integration_connections(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid references public.establishments(id) on delete cascade, connector_id uuid not null references public.integration_connector_registry(id), name text not null,
 environment text not null default 'production' check(environment in('development','staging','sandbox','production')), status text not null default 'draft' check(status in('draft','connecting','testing','active','degraded','failing','disconnected','disabled','revoked','error')),
 auth_secret_ref text, oauth_connection_ref text, external_account_ref text, endpoint_profile jsonb not null default '{}'::jsonb, configuration jsonb not null default '{}'::jsonb, capability_snapshot jsonb not null default '{}'::jsonb,
 configuration_schema_version text not null, priority integer not null default 100, last_tested_at timestamptz, last_healthy_at timestamptz,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(auth_secret_ref is null or auth_secret_ref ~ '^(vault|secret|oauth)://[A-Za-z0-9_./:-]+$')
);
create table if not exists public.integration_connection_scopes(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.integration_connections(id) on delete cascade, scope_type text not null check(scope_type in('organization','store','resource','capability')),
 scope_ref text not null, permissions text[] not null default '{}', created_at timestamptz not null default now(), unique(connection_id,scope_type,scope_ref)
);
create table if not exists public.integration_connection_health(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.integration_connections(id) on delete cascade, checked_at timestamptz not null default now(), status text not null check(status in('healthy','degraded','failing','disconnected','unavailable','unknown')),
 latency_ms integer, error_category text, redacted_evidence jsonb not null default '{}'::jsonb, secret_exposed boolean not null default false
);
create table if not exists public.integration_flows(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 flow_key text not null, name text not null, description text, owner_label text not null, source_connection_id uuid references public.integration_connections(id), flow_type text not null default 'outbound' check(flow_type in('inbound','outbound','sync','reconciliation','scheduled_import','scheduled_export')),
 criticality text not null default 'medium' check(criticality in('low','medium','high','critical','business_critical','regulatory_critical')), lifecycle_status text not null default 'draft' check(lifecycle_status in('draft','testing','pilot','review','active','paused','deprecated','archived','retired')), active_version integer,
 core_operation_independent boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,flow_key)
);
create table if not exists public.integration_flow_versions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 flow_id uuid not null references public.integration_flows(id) on delete cascade, version integer not null check(version>0), status text not null default 'draft' check(status in('draft','validation_failed','review','approved','published','retired')),
 definition jsonb not null, definition_hash text not null, max_runtime_seconds integer not null default 300 check(max_runtime_seconds between 1 and 3600), max_steps integer not null default 100 check(max_steps between 1 and 500),
 input_contract_version text not null, output_contract_version text, feature_flag_key text, policy_set_id uuid, published_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(flow_id,version)
);
create table if not exists public.integration_flow_triggers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 flow_version_id uuid not null references public.integration_flow_versions(id) on delete cascade, trigger_type text not null check(trigger_type in('event','schedule','webhook','polling','file_arrival','manual_preview')),
 trigger_ref text not null, configuration jsonb not null default '{}'::jsonb, configuration_schema_version text not null, enabled boolean not null default false,
 automation_definition_id uuid, created_at timestamptz not null default now(), unique(flow_version_id,trigger_type,trigger_ref)
);
create table if not exists public.integration_mappings(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 mapping_key text not null, name text not null, source_contract_version text not null, target_contract_version text not null, version integer not null default 1 check(version>0),
 mappings jsonb not null default '[]'::jsonb, mapping_hash text not null, status text not null default 'draft' check(status in('draft','approved','published','deprecated')),
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(organization_id,mapping_key,version)
);
create table if not exists public.integration_transformations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 mapping_id uuid not null references public.integration_mappings(id) on delete cascade, sequence integer not null check(sequence>=0), transformation_type text not null check(transformation_type in('rename','pick','omit','constant','coalesce','concat','split','trim','lowercase','uppercase','date_format','number_format','boolean_cast','lookup_table','enum_map','default','mask','hash','array_map_fields')),
 source_path text, target_path text, configuration jsonb not null default '{}'::jsonb, configuration_schema_version text not null, unique(mapping_id,sequence)
);
create table if not exists public.integration_identity_rules(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 flow_version_id uuid not null references public.integration_flow_versions(id) on delete cascade, entity_type text not null, source_system text not null, source_identifier_path text not null,
 identifier_type text not null, resolution_strategy text not null default 'mdm_exact' check(resolution_strategy in('mdm_exact','mdm_crosswalk','human_review')),
 on_unresolved text not null default 'dead_letter' check(on_unresolved in('dead_letter','skip','human_review')), created_at timestamptz not null default now()
);
create table if not exists public.integration_field_ownership(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 entity_type text not null, field_path text not null, owning_system text not null, precedence text[] not null default '{}', conflict_strategy text not null check(conflict_strategy in('source_wins','target_wins','newest_verified','human_review','reject')),
 policy_set_id uuid, active boolean not null default true, created_at timestamptz not null default now(), unique(organization_id,entity_type,field_path)
);
create table if not exists public.integration_poll_cursors(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.integration_connections(id) on delete cascade, flow_version_id uuid not null references public.integration_flow_versions(id) on delete cascade,
 cursor_key text not null, cursor_value_ref text, cursor_hash text, watermark_at timestamptz, lease_owner text, lease_expires_at timestamptz, updated_at timestamptz not null default now(), unique(connection_id,flow_version_id,cursor_key)
);
create table if not exists public.integration_retry_policies(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, max_attempts integer not null default 5 check(max_attempts between 0 and 20), base_delay_ms integer not null default 1000 check(base_delay_ms between 100 and 3600000),
 max_delay_ms integer not null default 300000 check(max_delay_ms between 100 and 86400000), jitter_ratio numeric(4,3) not null default .2 check(jitter_ratio between 0 and .5),
 retryable_categories text[] not null default array['rate_limit','timeout','network','provider'], active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.integration_rate_limit_policies(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid references public.integration_connections(id) on delete cascade, capability text, requests_per_window integer not null check(requests_per_window>0), window_seconds integer not null check(window_seconds between 1 and 86400),
 concurrency_limit integer not null default 5 check(concurrency_limit between 1 and 1000), overflow_strategy text not null default 'queue' check(overflow_strategy in('queue','reject','dead_letter')), active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.integration_runs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 flow_id uuid not null references public.integration_flows(id), flow_version_id uuid not null references public.integration_flow_versions(id), trigger_id uuid references public.integration_flow_triggers(id),
 store_id uuid references public.establishments(id), source_event_id text, correlation_id text not null, idempotency_key text not null, status text not null default 'queued' check(status in('queued','running','waiting','completed','completed_with_warning','succeeded','partially_succeeded','failed','dead_lettered','cancelled','timed_out','reconciling')),
 current_step integer not null default 0, attempt integer not null default 1, input_payload_ref text, input_hash text, output_payload_ref text, output_hash text,
 error_category text, redacted_error text, started_at timestamptz, finished_at timestamptz, duration_ms bigint, created_at timestamptz not null default now(), unique(organization_id,idempotency_key)
);
create table if not exists public.integration_run_steps(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 run_id uuid not null references public.integration_runs(id) on delete cascade, node_id text not null, node_type text not null, sequence integer not null,
 status text not null default 'queued' check(status in('queued','running','succeeded','skipped','failed','timed_out','dead_lettered')), attempt integer not null default 1,
 input_hash text, output_hash text, payload_ref text, error_category text, redacted_error text, latency_ms bigint, started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now(), unique(run_id,node_id,attempt)
);
create table if not exists public.integration_idempotency_keys(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 idempotency_key text not null, operation text not null, request_hash text not null, status text not null default 'processing' check(status in('processing','succeeded','failed','expired')),
 run_id uuid references public.integration_runs(id), response_ref text, locked_until timestamptz, expires_at timestamptz not null, created_at timestamptz not null default now(), unique(organization_id,idempotency_key)
);
create table if not exists public.integration_dead_letters(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 run_id uuid not null references public.integration_runs(id), step_id uuid references public.integration_run_steps(id), connection_id uuid references public.integration_connections(id), flow_id uuid references public.integration_flows(id),
 status text not null default 'open' check(status in('open','reviewing','retry_scheduled','replay_scheduled','resolved','discarded','discarded_with_reason','escalated')),
 error_category text not null, redacted_error text not null, payload_ref text, payload_hash text, retry_history jsonb not null default '[]'::jsonb, attempts integer not null default 1, first_failed_at timestamptz not null default now(), last_failed_at timestamptz not null default now(),
 resolution_reason text, resolved_by uuid references auth.users(id), resolved_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.integration_reconciliation_jobs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 flow_id uuid references public.integration_flows(id), connection_id uuid references public.integration_connections(id), reconciliation_type text not null, status text not null default 'draft' check(status in('draft','queued','running','completed','completed_with_mismatches','failed')),
 window_start timestamptz not null, window_end timestamptz not null, source_count bigint, target_count bigint, matched_count bigint, mismatch_count bigint,
 correction_mode text not null default 'action_intent_only' check(correction_mode='action_intent_only'), started_at timestamptz, finished_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(), check(window_end>window_start)
);
create table if not exists public.integration_reconciliation_items(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 job_id uuid not null references public.integration_reconciliation_jobs(id) on delete cascade, entity_key_hash text not null, status text not null check(status in('matched','missing_source','missing_target','mismatch','conflict')),
 source_hash text, target_hash text, redacted_difference jsonb not null default '{}'::jsonb, action_intent_id uuid, reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.integration_sftp_profiles(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.integration_connections(id) on delete cascade, host text not null, port integer not null default 22 check(port between 1 and 65535), username_secret_ref text not null, ssh_key_secret_ref text not null,
 host_key_fingerprint text not null, allowed_base_path text not null, allow_write boolean not null default false, status text not null default 'draft' check(status in('draft','active','disabled')), created_at timestamptz not null default now(),
 check(host!~*'^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'), check(username_secret_ref~'^secret://'), check(ssh_key_secret_ref~'^secret://')
);
create table if not exists public.integration_file_contracts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 contract_key text not null, version integer not null default 1, format text not null check(format in('csv','jsonl','xml','xlsx','zip')), max_bytes bigint not null check(max_bytes between 1 and 1073741824),
 schema_contract_version text not null, checksum_required boolean not null default true, malware_scan_required boolean not null default true, status text not null default 'draft' check(status in('draft','published','deprecated')), unique(organization_id,contract_key,version)
);
create table if not exists public.integration_file_batches(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 file_contract_id uuid not null references public.integration_file_contracts(id), connection_id uuid references public.integration_connections(id), object_ref text not null, file_name text not null, size_bytes bigint not null,
 sha256 text not null, malware_status text not null default 'pending' check(malware_status in('pending','clean','blocked','failed')), validation_status text not null default 'pending' check(validation_status in('pending','valid','invalid','failed')),
 record_count bigint, accepted_count bigint, rejected_count bigint, status text not null default 'registered' check(status in('registered','scanning','validating','ready','processing','completed','blocked','failed')), created_at timestamptz not null default now(), unique(organization_id,sha256)
);
create table if not exists public.integration_flow_templates(
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
 template_key text not null, name text not null, description text, category text not null, version integer not null default 1, definition jsonb not null, definition_hash text not null,
 status text not null default 'draft' check(status in('draft','published','deprecated')), source text not null default 'masterapp', created_at timestamptz not null default now(), unique nulls not distinct(organization_id,template_key,version)
);
create table if not exists public.integration_flow_changesets(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 flow_id uuid not null references public.integration_flows(id) on delete cascade, title text not null, reason text not null, status text not null default 'draft' check(status in('draft','validating','review','approved','published','rejected','rolled_back')),
 from_version integer, to_version integer not null, contract_compatibility text, impact_summary jsonb not null default '{}'::jsonb, approval_request_id uuid, rollout_ref text,
 created_by uuid references auth.users(id), approved_by uuid references auth.users(id), created_at timestamptz not null default now(), approved_at timestamptz
);
create table if not exists public.integration_orchestration_audit_events(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid references auth.users(id), event_type text not null, entity_type text not null, entity_id uuid, reason text, before_state_redacted jsonb, after_state_redacted jsonb,
 correlation_id text, ip_hash text, created_at timestamptz not null default now()
);
create table if not exists public.integration_orchestration_settings(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade unique,
 default_retry_policy_id uuid references public.integration_retry_policies(id), max_active_runs integer not null default 50 check(max_active_runs between 1 and 5000),
 max_payload_bytes bigint not null default 5242880 check(max_payload_bytes between 1024 and 104857600), default_run_retention_days integer not null default 90 check(default_run_retention_days between 7 and 730),
 default_dlq_retention_days integer not null default 90 check(default_dlq_retention_days between 7 and 730), external_outage_core_independent boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists integration_runs_org_status_created_idx on public.integration_runs(organization_id,status,created_at desc);
create index if not exists integration_steps_run_status_idx on public.integration_run_steps(run_id,status,sequence);
create index if not exists integration_dlq_org_status_idx on public.integration_dead_letters(organization_id,status,last_failed_at desc);
create index if not exists integration_health_connection_idx on public.integration_connection_health(connection_id,checked_at desc);
create index if not exists integration_reconciliation_org_status_idx on public.integration_reconciliation_jobs(organization_id,status,created_at desc);
create index if not exists integration_audit_org_created_idx on public.integration_orchestration_audit_events(organization_id,created_at desc);

do $$ declare t text; begin foreach t in array array[
 'integration_orchestration_permissions','integration_connector_registry','integration_connector_versions','integration_connector_actions','integration_connections','integration_connection_scopes','integration_connection_health','integration_flows','integration_flow_versions','integration_flow_triggers','integration_mappings','integration_transformations','integration_identity_rules','integration_field_ownership','integration_poll_cursors','integration_retry_policies','integration_rate_limit_policies','integration_runs','integration_run_steps','integration_idempotency_keys','integration_dead_letters','integration_reconciliation_jobs','integration_reconciliation_items','integration_sftp_profiles','integration_file_contracts','integration_file_batches','integration_flow_templates','integration_flow_changesets','integration_orchestration_audit_events','integration_orchestration_settings'
] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t); execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',left('integration_service_'||t,63),t); end loop; end $$;

create or replace view public.integration_orchestration_health_overview with (security_invoker=true) as
select f.organization_id,count(distinct f.id) filter(where f.lifecycle_status='active') active_flows,count(distinct c.id) filter(where c.status='active') active_connections,
 count(distinct r.id) filter(where r.created_at>=now()-interval '24 hours') runs_24h,count(distinct r.id) filter(where r.status in('failed','dead_lettered')) failed_runs,
 count(distinct d.id) filter(where d.status in('open','reviewing')) open_dead_letters
from public.integration_flows f left join public.integration_connections c on c.organization_id=f.organization_id left join public.integration_runs r on r.organization_id=f.organization_id left join public.integration_dead_letters d on d.organization_id=f.organization_id group by f.organization_id;
revoke all on public.integration_orchestration_health_overview from public,anon,authenticated;
grant select on public.integration_orchestration_health_overview to service_role;

comment on table public.integration_flows is 'Fase 81: control plane declarativo; efeitos operacionais passam pelo ActionEngine.';
comment on column public.integration_connections.auth_secret_ref is 'Referência opaca ao Secret Management. Nunca armazena credencial em claro.';
comment on column public.integration_runs.input_payload_ref is 'Referência a payload protegido; payload completo não fica em logs.';
