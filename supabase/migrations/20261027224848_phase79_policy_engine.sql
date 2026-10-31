-- Phase 79: typed Policy Engine / Decision Management.
-- Definitions are data only. No arbitrary JavaScript, SQL, HTTP, URL or executable payload is accepted.
-- quality: allow-nonconcurrent-index reason=new-empty-policy-engine-tables

create table public.policy_member_permissions(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permissions text[] not null default '{}', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(organization_id,user_id),
  check(permissions <@ array['policies:view','policies:create','policies:edit','policies:test','policies:simulate','policies:request_approval','policies:approve','policies:publish','policies:rollback','policies:manage_exceptions','policies:view_decisions','policies:view_analytics','policies:manage_facts','policies:manage_settings']::text[])
);

create or replace function private.policy_allowed(target_organization uuid, requested_permission text default 'policies:view')
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_superadmin() or exists(
    select 1 from public.policy_member_permissions p
    where p.organization_id=target_organization and p.user_id=(select auth.uid()) and p.active
      and (requested_permission=any(p.permissions) or 'policies:manage_settings'=any(p.permissions))
  ) or exists(
    select 1 from public.organization_members m where m.organization_id=target_organization
      and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin')
  )
$$;
revoke all on function private.policy_allowed(uuid,text) from public,anon,authenticated;
grant execute on function private.policy_allowed(uuid,text) to authenticated,service_role;

create table public.policy_definitions(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_key text not null, name text not null, description text, domain text not null,
  policy_type text not null check(policy_type in('eligibility','limit','approval','routing','validation','restriction','calculation_selector','escalation','exception','governance','custom_safe_type')),
  risk_level text not null default 'medium' check(risk_level in('low','medium','high','critical')),
  lifecycle text not null default 'draft' check(lifecycle in('draft','active','deprecated','retired')),
  owner_label text not null, active_version_id uuid, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,policy_key)
);
create table public.policy_versions(
  id uuid primary key default gen_random_uuid(), policy_id uuid not null references public.policy_definitions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, version integer not null check(version>0), evaluator_version text not null default '1.0.0',
  status text not null default 'draft' check(status in('draft','review','approved','active','superseded','archived')),
  evaluation_mode text not null default 'priority' check(evaluation_mode in('first_match','all_match','deny_overrides','allow_overrides','priority','scoreless_decision')),
  fail_mode text not null default 'require_manual_review' check(fail_mode in('fail_closed','fail_open','require_manual_review','default_effect')),
  default_effect text not null default 'require_review' check(default_effect in('allow','deny','require_approval','warn','route','set_limit','require_review','no_op')),
  audit_mode text not null default 'sampled' check(audit_mode in('none','aggregate','sampled','full')),
  offline_safe boolean not null default false, change_summary text not null, definition_hash text not null,
  approved_by uuid references auth.users(id), approved_at timestamptz, published_by uuid references auth.users(id), published_at timestamptz,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(policy_id,version), unique(policy_id,definition_hash)
);
alter table public.policy_definitions add constraint policy_active_version_fk foreign key(active_version_id) references public.policy_versions(id) on delete set null;

create table public.policy_sets(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  set_key text not null, name text not null, description text, status text not null default 'draft' check(status in('draft','active','deprecated','retired')),
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(organization_id,set_key)
);
create table public.policy_set_members(
  policy_set_id uuid not null references public.policy_sets(id) on delete cascade, policy_version_id uuid not null references public.policy_versions(id) on delete restrict,
  priority integer not null default 100, enabled boolean not null default true, primary key(policy_set_id,policy_version_id)
);

