-- Phase 57A: network_announcements (Phase 46) becomes the canonical announcement. Additive only; no second announcements table.
-- quality: allow-nonconcurrent-index reason=new-empty-comms-tables

alter table public.plans add column if not exists internal_communications_enabled boolean not null default false,add column if not exists comms_board_enabled boolean not null default false,add column if not exists comms_polls_enabled boolean not null default false,add column if not exists comms_crisis_enabled boolean not null default false,add column if not exists comms_ai_drafts_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists internal_communications_enabled boolean not null default false,add column if not exists comms_board_enabled boolean not null default false,add column if not exists comms_polls_enabled boolean not null default false,add column if not exists comms_crisis_enabled boolean not null default false,add column if not exists comms_ai_drafts_enabled boolean not null default false;

alter table public.network_announcements drop constraint network_announcements_scope_type_check;
alter table public.network_announcements add constraint network_announcements_scope_type_check check(scope_type in('organization','brand','region','cluster','franchise','store','team'));

-- acknowledgement_required stays as requires_ack and created_by stays as the author, so neither is duplicated.
alter table public.network_announcements
 add column store_id uuid references public.establishments(id) on delete set null,
 add column announcement_type text not null default 'general' check(announcement_type in('general','procedure_change','menu_change','recall_food_safety','maintenance','store_opening','policy','training','crisis','celebration')),
 add column priority text not null default 'info' check(priority in('info','important','mandatory','urgent')),
 add column status text not null default 'draft' check(status in('draft','pending_approval','approved','scheduled','published','expired','archived','retracted')),
 add column audience_definition jsonb not null default '{}',
 add column ack_deadline timestamptz,
 add column publish_at timestamptz,
 add column approval_id uuid references public.internal_approvals(id) on delete set null,
 add column approved_hash text,
 add column template_id uuid,
 add column related_refs jsonb not null default '{}',
 add column version integer not null default 1 check(version>0),
 add column content_hash text,
 add column verification jsonb,
 add column ai_generated boolean not null default false,
 add column emergency boolean not null default false,
 add column emergency_reason text,
 add column review_due_at timestamptz,
 add column reviewed_by uuid references auth.users(id) on delete set null,
 add column reviewed_at timestamptz,
 add column retracted_at timestamptz,
 add column retracted_by uuid references auth.users(id) on delete set null,
 add column retraction_reason text,
 add column correction_note text,
 add column pending_edit jsonb,
 add column pending_edit_approval_id uuid references public.internal_approvals(id) on delete set null,
 add column source_type text,
 add column idempotency_key text,
 add column last_escalated_at timestamptz,
 add column updated_by uuid references auth.users(id) on delete set null,
 add column updated_at timestamptz not null default now();

-- Rows from Phase 46 keep their meaning: what was published stays published, and the scope becomes the audience.
update public.network_announcements set
 status=case when published_at is null then 'draft' when expires_at is not null and expires_at<now() then 'expired' else 'published' end,
 priority=case when acknowledgement_required then 'mandatory' else 'info' end,
 audience_definition=jsonb_build_object('scope',jsonb_build_object('type',scope_type,'ids',case when scope_id is null then '[]'::jsonb else jsonb_build_array(scope_id) end));

create unique index network_announcements_idempotency_idx on public.network_announcements(organization_id,idempotency_key) where idempotency_key is not null;
create index network_announcements_status_idx on public.network_announcements(organization_id,status,publish_at);
create index network_announcements_store_idx on public.network_announcements(store_id) where store_id is not null;
create index network_announcements_approval_idx on public.network_announcements(approval_id) where approval_id is not null;
create index network_announcements_edit_approval_idx on public.network_announcements(pending_edit_approval_id) where pending_edit_approval_id is not null;
create index network_announcements_reviewed_by_idx on public.network_announcements(reviewed_by) where reviewed_by is not null;
create index network_announcements_retracted_by_idx on public.network_announcements(retracted_by) where retracted_by is not null;
create index network_announcements_updated_by_idx on public.network_announcements(updated_by) where updated_by is not null;

