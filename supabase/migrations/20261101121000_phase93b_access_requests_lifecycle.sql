-- Phase 93B: access requests and joiner/mover/leaver. Approvals stay in Phase 32; real access changes only through the rbac_* facade.
-- quality: allow-nonconcurrent-index reason=new-empty-identity-governance-tables

create table public.identity_governance_settings(organization_id uuid primary key references public.organizations(id) on delete cascade,require_mfa_for_privileged boolean not null default true,dormant_days integer not null default 90 check(dormant_days between 7 and 730),expiry_warning_hours integer not null default 24 check(expiry_warning_hours between 1 and 720),break_glass_max_minutes integer not null default 60 check(break_glass_max_minutes between 5 and 240),break_glass_review_hours integer not null default 72 check(break_glass_review_hours between 1 and 720),break_glass_requires_incident boolean not null default true,jit_max_minutes integer not null default 240 check(jit_max_minutes between 5 and 480),review_due_days integer not null default 30 check(review_due_days between 1 and 365),pre_approved_jit_keys text[] not null default '{}',production_access_requires_change boolean not null default false,updated_at timestamptz not null default now());

create table public.access_requests(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,requester_id uuid not null references auth.users(id) on delete restrict,beneficiary_identity_id uuid not null references public.governed_identities(id) on delete restrict,entitlement_id uuid not null references public.access_entitlements(id) on delete restrict,scope jsonb not null default '{}',scope_key text not null,justification text not null,requested_duration interval,request_type text not null check(request_type in('new_access','extension','scope_change','temporary','jit','removal')),status text not null default 'draft' check(status in('draft','submitted','pending_approval','approved','rejected','provisioning','completed','failed','cancelled','expired')),linked_change_ref uuid references public.change_requests(id) on delete set null,linked_incident_ref uuid references public.operational_incidents(id) on delete set null,approval_id uuid references public.internal_approvals(id) on delete set null,action_request_id uuid references public.copilot_action_requests(id) on delete set null,grant_id uuid references public.access_grants(id) on delete set null,policy_decision jsonb not null default '{}',sod_result text check(sod_result in('no_conflict','conflict_blocked','conflict_mitigated','conflict_accepted')),sod_conflicts jsonb not null default '[]',failure_reason text,idempotency_key text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,idempotency_key),check(status<>'failed' or failure_reason is not null));
alter table public.access_grants add constraint access_grants_request_id_fkey foreign key(request_id) references public.access_requests(id) on delete set null;

create table public.birthright_rules(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,match_type text not null check(match_type in('staff_role','store','organization')),match_value text,entitlement_id uuid not null references public.access_entitlements(id) on delete restrict,status text not null default 'draft' check(status in('draft','active','retired')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,name));

create table public.identity_lifecycle_events(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,identity_id uuid references public.governed_identities(id) on delete set null,user_id uuid references auth.users(id) on delete set null,event_type text not null check(event_type in('joiner','mover','leaver','vendor_terminated')),source_system text not null,source_ref text not null,status text not null default 'queued' check(status in('queued','processing','confirmed','failed')),priority integer not null default 50,details jsonb not null default '{}',results jsonb not null default '{}',failure_reason text,requested_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),completed_at timestamptz,unique(organization_id,event_type,source_system,source_ref),check(status<>'failed' or failure_reason is not null));

create index access_requests_board_idx on public.access_requests(organization_id,status,created_at desc);
create index access_requests_beneficiary_idx on public.access_requests(beneficiary_identity_id);
create index access_requests_entitlement_idx on public.access_requests(entitlement_id);
create index access_requests_requester_idx on public.access_requests(requester_id);
create index access_requests_change_idx on public.access_requests(linked_change_ref) where linked_change_ref is not null;
create index access_requests_incident_idx on public.access_requests(linked_incident_ref) where linked_incident_ref is not null;
create index access_requests_approval_idx on public.access_requests(approval_id) where approval_id is not null;
create index access_requests_action_idx on public.access_requests(action_request_id) where action_request_id is not null;
create index access_requests_grant_idx on public.access_requests(grant_id) where grant_id is not null;
create index access_grants_request_idx on public.access_grants(request_id) where request_id is not null;
create index birthright_rules_entitlement_idx on public.birthright_rules(entitlement_id);
create index identity_lifecycle_queue_idx on public.identity_lifecycle_events(status,priority desc,created_at);
create index identity_lifecycle_identity_idx on public.identity_lifecycle_events(identity_id) where identity_id is not null;

