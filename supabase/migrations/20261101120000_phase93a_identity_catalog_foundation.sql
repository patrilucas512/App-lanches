-- Phase 93A: Identity Governance foundation. Governs rights; Auth, RBAC tables, Policy Engine, approvals and audit remain canonical.
-- quality: allow-nonconcurrent-index reason=new-empty-identity-governance-tables

alter table public.plans add column if not exists identity_governance_enabled boolean not null default false,add column if not exists identity_jit_enabled boolean not null default false,add column if not exists identity_break_glass_enabled boolean not null default false,add column if not exists identity_sod_enabled boolean not null default false,add column if not exists identity_access_reviews_enabled boolean not null default false,add column if not exists identity_reconciliation_enabled boolean not null default false,add column if not exists identity_ai_assistance_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists identity_governance_enabled boolean not null default false,add column if not exists identity_jit_enabled boolean not null default false,add column if not exists identity_break_glass_enabled boolean not null default false,add column if not exists identity_sod_enabled boolean not null default false,add column if not exists identity_access_reviews_enabled boolean not null default false,add column if not exists identity_reconciliation_enabled boolean not null default false,add column if not exists identity_ai_assistance_enabled boolean not null default false;

create table public.identity_governance_member_permissions(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,permission_key text not null check(permission_key like 'idgov:%'),scope_refs text[] not null default '{}',active boolean not null default true,granted_at timestamptz not null default now(),unique(organization_id,user_id,permission_key));

create table public.governed_identities(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,identity_ref text not null,identity_type text not null check(identity_type in('employee','contractor','vendor_user','support_agent','platform_admin','service_account','api_client','integration_identity','ai_agent','shared_account')),user_id uuid references auth.users(id) on delete set null,lifecycle_status text not null default 'active' check(lifecycle_status in('pending','active','suspended','leaving','terminated','archived')),governance_status text not null default 'ungoverned' check(governance_status in('governed','partially_governed','ungoverned','orphan')),owner_ref text,sponsor_ref text,source_system text not null,source_ref text,valid_until timestamptz,last_seen_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,identity_type,identity_ref),
 check(identity_type not in('service_account','api_client','integration_identity','ai_agent') or owner_ref is not null or governance_status in('orphan','ungoverned')),
 check(identity_type not in('contractor','vendor_user') or sponsor_ref is not null or governance_status in('orphan','ungoverned')));

create table public.access_entitlements(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,key text not null,name text not null,description text not null default '',entitlement_type text not null check(entitlement_type in('role','permission_bundle','scope_grant','store_access','environment_access','data_access','feature_admin','integration_access','support_access','api_scope')),source_system text not null,technical_ref jsonb not null,criticality text not null default 'low' check(criticality in('low','medium','high','critical')),privileged boolean not null default false,owner_ref text,technical_owner_ref text,requestable boolean not null default false,max_duration interval,requires_justification boolean not null default true,status text not null default 'draft' check(status in('draft','active','deprecated','retired')),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,key),
 check(criticality<>'critical' or status<>'active' or(owner_ref is not null and technical_owner_ref is not null)),
 check(not requestable or status='active'),
 check(not technical_ref ? 'secret' and not technical_ref ? 'token'));

create table public.access_grants(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,identity_id uuid not null references public.governed_identities(id) on delete restrict,entitlement_id uuid not null references public.access_entitlements(id) on delete restrict,scope jsonb not null default '{}',scope_key text not null,source_type text not null check(source_type in('request','birthright_role','lifecycle_rule','jit','break_glass','migration_baseline','manual_admin_legacy')),request_id uuid,reason text not null,approved_by uuid[] not null default '{}',granted_at timestamptz,valid_until timestamptz,status text not null default 'pending' check(status in('pending','active','expiring','expired','revoked','failed')),previous_state jsonb,review_required boolean not null default false,revocation_reason text,revoked_at timestamptz,revocation_confirmed_at timestamptz,failure_reason text,last_used_at timestamptz,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(source_type not in('jit','break_glass') or valid_until is not null),
 check(status<>'revoked' or(revocation_reason is not null and revocation_confirmed_at is not null)),
 check(status<>'failed' or failure_reason is not null));
create unique index access_grants_one_live_idx on public.access_grants(identity_id,entitlement_id,scope_key) where status in('pending','active','expiring');