create table public.policy_fact_definitions(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  fact_key text not null, source text not null check(source in('evaluation_context','entity_field','entitlement','feature_state','semantic_metric','domain_fact','current_time')),
  value_type text not null check(value_type in('text','integer','decimal','boolean','date','datetime','duration','currency','set')),
  schema_version integer not null default 1 check(schema_version>0), provider_key text not null, description text, sensitive boolean not null default false,
  status text not null default 'active' check(status in('draft','active','deprecated','retired')), created_at timestamptz not null default now(), unique(organization_id,fact_key,schema_version),
  check(fact_key !~* '(javascript|script|sql|query|eval|function|http|url|webhook|secret|token|password)')
);
create table public.policy_parameters(
  id uuid primary key default gen_random_uuid(), policy_version_id uuid not null references public.policy_versions(id) on delete cascade,
  parameter_key text not null, value_type text not null check(value_type in('text','integer','decimal','boolean','date','datetime','duration','currency','set')),
  text_value text, integer_value bigint, decimal_value numeric(30,12), boolean_value boolean, date_value date, datetime_value timestamptz, duration_seconds bigint, currency_code text, set_value text[],
  required boolean not null default true, description text, unique(policy_version_id,parameter_key),
  check(num_nonnulls(text_value,integer_value,decimal_value,boolean_value,date_value,datetime_value,duration_seconds,currency_code,set_value)<=1),
  check(parameter_key !~* '(javascript|script|sql|query|eval|function|http|url|webhook|secret|token|password)')
);

create table public.policy_rules(
  id uuid primary key default gen_random_uuid(), policy_version_id uuid not null references public.policy_versions(id) on delete cascade,
  rule_key text not null, name text not null, priority integer not null default 100, enabled boolean not null default true,
  effect text not null check(effect in('allow','deny','require_approval','warn','route','set_limit','require_review','no_op')),
  explanation text not null, created_at timestamptz not null default now(), unique(policy_version_id,rule_key)
);
create table public.policy_condition_groups(
  id uuid primary key default gen_random_uuid(), rule_id uuid not null references public.policy_rules(id) on delete cascade,
  parent_group_id uuid references public.policy_condition_groups(id) on delete cascade, group_key text not null,
  mode text not null check(mode in('all','any','none')), depth smallint not null default 1 check(depth between 1 and 6), sort_order integer not null default 0,
  unique(rule_id,group_key)
);
create table public.policy_conditions(
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.policy_condition_groups(id) on delete cascade,
  condition_key text not null, left_source text not null check(left_source in('evaluation_context','entity_field','entitlement','feature_state','semantic_metric','domain_fact','policy_parameter','current_time','static_value')),
  left_key text, operator text not null check(operator in('equals','not_equals','in','not_in','greater_than','greater_or_equal','less_than','less_or_equal','between','exists','not_exists','contains','starts_with','ends_with','date_before','date_after','date_between')),
  right_source text check(right_source in('evaluation_context','entity_field','entitlement','feature_state','semantic_metric','domain_fact','policy_parameter','current_time','static_value')),
  right_key text, value_type text check(value_type in('text','integer','decimal','boolean','date','datetime','duration','currency','set')),
  text_value text, integer_value bigint, decimal_value numeric(30,12), boolean_value boolean, date_value date, datetime_value timestamptz, duration_seconds bigint, currency_code text, set_value text[],
  upper_text_value text, upper_integer_value bigint, upper_decimal_value numeric(30,12), upper_date_value date, upper_datetime_value timestamptz,
  sort_order integer not null default 0, unique(group_id,condition_key),
  check(num_nonnulls(text_value,integer_value,decimal_value,boolean_value,date_value,datetime_value,duration_seconds,currency_code,set_value)<=1),
  check(coalesce(left_key,'') !~* '(javascript|script|sql|query|eval|function|http|url|webhook|secret|token|password)'),
  check(coalesce(right_key,'') !~* '(javascript|script|sql|query|eval|function|http|url|webhook|secret|token|password)')
);
create table public.policy_obligations(
  id uuid primary key default gen_random_uuid(), rule_id uuid not null references public.policy_rules(id) on delete cascade,
  obligation_type text not null check(obligation_type in('approval','review','route','limit','warning')), target_key text,
  value_type text check(value_type in('text','integer','decimal','boolean','date','datetime','duration','currency','set')),
  text_value text, integer_value bigint, decimal_value numeric(30,12), boolean_value boolean, duration_seconds bigint, set_value text[], required_approvals smallint check(required_approvals between 1 and 10),
  check(num_nonnulls(text_value,integer_value,decimal_value,boolean_value,duration_seconds,set_value)<=1)
);
create table public.policy_scope_assignments(
  id uuid primary key default gen_random_uuid(), policy_version_id uuid not null references public.policy_versions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, scope_type text not null check(scope_type in('global','organization','brand','region','store','plan','channel','role','business_type')),
  scope_id text, precedence integer not null default 0, locked boolean not null default false, inheritance_mode text not null default 'inherit' check(inheritance_mode in('inherit','override','stricter_only','blocked')),
  effective_from timestamptz not null default now(), effective_until timestamptz, unique(policy_version_id,scope_type,scope_id), check(effective_until is null or effective_until>effective_from)
);

