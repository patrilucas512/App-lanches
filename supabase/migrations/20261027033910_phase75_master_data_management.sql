-- Phase 75 - Master Data Management (MDM)
-- Governance/identity layer only. Operational domains remain authoritative.

create schema if not exists mdm_private;
revoke all on schema mdm_private from public, anon, authenticated;
grant usage on schema mdm_private to service_role;

alter table public.plans add column if not exists mdm_enabled boolean not null default true;
alter table public.plans add column if not exists mdm_deduplication_enabled boolean not null default true;
alter table public.plans add column if not exists mdm_golden_records_enabled boolean not null default true;
alter table public.plans add column if not exists mdm_data_quality_enabled boolean not null default true;
alter table public.plans add column if not exists mdm_merge_center_enabled boolean not null default true;
alter table public.plans add column if not exists mdm_ai_assistant_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists mdm_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists mdm_deduplication_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists mdm_golden_records_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists mdm_data_quality_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists mdm_merge_center_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists mdm_ai_assistant_enabled boolean not null default false;

create table public.mdm_member_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permissions text[] not null default '{}',
  scope_type text not null default 'organization' check (scope_type in ('store','region','organization','network')),
  scope_ids uuid[] not null default '{}', active boolean not null default true,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  unique (organization_id,user_id)
);

create table public.master_entity_registry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('product','ingredient','supplier','customer','store','employee','asset','carrier','warehouse','address','custom')),
  canonical_entity_id uuid not null,
  status text not null default 'active' check (status in ('active','merged','archived','anonymized','blocked')),
  master_key text not null, canonical_updated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,entity_type,canonical_entity_id), unique (organization_id,master_key)
);

create table public.master_source_records (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  master_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  source_system text not null, source_entity_type text not null, source_entity_id text not null,
  status text not null default 'active' check (status in ('active','retired','merged','deleted','anonymized')),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  source_snapshot_hash text, source_version text, unique (organization_id,source_system,source_entity_type,source_entity_id)
);

create table public.master_normalization_rules (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  entity_type text not null, identifier_type text not null, rule_key text not null,
  strategy text not null check (strategy in ('trim','case_policy','digits_only','e164','email_safe','barcode','sku_tenant','uom_alias','custom_safe')),
  configuration jsonb not null default '{}', version integer not null default 1, active boolean not null default true,
  published_by uuid references auth.users(id), published_at timestamptz, created_at timestamptz not null default now(),
  unique (organization_id,entity_type,identifier_type,version)
);

create table public.master_entity_identifiers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  master_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('internal_id','sku','barcode','gtin','supplier_code','marketplace_product_id','external_customer_id','tax_id','email','phone','employee_number','serial_number','asset_tag','provider_id','legacy_id','custom')),
  identifier_value text, normalized_value text, value_hash text,
  source_system text not null, source_scope text not null default '', verified boolean not null default false,
  status text not null default 'active' check (status in ('active','conflict','retired','suppressed')),
  normalization_rule_id uuid references public.master_normalization_rules(id), normalization_version integer not null default 1,
  valid_from timestamptz not null default now(), valid_until timestamptz,
  created_at timestamptz not null default now(),
  check (identifier_value is not null or value_hash is not null)
);

create table public.master_source_profiles (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text not null, entity_type text not null, trust_level smallint not null default 50 check (trust_level between 0 and 100),
  field_precedence jsonb not null default '{}', active boolean not null default true, version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,source_system,entity_type,version)
);

create table public.master_match_rules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, field_name text not null,
  match_type text not null check (match_type in ('exact','normalized_exact','fuzzy','numeric_tolerance','set_overlap','custom_safe')),
  weight numeric(6,2) not null check (weight between 0 and 100), required boolean not null default false,
  normalization_rule text not null, active boolean not null default true, version integer not null default 1,
  auto_link_allowed boolean not null default false, created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  unique (organization_id,entity_type,field_name,version)
);

create table public.master_match_index (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  master_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  entity_type text not null, block_key text not null, token_type text not null,
  token_hash text not null, token_preview text, normalization_version integer not null,
  sensitive boolean not null default false, indexed_at timestamptz not null default now(),
  unique (organization_id,master_entity_id,token_type,token_hash)
);