create table public.access_findings(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,finding_type text not null check(finding_type in('excessive_privilege','permanent_privileged_access','sod_conflict','orphan_account','dormant_access','ownerless_service_account','expired_vendor_access','shared_account','access_drift','unreviewed_break_glass')),severity text not null check(severity in('low','medium','high','critical')),state text not null default 'open' check(state in('open','accepted','mitigating','resolved')),identity_id uuid references public.governed_identities(id) on delete set null,grant_id uuid references public.access_grants(id) on delete set null,entitlement_id uuid references public.access_entitlements(id) on delete set null,title text not null,priority_reasons jsonb not null default '[]',evidence jsonb not null default '{}',fingerprint text not null,accepted_reason text,accepted_until timestamptz,accepted_by uuid references auth.users(id) on delete set null,first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),resolved_at timestamptz,unique(organization_id,fingerprint),
 check(state<>'accepted' or(accepted_reason is not null and accepted_until is not null and accepted_by is not null)));

create table public.identity_governance_jobs(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id) on delete cascade,job_type text not null check(job_type in('expiration','expiry_warning','reconciliation','leaver','dormant_scan','sod_scan','review_reminder','soc_requests')),priority integer not null default 50,status text not null default 'queued' check(status in('queued','running','completed','failed','dead_letter')),payload jsonb not null default '{}',attempt_count integer not null default 0,max_attempts integer not null default 5,available_at timestamptz not null default now(),lease_expires_at timestamptz,error_message text,created_at timestamptz not null default now(),completed_at timestamptz);

create table public.identity_governance_audit_events(id bigint generated always as identity primary key,organization_id uuid references public.organizations(id) on delete cascade,actor_id uuid references auth.users(id) on delete set null,action text not null,resource_type text not null,resource_id text,reason text,correlation_id text not null default gen_random_uuid()::text,safe_metadata jsonb not null default '{}',created_at timestamptz not null default now());
create function public.prevent_identity_governance_history_rewrite() returns trigger language plpgsql set search_path=public as $$begin raise exception 'IDENTITY_GOVERNANCE_HISTORY_IMMUTABLE';end$$;
create trigger identity_governance_audit_immutable before update or delete on public.identity_governance_audit_events for each row execute function public.prevent_identity_governance_history_rewrite();
revoke all on function public.prevent_identity_governance_history_rewrite() from public,anon,authenticated;grant execute on function public.prevent_identity_governance_history_rewrite() to service_role;

create index governed_identities_board_idx on public.governed_identities(organization_id,identity_type,governance_status,lifecycle_status);
create index governed_identities_user_idx on public.governed_identities(user_id) where user_id is not null;
create index access_entitlements_board_idx on public.access_entitlements(organization_id,status,criticality,privileged);
create index access_grants_identity_idx on public.access_grants(organization_id,identity_id,status);
create index access_grants_entitlement_idx on public.access_grants(entitlement_id,status);
create index access_grants_expiry_idx on public.access_grants(status,valid_until) where valid_until is not null;
create index access_findings_board_idx on public.access_findings(organization_id,state,severity,first_seen_at);
create index access_findings_identity_idx on public.access_findings(identity_id) where identity_id is not null;
create index access_findings_grant_idx on public.access_findings(grant_id) where grant_id is not null;
create index access_findings_entitlement_idx on public.access_findings(entitlement_id) where entitlement_id is not null;
create index identity_governance_jobs_queue_idx on public.identity_governance_jobs(status,priority desc,available_at,lease_expires_at);
create index identity_governance_audit_lookup_idx on public.identity_governance_audit_events(organization_id,created_at desc);
create index identity_governance_permissions_user_idx on public.identity_governance_member_permissions(user_id);

-- Official RBAC facade. Each function writes the real table in one audited place and returns the state read back. Service role only.
create function public.rbac_read_effective_access(requested_organization_id uuid,requested_user_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'organization_members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'all_stores',m.all_stores,'active',m.active)) from public.organization_members m where m.organization_id=requested_organization_id and(requested_user_id is null or m.user_id=requested_user_id)),'[]'),
  'establishment_members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'establishment_id',m.establishment_id,'role',m.role,'status',m.status)) from public.establishment_members m join public.establishments e on e.id=m.establishment_id where e.organization_id=requested_organization_id and(requested_user_id is null or m.user_id=requested_user_id)),'[]'),
  'store_access',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'establishment_id',a.establishment_id)) from public.organization_member_store_access a where a.organization_id=requested_organization_id and(requested_user_id is null or a.user_id=requested_user_id)),'[]'),
  'module_permissions',coalesce((select jsonb_agg(x) from(
    select jsonb_build_object('user_id',p.user_id,'module','soc','permission_key',p.permission_key) x from public.security_soc_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','vendor','permission_key',p.permission_key) from public.vendor_member_permissions p where p.organization_id=requested_organization_id and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','idgov','permission_key',p.permission_key) from public.identity_governance_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id))s),'[]'))
