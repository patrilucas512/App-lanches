-- Phase 32: MasterApp internal operations. This domain is platform-internal only.
-- Existing support, sales, CS, incident and release records remain their source of truth.

create table public.internal_work_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default array['internal_work:view'], active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create or replace function private.internal_work_allowed(requested_permission text) returns boolean
language sql stable security definer set search_path=''
as $$ select private.is_superadmin() or exists(select 1 from public.internal_work_permissions p where p.user_id=(select auth.uid()) and p.active and (requested_permission=any(p.permissions) or 'internal_work:manage'=any(p.permissions))) $$;
revoke all on function private.internal_work_allowed(text) from public,anon,authenticated;
grant execute on function private.internal_work_allowed(text) to authenticated;

create table public.internal_teams(
  id uuid primary key default gen_random_uuid(), name text not null unique, description text,
  lead_user_id uuid references auth.users(id) on delete set null, active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.internal_projects(
  id uuid primary key default gen_random_uuid(), name text not null, description text, project_type text not null default 'operations' check(project_type in('product','engineering','growth','sales','customer_success','support','infrastructure','security','operations')),
  status text not null default 'planned' check(status in('planned','active','blocked','on_hold','completed','cancelled','archived')),
  priority text not null default 'normal' check(priority in('low','normal','high','critical')), owner_user_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.internal_teams(id) on delete set null, start_date date, target_date date, completed_at timestamptz, progress integer not null default 0 check(progress between 0 and 100),
  source_type text, source_id text, archived_at timestamptz, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(target_date is null or start_date is null or target_date>=start_date)
);
create table public.internal_tasks(
  id uuid primary key default gen_random_uuid(), project_id uuid references public.internal_projects(id) on delete cascade, parent_task_id uuid references public.internal_tasks(id) on delete set null,
  title text not null, description text, status text not null default 'backlog' check(status in('backlog','todo','in_progress','review','blocked','done','cancelled','archived')),
  priority text not null default 'normal' check(priority in('low','normal','high','critical')), assigned_to_user_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.internal_teams(id) on delete set null, created_by_user_id uuid references auth.users(id) on delete set null,
  due_at timestamptz, started_at timestamptz, estimated_effort text check(estimated_effort is null or estimated_effort in('small','medium','large')), estimate_hours numeric(8,2) check(estimate_hours is null or estimate_hours>=0), labels text[] not null default '{}',
  task_type text not null default 'task' check(task_type in('task','bug','action_item','follow_up')), severity text check(severity is null or severity in('low','medium','high','critical')), environment text, affected_version text, reproducibility text,
  source_type text, source_id text, archived_at timestamptz, completed_at timestamptz, position numeric not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(parent_task_id is null or parent_task_id<>id)
);
create table public.internal_task_dependencies(
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.internal_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.internal_tasks(id) on delete cascade, dependency_type text not null default 'blocks' check(dependency_type in('blocks','blocked_by','related')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), unique(task_id,depends_on_task_id), check(task_id<>depends_on_task_id)
);
create or replace function private.prevent_internal_task_cycle() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.task_id=new.depends_on_task_id then raise exception 'Uma tarefa não pode depender dela mesma.'; end if;
  if exists(with recursive chain(id) as (
    select new.depends_on_task_id union select d.depends_on_task_id from public.internal_task_dependencies d join chain c on d.task_id=c.id
  ) select 1 from chain where id=new.task_id) then raise exception 'Dependência circular detectada.'; end if;
  return new;
end $$;
revoke all on function private.prevent_internal_task_cycle() from public,anon,authenticated;
create trigger internal_task_dependency_cycle before insert or update on public.internal_task_dependencies for each row execute function private.prevent_internal_task_cycle();

create or replace function private.prevent_internal_task_parent_cycle() returns trigger language plpgsql security definer set search_path='' as $$
declare depth_count integer;
begin
  if new.parent_task_id is null then return new; end if;
  if new.parent_task_id=new.id then raise exception 'Hierarquia circular detectada.'; end if;
  with recursive parents(id,depth) as (select new.parent_task_id,1 union all select t.parent_task_id,p.depth+1 from public.internal_tasks t join parents p on t.id=p.id where t.parent_task_id is not null and p.depth<10)
  select coalesce(max(depth),0) into depth_count from parents;
  if exists(with recursive parents(id) as (select new.parent_task_id union all select t.parent_task_id from public.internal_tasks t join parents p on t.id=p.id where t.parent_task_id is not null) select 1 from parents where id=new.id) then raise exception 'Hierarquia circular detectada.'; end if;
  if depth_count>3 then raise exception 'A hierarquia aceita no máximo quatro níveis.'; end if;
  return new;
end $$;
revoke all on function private.prevent_internal_task_parent_cycle() from public,anon,authenticated;
create trigger internal_task_parent_cycle before insert or update of parent_task_id on public.internal_tasks for each row execute function private.prevent_internal_task_parent_cycle();

create table public.internal_task_comments(
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.internal_tasks(id) on delete cascade, body text not null,
  created_by uuid references auth.users(id) on delete set null, edited_at timestamptz, created_at timestamptz not null default now(), archived_at timestamptz
);
create table public.internal_task_mentions(
  id uuid primary key default gen_random_uuid(), comment_id uuid not null references public.internal_task_comments(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade, read_at timestamptz, created_at timestamptz not null default now(), unique(comment_id,mentioned_user_id)
);
create table public.internal_notes(
  id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id text not null, body text not null,
  visibility text not null default 'internal' check(visibility in('internal','restricted')), created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.internal_attachments(
  id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id text not null, storage_bucket text not null default 'internal-work', storage_path text not null,
  file_name text not null, content_type text, size_bytes bigint check(size_bytes is null or size_bytes>=0), uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), archived_at timestamptz, unique(storage_bucket,storage_path)
);

create table public.internal_approvals(
  id uuid primary key default gen_random_uuid(), approval_type text not null default 'general', title text not null, description text, source_type text, source_id text, action_request_id uuid references public.copilot_action_requests(id) on delete set null,
  status text not null default 'pending' check(status in('pending','approved','rejected','cancelled','expired')), required_approvals integer not null default 1 check(required_approvals between 1 and 10),
  risk_level text not null default 'medium' check(risk_level in('low','medium','high','critical')), requested_by uuid references auth.users(id) on delete set null,
  approver_user_id uuid references auth.users(id) on delete set null, requested_at timestamptz not null default now(), due_at timestamptz, resolved_at timestamptz, resolution_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.internal_approval_steps(
  id uuid primary key default gen_random_uuid(), approval_id uuid not null references public.internal_approvals(id) on delete cascade,
  approver_user_id uuid not null references auth.users(id) on delete cascade, decision text not null default 'pending' check(decision in('pending','approved','rejected')),
  reason text, decided_at timestamptz, created_at timestamptz not null default now(), unique(approval_id,approver_user_id)
);
create table public.internal_decisions(
  id uuid primary key default gen_random_uuid(), title text not null, context text not null, decision text not null, rationale text not null,
  alternatives jsonb not null default '[]', consequences jsonb not null default '[]', status text not null default 'accepted' check(status in('proposed','accepted','superseded','reversed','archived')),
  owner_user_id uuid references auth.users(id) on delete set null, project_id uuid references public.internal_projects(id) on delete set null,
  supersedes_id uuid references public.internal_decisions(id) on delete set null, decided_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.internal_documents(
  id uuid primary key default gen_random_uuid(), title text not null, document_type text not null default 'process' check(document_type in('runbook','policy','process','strategy','meeting_notes','specification','retrospective')),
  sensitivity text not null default 'internal' check(sensitivity in('internal','restricted','security')), status text not null default 'draft' check(status in('draft','published','archived')),
  owner_user_id uuid references auth.users(id) on delete set null, current_version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.internal_document_versions(
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.internal_documents(id) on delete cascade, version integer not null,
  content text not null, change_summary text not null, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), unique(document_id,version)
);

create table public.strategic_initiatives(
  id uuid primary key default gen_random_uuid(), title text not null, description text, status text not null default 'planned' check(status in('planned','active','blocked','completed','archived')),
  owner_user_id uuid references auth.users(id) on delete set null, revenue_target_id uuid references public.revenue_targets(id) on delete set null,
  project_id uuid references public.internal_projects(id) on delete set null, expected_impact text, confidence numeric(5,2) check(confidence is null or confidence between 0 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.product_roadmap_items(
  id uuid primary key default gen_random_uuid(), title text not null, description text, category text not null default 'product', priority text not null default 'normal' check(priority in('low','normal','high','critical')),
  horizon text not null default 'next' check(horizon in('now','next','later')), status text not null default 'idea' check(status in('idea','discovery','planned','in_progress','beta','released','cancelled','archived')), owner_user_id uuid references auth.users(id) on delete set null,
  reach_score numeric not null default 0, impact_score numeric not null default 0, confidence_score numeric not null default 0, effort_score numeric not null default 1 check(effort_score>0),
  scoring_note text not null default 'Estimativa para priorização; não representa promessa.', source text, target_period text, linked_project_id uuid references public.internal_projects(id) on delete set null,
  initiative_id uuid references public.strategic_initiatives(id) on delete set null, target_date date, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.internal_meetings(
  id uuid primary key default gen_random_uuid(), title text not null, meeting_type text not null default 'sync', starts_at timestamptz not null, ends_at timestamptz,
  participant_user_ids uuid[] not null default '{}', agenda text, notes text, decisions jsonb not null default '[]', organizer_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at is null or ends_at>starts_at)
);
create table public.internal_retrospectives(
  id uuid primary key default gen_random_uuid(), title text not null, period_start date, period_end date, went_well jsonb not null default '[]', improve jsonb not null default '[]', action_items jsonb not null default '[]',
  project_id uuid references public.internal_projects(id) on delete set null, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), check(period_end is null or period_start is null or period_end>=period_start)
);
create table public.internal_requests(
  id uuid primary key default gen_random_uuid(), request_type text not null check(request_type in('bug','feature','access','infra','marketing','data','support','support_followup','sales_followup','cs_followup','incident_followup','release_followup','general')),
  title text not null, description text, problem text, evidence jsonb not null default '[]', affected_customers integer not null default 0, affected_mrr_cents bigint not null default 0, hypothesis text, proposed_solution text,
  status text not null default 'new' check(status in('new','triaged','accepted','rejected','converted_to_task','resolved','archived')),
  priority text not null default 'normal' check(priority in('low','normal','high','critical')), source_type text, source_id text, duplicate_of_id uuid references public.internal_requests(id) on delete set null,
  requester_user_id uuid references auth.users(id) on delete set null, owner_user_id uuid references auth.users(id) on delete set null,
  promoted_task_id uuid references public.internal_tasks(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.internal_automation_rules(
  id uuid primary key default gen_random_uuid(), name text not null, event_type text not null, conditions jsonb not null default '{}', action_type text not null,
  action_payload jsonb not null default '{}', active boolean not null default false, cooldown_seconds integer not null default 3600 check(cooldown_seconds between 60 and 604800),
  requires_human_confirmation boolean not null default true, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.internal_automation_runs(
  id uuid primary key default gen_random_uuid(), rule_id uuid not null references public.internal_automation_rules(id) on delete cascade, event_key text not null,
  status text not null check(status in('skipped','pending_confirmation','executed','failed')), details jsonb not null default '{}', executed_at timestamptz,
  created_at timestamptz not null default now(), unique(rule_id,event_key)
);
create table public.internal_notifications(
  id uuid primary key default gen_random_uuid(), recipient_user_id uuid not null references auth.users(id) on delete cascade, notification_type text not null,
  title text not null, body text, entity_type text, entity_id text, dedupe_key text not null, read_at timestamptz, created_at timestamptz not null default now(), unique(recipient_user_id,dedupe_key)
);
create table public.internal_audit_events(
  id bigint generated always as identity primary key, actor_user_id uuid references auth.users(id) on delete set null, event_type text not null,
  entity_type text not null, entity_id text, reason text not null, before_state jsonb, after_state jsonb, ip_hash text, created_at timestamptz not null default now()
);
create table public.internal_operations_feature_flags(
  singleton boolean primary key default true check(singleton), internal_operations_enabled boolean not null default true, internal_projects_enabled boolean not null default true,
  internal_approvals_enabled boolean not null default true, internal_roadmap_enabled boolean not null default true, internal_documents_enabled boolean not null default true,
  automations_enabled boolean not null default false, copilot_enabled boolean not null default true, updated_at timestamptz not null default now()
);
insert into public.internal_operations_feature_flags(singleton) values(true) on conflict(singleton) do nothing;

create index internal_projects_owner_idx on public.internal_projects(owner_user_id,status,updated_at desc);
create index internal_projects_team_idx on public.internal_projects(team_id,status);
create index internal_tasks_project_idx on public.internal_tasks(project_id,status,position);
create index internal_tasks_assignee_idx on public.internal_tasks(assigned_to_user_id,status,due_at);
create index internal_tasks_parent_idx on public.internal_tasks(parent_task_id);
create index internal_dependencies_reverse_idx on public.internal_task_dependencies(depends_on_task_id);
create index internal_comments_task_idx on public.internal_task_comments(task_id,created_at desc);
create index internal_notes_entity_idx on public.internal_notes(entity_type,entity_id,created_at desc);
create index internal_attachments_entity_idx on public.internal_attachments(entity_type,entity_id);
create index internal_approvals_status_idx on public.internal_approvals(status,due_at,created_at desc);
create index internal_approval_steps_user_idx on public.internal_approval_steps(approver_user_id,decision);
create index internal_decisions_project_idx on public.internal_decisions(project_id,decided_at desc);
create index internal_document_versions_doc_idx on public.internal_document_versions(document_id,version desc);
create index roadmap_horizon_idx on public.product_roadmap_items(horizon,status,updated_at desc);
create index initiatives_target_idx on public.strategic_initiatives(revenue_target_id,status);
create index internal_meetings_start_idx on public.internal_meetings(starts_at desc);
create index internal_requests_queue_idx on public.internal_requests(status,priority,created_at desc);
create index internal_requests_source_idx on public.internal_requests(source_type,source_id);
create index internal_notifications_user_idx on public.internal_notifications(recipient_user_id,read_at,created_at desc);
create index internal_audit_entity_idx on public.internal_audit_events(entity_type,entity_id,created_at desc);

do $$ declare t text; begin foreach t in array array[
  'internal_work_permissions','internal_teams','internal_projects','internal_tasks','internal_task_dependencies','internal_task_comments','internal_task_mentions','internal_notes','internal_attachments',
  'internal_approvals','internal_approval_steps','internal_decisions','internal_documents','internal_document_versions','strategic_initiatives','product_roadmap_items','internal_meetings','internal_retrospectives',
  'internal_requests','internal_automation_rules','internal_automation_runs','internal_notifications','internal_audit_events','internal_operations_feature_flags'
] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select to authenticated using((select private.internal_work_allowed(''internal_work:view'')))','iwork_select_'||t,t);
  execute format('create policy %I on public.%I for insert to authenticated with check((select private.internal_work_allowed(''internal_work:manage'')))','iwork_insert_'||t,t);
  execute format('create policy %I on public.%I for update to authenticated using((select private.internal_work_allowed(''internal_work:manage''))) with check((select private.internal_work_allowed(''internal_work:manage'')))','iwork_update_'||t,t);
  execute format('create policy %I on public.%I for delete to authenticated using((select private.internal_work_allowed(''internal_work:manage'')))','iwork_delete_'||t,t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
end loop; end $$;
grant usage,select on sequence public.internal_audit_events_id_seq to authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('internal-work','internal-work',false,10485760,array['application/pdf','image/png','image/jpeg','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy internal_work_objects_select on storage.objects for select to authenticated using(bucket_id='internal-work' and (select private.internal_work_allowed('internal_work:view')));
create policy internal_work_objects_insert on storage.objects for insert to authenticated with check(bucket_id='internal-work' and (select private.internal_work_allowed('internal_work:manage')));
create policy internal_work_objects_update on storage.objects for update to authenticated using(bucket_id='internal-work' and (select private.internal_work_allowed('internal_work:manage'))) with check(bucket_id='internal-work' and (select private.internal_work_allowed('internal_work:manage')));
create policy internal_work_objects_delete on storage.objects for delete to authenticated using(bucket_id='internal-work' and (select private.internal_work_allowed('internal_work:manage')));