create table public.policy_decision_tables(
  id uuid primary key default gen_random_uuid(), policy_version_id uuid not null references public.policy_versions(id) on delete cascade,
  name text not null, match_mode text not null default 'priority' check(match_mode in('first_match','priority','deny_overrides')), status text not null default 'draft' check(status in('draft','validated','active','archived'))
);
create table public.policy_decision_rows(
  id uuid primary key default gen_random_uuid(), decision_table_id uuid not null references public.policy_decision_tables(id) on delete cascade,
  priority integer not null, min_decimal numeric(30,12), max_decimal numeric(30,12), match_values text[],
  effect text not null check(effect in('allow','deny','require_approval','warn','route','set_limit','require_review','no_op')), explanation text not null,
  check(min_decimal is null or max_decimal is null or max_decimal>=min_decimal)
);

create table public.policy_exceptions(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid not null references public.policy_definitions(id) on delete cascade, exception_type text not null check(exception_type in('temporary_override','waiver','emergency','pilot','contractual')),
  scope_type text not null check(scope_type in('organization','brand','region','store','plan','channel','role','business_type')), scope_id text not null, scope_precedence integer not null,
  effect text not null check(effect in('allow','deny','require_approval','warn','route','set_limit','require_review','no_op')), reason text not null,
  status text not null default 'pending' check(status in('pending','active','expired','revoked','rejected')), valid_from timestamptz not null, valid_until timestamptz not null,
  approval_id uuid references public.internal_approvals(id) on delete set null, created_by uuid references auth.users(id), revoked_by uuid references auth.users(id), created_at timestamptz not null default now(),
  check(valid_until>valid_from)
);
create table public.policy_test_cases(
  id uuid primary key default gen_random_uuid(), policy_version_id uuid not null references public.policy_versions(id) on delete cascade,
  name text not null, fixture_version integer not null default 1, context_fixture jsonb not null, expected_decision text not null check(expected_decision in('allow','deny','allow_with_conditions','require_approval','require_review','warn','not_applicable','indeterminate')),
  expected_obligation_types text[] not null default '{}', active boolean not null default true, created_at timestamptz not null default now(),
  check(context_fixture::text !~* '"(javascript|script|sql|query|eval|function|http|url|webhook|secret|token|password)"\s*:')
);
create table public.policy_test_runs(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_version_id uuid not null references public.policy_versions(id) on delete cascade, status text not null check(status in('running','passed','failed','cancelled')),
  passed integer not null default 0, failed integer not null default 0, coverage numeric(5,2) not null default 0 check(coverage between 0 and 100), evaluator_version text not null,
  result_summary jsonb not null default '{}', started_at timestamptz not null default now(), completed_at timestamptz
);
create table public.policy_dependencies(
  policy_version_id uuid not null references public.policy_versions(id) on delete cascade, depends_on_policy_id uuid not null references public.policy_definitions(id) on delete restrict,
  dependency_type text not null check(dependency_type in('fact','policy','entitlement','feature','semantic_metric','domain_invariant')), required boolean not null default true,
  primary key(policy_version_id,depends_on_policy_id,dependency_type)
);