create table public.network_announcement_versions(
 id uuid primary key default gen_random_uuid(),announcement_id uuid not null references public.network_announcements(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,version integer not null check(version>0),title text not null,body text not null,content_hash text not null,
 material_change boolean not null default false,change_note text,edited_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),unique(announcement_id,version));
create index network_announcement_versions_org_idx on public.network_announcement_versions(organization_id);
create index network_announcement_versions_editor_idx on public.network_announcement_versions(edited_by) where edited_by is not null;

create table public.comms_member_permissions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 permission_key text not null check(permission_key like 'comms:%'),active boolean not null default true,created_at timestamptz not null default now(),unique(organization_id,user_id,permission_key));
create index comms_member_permissions_user_idx on public.comms_member_permissions(user_id);

create table public.comms_settings(
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 emergency_publish_allowed boolean not null default false,urgent_bypass_quiet_hours boolean not null default false,self_approval_allowed boolean not null default false,
 required_approvals integer not null default 1 check(required_approvals between 1 and 5),
 reminder_hours_before integer not null default 24 check(reminder_hours_before between 1 and 168),reminder_interval_hours integer not null default 24 check(reminder_interval_hours between 1 and 168),max_reminders integer not null default 3 check(max_reminders between 0 and 10),
 late_joiner_ack_hours integer not null default 72 check(late_joiner_ack_hours between 1 and 720),emergency_review_hours integer not null default 24 check(emergency_review_hours between 1 and 168),
 board_comments_enabled boolean not null default false,poll_minimum_responses integer not null default 5 check(poll_minimum_responses>=3),
 retention_months integer check(retention_months is null or retention_months>0),updated_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now());
create index comms_settings_updated_by_idx on public.comms_settings(updated_by) where updated_by is not null;

create table public.comms_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,announcement_id uuid references public.network_announcements(id) on delete cascade,
 job_type text not null check(job_type in('deliver','scan')),priority integer not null default 50,status text not null default 'queued' check(status in('queued','running','completed','dead_letter')),
 attempt_count integer not null default 0,max_attempts integer not null default 5,available_at timestamptz not null default now(),lease_expires_at timestamptz,completed_at timestamptz,error_message text,created_at timestamptz not null default now());
create unique index comms_jobs_active_idx on public.comms_jobs(organization_id,job_type,coalesce(announcement_id,'00000000-0000-0000-0000-000000000000'::uuid)) where status in('queued','running');
create index comms_jobs_queue_idx on public.comms_jobs(priority desc,available_at) where status='queued';
create index comms_jobs_announcement_idx on public.comms_jobs(announcement_id) where announcement_id is not null;

create table public.comms_audit_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete set null,
 actor_id uuid references auth.users(id) on delete set null,actor_type text not null default 'user',action text not null,resource_type text not null,resource_id text,reason text,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create index comms_audit_events_lookup_idx on public.comms_audit_events(organization_id,created_at desc);
create index comms_audit_events_store_idx on public.comms_audit_events(store_id) where store_id is not null;
create index comms_audit_events_actor_idx on public.comms_audit_events(actor_id) where actor_id is not null;

-- History stays: an organization being removed may still cascade, nothing else rewrites it.
create function public.prevent_comms_history_rewrite() returns trigger language plpgsql set search_path=public as $$begin if tg_op='DELETE' and pg_trigger_depth()>1 then return old;end if;raise exception 'COMMS_HISTORY_IMMUTABLE';end$$;
create trigger comms_audit_immutable before update or delete on public.comms_audit_events for each row execute function public.prevent_comms_history_rewrite();
create trigger network_announcement_versions_immutable before update or delete on public.network_announcement_versions for each row execute function public.prevent_comms_history_rewrite();
revoke all on function public.prevent_comms_history_rewrite() from public,anon,authenticated;grant execute on function public.prevent_comms_history_rewrite() to service_role;

do $$declare t text;begin foreach t in array array['network_announcement_versions','comms_member_permissions','comms_settings','comms_jobs','comms_audit_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
