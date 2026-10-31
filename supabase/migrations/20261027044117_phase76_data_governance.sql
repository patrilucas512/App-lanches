-- Phase 76 - Enterprise Data Governance and Reliability
-- Metadata only: Data Platform (Phase 34), MDM (Phase 75), semantic metrics and Incident Management remain authoritative.

create schema if not exists data_governance_private;
revoke all on schema data_governance_private from public, anon, authenticated;
grant usage on schema data_governance_private to service_role;

alter table public.plans add column if not exists data_catalog_enabled boolean not null default true;
alter table public.plans add column if not exists data_contracts_enabled boolean not null default true;
alter table public.plans add column if not exists data_lineage_enabled boolean not null default true;
alter table public.plans add column if not exists data_observability_enabled boolean not null default true;
alter table public.plans add column if not exists data_products_enabled boolean not null default false;
alter table public.plans add column if not exists data_governance_ai_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists data_catalog_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists data_contracts_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists data_lineage_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists data_observability_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists data_products_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists data_governance_ai_enabled boolean not null default false;

create table public.data_governance_member_permissions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, permissions text[] not null default '{}', scope_type text not null default 'organization' check(scope_type in('store','region','organization','network')),
 scope_ids uuid[] not null default '{}', active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(organization_id,user_id)
);
create table public.data_domains(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 domain_key text not null, name text not null, description text, business_owner_id uuid references auth.users(id), technical_owner_id uuid references auth.users(id), steward_id uuid references auth.users(id),
 status text not null default 'active' check(status in('draft','active','deprecated','retired')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,domain_key)
);
create table public.data_assets(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, domain_id uuid references public.data_domains(id) on delete set null,
 asset_type text not null check(asset_type in('table','view','materialized_view','dataset','fact','dimension','metric','pipeline','api','event','webhook','file_feed','report','dashboard','model','custom')),
 system_name text not null, logical_name text not null, description text, domain text not null, owner_type text, owner_id uuid, steward_id uuid references auth.users(id),
 sensitivity text not null default 'internal' check(sensitivity in('public_internal','internal','restricted','confidential','personal_data','financial','custom')),
 criticality text not null default 'medium' check(criticality in('low','medium','high','critical')), lifecycle_status text not null default 'draft' check(lifecycle_status in('draft','active','deprecated','retired')),
 source_system text not null, external_ref text, auto_discovered boolean not null default false, discovery_confidence numeric(5,2), metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,source_system,system_name)
);
create table public.data_asset_fields(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 field_name text not null, data_type text not null, nullable boolean not null default true, description text, sensitivity text not null default 'internal', business_term_id uuid, source_field_ref text,
 status text not null default 'active' check(status in('active','deprecated','removed')), ordinal_position integer, generated_description_draft text, updated_at timestamptz not null default now(), unique(asset_id,field_name)
);
create table public.data_asset_ownership(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 ownership_type text not null check(ownership_type in('technical_owner','business_owner','data_steward','security_owner')), owner_role_or_user text not null,
 effective_from timestamptz not null default now(), effective_until timestamptz, created_at timestamptz not null default now()
);
create table public.data_glossary_terms(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, domain_id uuid references public.data_domains(id) on delete set null,
 term text not null, definition text not null, examples text, synonyms text[] not null default '{}', status text not null default 'draft' check(status in('draft','under_review','approved','deprecated','rejected')),
 business_owner_id uuid references auth.users(id), reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,term)
);
alter table public.data_asset_fields add constraint data_asset_fields_business_term_fk foreign key(business_term_id) references public.data_glossary_terms(id) on delete set null;
create table public.data_glossary_conflicts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, candidate_term_id uuid not null references public.data_glossary_terms(id) on delete cascade,
 conflicting_term_id uuid not null references public.data_glossary_terms(id) on delete cascade, conflict_type text not null, evidence jsonb not null default '{}', status text not null default 'open' check(status in('open','resolved','dismissed')),
 resolution text, reviewed_by uuid references auth.users(id), created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.data_metric_governance(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid references public.data_assets(id) on delete cascade,
 metric_key text not null, semantic_metric_key text not null, business_term_id uuid references public.data_glossary_terms(id) on delete set null, owner_id uuid references auth.users(id),
 status text not null default 'draft' check(status in('draft','review','official','deprecated')), approved_by uuid references auth.users(id), approved_at timestamptz, metadata jsonb not null default '{}', unique(organization_id,metric_key)
);
create table public.data_contracts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 name text not null, contract_type text not null check(contract_type in('table','event','api','file','metric','custom')), compatibility_mode text not null default 'backward' check(compatibility_mode in('backward','forward','full','none')),
 owner_id uuid references auth.users(id), status text not null default 'draft' check(status in('draft','review','active','deprecated','retired')), current_version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name)
);
create table public.data_contract_versions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, contract_id uuid not null references public.data_contracts(id) on delete cascade,
 version integer not null, schema_definition jsonb not null default '{}', schema_hash text not null, quality_expectations jsonb not null default '[]', producer_slo jsonb not null default '{}', change_summary text,
 status text not null default 'draft' check(status in('draft','review','published','superseded','rejected')), created_by uuid references auth.users(id), approved_by uuid references auth.users(id), published_at timestamptz, created_at timestamptz not null default now(), unique(contract_id,version), unique(contract_id,schema_hash)
);
create table public.data_contract_fields(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, contract_version_id uuid not null references public.data_contract_versions(id) on delete cascade,
 field_name text not null, data_type text not null, required boolean not null default false, nullable boolean not null default true, description text, allowed_values jsonb, safe_constraints jsonb not null default '{}', sensitivity text not null default 'internal', unique(contract_version_id,field_name)
);
create table public.data_schema_snapshots(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 schema_version integer not null, schema_definition jsonb not null, schema_hash text not null, source text not null, captured_at timestamptz not null default now(), captured_by uuid references auth.users(id), unique(asset_id,schema_version), unique(asset_id,schema_hash)
);
create table public.data_schema_changes(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 before_snapshot_id uuid references public.data_schema_snapshots(id), after_snapshot_id uuid references public.data_schema_snapshots(id), classification text not null check(classification in('no_change','non_breaking','potentially_breaking','breaking')),
 changes jsonb not null default '[]', affected_consumers integer not null default 0, status text not null default 'detected' check(status in('detected','review','approved','rejected','deployed','rolled_back','waived')),
 reason text, pull_request_url text, deployment_ref text, reviewed_by uuid references auth.users(id), created_at timestamptz not null default now(), reviewed_at timestamptz
);
create table public.data_lineage_edges(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, source_asset_id uuid not null references public.data_assets(id) on delete cascade, target_asset_id uuid not null references public.data_assets(id) on delete cascade,
 source_field text, target_field text, relationship_type text not null check(relationship_type in('reads_from','writes_to','transforms','derives','publishes','consumes','joins','aggregates','copies','references','semantic_mapping')),
 lineage_kind text not null default 'technical' check(lineage_kind in('technical','conceptual')), confidence text not null default 'declared' check(confidence in('declared','inferred')),
 evidence jsonb not null default '{}', sensitive boolean not null default false, active boolean not null default true, created_at timestamptz not null default now(), check(source_asset_id<>target_asset_id), unique(organization_id,source_asset_id,target_asset_id,relationship_type,source_field,target_field)
);
create table public.data_consumers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 consumer_type text not null check(consumer_type in('service','pipeline','dashboard','report','api','event','integration','team','external')), consumer_ref text not null, owner_ref text,
 contract_version integer, status text not null default 'active' check(status in('active','migration_required','acknowledged','migrated','retired')), last_seen_at timestamptz, created_at timestamptz not null default now(), unique(organization_id,asset_id,consumer_type,consumer_ref)
);
create table public.data_change_requests(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 change_type text not null, proposed_schema jsonb, reason text not null, criticality text not null default 'medium', breaking boolean not null default false, impact_summary jsonb not null default '{}',
 status text not null default 'draft' check(status in('draft','submitted','impact_review','approved','rejected','scheduled','deployed','verified','rolled_back','cancelled')),
 deprecation_deadline timestamptz, exception_expires_at timestamptz, requester_id uuid references auth.users(id), reviewer_id uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.data_observability_checks(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 check_type text not null check(check_type in('freshness','volume','null_rate','uniqueness','referential_integrity','distribution_drift','schema_drift','contract_validation')),
 configuration jsonb not null default '{}', warning_threshold numeric, critical_threshold numeric, schedule text, severity text not null default 'warning', active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.data_observability_results(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, check_id uuid not null references public.data_observability_checks(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade,
 status text not null check(status in('healthy','warning','critical','unknown','failed')), measured_value numeric, evidence jsonb not null default '{}', started_at timestamptz not null default now(), completed_at timestamptz, correlation_id uuid, dedup_key text
);
create table public.data_incidents(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, asset_id uuid not null references public.data_assets(id) on delete cascade, check_result_id uuid references public.data_observability_results(id),
 incident_type text not null check(incident_type in('freshness','quality','schema_drift','contract','pipeline','availability','other')), severity text not null check(severity in('SEV1','SEV2','SEV3','SEV4')),
 status text not null default 'candidate' check(status in('candidate','confirmed','investigating','monitoring','resolved','closed','false_positive')), impact_evidence jsonb not null default '{}',
 phase59_incident_id uuid, dedup_key text not null, created_at timestamptz not null default now(), resolved_at timestamptz, unique(organization_id,dedup_key)
);
create table public.data_contract_exceptions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, contract_id uuid not null references public.data_contracts(id) on delete cascade,
 change_request_id uuid references public.data_change_requests(id), reason text not null, scope jsonb not null default '{}', expires_at timestamptz not null, status text not null default 'requested' check(status in('requested','approved','rejected','expired','revoked')),
 requested_by uuid references auth.users(id), approved_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.data_products(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, description text, owner_id uuid references auth.users(id),
 domain_id uuid references public.data_domains(id), asset_ids uuid[] not null default '{}', contract_ids uuid[] not null default '{}', slo_definition jsonb not null default '{}', lifecycle_status text not null default 'draft', feature_flag_required boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name)
);
create table public.data_governance_audit_events(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, actor_user_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid,
 reason text, before_state jsonb, after_state jsonb, correlation_id uuid not null default gen_random_uuid(), metadata_redacted jsonb not null default '{}', created_at timestamptz not null default now()
);

create index data_assets_catalog_idx on public.data_assets(organization_id,domain,asset_type,lifecycle_status);
create index data_assets_name_idx on public.data_assets(organization_id,system_name,logical_name);
create index data_asset_fields_asset_idx on public.data_asset_fields(asset_id,field_name);
create index data_lineage_source_idx on public.data_lineage_edges(organization_id,source_asset_id) where active;
create index data_lineage_target_idx on public.data_lineage_edges(organization_id,target_asset_id) where active;
create index data_consumers_asset_idx on public.data_consumers(organization_id,asset_id,status);
create index data_observability_results_idx on public.data_observability_results(organization_id,asset_id,started_at desc);
create index data_incidents_open_idx on public.data_incidents(organization_id,status,severity) where status not in('closed','false_positive');
create index data_schema_changes_idx on public.data_schema_changes(organization_id,status,classification,created_at desc);

create or replace function data_governance_private.org_allowed(org uuid, permission_name text default 'data_governance:view')
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=(select auth.uid()) and m.active and (m.role in('owner','admin','manager','supervisor') or exists(select 1 from public.data_governance_member_permissions p where p.organization_id=org and p.user_id=(select auth.uid()) and p.active and permission_name=any(p.permissions))))$$;
revoke all on function data_governance_private.org_allowed(uuid,text) from public,anon;
grant execute on function data_governance_private.org_allowed(uuid,text) to authenticated,service_role;

create or replace function data_governance_private.queue_catalog_search()
returns trigger language plpgsql set search_path='' as $$
declare title text; subtitle text; route text; keywords text[]; sensitivity text; source_updated timestamptz; asset public.data_assets;
begin
 if tg_table_name='data_assets' then
  title:=new.logical_name; subtitle:=new.asset_type||' · '||new.domain; route:='/painel/governanca-dados?asset='||new.id::text; keywords:=array[new.system_name,new.domain,new.asset_type]; sensitivity:=new.sensitivity; source_updated:=new.updated_at;
 elsif tg_table_name='data_asset_fields' then
  select * into asset from public.data_assets where id=new.asset_id and organization_id=new.organization_id;
  title:=coalesce(asset.logical_name,asset.system_name)||' · '||new.field_name; subtitle:='Campo · '||new.data_type; route:='/painel/governanca-dados?asset='||new.asset_id::text||'&field='||new.id::text; keywords:=array[new.field_name,new.data_type,coalesce(asset.domain,'')]; sensitivity:=new.sensitivity; source_updated:=new.updated_at;
 elsif tg_table_name='data_glossary_terms' then
  title:=new.term; subtitle:='Glossário de negócio · '||new.status; route:='/painel/governanca-dados?term='||new.id::text; keywords:=new.synonyms; sensitivity:='internal'; source_updated:=new.updated_at;
 else
  title:=new.metric_key; subtitle:='Métrica semântica · '||new.status; route:='/painel/governanca-dados?metric='||new.id::text; keywords:=array[new.semantic_metric_key]; sensitivity:='internal'; source_updated:=coalesce(new.approved_at,new.created_at);
 end if;
 insert into public.search_index_jobs(organization_id,entity_type,entity_id,operation,payload_hint,priority,correlation_id,idempotency_key)
 values(new.organization_id,case tg_table_name when 'data_assets' then 'data_asset' when 'data_asset_fields' then 'data_field' when 'data_glossary_terms' then 'glossary_term' else 'semantic_metric' end,new.id::text,'upsert',jsonb_build_object('document',jsonb_build_object('entity_id',new.id::text,'title',title,'subtitle',subtitle,'searchable_text',title||' '||subtitle||' '||array_to_string(keywords,' '),'keywords',to_jsonb(keywords),'route',route,'icon','⌘','metadata',jsonb_build_object('module','data_governance'),'sensitivity',case when sensitivity in('restricted','confidential','personal_data','financial') then 'confidential' else 'normal' end,'required_permission','search:global','source_updated_at',source_updated)),60,gen_random_uuid()::text,tg_table_name||':'||new.id::text||':'||extract(epoch from source_updated)::bigint::text)
 on conflict(organization_id,idempotency_key) do nothing;
 return new;
end$$;
revoke all on function data_governance_private.queue_catalog_search() from public,anon,authenticated;
create trigger data_assets_search_queue after insert or update of logical_name,system_name,description,domain,lifecycle_status on public.data_assets for each row execute function data_governance_private.queue_catalog_search();
create trigger data_fields_search_queue after insert or update of field_name,description,status on public.data_asset_fields for each row execute function data_governance_private.queue_catalog_search();
create trigger data_glossary_search_queue after insert or update of term,definition,synonyms,status on public.data_glossary_terms for each row execute function data_governance_private.queue_catalog_search();
create trigger data_metrics_search_queue after insert or update of metric_key,status on public.data_metric_governance for each row execute function data_governance_private.queue_catalog_search();

do $$declare t text;begin foreach t in array array['data_governance_member_permissions','data_domains','data_assets','data_asset_fields','data_asset_ownership','data_glossary_terms','data_glossary_conflicts','data_metric_governance','data_contracts','data_contract_versions','data_contract_fields','data_schema_snapshots','data_schema_changes','data_lineage_edges','data_consumers','data_change_requests','data_observability_checks','data_observability_results','data_incidents','data_contract_exceptions','data_products','data_governance_audit_events'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t);
end loop;end$$;

create policy data_assets_read on public.data_assets for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_fields_read on public.data_asset_fields for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_domains_read on public.data_domains for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_glossary_read on public.data_glossary_terms for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_contracts_read on public.data_contracts for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_contract_versions_read on public.data_contract_versions for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_lineage_read on public.data_lineage_edges for select to authenticated using((select data_governance_private.org_allowed(organization_id,case when sensitive then 'data_governance:view_sensitive' else 'data_governance:view' end)));
create policy data_quality_read on public.data_observability_results for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_incidents_read on public.data_incidents for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));
create policy data_changes_read on public.data_schema_changes for select to authenticated using((select data_governance_private.org_allowed(organization_id,'data_governance:view')));