create table public.master_dedup_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, scope jsonb not null default '{}', rule_version integer not null,
  status text not null default 'queued' check (status in ('queued','running','review_ready','completed','failed','cancelled')),
  candidate_count integer not null default 0, idempotency_key text not null,
  progress jsonb not null default '{}', metrics jsonb not null default '{}', error_message text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
  unique (organization_id,idempotency_key)
);

create table public.master_match_candidates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  dedup_job_id uuid references public.master_dedup_jobs(id) on delete set null,
  entity_a uuid not null references public.master_entity_registry(id) on delete cascade,
  entity_b uuid not null references public.master_entity_registry(id) on delete cascade,
  match_level text not null check (match_level in ('exact','strong','probable','weak','no_match')),
  score numeric(6,2), reasons jsonb not null default '[]', conflicts jsonb not null default '[]',
  recommendation text not null check (recommendation in ('auto_link_identifier','human_review','keep_separate','blocked')),
  status text not null default 'pending' check (status in ('pending','confirmed_match','rejected_match','deferred','merged')),
  rule_version integer not null, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(), check (entity_a <> entity_b),
  unique (organization_id,entity_a,entity_b,rule_version)
);

create table public.master_golden_records (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  master_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  entity_type text not null, golden_version integer not null default 1,
  status text not null default 'generated' check (status in ('generated','review_required','reviewed','stale','superseded')),
  confidence numeric(5,2) check (confidence between 0 and 100), generated_at timestamptz not null default now(),
  reviewed_at timestamptz, reviewed_by uuid references auth.users(id), unique (master_entity_id,golden_version)
);

create table public.master_survivorship_rules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, field_name text not null,
  method text not null check (method in ('trusted_source','most_recent','most_complete','manually_selected','verified_source','domain_precedence','custom_safe_rule')),
  configuration jsonb not null default '{}', version integer not null default 1, active boolean not null default true,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique (organization_id,entity_type,field_name,version)
);

create table public.master_field_values (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  master_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  golden_record_id uuid references public.master_golden_records(id) on delete cascade,
  field_name text not null, resolved_value jsonb not null,
  source_entity_type text not null, source_entity_id text not null, source_system text not null,
  resolution_rule text not null, rule_version integer not null, confidence numeric(5,2),
  manually_locked boolean not null default false, effective_from timestamptz not null default now(), effective_until timestamptz,
  unique (master_entity_id,field_name,effective_from)
);

create table public.master_merges (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, survivor_entity_id uuid not null references public.master_entity_registry(id),
  duplicate_entity_id uuid not null references public.master_entity_registry(id),
  status text not null default 'draft' check (status in ('draft','previewed','approved','executing','completed','completed_with_warning','failed','reversed')),
  requested_by uuid not null references auth.users(id), approved_by uuid references auth.users(id),
  merge_strategy text not null default 'alias_preserve_history' check (merge_strategy in ('alias_preserve_history','domain_delegated','link_only')),
  preview jsonb not null default '{}', preview_hash text, dependency_snapshot jsonb not null default '{}',
  irreversible_effects jsonb not null default '[]', warnings jsonb not null default '[]',
  requires_two_person_approval boolean not null default false, lock_version integer not null default 1,
  idempotency_key text not null, reversible boolean not null default true,
  created_at timestamptz not null default now(), previewed_at timestamptz, completed_at timestamptz, reversed_at timestamptz,
  check (survivor_entity_id <> duplicate_entity_id), unique (organization_id,idempotency_key)
);

create table public.master_entity_aliases (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  alias_entity_type text not null, alias_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  canonical_entity_id uuid not null references public.master_entity_registry(id) on delete restrict,
  created_from_merge uuid references public.master_merges(id), active boolean not null default true,
  created_at timestamptz not null default now(), check (alias_entity_id <> canonical_entity_id),
  unique (organization_id,alias_entity_type,alias_entity_id)
);

