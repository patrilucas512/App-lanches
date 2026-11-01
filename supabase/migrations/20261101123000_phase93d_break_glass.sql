-- Phase 93D: break-glass. Rare, justified, time-limited, audited and always reviewed by someone else afterwards.
-- quality: allow-nonconcurrent-index reason=new-empty-identity-governance-tables

create table public.break_glass_events(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,identity_id uuid not null references public.governed_identities(id) on delete restrict,used_by uuid references auth.users(id) on delete set null,entitlement_id uuid not null references public.access_entitlements(id) on delete restrict,grant_id uuid references public.access_grants(id) on delete set null,action_request_id uuid references public.copilot_action_requests(id) on delete set null,scope jsonb not null default '{}',scope_key text not null,reason text not null check(length(trim(reason))>=10),linked_incident_ref uuid references public.operational_incidents(id) on delete set null,status text not null default 'requested' check(status in('requested','active','expired','closed','under_review','reviewed')),requested_minutes integer not null check(requested_minutes between 1 and 240),activated_at timestamptz,expires_at timestamptz,closed_at timestamptz,notified_at timestamptz,review_due_at timestamptz,reviewer_id uuid references auth.users(id) on delete set null,reviewed_at timestamptz,review_outcome text check(review_outcome in('appropriate','needs_follow_up','out_of_scope_signal')),review_notes text,finding_id uuid references public.access_findings(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(reviewer_id is null or reviewer_id is distinct from used_by),check(status<>'reviewed' or(reviewer_id is not null and reviewed_at is not null and review_outcome is not null)),check(status<>'active' or(activated_at is not null and expires_at is not null)));

create index break_glass_board_idx on public.break_glass_events(organization_id,status,review_due_at);
create index break_glass_expiry_idx on public.break_glass_events(status,expires_at);
create index break_glass_identity_idx on public.break_glass_events(identity_id);
create index break_glass_entitlement_idx on public.break_glass_events(entitlement_id);
create index break_glass_grant_idx on public.break_glass_events(grant_id) where grant_id is not null;
create index break_glass_action_idx on public.break_glass_events(action_request_id) where action_request_id is not null;
create index break_glass_incident_idx on public.break_glass_events(linked_incident_ref) where linked_incident_ref is not null;
create index break_glass_finding_idx on public.break_glass_events(finding_id) where finding_id is not null;

alter table public.break_glass_events enable row level security;
revoke all on public.break_glass_events from public,anon,authenticated;
grant all on public.break_glass_events to service_role;
