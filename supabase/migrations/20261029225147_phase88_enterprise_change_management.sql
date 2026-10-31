-- Phase 88: Enterprise Change Management control plane.
-- Source systems remain execution owners; this schema stores governance, evidence and history.
-- quality: allow-nonconcurrent-index reason=new-empty-change-management-tables

create table public.change_member_permissions(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permissions text[] not null default '{change:view}',
  scope_types text[] not null default '{}',
  active boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(organization_id,user_id)
);

create table public.change_requests(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_key text not null,
  title text not null,
  description text not null,
  change_type text not null check(change_type in('standard','normal','major','emergency','maintenance','migration','configuration','release','feature_rollout','policy_change','integration_change','schema_change','infrastructure_change','provider_change','operational_change')),
  source_domain text not null check(source_domain in('cicd','feature_management','policy_engine','integrations','data_governance','continuity','reliability','security','infrastructure','catalog','pricing','finance','operations','custom')),
  source_ref text,
  scope_type text not null,
  scope_refs jsonb not null default '[]',
  owner_user_id uuid not null references auth.users(id),
  requester_user_id uuid not null references auth.users(id),
  status text not null default 'draft' check(status in('draft','impact_analysis','review','awaiting_approval','approved','scheduled','implementing','validating','completed','completed_with_issues','failed','rolled_back','cancelled')),
  risk_level text not null default 'unknown' check(risk_level in('unknown','low','medium','high','critical')),
  urgency text not null default 'normal' check(urgency in('low','normal','high','urgent')),
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  irreversible boolean not null default false,
  sensitive boolean not null default false,
  metadata_redacted jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,change_key),
  check(planned_start is null or planned_end is null or planned_end>planned_start)
);

create table public.standard_change_templates(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  version integer not null check(version>0),
  allowed_scope jsonb not null default '[]',
  prerequisites jsonb not null default '[]',
  validation_requirements jsonb not null default '[]',
  rollback_requirements jsonb not null default '[]',
  approver_policy_ref text,
  observation_window text,
  status text not null default 'draft' check(status in('draft','active','retired')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organization_id,name,version)
);

create table public.change_risk_assessments(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  version integer not null check(version>0),
  risk_level text not null check(risk_level in('low','medium','high','critical')),
  factors jsonb not null,
  reasons jsonb not null default '[]',
  reliability_ref text,
  enterprise_risk_refs jsonb not null default '[]',
  continuity_ref text,
  assessed_by uuid not null references auth.users(id),
  assessed_at timestamptz not null default now(),
  unique(change_id,version)
);

create table public.change_impacts(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  direct_impact jsonb not null default '[]',
  transitive_impact jsonb not null default '[]',
  estimated_user_scope jsonb not null default '{}',
  data_scope jsonb not null default '[]',
  coverage text not null check(coverage in('complete','incomplete','unknown')),
  confidence text not null check(confidence in('high','medium','limited','unknown')),
  missing_sources jsonb not null default '[]',
  source_lineage_refs jsonb not null default '[]',
  analyzed_at timestamptz not null default now()
);

create table public.change_dependencies(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  related_change_id uuid not null references public.change_requests(id) on delete cascade,
  dependency_type text not null check(dependency_type in('requires_change','must_complete_before','must_complete_after','conflicts_with','related_to')),
  created_at timestamptz not null default now(),
  unique(change_id,related_change_id,dependency_type),
  check(change_id<>related_change_id)
);

create table public.change_conflicts(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  conflicting_change_id uuid references public.change_requests(id) on delete cascade,
  conflict_type text not null,
  level text not null check(level in('info','warning','high','blocking')),
  scope_ref text,
  reasons jsonb not null default '[]',
  status text not null default 'open' check(status in('open','accepted','resolved','superseded')),
  resolution text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  detected_at timestamptz not null default now()
);

create table public.change_maintenance_windows(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  scope_type text not null,
  scope_ref text,
  allowed_start time not null,
  allowed_end time not null,
  timezone text not null,
  recurrence text,
  blackout_rules jsonb not null default '[]',
  owner_user_id uuid not null references auth.users(id),
  status text not null default 'active' check(status in('active','inactive','retired')),
  created_at timestamptz not null default now()
);