create table public.master_data_quality_rules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, field_name text, scope jsonb not null default '{}',
  rule_type text not null check (rule_type in ('required','format','uniqueness','reference_exists','allowed_values','range','consistency','freshness','custom_safe')),
  severity text not null check (severity in ('info','warning','error','critical')),
  condition_config jsonb not null, remediation jsonb not null default '{}', active boolean not null default true,
  version integer not null default 1, published_by uuid references auth.users(id), published_at timestamptz,
  created_at timestamptz not null default now(), unique (organization_id,entity_type,field_name,rule_type,version)
);

create table public.master_data_quality_issues (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  master_entity_id uuid references public.master_entity_registry(id) on delete cascade,
  entity_type text not null, entity_id uuid not null, rule_id uuid not null references public.master_data_quality_rules(id),
  rule_version integer not null, severity text not null check (severity in ('info','warning','error','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','in_progress','resolved','accepted_exception','false_positive')),
  evidence jsonb not null default '{}', detected_at timestamptz not null default now(), resolved_at timestamptz,
  resolution_type text, resolution_reason text, owner_user_id uuid references auth.users(id),
  dedupe_key text not null, unique (organization_id,dedupe_key,status)
);

create table public.master_data_stewardship (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, scope_type text not null check (scope_type in ('store','region','organization','network')),
  scope_ids uuid[] not null default '{}', data_owner_role text, data_steward_role text,
  steward_user_id uuid references auth.users(id), active boolean not null default true,
  created_at timestamptz not null default now(), unique (organization_id,entity_type,scope_type,scope_ids)
);

create table public.master_governance_policies (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_type text not null check (policy_type in ('creation','update','merge','delete_archive','identifier','source_precedence','approval','quality','retention')),
  entity_type text not null, scope jsonb not null default '{}', policy_config jsonb not null,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  version integer not null default 1, status text not null default 'draft' check (status in ('draft','published','retired')),
  published_by uuid references auth.users(id), published_at timestamptz, created_at timestamptz not null default now(),
  unique (organization_id,policy_type,entity_type,version)
);

create table public.master_domain_field_ownership (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, field_name text not null, owning_domain text not null, authoritative_source text not null,
  editable_via_mdm boolean not null default false,
  governance_level text not null default 'standard' check (governance_level in ('standard','controlled','high_risk','domain_only')),
  version integer not null default 1, unique (organization_id,entity_type,field_name,version)
);

create table public.master_data_change_requests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  master_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  requested_field text not null, current_value jsonb, proposed_value jsonb not null, reason text not null,
  requester uuid not null references auth.users(id), destination_domain text not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','applied','cancelled')),
  approved_by uuid references auth.users(id), domain_operation_ref text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.master_data_migration_batches (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text not null, entity_type text not null, source_hash text not null, status text not null default 'preview' check (status in ('preview','validated','running','partial','completed','failed','cancelled')),
  totals jsonb not null default '{}', validation_report jsonb not null default '{}', idempotency_key text not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz,
  unique (organization_id,idempotency_key)
);

create table public.master_id_crosswalks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text not null, source_id text not null, entity_type text not null,
  master_entity_id uuid not null references public.master_entity_registry(id) on delete cascade,
  canonical_entity_id uuid not null, status text not null default 'matched' check (status in ('matched','unmapped','conflict','retired')),
  mapping_confidence numeric(5,2), verified_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,source_system,source_id,entity_type)
);

create table public.master_reconciliation_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  reconciliation_type text not null check (reconciliation_type in ('domain_registry','identifier','crosswalk','analytics','search_index','post_merge')),
  entity_type text, scope jsonb not null default '{}', status text not null default 'queued' check (status in ('queued','running','completed','completed_with_issues','failed','cancelled')),
  findings jsonb not null default '[]', summary jsonb not null default '{}', idempotency_key text not null,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz,
  unique (organization_id,idempotency_key)
);

create table public.master_hierarchy_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  hierarchy_type text not null check (hierarchy_type in ('product','organization','supplier_grouping','custom')),
  source_domain text not null, source_version text not null, effective_from timestamptz not null,
  effective_until timestamptz, snapshot_ref jsonb not null, status text not null default 'active' check (status in ('draft','active','superseded','archived')),
  created_at timestamptz not null default now(), unique (organization_id,hierarchy_type,source_version)
);