create table public.policy_changesets(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null, reason text not null, status text not null default 'draft' check(status in('draft','validating','pending_approval','approved','published','rejected','rolled_back')),
  impact_summary jsonb not null default '{}', approval_id uuid references public.internal_approvals(id) on delete set null,
  created_by uuid references auth.users(id), approved_by uuid references auth.users(id), published_by uuid references auth.users(id), created_at timestamptz not null default now(), published_at timestamptz
);
create table public.policy_changeset_items(
  changeset_id uuid not null references public.policy_changesets(id) on delete cascade, policy_version_id uuid not null references public.policy_versions(id) on delete restrict,
  action text not null check(action in('publish','deprecate','retire','rollback')), previous_version_id uuid references public.policy_versions(id), primary key(changeset_id,policy_version_id)
);
create table public.policy_active_documents(
  policy_version_id uuid primary key references public.policy_versions(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_key text not null, document jsonb not null, definition_hash text not null, evaluator_version text not null, compiled_at timestamptz not null default now(),
  unique(organization_id,policy_key), check(document::text !~* '"(javascript|script|sql|query|eval|function|http|url|webhook|secret|token|password)"\s*:')
);
create table public.policy_decision_logs(
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete set null, domain text not null, subject_type text not null, subject_id text,
  decision text not null check(decision in('allow','deny','allow_with_conditions','require_approval','require_review','warn','not_applicable','indeterminate')),
  effect text not null, policy_id uuid not null references public.policy_definitions(id), policy_version integer not null, matched_rule_ids uuid[] not null default '{}',
  duration_ms integer not null check(duration_ms>=0), request_id text, sampled boolean not null default true, explanation text, created_at timestamptz not null default now()
);
create table public.policy_decision_aggregates(
  organization_id uuid not null references public.organizations(id) on delete cascade, domain text not null, decision text not null,
  bucket_at timestamptz not null, evaluations bigint not null default 0, duration_ms_sum bigint not null default 0, failures bigint not null default 0,
  primary key(organization_id,domain,decision,bucket_at)
);
create table public.policy_health_results(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid not null references public.policy_definitions(id) on delete cascade, health_status text not null check(health_status in('healthy','warning','critical','stale','unknown')),
  latency_p95_ms integer, missing_fact_rate numeric(8,5), conflict_count integer not null default 0, exception_count integer not null default 0,
  details jsonb not null default '{}', measured_at timestamptz not null default now()
);
create table public.policy_audit_events(
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, event_type text not null, entity_type text not null, entity_id text,
  reason text not null, before_state jsonb, after_state jsonb, created_at timestamptz not null default now()
);
create table public.policy_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true, default_audit_mode text not null default 'sampled' check(default_audit_mode in('none','aggregate','sampled','full')),
  max_evaluation_ms integer not null default 100 check(max_evaluation_ms between 10 and 5000), cache_ttl_seconds integer not null default 60 check(cache_ttl_seconds between 5 and 3600),
  ai_drafts_enabled boolean not null default true, updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);

create or replace function public.record_policy_decision_aggregate(requested_organization_id uuid,requested_domain text,requested_decision text,requested_duration_ms integer)
returns void language sql security definer set search_path='' as $$
  insert into public.policy_decision_aggregates(organization_id,domain,decision,bucket_at,evaluations,duration_ms_sum)
  values(requested_organization_id,requested_domain,requested_decision,date_trunc('hour',now()),1,greatest(requested_duration_ms,0))
  on conflict(organization_id,domain,decision,bucket_at) do update set evaluations=public.policy_decision_aggregates.evaluations+1,duration_ms_sum=public.policy_decision_aggregates.duration_ms_sum+excluded.duration_ms_sum