$$;

create function public.rbac_apply_establishment_role(requested_organization_id uuid,requested_establishment_id uuid,requested_user_id uuid,requested_role text) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_role_value text;
begin
 if requested_role not in('manager','attendant','catalog_editor','kitchen') then raise exception 'RBAC_ROLE_NOT_PROVISIONABLE'; end if;
 if not exists(select 1 from public.establishments where id=requested_establishment_id and organization_id=requested_organization_id) then raise exception 'RBAC_SCOPE_INVALID'; end if;
 select role::text into current_role_value from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id;
 if current_role_value='owner' then raise exception 'RBAC_OWNER_PROTECTED'; end if;
 insert into public.establishment_members(establishment_id,user_id,role,status) values(requested_establishment_id,requested_user_id,requested_role::public.member_role,'active') on conflict(establishment_id,user_id) do update set role=excluded.role,status='active',updated_at=now();
 return jsonb_build_object('previous_role',current_role_value,'role',requested_role);
end$$;

-- private.has_role ignores status, so revoking must remove the row: inactivating would leave RLS access in place.
create function public.rbac_revoke_establishment_role(requested_organization_id uuid,requested_establishment_id uuid,requested_user_id uuid,requested_role text) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_role_value text;
begin
 if not exists(select 1 from public.establishments where id=requested_establishment_id and organization_id=requested_organization_id) then raise exception 'RBAC_SCOPE_INVALID'; end if;
 select role::text into current_role_value from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id;
 if current_role_value='owner' then raise exception 'RBAC_OWNER_PROTECTED'; end if;
 if current_role_value is not null and current_role_value=requested_role then delete from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id; end if;
 return jsonb_build_object('removed',current_role_value is not null and current_role_value=requested_role,'current_role',current_role_value);
end$$;