create table public.master_audit_events (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid,
  correlation_id uuid not null default gen_random_uuid(), reason text, before_state jsonb, after_state jsonb,
  metadata_redacted jsonb not null default '{}', created_at timestamptz not null default now()
);

-- quality: allow-nonconcurrent-index reason=new-empty-mdm-tables
create unique index master_identifier_active_unique on public.master_entity_identifiers(organization_id,identifier_type,source_system,source_scope,coalesce(normalized_value,value_hash)) where status='active';
create index master_registry_lookup_idx on public.master_entity_registry(organization_id,entity_type,status,canonical_entity_id);
create index master_source_lookup_idx on public.master_source_records(organization_id,source_system,source_entity_type,source_entity_id);
create index master_identifier_resolve_idx on public.master_entity_identifiers(organization_id,identifier_type,source_system,source_scope,normalized_value) where status='active';
create index master_identifier_hash_idx on public.master_entity_identifiers(organization_id,identifier_type,value_hash) where status='active';
create index master_match_block_idx on public.master_match_index(organization_id,entity_type,block_key,token_hash);
create index master_candidate_queue_idx on public.master_match_candidates(organization_id,status,match_level,score desc);
create index master_quality_queue_idx on public.master_data_quality_issues(organization_id,status,severity,detected_at desc);
create index master_merge_queue_idx on public.master_merges(organization_id,status,created_at desc);
create index master_crosswalk_resolve_idx on public.master_id_crosswalks(organization_id,source_system,entity_type,source_id) where status='matched';
create index master_audit_entity_idx on public.master_audit_events(organization_id,entity_type,entity_id,created_at desc);

create or replace function mdm_private.org_allowed(org uuid, permission_name text default 'mdm:view')
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=(select auth.uid()) and m.active and (m.role in('owner','admin','manager','supervisor') or exists(select 1 from public.mdm_member_permissions p where p.organization_id=org and p.user_id=(select auth.uid()) and p.active and permission_name=any(p.permissions))))$$;

create or replace function mdm_private.resolve_canonical(requested_organization uuid, requested_entity_type text, requested_entity_id uuid)
returns uuid language sql stable security definer set search_path=''
as $$
  with recursive chain(id,path,depth) as (
    select requested_entity_id,array[requested_entity_id],0
    union all
    select a.canonical_entity_id,c.path||a.canonical_entity_id,c.depth+1
    from chain c join public.master_entity_aliases a on a.organization_id=requested_organization and a.alias_entity_type=requested_entity_type and a.alias_entity_id=c.id and a.active
    where c.depth<32 and not a.canonical_entity_id=any(c.path)
  ) select id from chain order by depth desc limit 1
$$;

create or replace function mdm_private.prevent_alias_cycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare resolved uuid;
begin
  if new.alias_entity_id=new.canonical_entity_id then raise exception 'MDM_ALIAS_SELF_REFERENCE'; end if;
  resolved:=mdm_private.resolve_canonical(new.organization_id,new.alias_entity_type,new.canonical_entity_id);
  if resolved=new.alias_entity_id then raise exception 'MDM_ALIAS_CYCLE'; end if;
  if not exists(select 1 from public.master_entity_registry e where e.id=new.alias_entity_id and e.organization_id=new.organization_id and e.entity_type=new.alias_entity_type) then raise exception 'MDM_ALIAS_SCOPE_MISMATCH'; end if;
  if not exists(select 1 from public.master_entity_registry e where e.id=new.canonical_entity_id and e.organization_id=new.organization_id and e.entity_type=new.alias_entity_type) then raise exception 'MDM_CANONICAL_SCOPE_MISMATCH'; end if;
  return new;
end$$;

create trigger master_entity_alias_cycle_guard before insert or update on public.master_entity_aliases for each row execute function mdm_private.prevent_alias_cycle();

create sequence if not exists public.master_entity_key_seq;
revoke all on sequence public.master_entity_key_seq from public,anon,authenticated;
grant usage,select on sequence public.master_entity_key_seq to service_role;

