-- Phase 93G: reconciliation, drift, third parties, support access and non-human credentials. Inventories hold references, never secrets.
-- quality: allow-nonconcurrent-index reason=new-empty-identity-governance-tables

create table public.access_reconciliation_runs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,status text not null default 'running' check(status in('running','completed','failed')),counts jsonb not null default '{}',error_message text,created_by uuid references auth.users(id) on delete set null,started_at timestamptz not null default now(),finished_at timestamptz);
create table public.access_drift_items(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,run_id uuid not null references public.access_reconciliation_runs(id) on delete cascade,outcome text not null check(outcome in('ungoverned_access','missing_access','expired_but_active')),identity_id uuid references public.governed_identities(id) on delete set null,user_id uuid references auth.users(id) on delete set null,entitlement_key text not null,scope_key text not null,grant_id uuid references public.access_grants(id) on delete set null,detected_at timestamptz not null default now());

create table public.third_party_access_profiles(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,vendor_profile_id uuid not null references public.vendor_profiles(id) on delete restrict,identity_id uuid references public.governed_identities(id) on delete set null,sponsor_ref text,scope jsonb not null default '{}',systems text[] not null default '{}',valid_until timestamptz,status text not null default 'active' check(status in('active','review_required','revoked')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(vendor_profile_id,identity_id));

create table public.non_human_credentials(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,identity_id uuid references public.governed_identities(id) on delete set null,credential_kind text not null check(credential_kind in('api_client','oauth_app','integration_connection','ai_tool_permission')),source_table text not null,source_ref text not null,scopes text[] not null default '{}',owner_ref text,expires_at timestamptz,last_used_at timestamptz,review_due_at timestamptz,last_reviewed_at timestamptz,interactive_login_allowed boolean not null default false,status text not null default 'active',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,source_table,source_ref));

-- Phase 24's impersonation_sessions had no code using it; it is extended instead of duplicated. Read-only by default, write only with approval.
alter table public.impersonation_sessions add column if not exists organization_id uuid references public.organizations(id) on delete cascade,add column if not exists case_ref text,add column if not exists mode text not null default 'read_only',add column if not exists expires_at timestamptz,add column if not exists approved_by uuid references auth.users(id) on delete set null,add column if not exists jit_session_id uuid references public.jit_sessions(id) on delete set null;
alter table public.impersonation_sessions add constraint impersonation_sessions_mode_check check(mode in('read_only','write')),add constraint impersonation_sessions_write_approved_check check(mode<>'write' or(approved_by is not null and approved_by<>superadmin_user_id));

create index access_reconciliation_runs_org_idx on public.access_reconciliation_runs(organization_id,started_at desc);
create index access_drift_items_run_idx on public.access_drift_items(run_id,outcome);
create index access_drift_items_org_idx on public.access_drift_items(organization_id,detected_at desc);
create index access_drift_items_identity_idx on public.access_drift_items(identity_id) where identity_id is not null;
create index access_drift_items_grant_idx on public.access_drift_items(grant_id) where grant_id is not null;
create index third_party_profiles_org_idx on public.third_party_access_profiles(organization_id,status,valid_until);
create index third_party_profiles_identity_idx on public.third_party_access_profiles(identity_id) where identity_id is not null;
create index non_human_credentials_board_idx on public.non_human_credentials(organization_id,status,review_due_at);
create index non_human_credentials_identity_idx on public.non_human_credentials(identity_id) where identity_id is not null;
create index impersonation_sessions_org_idx on public.impersonation_sessions(organization_id,expires_at) where organization_id is not null;
create index impersonation_sessions_approver_idx on public.impersonation_sessions(approved_by) where approved_by is not null;
create index impersonation_sessions_jit_idx on public.impersonation_sessions(jit_session_id) where jit_session_id is not null;

create function public.rbac_revoke_api_client(requested_organization_id uuid,requested_client_id uuid,requested_actor_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_status text;
begin
 update public.api_clients set status='revoked',previous_secret_hash=null,previous_secret_expires_at=null where id=requested_client_id and organization_id=requested_organization_id;
 select status into current_status from public.api_clients where id=requested_client_id and organization_id=requested_organization_id;
 insert into public.integration_logs(organization_id,event_type,message,metadata) values(requested_organization_id,'credential_revoked','API key revogada pela governança de acessos.',jsonb_build_object('api_client_id',requested_client_id,'actor_user_id',requested_actor_id));
 return jsonb_build_object('status',current_status);
end$$;
revoke all on function public.rbac_revoke_api_client(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.rbac_revoke_api_client(uuid,uuid,uuid) to service_role;

-- The end of a vendor relationship opens a review and revocation; failing here must not block Vendor Management.
create function private.identity_governance_detect_vendor_end() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.organization_id is null or new.relationship_status not in('exiting','terminated') or new.relationship_status is not distinct from old.relationship_status then return new; end if;
 insert into public.identity_lifecycle_events(organization_id,event_type,source_system,source_ref,priority,details) values(new.organization_id,'vendor_terminated','vendor_profiles',new.id::text||':'||new.relationship_status,90,jsonb_build_object('vendor_profile_id',new.id,'relationship_status',new.relationship_status)) on conflict(organization_id,event_type,source_system,source_ref) do nothing;
 return new;
exception when others then return new;
end$$;
create trigger identity_governance_vendor_end after update of relationship_status on public.vendor_profiles for each row execute function private.identity_governance_detect_vendor_end();
revoke all on function private.identity_governance_detect_vendor_end() from public,anon,authenticated;

do $$declare t text;begin foreach t in array array['access_reconciliation_runs','access_drift_items','third_party_access_profiles','non_human_credentials'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
