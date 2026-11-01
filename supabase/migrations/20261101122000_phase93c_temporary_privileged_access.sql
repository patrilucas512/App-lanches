-- Phase 93C: just-in-time windows and privileged sessions. Records start, end, scope and key actions; there is no screen recording.
-- quality: allow-nonconcurrent-index reason=new-empty-identity-governance-tables

create table public.jit_sessions(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,identity_id uuid not null references public.governed_identities(id) on delete restrict,entitlement_id uuid not null references public.access_entitlements(id) on delete restrict,request_id uuid references public.access_requests(id) on delete set null,grant_id uuid references public.access_grants(id) on delete set null,status text not null default 'requested' check(status in('requested','approved','active','expired','revoked')),scope jsonb not null default '{}',scope_key text not null,justification text not null,requested_minutes integer not null check(requested_minutes between 1 and 480),pre_approved boolean not null default false,approved_by uuid[] not null default '{}',activated_at timestamptz,expires_at timestamptz,ended_at timestamptz,linked_change_ref uuid references public.change_requests(id) on delete set null,linked_incident_ref uuid references public.operational_incidents(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(status<>'active' or(activated_at is not null and expires_at is not null)));

create table public.privileged_sessions(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,grant_id uuid not null references public.access_grants(id) on delete restrict,identity_id uuid not null references public.governed_identities(id) on delete restrict,origin text not null check(origin in('grant','jit','break_glass')),scope jsonb not null default '{}',mfa_level text,started_at timestamptz not null default now(),ended_at timestamptz,key_actions jsonb not null default '[]');

create index jit_sessions_board_idx on public.jit_sessions(organization_id,status,expires_at);
create index jit_sessions_identity_idx on public.jit_sessions(identity_id);
create index jit_sessions_entitlement_idx on public.jit_sessions(entitlement_id);
create index jit_sessions_request_idx on public.jit_sessions(request_id) where request_id is not null;
create index jit_sessions_grant_idx on public.jit_sessions(grant_id) where grant_id is not null;
create index jit_sessions_change_idx on public.jit_sessions(linked_change_ref) where linked_change_ref is not null;
create index jit_sessions_incident_idx on public.jit_sessions(linked_incident_ref) where linked_incident_ref is not null;
create index privileged_sessions_grant_idx on public.privileged_sessions(grant_id);
create index privileged_sessions_identity_idx on public.privileged_sessions(identity_id);
create index privileged_sessions_org_idx on public.privileged_sessions(organization_id,started_at desc);

do $$declare t text;begin foreach t in array array['jit_sessions','privileged_sessions'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