create or replace function public.mdm_register_master_entity(requested_organization uuid, requested_entity_type text, requested_canonical_id uuid, requested_source_system text default 'masterapp')
returns public.master_entity_registry language plpgsql security definer set search_path='' as $$
declare result public.master_entity_registry; prefix text; seq bigint;
begin
  if requested_entity_type not in ('product','ingredient','supplier','customer','store','employee','asset','carrier','warehouse','address','custom') then raise exception 'MDM_ENTITY_TYPE_INVALID'; end if;
  select * into result from public.master_entity_registry where organization_id=requested_organization and entity_type=requested_entity_type and canonical_entity_id=requested_canonical_id;
  if found then return result; end if;
  prefix:=case requested_entity_type when 'product' then 'PROD' when 'ingredient' then 'INGR' when 'supplier' then 'SUPP' when 'customer' then 'CUST' when 'store' then 'STORE' when 'employee' then 'EMPL' when 'asset' then 'ASSET' when 'carrier' then 'CARR' when 'warehouse' then 'WHSE' when 'address' then 'ADDR' else 'CUSTM' end;
  seq:=nextval('public.master_entity_key_seq');
  insert into public.master_entity_registry(organization_id,entity_type,canonical_entity_id,master_key) values(requested_organization,requested_entity_type,requested_canonical_id,'MDM-'||prefix||'-'||lpad(seq::text,12,'0')) returning * into result;
  insert into public.master_source_records(organization_id,master_entity_id,source_system,source_entity_type,source_entity_id) values(requested_organization,result.id,requested_source_system,requested_entity_type,requested_canonical_id::text) on conflict do nothing;
  return result;
end$$;