create function public.rbac_apply_organization_role(requested_organization_id uuid,requested_user_id uuid,requested_role text,requested_all_stores boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_role_value text;
begin
 if requested_role not in('admin','supervisor','analyst','member') then raise exception 'RBAC_ROLE_NOT_PROVISIONABLE'; end if;
 select role into current_role_value from public.organization_members where organization_id=requested_organization_id and user_id=requested_user_id;
 if current_role_value='owner' then raise exception 'RBAC_OWNER_PROTECTED'; end if;
 insert into public.organization_members(organization_id,user_id,role,all_stores,active) values(requested_organization_id,requested_user_id,requested_role,requested_all_stores,true) on conflict(organization_id,user_id) do update set role=excluded.role,all_stores=excluded.all_stores,active=true,updated_at=now();
 return jsonb_build_object('previous_role',current_role_value,'role',requested_role);
end$$;

create function public.rbac_revoke_organization_role(requested_organization_id uuid,requested_user_id uuid,requested_role text) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_role_value text;
begin
 select role into current_role_value from public.organization_members where organization_id=requested_organization_id and user_id=requested_user_id;
 if current_role_value='owner' then raise exception 'RBAC_OWNER_PROTECTED'; end if;
 if current_role_value is not null and current_role_value=requested_role then
  delete from public.organization_member_store_access where organization_id=requested_organization_id and user_id=requested_user_id;
  delete from public.organization_members where organization_id=requested_organization_id and user_id=requested_user_id;
 end if;
 return jsonb_build_object('removed',current_role_value is not null and current_role_value=requested_role,'current_role',current_role_value);
end$$;

create function public.rbac_set_module_permission(requested_organization_id uuid,requested_user_id uuid,requested_module text,requested_permission_key text,requested_active boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if requested_module='soc' and requested_permission_key like 'soc:%' then
  insert into public.security_soc_member_permissions(organization_id,user_id,context,permission_key,active) values(requested_organization_id,requested_user_id,'tenant_soc',requested_permission_key,requested_active) on conflict(organization_id,user_id,context,permission_key) do update set active=excluded.active;
 elsif requested_module='vendor' and requested_permission_key like 'vendor:%' then
  if requested_active then insert into public.vendor_member_permissions(organization_id,user_id,permission_key) values(requested_organization_id,requested_user_id,requested_permission_key) on conflict(organization_id,user_id,permission_key) do nothing;
  else delete from public.vendor_member_permissions where organization_id=requested_organization_id and user_id=requested_user_id and permission_key=requested_permission_key; end if;
 elsif requested_module='idgov' and requested_permission_key like 'idgov:%' then
  insert into public.identity_governance_member_permissions(organization_id,user_id,permission_key,active) values(requested_organization_id,requested_user_id,requested_permission_key,requested_active) on conflict(organization_id,user_id,permission_key) do update set active=excluded.active;
 else raise exception 'RBAC_MODULE_NOT_PROVISIONABLE'; end if;
 return jsonb_build_object('module',requested_module,'permission_key',requested_permission_key,'active',requested_active);
end$$;

do $$declare f text;begin foreach f in array array['rbac_read_effective_access(uuid,uuid)','rbac_apply_establishment_role(uuid,uuid,uuid,text)','rbac_revoke_establishment_role(uuid,uuid,uuid,text)','rbac_apply_organization_role(uuid,uuid,text,boolean)','rbac_revoke_organization_role(uuid,uuid,text)','rbac_set_module_permission(uuid,uuid,text,text,boolean)'] loop execute format('revoke all on function public.%s from public,anon,authenticated',f);execute format('grant execute on function public.%s to service_role',f);end loop;end$$;

-- ActionEngine stays the shared ledger: Phase 93 records high-impact actions in it, and they stay out of the Copilot's history and metrics.
alter table public.copilot_action_requests drop constraint copilot_action_requests_action_type_check;
alter table public.copilot_action_requests add constraint copilot_action_requests_action_type_check check(action_type in('PRODUCT_SET_AVAILABILITY','CAMPAIGN_PAUSE','CAMPAIGN_RESUME','STORE_TEMPORARILY_CLOSE','STORE_REOPEN','DELIVERY_TOGGLE','UPDATE_DELIVERY_ESTIMATE','AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE','ASSIGN_CONVERSATION','CHANGE_CONVERSATION_PRIORITY','QUEUE_ADJUST_CAPACITY','IDGOV_GRANT_CRITICAL','IDGOV_REVOKE_CRITICAL','IDGOV_DISABLE_IDENTITY','IDGOV_BULK_REVOKE','IDGOV_ACTIVATE_BREAK_GLASS','IDGOV_CHANGE_PRIVILEGED_BUNDLE'));
alter table public.copilot_action_requests drop constraint copilot_action_requests_source_check;
alter table public.copilot_action_requests add constraint copilot_action_requests_source_check check(source in('copilot','identity_governance'));
alter table public.copilot_action_requests add constraint copilot_action_requests_idgov_type_source_check check((action_type like 'IDGOV\_%')=(source='identity_governance'));

create or replace function public.list_copilot_actions(requested_establishment_id uuid,requested_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if private.copilot_action_role(requested_establishment_id) is null then raise exception 'Sem permissão.'; end if;
  return jsonb_build_object(
    'actions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,action_type,risk_level,status,preview,required_approvals,confirmed_at,executed_at,undo_expires_at,created_at from public.copilot_action_requests where establishment_id=requested_establishment_id and source='copilot' order by created_at desc limit least(greatest(requested_limit,1),100))x),'[]'),
    'temporary',coalesce((select jsonb_agg(to_jsonb(t) order by t.restore_at) from public.copilot_temporary_operations t where t.establishment_id=requested_establishment_id and t.status='scheduled'),'[]'),
    'metrics',(select jsonb_build_object('suggested',count(*),'confirmed',count(*) filter(where confirmed_at is not null),'executed',count(*) filter(where status in ('executed','undone')),'cancelled',count(*) filter(where status='cancelled'),'failed',count(*) filter(where status in ('failed','conflict')),'undone',count(*) filter(where status='undone'),'average_confirmation_seconds',round(avg(extract(epoch from(confirmed_at-created_at))) filter(where confirmed_at is not null))) from public.copilot_action_requests where establishment_id=requested_establishment_id and source='copilot')
  );
end$$;

create policy copilot_action_requests_hide_identity_governance on public.copilot_action_requests as restrictive for select to authenticated using(source='copilot');

do $$declare t text;begin foreach t in array array['identity_governance_member_permissions','governed_identities','access_entitlements','access_grants','access_findings','identity_governance_jobs','identity_governance_audit_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