$$;
revoke all on function public.record_policy_decision_aggregate(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_policy_decision_aggregate(uuid,text,text,integer) to service_role;

create index policy_definitions_org_domain_idx on public.policy_definitions(organization_id,domain,lifecycle);
create index policy_member_permissions_user_idx on public.policy_member_permissions(user_id) where active;
create index policy_definitions_active_version_idx on public.policy_definitions(active_version_id) where active_version_id is not null;
create index policy_definitions_created_by_idx on public.policy_definitions(created_by) where created_by is not null;
create index policy_versions_policy_status_idx on public.policy_versions(policy_id,status,version desc);
create index policy_versions_org_status_idx on public.policy_versions(organization_id,status,created_at desc);
create index policy_versions_approved_by_idx on public.policy_versions(approved_by) where approved_by is not null;
create index policy_versions_published_by_idx on public.policy_versions(published_by) where published_by is not null;
create index policy_versions_created_by_idx on public.policy_versions(created_by) where created_by is not null;
create index policy_sets_created_by_idx on public.policy_sets(created_by) where created_by is not null;
create index policy_set_members_version_idx on public.policy_set_members(policy_version_id);
create index policy_rules_version_priority_idx on public.policy_rules(policy_version_id,enabled,priority desc);
create index policy_groups_rule_parent_idx on public.policy_condition_groups(rule_id,parent_group_id,sort_order);
create index policy_conditions_group_idx on public.policy_conditions(group_id,sort_order);
create index policy_obligations_rule_idx on public.policy_obligations(rule_id);
create index policy_scopes_resolution_idx on public.policy_scope_assignments(organization_id,scope_type,scope_id,precedence desc) where effective_until is null;
create index policy_exceptions_effective_idx on public.policy_exceptions(organization_id,policy_id,status,valid_from,valid_until);
create index policy_exceptions_active_idx on public.policy_exceptions(organization_id,valid_until) where status='active';
create index policy_exceptions_approval_idx on public.policy_exceptions(approval_id) where approval_id is not null;
create index policy_decision_tables_version_idx on public.policy_decision_tables(policy_version_id);
create index policy_decision_rows_table_idx on public.policy_decision_rows(decision_table_id,priority);
create index policy_test_cases_version_idx on public.policy_test_cases(policy_version_id) where active;
create index policy_decisions_scope_time_idx on public.policy_decision_logs(organization_id,domain,created_at desc);
create index policy_decisions_store_idx on public.policy_decision_logs(store_id,created_at desc) where store_id is not null;
create index policy_decisions_policy_idx on public.policy_decision_logs(policy_id,created_at desc);
create index policy_test_runs_version_idx on public.policy_test_runs(policy_version_id,started_at desc);
create index policy_test_runs_org_idx on public.policy_test_runs(organization_id,started_at desc);
create index policy_dependencies_reverse_idx on public.policy_dependencies(depends_on_policy_id);
create index policy_changesets_org_idx on public.policy_changesets(organization_id,created_at desc);
create index policy_changesets_approval_idx on public.policy_changesets(approval_id) where approval_id is not null;
create index policy_changeset_items_version_idx on public.policy_changeset_items(policy_version_id);
create index policy_health_policy_time_idx on public.policy_health_results(policy_id,measured_at desc);
create index policy_health_org_time_idx on public.policy_health_results(organization_id,measured_at desc);
create index policy_audit_org_time_idx on public.policy_audit_events(organization_id,created_at desc);
create index policy_audit_actor_idx on public.policy_audit_events(actor_id,created_at desc) where actor_id is not null;

do $$ declare t text; begin foreach t in array array[
 'policy_member_permissions','policy_definitions','policy_versions','policy_sets','policy_set_members','policy_fact_definitions','policy_parameters','policy_rules','policy_condition_groups','policy_conditions','policy_obligations','policy_scope_assignments','policy_decision_tables','policy_decision_rows','policy_exceptions','policy_test_cases','policy_test_runs','policy_dependencies','policy_changesets','policy_changeset_items','policy_active_documents','policy_decision_logs','policy_decision_aggregates','policy_health_results','policy_audit_events','policy_settings'
] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

-- Most writes go through reviewed server routes. Direct browser access is read-only and tenant scoped.
do $$ declare t text; begin foreach t in array array[
 'policy_member_permissions','policy_definitions','policy_versions','policy_sets','policy_fact_definitions','policy_scope_assignments','policy_exceptions','policy_test_runs','policy_changesets','policy_active_documents','policy_decision_logs','policy_decision_aggregates','policy_health_results','policy_audit_events','policy_settings'
] loop
 execute format('create policy %I on public.%I for select to authenticated using((select private.policy_allowed(organization_id,''policies:view'')))','policy_read_'||t,t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;

-- Child tables inherit authorization through their parent and are server-write only.
do $$ declare t text; begin foreach t in array array['policy_set_members','policy_parameters','policy_rules','policy_condition_groups','policy_conditions','policy_obligations','policy_decision_tables','policy_decision_rows','policy_test_cases','policy_dependencies','policy_changeset_items'] loop
 execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop; end $$;

create policy policy_set_members_read on public.policy_set_members for select to authenticated using(exists(select 1 from public.policy_sets s where s.id=policy_set_id and (select private.policy_allowed(s.organization_id,'policies:view'))));
create policy policy_parameters_read on public.policy_parameters for select to authenticated using(exists(select 1 from public.policy_versions v where v.id=policy_version_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_rules_read on public.policy_rules for select to authenticated using(exists(select 1 from public.policy_versions v where v.id=policy_version_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_condition_groups_read on public.policy_condition_groups for select to authenticated using(exists(select 1 from public.policy_rules r join public.policy_versions v on v.id=r.policy_version_id where r.id=rule_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_conditions_read on public.policy_conditions for select to authenticated using(exists(select 1 from public.policy_condition_groups g join public.policy_rules r on r.id=g.rule_id join public.policy_versions v on v.id=r.policy_version_id where g.id=group_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_obligations_read on public.policy_obligations for select to authenticated using(exists(select 1 from public.policy_rules r join public.policy_versions v on v.id=r.policy_version_id where r.id=rule_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_decision_tables_read on public.policy_decision_tables for select to authenticated using(exists(select 1 from public.policy_versions v where v.id=policy_version_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_decision_rows_read on public.policy_decision_rows for select to authenticated using(exists(select 1 from public.policy_decision_tables d join public.policy_versions v on v.id=d.policy_version_id where d.id=decision_table_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_test_cases_read on public.policy_test_cases for select to authenticated using(exists(select 1 from public.policy_versions v where v.id=policy_version_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_dependencies_read on public.policy_dependencies for select to authenticated using(exists(select 1 from public.policy_versions v where v.id=policy_version_id and (select private.policy_allowed(v.organization_id,'policies:view'))));
create policy policy_changeset_items_read on public.policy_changeset_items for select to authenticated using(exists(select 1 from public.policy_changesets c where c.id=changeset_id and (select private.policy_allowed(c.organization_id,'policies:view'))));
grant select on public.policy_set_members,public.policy_parameters,public.policy_rules,public.policy_condition_groups,public.policy_conditions,public.policy_obligations,public.policy_decision_tables,public.policy_decision_rows,public.policy_test_cases,public.policy_dependencies,public.policy_changeset_items to authenticated;
revoke all on sequence public.policy_decision_logs_id_seq,public.policy_audit_events_id_seq from public,anon,authenticated;
grant usage,select on sequence public.policy_decision_logs_id_seq,public.policy_audit_events_id_seq to service_role;

create or replace view public.fact_policy_evaluations with(security_invoker=true) as select organization_id,domain,date_trunc('hour',created_at) bucket_at,count(*) evaluations,avg(duration_ms)::numeric(12,2) avg_duration_ms from public.policy_decision_logs group by organization_id,domain,date_trunc('hour',created_at);
create or replace view public.fact_policy_decisions with(security_invoker=true) as select organization_id,domain,decision,date_trunc('day',created_at) decision_date,count(*) decisions from public.policy_decision_logs group by organization_id,domain,decision,date_trunc('day',created_at);
create or replace view public.fact_policy_changes with(security_invoker=true) as select organization_id,status,date_trunc('day',created_at) change_date,count(*) changes from public.policy_changesets group by organization_id,status,date_trunc('day',created_at);
create or replace view public.fact_policy_exceptions with(security_invoker=true) as select organization_id,exception_type,status,count(*) exceptions from public.policy_exceptions group by organization_id,exception_type,status;
create or replace view public.fact_policy_test_runs with(security_invoker=true) as select organization_id,status,count(*) runs,avg(coverage)::numeric(5,2) avg_coverage from public.policy_test_runs group by organization_id,status;
create or replace view public.fact_policy_health with(security_invoker=true) as select organization_id,health_status,count(*) policies,max(measured_at) measured_at from public.policy_health_results group by organization_id,health_status;
create or replace view public.dim_policy with(security_invoker=true) as select id,organization_id,policy_key,name,domain,policy_type,risk_level,lifecycle from public.policy_definitions;
create or replace view public.dim_policy_version with(security_invoker=true) as select id,organization_id,policy_id,version,evaluator_version,status,evaluation_mode,fail_mode,audit_mode from public.policy_versions;
grant select on public.fact_policy_evaluations,public.fact_policy_decisions,public.fact_policy_changes,public.fact_policy_exceptions,public.fact_policy_test_runs,public.fact_policy_health,public.dim_policy,public.dim_policy_version to authenticated,service_role;

-- Safe templates only. They do not create active policies or bypass domain invariants.
comment on table public.policy_definitions is 'Phase 79 typed business policies. Initial pilots: discount approval, refund approval, supplier eligibility, purchase approval and franchise local override.';
comment on table public.policy_active_documents is 'Validated compiled typed AST only. Publication requires tests, impact analysis, approval and immutable changeset.';