create table public.change_blackout_windows(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  scope_type text not null,
  scope_ref text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  reason text not null,
  source_domain text not null default 'operating_calendar',
  source_ref text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  check(ends_at>starts_at)
);

create table public.change_checklists(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  item_key text not null,
  item_type text not null,
  required boolean not null default true,
  status text not null default 'pending' check(status in('pending','passed','failed','not_applicable','waived')),
  evidence_ref text,
  evidence_source text,
  waiver_reason text,
  waiver_approval_ref text,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  unique(change_id,item_key)
);

create table public.change_approval_links(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  approval_ref text not null,
  approval_role text not null,
  policy_decision_ref text,
  status text not null default 'pending',
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique(change_id,approval_ref)
);

create table public.change_rollback_plans(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  strategy text not null check(strategy in('deployment_revert','feature_disable','config_revert','schema_rollback','forward_fix','provider_switch_back','restore','manual_recovery','not_applicable')),
  readiness_state text not null check(readiness_state in('ready','partial','not_ready','not_applicable','unknown')),
  owner_user_id uuid references auth.users(id),
  tested boolean not null default false,
  estimated_minutes integer,
  data_compatibility text,
  backup_validation_ref text,
  forward_recovery_plan text,
  source_executor_ref text,
  created_at timestamptz not null default now()
);

create table public.change_implementation_steps(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  sequence integer not null check(sequence>0),
  step_type text not null check(step_type in('prepare','deploy','configure','migrate','verify','communicate','monitor','rollback')),
  owner_user_id uuid not null references auth.users(id),
  executor_domain text not null,
  action_ref text,
  validation_ref text,
  status text not null default 'pending' check(status in('pending','ready','executing','completed','failed','skipped_with_reason')),
  skip_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  unique(change_id,sequence)
);

create table public.change_validation_plans(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  validation_key text not null,
  source_domain text not null,
  source_ref text,
  required boolean not null default true,
  success_criteria jsonb not null,
  observation_window text not null,
  created_at timestamptz not null default now(),
  unique(change_id,validation_key)
);

create table public.change_validation_results(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  validation_plan_id uuid references public.change_validation_plans(id) on delete cascade,
  status text not null check(status in('passed','failed','warning','unknown')),
  evidence_ref text,
  observed_value jsonb,
  outcome text check(outcome in('successful','successful_with_warning','failed','rolled_back','inconclusive')),
  evaluated_at timestamptz not null default now()
);

create table public.change_observation_windows(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check(status in('pending','active','completed','failed')),
  health_summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check(ends_at>starts_at)
);