create or replace function public.mdm_execute_alias_merge(requested_organization uuid, requested_merge_id uuid, requested_actor uuid, requested_preview_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.master_merges; existing uuid;
begin
  perform pg_advisory_xact_lock(hashtext(requested_merge_id::text));
  select * into m from public.master_merges where id=requested_merge_id and organization_id=requested_organization for update;
  if not found then raise exception 'MDM_MERGE_NOT_FOUND'; end if;
  if m.status in ('completed','completed_with_warning') then return jsonb_build_object('status',m.status,'idempotent',true); end if;
  if m.status<>'approved' or m.preview_hash is distinct from requested_preview_hash then raise exception 'MDM_MERGE_PREVIEW_STALE_OR_UNAPPROVED'; end if;
  if m.entity_type='customer' then raise exception 'MDM_CUSTOMER_MERGE_DELEGATE_CUSTOMER360'; end if;
  select mdm_private.resolve_canonical(requested_organization,m.entity_type,m.survivor_entity_id) into existing;
  if existing=m.duplicate_entity_id then raise exception 'MDM_ALIAS_CYCLE'; end if;
  update public.master_merges set status='executing',lock_version=lock_version+1 where id=m.id;
  insert into public.master_entity_aliases(organization_id,alias_entity_type,alias_entity_id,canonical_entity_id,created_from_merge) values(requested_organization,m.entity_type,m.duplicate_entity_id,existing,m.id)
  on conflict(organization_id,alias_entity_type,alias_entity_id) do update set canonical_entity_id=excluded.canonical_entity_id,created_from_merge=excluded.created_from_merge,active=true;
  update public.master_entity_registry set status='merged',updated_at=now() where id=m.duplicate_entity_id and organization_id=requested_organization;
  update public.master_merges set status='completed',completed_at=now() where id=m.id;
  insert into public.master_audit_events(organization_id,actor_user_id,action,entity_type,entity_id,reason,after_state) values(requested_organization,requested_actor,'merge_completed',m.entity_type,m.id,'Alias canônico criado sem apagar o registro fonte.',jsonb_build_object('survivor',existing,'duplicate',m.duplicate_entity_id,'historical_rows_rewritten',false));
  return jsonb_build_object('status','completed','canonical_entity_id',existing,'alias_entity_id',m.duplicate_entity_id,'historical_rows_rewritten',false);
end$$;

create or replace function public.mdm_reverse_alias_merge(requested_organization uuid, requested_merge_id uuid, requested_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.master_merges;
begin
  perform pg_advisory_xact_lock(hashtext(requested_merge_id::text));
  select * into m from public.master_merges where id=requested_merge_id and organization_id=requested_organization for update;
  if not found then raise exception 'MDM_MERGE_NOT_FOUND'; end if;
  if m.status='reversed' then return jsonb_build_object('status','reversed','idempotent',true); end if;
  if m.status not in ('completed','completed_with_warning') or not m.reversible or jsonb_array_length(m.irreversible_effects)>0 then raise exception 'MDM_MERGE_NOT_REVERSIBLE'; end if;
  update public.master_entity_aliases set active=false where organization_id=requested_organization and created_from_merge=m.id;
  update public.master_entity_registry set status='active',updated_at=now() where id=m.duplicate_entity_id and organization_id=requested_organization;
  update public.master_merges set status='reversed',reversed_at=now() where id=m.id;
  insert into public.master_audit_events(organization_id,actor_user_id,action,entity_type,entity_id,reason,after_state) values(requested_organization,requested_actor,'merge_reversed',m.entity_type,m.id,'Alias desativado; histórico do merge preservado.',jsonb_build_object('duplicate_reactivated',m.duplicate_entity_id));
  return jsonb_build_object('status','reversed','duplicate_entity_id',m.duplicate_entity_id,'history_preserved',true);
end$$;

revoke all on function mdm_private.org_allowed(uuid,text) from public,anon;
revoke all on function mdm_private.resolve_canonical(uuid,text,uuid) from public,anon,authenticated;
revoke all on function mdm_private.prevent_alias_cycle() from public,anon,authenticated;
revoke all on function public.mdm_register_master_entity(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.mdm_execute_alias_merge(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.mdm_reverse_alias_merge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function mdm_private.org_allowed(uuid,text) to authenticated,service_role;
grant execute on function mdm_private.resolve_canonical(uuid,text,uuid) to service_role;
grant execute on function public.mdm_register_master_entity(uuid,text,uuid,text) to service_role;
grant execute on function public.mdm_execute_alias_merge(uuid,uuid,uuid,text) to service_role;
grant execute on function public.mdm_reverse_alias_merge(uuid,uuid,uuid) to service_role;

do $$declare t text;begin foreach t in array array[
  'mdm_member_permissions','master_entity_registry','master_source_records','master_normalization_rules','master_entity_identifiers','master_source_profiles','master_match_rules','master_match_index','master_dedup_jobs','master_match_candidates','master_golden_records','master_survivorship_rules','master_field_values','master_merges','master_entity_aliases','master_data_quality_rules','master_data_quality_issues','master_data_stewardship','master_governance_policies','master_domain_field_ownership','master_data_change_requests','master_data_migration_batches','master_id_crosswalks','master_reconciliation_runs','master_hierarchy_versions','master_audit_events'
] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;

create policy master_registry_read on public.master_entity_registry for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:view')));
create policy master_identifiers_read on public.master_entity_identifiers for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:view_identifiers')));
create policy master_sources_read on public.master_source_records for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:view_lineage')));
create policy master_candidates_read on public.master_match_candidates for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:review_duplicates')));
create policy master_quality_read on public.master_data_quality_issues for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:view_quality')));
create policy master_merges_read on public.master_merges for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:merge')));
create policy master_golden_read on public.master_golden_records for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:view')));
create policy master_fields_read on public.master_field_values for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:view_lineage')));
create policy master_crosswalks_read on public.master_id_crosswalks for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:view_identifiers')));
create policy master_reconciliation_read on public.master_reconciliation_runs for select to authenticated using ((select mdm_private.org_allowed(organization_id,'mdm:run_reconciliation')));

create or replace view public.mdm_quality_overview with (security_invoker=true) as
select organization_id,entity_type,count(*) filter(where status in('open','acknowledged','in_progress')) as open_issues,
count(*) filter(where status in('open','acknowledged','in_progress') and severity='critical') as critical_issues,
count(*) filter(where status='resolved') as resolved_issues,
min(detected_at) filter(where status in('open','acknowledged','in_progress')) as oldest_open_at
from public.master_data_quality_issues group by organization_id,entity_type;
revoke all on public.mdm_quality_overview from public,anon,authenticated;
grant select on public.mdm_quality_overview to service_role;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,certified,sensitive,allowed_dimensions) values
('mdm_duplicate_candidate_count','Duplicate Candidate Count','Candidatos de duplicidade ainda pendentes de decisão humana.','count(master_match_candidates where status=pending)','master_match_candidates','organization/entity_type','Data Governance','hourly','count','fact',true,false,array['organization','entity_type','match_level','source_system']),
('mdm_critical_quality_issue_count','Critical Data Quality Issue Count','Problemas críticos de qualidade ainda abertos.','count(master_data_quality_issues where severity=critical and status open)','master_data_quality_issues','organization/entity_type','Data Governance','hourly','count','fact',true,true,array['organization','entity_type','severity','source_system']),
('mdm_unmapped_external_identifier_count','Unmapped External Identifier Count','Identificadores externos ainda sem vínculo canônico.','count(master_id_crosswalks where status=unmapped)','master_id_crosswalks','organization/source/entity_type','Integration Governance','hourly','count','fact',true,false,array['organization','entity_type','source_system']),
('mdm_master_data_completeness_rate','Master Data Completeness Rate','Percentual transparente de regras required atendidas.','passed required checks / evaluated required checks','master_data_quality_issues','organization/entity_type','Data Governance','daily','percent','calculation',true,false,array['organization','entity_type','source_system'])
on conflict(metric_key) do update set description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,grain=excluded.grain,owner_label=excluded.owner_label,refresh_frequency=excluded.refresh_frequency,unit=excluded.unit,evidence_class=excluded.evidence_class,certified=excluded.certified,sensitive=excluded.sensitive,allowed_dimensions=excluded.allowed_dimensions,updated_at=now();

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position,customer_visible) values
('master-data','Dados Mestres','/painel/dados-mestres',array['mdm','dados mestres','duplicidades','golden record','identificadores','qualidade'],'master_data','search:global','◈',76,true)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,icon=excluded.icon,position=excluded.position,customer_visible=true;

insert into public.search_command_registry(id,title,description,keywords,command_type,route,action_type,required_permission,risk_level,scope,position) values
('mdm-review-duplicates','Revisar duplicidades','Abrir a fila explicável de possíveis duplicidades.',array['duplicidade','merge','matching'],'navigation','/painel/dados-mestres?tab=duplicidades',null,'search:global','low','organization',76),
('mdm-data-quality','Ver problemas de dados','Abrir a Central de Qualidade dos dados mestres.',array['qualidade','cadastro','problema'],'navigation','/painel/dados-mestres?tab=qualidade',null,'search:global','low','organization',77),
('mdm-resolve-identifier','Resolver identificador externo','Buscar SKU, código de barras, código legado ou ID externo.',array['sku','barcode','código externo','legado'],'navigation','/painel/dados-mestres?tab=identificadores',null,'search:global','low','organization',78)
on conflict(id) do update set title=excluded.title,description=excluded.description,keywords=excluded.keywords,route=excluded.route,required_permission=excluded.required_permission,risk_level=excluded.risk_level,position=excluded.position;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,size_options,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('mdm_quality_summary','Qualidade de Dados Mestres','Visão transparente dos problemas de qualidade abertos.','governance','metric_card','["small","medium"]','{mdm:view_quality}','{store,network}','mdm:quality','5m','{}','{}','/painel/dados-mestres?tab=qualidade',true,false),
('mdm_duplicate_review_queue','Revisão de Duplicidades','Fila de candidatos que exige decisão humana.','governance','status_list','["medium","large"]','{mdm:review_duplicates}','{store,network}','mdm:duplicates','1m','{}','{}','/painel/dados-mestres?tab=duplicidades',false,true),
('mdm_reconciliation_status','Reconciliação MDM','Status das reconciliações entre domínios e registro mestre.','governance','status_list','["medium","large"]','{mdm:run_reconciliation}','{store,network}','mdm:reconciliation','5m','{}','{}','/painel/dados-mestres?tab=reconciliação',true,false)
on conflict(id) do update set description=excluded.description,required_permissions=excluded.required_permissions,data_source=excluded.data_source,route=excluded.route,active=true,updated_at=now();