create function public.rbac_revoke_user_sessions(requested_organization_id uuid,requested_user_id uuid,requested_reason text,requested_include_global boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare revoked integer;remaining integer;
begin
 update public.security_sessions set revoked_at=now(),revoke_reason=requested_reason,is_current=false where user_id=requested_user_id and revoked_at is null and(organization_id=requested_organization_id or(requested_include_global and organization_id is null));
 get diagnostics revoked=row_count;
 select count(*) into remaining from public.security_sessions where user_id=requested_user_id and revoked_at is null and(organization_id=requested_organization_id or(requested_include_global and organization_id is null));
 return jsonb_build_object('revoked',revoked,'remaining',remaining);
end$$;

create function public.rbac_offboard_employee_records(requested_organization_id uuid,requested_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare stores uuid[];remaining integer;
begin
 select coalesce(array_agg(id),'{}') into stores from public.establishments where organization_id=requested_organization_id;
 update public.waiter_access_links set expires_at=now() where used_at is null and waiter_id in(select id from public.waiters where user_id=requested_user_id and establishment_id=any(stores));
 update public.kitchen_access_links set expires_at=now() where used_at is null and operator_id in(select id from public.kitchen_operators where user_id=requested_user_id and establishment_id=any(stores));
 update public.cashier_access_links set expires_at=now() where used_at is null and staff_member_id in(select id from public.custom_staff_members where user_id=requested_user_id and establishment_id=any(stores));
 update public.driver_access_links set revoked_at=now() where used_at is null and revoked_at is null and driver_profile_id in(select id from public.driver_profiles where user_id=requested_user_id and establishment_id=any(stores));
 update public.waiters set status='inactive',active_now=false where user_id=requested_user_id and establishment_id=any(stores);
 update public.kitchen_operators set status='inactive' where user_id=requested_user_id and establishment_id=any(stores);
 update public.driver_profiles set approval_status='blocked',active=false where user_id=requested_user_id and establishment_id=any(stores);
 update public.custom_staff_members set status='inactive' where user_id=requested_user_id and establishment_id=any(stores);
 select (select count(*) from public.waiters where user_id=requested_user_id and establishment_id=any(stores) and status<>'inactive')+(select count(*) from public.kitchen_operators where user_id=requested_user_id and establishment_id=any(stores) and status<>'inactive')+(select count(*) from public.driver_profiles where user_id=requested_user_id and establishment_id=any(stores) and approval_status<>'blocked')+(select count(*) from public.custom_staff_members where user_id=requested_user_id and establishment_id=any(stores) and status<>'inactive') into remaining;
 return jsonb_build_object('remaining_active',remaining);
end$$;

do $$declare f text;begin foreach f in array array['rbac_revoke_user_sessions(uuid,uuid,text,boolean)','rbac_offboard_employee_records(uuid,uuid)'] loop execute format('revoke all on function public.%s from public,anon,authenticated',f);execute format('grant execute on function public.%s to service_role',f);end loop;end$$;

-- Workforce has no termination event, so this is its source. A failure here must never block an HR update.
create function private.identity_governance_detect_staff_termination() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if new.user_id is null then return new; end if;
 if not((new.termination_date is not null and old.termination_date is null and new.termination_date<=current_date) or(new.archived_at is not null and old.archived_at is null)) then return new; end if;
 select organization_id into org from public.establishments where id=new.establishment_id;
 insert into public.identity_lifecycle_events(organization_id,user_id,event_type,source_system,source_ref,priority,details) values(org,new.user_id,'leaver','custom_staff_members',new.id::text,100,jsonb_build_object('termination_date',new.termination_date)) on conflict(organization_id,event_type,source_system,source_ref) do nothing;
 return new;
exception when others then return new;
end$$;
create trigger identity_governance_staff_termination after update of termination_date,archived_at on public.custom_staff_members for each row execute function private.identity_governance_detect_staff_termination();
revoke all on function private.identity_governance_detect_staff_termination() from public,anon,authenticated;

do $$declare t text;begin foreach t in array array['identity_governance_settings','access_requests','birthright_rules','identity_lifecycle_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
