-- Phase 95E: retention policies and runs, legal holds, pseudonymization salts and orchestrated deletion. Simulation by default.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

create table public.legal_holds(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 scope_type text not null check(scope_type in('subject','dataset','case')),scope_ref text,domain text,
 reason text not null check(reason in('fiscal','financial','contract','litigation','incident_investigation','other')),basis text not null,
 owner_user_id uuid references auth.users(id) on delete set null,valid_until timestamptz,last_reviewed_at timestamptz,
 status text not null default 'active' check(status in('active','released')),released_reason text,released_by uuid references auth.users(id) on delete set null,released_at timestamptz,
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(scope_type<>'subject' or scope_ref is not null),check(scope_type<>'dataset' or coalesce(domain,scope_ref) is not null));
create index legal_holds_context_idx on public.legal_holds(context_id,status);
create index legal_holds_scope_idx on public.legal_holds(context_id,scope_type,scope_ref) where status='active';
create index legal_holds_owner_idx on public.legal_holds(owner_user_id) where owner_user_id is not null;
create index legal_holds_released_by_idx on public.legal_holds(released_by) where released_by is not null;
create index legal_holds_created_by_idx on public.legal_holds(created_by) where created_by is not null;

create table public.retention_policies(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 name text not null,domain text not null,dataset text not null,data_category text,
 period_days integer not null check(period_days>0),trigger text not null check(trigger in('after_created','after_last_order','after_last_activity','after_closed')),
 action text not null check(action in('anonymize','delete','archive','review')),basis text not null,requires_approval boolean not null default true,
 owner_user_id uuid references auth.users(id) on delete set null,status text not null default 'draft' check(status in('draft','active','paused','retired')),
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index retention_policies_context_idx on public.retention_policies(context_id,status);
create index retention_policies_owner_idx on public.retention_policies(owner_user_id) where owner_user_id is not null;
create index retention_policies_created_by_idx on public.retention_policies(created_by) where created_by is not null;

-- Every run starts as a dry run. A real run needs the execution flag, and the approval when its policy asks for one.
create table public.retention_runs(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,policy_id uuid not null references public.retention_policies(id) on delete cascade,
 mode text not null default 'dry_run' check(mode in('dry_run','execute')),status text not null default 'previewed' check(status in('previewed','awaiting_approval','running','completed','partially_completed','failed','cancelled')),
 due_count integer not null default 0,held_count integer not null default 0,processed_count integer not null default 0,failed_count integer not null default 0,
 approval_id uuid references public.internal_approvals(id) on delete set null,requested_by uuid references auth.users(id) on delete set null,
 report jsonb not null default '{}',started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now());
create index retention_runs_context_idx on public.retention_runs(context_id,created_at desc);
create index retention_runs_policy_idx on public.retention_runs(policy_id);
create index retention_runs_approval_idx on public.retention_runs(approval_id) where approval_id is not null;
create index retention_runs_requested_by_idx on public.retention_runs(requested_by) where requested_by is not null;

create table public.retention_run_items(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.retention_runs(id) on delete cascade,context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 record_ref text not null,decision text not null check(decision in('due','held','processed','failed','skipped')),reason text,created_at timestamptz not null default now(),unique(run_id,record_ref));
create index retention_run_items_context_idx on public.retention_run_items(context_id);

-- One salt per context, readable only by the server. The same value pseudonymizes to different tokens in different tenants.
create table public.privacy_pseudonym_salts(context_id uuid primary key references public.privacy_contexts(id) on delete cascade,salt text not null check(length(salt)>=32),created_at timestamptz not null default now());

-- Orchestrated deletion: plan, approval, execution per domain, verification. Steps are idempotent and resumable.
create table public.privacy_deletion_plans(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 request_id uuid references public.customer_privacy_requests(id) on delete set null,retention_run_id uuid references public.retention_runs(id) on delete set null,
 subject_ref text not null,mode text not null check(mode in('deletion','anonymization','blocking')),
 status text not null default 'previewed' check(status in('previewed','awaiting_approval','approved','running','completed','partially_completed','cancelled')),
 summary jsonb not null default '{}',approval_id uuid references public.internal_approvals(id) on delete set null,
 requested_by uuid references auth.users(id) on delete set null,approved_by uuid references auth.users(id) on delete set null,executed_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz);
create index privacy_deletion_plans_context_idx on public.privacy_deletion_plans(context_id,status);
create index privacy_deletion_plans_request_idx on public.privacy_deletion_plans(request_id) where request_id is not null;
create index privacy_deletion_plans_run_idx on public.privacy_deletion_plans(retention_run_id) where retention_run_id is not null;
create index privacy_deletion_plans_approval_idx on public.privacy_deletion_plans(approval_id) where approval_id is not null;
create index privacy_deletion_plans_requested_by_idx on public.privacy_deletion_plans(requested_by) where requested_by is not null;
create index privacy_deletion_plans_approved_by_idx on public.privacy_deletion_plans(approved_by) where approved_by is not null;
create index privacy_deletion_plans_executed_by_idx on public.privacy_deletion_plans(executed_by) where executed_by is not null;

-- A step names the record and the decision, never the values: the evidence of a deletion is that it happened, not what was there.
create table public.privacy_deletion_steps(
 id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.privacy_deletion_plans(id) on delete cascade,context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 domain text not null,table_name text not null,record_ref text not null,
 decision text not null check(decision in('delete','anonymize','anonymize_link','retain','block','manual')),reason text not null,
 status text not null default 'queued' check(status in('queued','running','completed','verified','skipped_retained','failed','manual_pending')),
 attempts integer not null default 0,error_code text,executed_at timestamptz,verified_at timestamptz,created_at timestamptz not null default now(),
 unique(plan_id,table_name,record_ref));
create index privacy_deletion_steps_queue_idx on public.privacy_deletion_steps(plan_id,status);
create index privacy_deletion_steps_context_idx on public.privacy_deletion_steps(context_id);

do $$declare t text;begin foreach t in array array['legal_holds','retention_policies','retention_runs','retention_run_items','privacy_pseudonym_salts','privacy_deletion_plans','privacy_deletion_steps'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