create table public.change_communication_plans(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  audiences jsonb not null default '[]',
  channels jsonb not null default '[]',
  message_ref text,
  approval_ref text,
  external_message boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table public.emergency_change_records(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null unique references public.change_requests(id) on delete cascade,
  incident_ref text,
  reason text not null,
  urgency text not null,
  minimum_impact_assessment jsonb not null,
  authorized_actor uuid not null references auth.users(id),
  authority_ref text not null,
  fallback_plan text,
  break_glass_used boolean not null default false,
  retrospective_due_at timestamptz not null,
  retrospective_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.change_advisory_reviews(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  participants jsonb not null default '[]',
  advisory_pack jsonb not null,
  status text not null default 'pending' check(status in('pending','in_review','recommended','not_recommended','completed')),
  recommendation text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.post_change_reviews(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  outcome text not null,
  validation_summary jsonb not null default '{}',
  issue_refs jsonb not null default '[]',
  incident_refs jsonb not null default '[]',
  lessons jsonb not null default '[]',
  follow_up_refs jsonb not null default '[]',
  reviewed_by uuid not null references auth.users(id),
  status text not null default 'draft' check(status in('draft','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.change_relationships(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  related_change_id uuid not null references public.change_requests(id) on delete cascade,
  relationship_type text not null check(relationship_type in('parent','child','related','dependency','correction')),
  created_at timestamptz not null default now(),
  unique(change_id,related_change_id,relationship_type),
  check(change_id<>related_change_id)
);

create table public.change_incident_links(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  incident_ref text not null,
  correlation_label text not null check(correlation_label in('possible_relation','strong_correlation','confirmed_by_incident')),
  reasons jsonb not null default '[]',
  reviewed boolean not null default false,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(change_id,incident_ref)
);

create table public.change_cleanup_items(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_id uuid not null references public.change_requests(id) on delete cascade,
  cleanup_type text not null,
  source_ref text not null,
  expires_at timestamptz,
  status text not null default 'active' check(status in('active','completed','cancelled')),
  owner_user_id uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.change_audit_events(
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  change_id uuid references public.change_requests(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  reason text,
  before_state_redacted jsonb,
  after_state_redacted jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create function public.prevent_final_change_mutation() returns trigger
language plpgsql
set search_path=public
as $$
begin
  if old.status in ('completed','completed_with_issues','failed','rolled_back','cancelled') and new is distinct from old then
    raise exception 'FINAL_CHANGE_IMMUTABLE';
  end if;
  return new;
end
$$;
revoke all on function public.prevent_final_change_mutation() from public,anon,authenticated;
create trigger change_requests_final_immutable before update on public.change_requests for each row execute function public.prevent_final_change_mutation();

create index change_requests_org_window_idx on public.change_requests(organization_id,planned_start,planned_end);
create index change_requests_org_status_idx on public.change_requests(organization_id,status,risk_level);
create index change_requests_owner_idx on public.change_requests(owner_user_id);
create index change_requests_requester_idx on public.change_requests(requester_user_id);
create index change_requests_source_idx on public.change_requests(source_domain,source_ref);
create index standard_change_templates_created_by_idx on public.standard_change_templates(created_by);
create index change_risk_assessments_change_idx on public.change_risk_assessments(change_id,version desc);
create index change_risk_assessments_assessed_by_idx on public.change_risk_assessments(assessed_by);
create index change_impacts_change_idx on public.change_impacts(change_id);
create index change_dependencies_related_idx on public.change_dependencies(related_change_id);
create index change_conflicts_window_lookup_idx on public.change_conflicts(change_id,status,level);
create index change_conflicts_conflicting_idx on public.change_conflicts(conflicting_change_id);
create index change_conflicts_resolved_by_idx on public.change_conflicts(resolved_by);
create index change_maintenance_scope_idx on public.change_maintenance_windows(organization_id,scope_type,scope_ref,status);
create index change_maintenance_owner_idx on public.change_maintenance_windows(owner_user_id);
create index change_blackout_window_idx on public.change_blackout_windows(organization_id,starts_at,ends_at);
create index change_checklists_change_idx on public.change_checklists(change_id,status);
create index change_checklists_completed_by_idx on public.change_checklists(completed_by);
create index change_approval_links_change_idx on public.change_approval_links(change_id,status);
create index change_approval_links_decided_by_idx on public.change_approval_links(decided_by);
create index change_rollback_change_idx on public.change_rollback_plans(change_id);
create index change_rollback_owner_idx on public.change_rollback_plans(owner_user_id);
create index change_steps_change_idx on public.change_implementation_steps(change_id,sequence);
create index change_steps_owner_idx on public.change_implementation_steps(owner_user_id);
create index change_validation_plan_change_idx on public.change_validation_plans(change_id);
create index change_validation_result_change_idx on public.change_validation_results(change_id,evaluated_at desc);
create index change_validation_result_plan_idx on public.change_validation_results(validation_plan_id);
create index change_observation_window_idx on public.change_observation_windows(change_id,starts_at,ends_at);
create index change_communications_change_idx on public.change_communication_plans(change_id);
create index emergency_change_authorized_idx on public.emergency_change_records(authorized_actor);
create index emergency_change_review_idx on public.emergency_change_records(retrospective_due_at,retrospective_completed_at);
create index change_advisory_change_idx on public.change_advisory_reviews(change_id,status);
create index post_change_reviews_change_idx on public.post_change_reviews(change_id,status);
create index post_change_reviews_reviewer_idx on public.post_change_reviews(reviewed_by);
create index change_relationships_related_idx on public.change_relationships(related_change_id);
create index change_incident_change_idx on public.change_incident_links(change_id,reviewed);
create index change_incident_reviewer_idx on public.change_incident_links(reviewed_by);
create index change_cleanup_due_idx on public.change_cleanup_items(organization_id,status,expires_at);
create index change_cleanup_owner_idx on public.change_cleanup_items(owner_user_id);
create index change_audit_org_time_idx on public.change_audit_events(organization_id,created_at desc);
create index change_audit_actor_idx on public.change_audit_events(actor_id);
create index change_audit_change_idx on public.change_audit_events(change_id,created_at desc);
create index change_member_permissions_user_idx on public.change_member_permissions(user_id);
create index change_member_permissions_updated_by_idx on public.change_member_permissions(updated_by);

create view public.enterprise_change_calendar with(security_invoker=true) as
select c.id,c.organization_id,c.change_key,c.title,c.change_type,c.source_domain,c.scope_type,c.scope_refs,c.owner_user_id,c.status,c.risk_level,c.planned_start,c.planned_end,
  exists(select 1 from public.change_conflicts f where f.change_id=c.id and f.status='open' and f.level='blocking') as has_blocking_conflict,
  (select count(*) from public.change_conflicts f where f.change_id=c.id and f.status='open') as open_conflict_count
from public.change_requests c
where c.planned_start is not null;

do $$
declare t text;
begin
  foreach t in array array[
    'change_member_permissions','change_requests','standard_change_templates','change_risk_assessments','change_impacts','change_dependencies','change_conflicts','change_maintenance_windows','change_blackout_windows','change_checklists','change_approval_links','change_rollback_plans','change_implementation_steps','change_validation_plans','change_validation_results','change_observation_windows','change_communication_plans','emergency_change_records','change_advisory_reviews','post_change_reviews','change_relationships','change_incident_links','change_cleanup_items','change_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
revoke all on public.enterprise_change_calendar from public,anon,authenticated;
grant select on public.enterprise_change_calendar to service_role;
grant usage,select on sequence public.change_audit_events_id_seq to service_role;

insert into public.feature_definitions(feature_key,name,description,category,value_type,default_value,safe_default,client_safe,owner_label,lifecycle_status,created_at,updated_at)
values
('enterprise_change_management_enabled','Enterprise Change Management','Change registry, risk, calendar, approvals and validation.','governance','boolean','true','false',false,'platform','active',now(),now()),
('change_advisory_enabled','Change Advisory','Advisory queue and packs for major changes.','governance','boolean','true','false',false,'platform','active',now(),now()),
('change_conflict_detection_enabled','Change Conflict Detection','Detect overlapping scopes, freezes and blackouts.','governance','boolean','true','false',false,'platform','active',now(),now()),
('post_change_validation_enabled','Post-change Validation','Require configured validation before successful completion.','governance','boolean','true','false',false,'platform','active',now(),now())
on conflict(feature_key) do update set description=excluded.description,updated_at=now();

insert into public.workspace_widget_registry(id,title,description,category,widget_type,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive)
values
('changes_today','Mudanças hoje','Mudanças programadas e ativas no dia.','change_management','status_list','{change:view}','{store,network}','change_management:calendar','5m','{}','{}','/painel/governanca/mudancas',false,true),
('change_approvals','Aguardando aprovação','Mudanças aguardando decisão no Approval Engine.','change_management','status_list','{change:view}','{store,network}','change_management:approvals','5m','{}','{}','/painel/governanca/mudancas?tab=Advisory',false,true),
('change_conflicts','Conflitos de mudança','Conflitos de janela e escopo ainda abertos.','change_management','alert_list','{change:view}','{store,network}','change_management:conflicts','5m','{}','{}','/painel/governanca/mudancas?tab=Conflitos',false,true),
('change_observations','Mudanças em observação','Mudanças sob validação pós-implementação.','change_management','status_list','{change:view}','{store,network}','change_management:validation','5m','{}','{}','/painel/governanca/mudancas?tab=Validação',false,true)
on conflict(id) do update set title=excluded.title,description=excluded.description,required_permissions=excluded.required_permissions,route=excluded.route;