create or replace view public.data_governance_health_overview with(security_invoker=true) as
select a.organization_id,a.id asset_id,a.logical_name,a.criticality,a.lifecycle_status,
 coalesce((select r.status from public.data_observability_results r where r.asset_id=a.id order by r.started_at desc limit 1),'unknown') latest_health,
 (select count(*) from public.data_incidents i where i.asset_id=a.id and i.status not in('closed','false_positive')) open_incidents,
 (select max(s.captured_at) from public.data_schema_snapshots s where s.asset_id=a.id) last_schema_snapshot_at
from public.data_assets a;
revoke all on public.data_governance_health_overview from public,anon,authenticated;
grant select on public.data_governance_health_overview to service_role;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,certified,sensitive,allowed_dimensions) values
('data_asset_count','Data Asset Count','Ativos de dados registrados por domínio e tipo.','count(data_assets)','data_assets','organization/domain/asset_type','Data Governance','hourly','count','fact',true,false,array['organization','domain','asset_type','criticality']),
('data_freshness_slo_rate','Data Freshness SLO Rate','Proporção transparente de checks de freshness saudáveis.','healthy freshness checks / completed freshness checks','data_observability_results','organization/asset/day','Data Reliability','hourly','percent','calculation',true,false,array['organization','domain','criticality']),
('data_breaking_change_count','Data Breaking Change Count','Breaking changes detectadas no período.','count(data_schema_changes where classification=breaking)','data_schema_changes','organization/day','Data Governance','hourly','count','fact',true,true,array['organization','domain','status']),
('data_incident_mttr','Data Incident MTTR','Tempo médio entre confirmação e resolução de incidentes de dados.','avg(resolved_at-created_at)','data_incidents','organization/severity/month','Data Reliability','daily','minutes','calculation',true,true,array['organization','severity','incident_type'])
on conflict(metric_key) do update set description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,grain=excluded.grain,owner_label=excluded.owner_label,refresh_frequency=excluded.refresh_frequency,unit=excluded.unit,evidence_class=excluded.evidence_class,certified=excluded.certified,sensitive=excluded.sensitive,allowed_dimensions=excluded.allowed_dimensions,updated_at=now();

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position,customer_visible) values
('data-governance','Governança de Dados','/painel/governanca-dados',array['dados','catálogo','contratos','lineage','linhagem','qualidade','freshness','schema'],'data_governance','search:global','⌘',77,true)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,icon=excluded.icon,position=excluded.position,customer_visible=true;
