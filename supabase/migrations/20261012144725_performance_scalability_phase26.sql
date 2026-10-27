-- Phase 26: measured performance, resilient jobs, observability and safe degradation.
-- The initial targets below are explicitly derived from the 24h baseline captured on 2026-10-12.

alter table public.plans
  add column if not exists advanced_observability_enabled boolean not null default false,
  add column if not exists performance_dashboard_enabled boolean not null default false,
  add column if not exists load_testing_enabled boolean not null default false,
  add column if not exists degraded_mode_enabled boolean not null default false;

create table if not exists public.performance_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  environment text not null default 'production',
  release_version text not null,
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  request_count bigint not null default 0,
  requests_per_second numeric(14,4),
  p50_ms numeric(14,2), p95_ms numeric(14,2), p99_ms numeric(14,2),
  error_rate_percent numeric(9,4), database_latency_ms numeric(14,2),
  queue_latency_ms numeric(14,2), cache_hit_percent numeric(9,4),
  websocket_connections integer, cpu_percent numeric(9,4), memory_percent numeric(9,4),
  worker_throughput_per_minute numeric(14,2), source text not null default 'measured',
  metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  check(window_ended_at>window_started_at)
);
create index if not exists performance_baselines_org_window_idx on public.performance_baselines(organization_id,window_ended_at desc);

create table if not exists public.performance_slos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  service_key text not null, sli_key text not null,
  target_operator text not null check(target_operator in('gte','lte')),
  target_value numeric(14,4) not null, unit text not null,
  evaluation_window text not null default '30d', error_budget_percent numeric(9,4),
  baseline_id uuid references public.performance_baselines(id) on delete set null,
  derivation text not null, enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique nulls not distinct(organization_id,service_key,sli_key)
);

create table if not exists public.observability_metrics (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  service_key text not null, metric_key text not null, value numeric(18,6) not null,
  unit text not null, dimensions jsonb not null default '{}',
  correlation_id text, release_version text, recorded_at timestamptz not null default now()
);
create index if not exists observability_metrics_service_time_idx on public.observability_metrics(service_key,metric_key,recorded_at desc);
create index if not exists observability_metrics_tenant_time_idx on public.observability_metrics(organization_id,recorded_at desc) where organization_id is not null;

create table if not exists public.observability_trace_spans (
  id uuid primary key default gen_random_uuid(), trace_id text not null, span_id text not null,
  parent_span_id text, organization_id uuid references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  service_key text not null, operation text not null,
  status text not null default 'ok' check(status in('ok','error','timeout','cancelled')),
  started_at timestamptz not null, ended_at timestamptz, duration_ms integer,
  correlation_id text not null, release_version text, sampled boolean not null default true,
  attributes jsonb not null default '{}', error_code text,
  unique(trace_id,span_id)
);
create index if not exists observability_spans_trace_idx on public.observability_trace_spans(trace_id,started_at);
create index if not exists observability_spans_service_time_idx on public.observability_trace_spans(service_key,started_at desc);

create table if not exists public.operational_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  queue_name text not null default 'default', job_type text not null,
  priority text not null default 'normal' check(priority in('critical','high','normal','low','batch')),
  status text not null default 'queued' check(status in('queued','leased','retry_scheduled','completed','dead_letter','cancelled')),
  payload jsonb not null default '{}', result jsonb,
  idempotency_key text not null, correlation_id text not null default gen_random_uuid()::text,
  attempt_count integer not null default 0, max_attempts integer not null default 5 check(max_attempts between 1 and 20),
  available_at timestamptz not null default now(), leased_at timestamptz,
  lease_expires_at timestamptz, leased_by text, timeout_seconds integer not null default 60 check(timeout_seconds between 1 and 3600),
  last_error_code text, last_error_message text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create unique index if not exists operational_jobs_idempotency_idx on public.operational_jobs(coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),job_type,idempotency_key);
create index if not exists operational_jobs_claim_idx on public.operational_jobs(queue_name,status,priority,available_at,created_at) where status in('queued','retry_scheduled');
create index if not exists operational_jobs_tenant_status_idx on public.operational_jobs(organization_id,status,created_at desc);

create table if not exists public.operational_dead_letters (
  id uuid primary key default gen_random_uuid(), original_job_id uuid not null references public.operational_jobs(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  queue_name text not null, job_type text not null, priority text not null,
  payload jsonb not null, correlation_id text not null, attempt_count integer not null,
  error_code text, error_message text, failed_at timestamptz not null default now(),
  reprocessed_at timestamptz, reprocessed_by uuid references auth.users(id) on delete set null,
  replacement_job_id uuid references public.operational_jobs(id) on delete set null,
  unique(original_job_id)
);
create index if not exists operational_dlq_open_idx on public.operational_dead_letters(failed_at desc) where reprocessed_at is null;

create table if not exists public.cache_namespaces (
  id uuid primary key default gen_random_uuid(),
  namespace text not null, organization_id uuid references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  version bigint not null default 1, invalidated_at timestamptz not null default now(),
  invalidated_by uuid references auth.users(id) on delete set null, reason text,
  unique nulls not distinct(namespace,organization_id,store_id)
);

create table if not exists public.integration_circuit_breakers (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null, organization_id uuid references public.organizations(id) on delete cascade,
  state text not null default 'closed' check(state in('closed','open','half_open')),
  failure_count integer not null default 0, success_count integer not null default 0,
  opened_at timestamptz, next_probe_at timestamptz, last_failure_at timestamptz,
  last_success_at timestamptz, latency_ms integer, error_code text,
  updated_at timestamptz not null default now(),
  unique nulls not distinct(provider_key,organization_id)
);

create table if not exists public.degradation_controls (
  capability_key text primary key,
  mode text not null default 'normal' check(mode in('normal','degraded','paused','read_only')),
  priority integer not null check(priority between 1 and 100), reason text,
  enabled_at timestamptz, expires_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);

create table if not exists public.dependency_health_snapshots (
  id bigint generated always as identity primary key, component_key text not null,
  status text not null check(status in('operational','degraded','outage','unknown')),
  latency_ms integer, error_rate_percent numeric(9,4), details jsonb not null default '{}',
  checked_at timestamptz not null default now()
);
create index if not exists dependency_health_component_time_idx on public.dependency_health_snapshots(component_key,checked_at desc);

create table if not exists public.tenant_cost_metrics (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  cost_type text not null, quantity numeric(18,6) not null default 0,
  estimated_cost_micros bigint not null default 0,
  period_started_at timestamptz not null, period_ended_at timestamptz not null,
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists tenant_cost_org_period_idx on public.tenant_cost_metrics(organization_id,period_ended_at desc,cost_type);

create table if not exists public.release_performance_snapshots (
  id uuid primary key default gen_random_uuid(), release_version text not null,
  commit_sha text, deployed_at timestamptz, baseline_id uuid references public.performance_baselines(id) on delete set null,
  request_count bigint not null default 0, p95_ms numeric(14,2), error_rate_percent numeric(9,4),
  performance_smoke_status text not null default 'pending' check(performance_smoke_status in('pending','passed','failed','insufficient_data')),
  regression_percent numeric(9,4), notes text, created_at timestamptz not null default now(), unique(release_version)
);

create or replace function public.enqueue_operational_job(requested_organization_id uuid,requested_store_id uuid,requested_queue text,requested_type text,requested_priority text,requested_payload jsonb,requested_idempotency_key text,requested_correlation_id text default null,requested_max_attempts integer default 5,requested_timeout_seconds integer default 60)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved_id uuid;
begin
 if current_user not in('service_role','postgres') then raise exception 'service role required'; end if;
 insert into public.operational_jobs(organization_id,store_id,queue_name,job_type,priority,payload,idempotency_key,correlation_id,max_attempts,timeout_seconds)
 values(requested_organization_id,requested_store_id,left(requested_queue,80),left(requested_type,120),requested_priority,coalesce(requested_payload,'{}'),left(requested_idempotency_key,240),coalesce(nullif(requested_correlation_id,''),gen_random_uuid()::text),least(20,greatest(1,requested_max_attempts)),least(3600,greatest(1,requested_timeout_seconds)))
 on conflict((coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid)),job_type,idempotency_key) do update set updated_at=public.operational_jobs.updated_at
 returning id into saved_id; return saved_id;
end $$;

create or replace function public.claim_operational_jobs(requested_worker text,requested_queue text default 'default',requested_limit integer default 20,requested_lease_seconds integer default 90)
returns setof public.operational_jobs language plpgsql security definer set search_path='' as $$
begin
 if current_user not in('service_role','postgres') then raise exception 'service role required'; end if;
 return query with ranked as (
  select j.id,row_number() over(partition by coalesce(j.organization_id,j.id) order by case j.priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 when 'low' then 4 else 5 end,j.created_at) tenant_rank
  from public.operational_jobs j where j.queue_name=requested_queue and j.status in('queued','retry_scheduled') and j.available_at<=now() and (j.lease_expires_at is null or j.lease_expires_at<now())
 ), picked as (
  select j.id from public.operational_jobs j join ranked r on r.id=j.id order by r.tenant_rank,case j.priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 when 'low' then 4 else 5 end,j.created_at limit least(100,greatest(1,requested_limit)) for update of j skip locked
 ) update public.operational_jobs j set status='leased',leased_at=now(),lease_expires_at=now()+make_interval(secs=>least(3600,greatest(5,requested_lease_seconds))),leased_by=left(requested_worker,120),attempt_count=j.attempt_count+1,updated_at=now() from picked where j.id=picked.id returning j.*;
end $$;

create or replace function public.finish_operational_job(requested_job_id uuid,requested_worker text,requested_success boolean,requested_result jsonb default null,requested_error_code text default null,requested_error_message text default null)
returns text language plpgsql security definer set search_path='' as $$
declare j public.operational_jobs; next_status text; delay_seconds integer;
begin
 if current_user not in('service_role','postgres') then raise exception 'service role required'; end if;
 select * into j from public.operational_jobs where id=requested_job_id for update;
 if j.id is null or j.status<>'leased' or j.leased_by is distinct from requested_worker then raise exception 'invalid job lease'; end if;
 if requested_success then
  update public.operational_jobs set status='completed',result=coalesce(requested_result,'{}'),completed_at=now(),lease_expires_at=null,updated_at=now() where id=j.id; return 'completed';
 end if;
 if j.attempt_count>=j.max_attempts then
  update public.operational_jobs set status='dead_letter',last_error_code=left(requested_error_code,120),last_error_message=left(requested_error_message,1000),lease_expires_at=null,updated_at=now() where id=j.id;
  insert into public.operational_dead_letters(original_job_id,organization_id,store_id,queue_name,job_type,priority,payload,correlation_id,attempt_count,error_code,error_message)
  values(j.id,j.organization_id,j.store_id,j.queue_name,j.job_type,j.priority,j.payload,j.correlation_id,j.attempt_count,left(requested_error_code,120),left(requested_error_message,1000)) on conflict(original_job_id) do nothing; return 'dead_letter';
 end if;
 delay_seconds:=least(3600,(power(2,greatest(0,j.attempt_count-1))*5)::integer+floor(random()*5)::integer);
 update public.operational_jobs set status='retry_scheduled',available_at=now()+make_interval(secs=>delay_seconds),lease_expires_at=null,leased_by=null,last_error_code=left(requested_error_code,120),last_error_message=left(requested_error_message,1000),updated_at=now() where id=j.id; return 'retry_scheduled';
end $$;

create or replace function public.retry_dead_letter_job(requested_dead_letter_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.operational_dead_letters; replacement uuid;
begin
 if current_user not in('service_role','postgres') and not private.is_superadmin() then raise exception 'access denied'; end if;
 select * into d from public.operational_dead_letters where id=requested_dead_letter_id and reprocessed_at is null for update;
 if d.id is null then raise exception 'dead letter unavailable'; end if;
 insert into public.operational_jobs(organization_id,store_id,queue_name,job_type,priority,payload,idempotency_key,correlation_id,max_attempts)
 values(d.organization_id,d.store_id,d.queue_name,d.job_type,d.priority,d.payload,'dlq:'||d.id||':'||extract(epoch from now())::bigint,d.correlation_id,5) returning id into replacement;
 update public.operational_dead_letters set reprocessed_at=now(),reprocessed_by=(select auth.uid()),replacement_job_id=replacement where id=d.id; return replacement;
end $$;

create or replace function public.invalidate_cache_namespace(requested_namespace text,requested_organization_id uuid,requested_store_id uuid,requested_reason text default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare next_version bigint;
begin
 if current_user not in('service_role','postgres') and not private.is_superadmin() then raise exception 'access denied'; end if;
 insert into public.cache_namespaces(namespace,organization_id,store_id,version,invalidated_by,reason)
 values(left(requested_namespace,120),requested_organization_id,requested_store_id,2,(select auth.uid()),left(requested_reason,500))
 on conflict(namespace,organization_id,store_id) do update set version=public.cache_namespaces.version+1,invalidated_at=now(),invalidated_by=(select auth.uid()),reason=left(requested_reason,500)
 returning version into next_version; return next_version;
end $$;

create or replace function public.record_observability_metric(requested_organization_id uuid,requested_store_id uuid,requested_service text,requested_metric text,requested_value numeric,requested_unit text,requested_dimensions jsonb default '{}',requested_correlation_id text default null,requested_release text default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare saved_id bigint;
begin
 if current_user not in('service_role','postgres') then raise exception 'service role required'; end if;
 insert into public.observability_metrics(organization_id,store_id,service_key,metric_key,value,unit,dimensions,correlation_id,release_version)
 values(requested_organization_id,requested_store_id,left(requested_service,100),left(requested_metric,120),requested_value,left(requested_unit,40),coalesce(requested_dimensions,'{}'),left(requested_correlation_id,160),left(requested_release,120)) returning id into saved_id; return saved_id;
end $$;

create or replace function public.get_performance_summary()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_superadmin() then raise exception 'access denied'; end if;
 select jsonb_build_object(
  'baseline',(select to_jsonb(b) from public.performance_baselines b order by b.window_ended_at desc limit 1),
  'jobs',jsonb_build_object('queued',(select count(*) from public.operational_jobs where status in('queued','retry_scheduled')),'leased',(select count(*) from public.operational_jobs where status='leased'),'dlq',(select count(*) from public.operational_dead_letters where reprocessed_at is null),'oldest_seconds',(select coalesce(extract(epoch from now()-min(created_at))::bigint,0) from public.operational_jobs where status in('queued','retry_scheduled'))),
  'circuits',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.integration_circuit_breakers c),
  'degradation',(select coalesce(jsonb_agg(to_jsonb(d) order by d.priority),'[]') from public.degradation_controls d),
  'dependencies',(select coalesce(jsonb_agg(x),'[]') from (select distinct on(component_key) component_key,status,latency_ms,error_rate_percent,checked_at from public.dependency_health_snapshots order by component_key,checked_at desc)x),
  'costs',(select coalesce(jsonb_agg(x),'[]') from (select organization_id,cost_type,sum(estimated_cost_micros) estimated_cost_micros,sum(quantity) quantity from public.tenant_cost_metrics where period_ended_at>now()-interval '30 days' group by organization_id,cost_type order by estimated_cost_micros desc limit 25)x)
 ) into result; return result;
end $$;

revoke all on function public.enqueue_operational_job(uuid,uuid,text,text,text,jsonb,text,text,integer,integer),public.claim_operational_jobs(text,text,integer,integer),public.finish_operational_job(uuid,text,boolean,jsonb,text,text),public.retry_dead_letter_job(uuid),public.invalidate_cache_namespace(text,uuid,uuid,text),public.record_observability_metric(uuid,uuid,text,text,numeric,text,jsonb,text,text),public.get_performance_summary() from public,anon,authenticated;
grant execute on function public.enqueue_operational_job(uuid,uuid,text,text,text,jsonb,text,text,integer,integer),public.claim_operational_jobs(text,text,integer,integer),public.finish_operational_job(uuid,text,boolean,jsonb,text,text),public.record_observability_metric(uuid,uuid,text,text,numeric,text,jsonb,text,text) to service_role;
grant execute on function public.retry_dead_letter_job(uuid),public.invalidate_cache_namespace(text,uuid,uuid,text),public.get_performance_summary() to service_role;

do $$declare t text;begin foreach t in array array['performance_baselines','performance_slos','observability_metrics','observability_trace_spans','operational_jobs','operational_dead_letters','cache_namespaces','integration_circuit_breakers','degradation_controls','dependency_health_snapshots','tenant_cost_metrics','release_performance_snapshots'] loop execute format('alter table public.%I enable row level security',t);end loop;end$$;
do $$declare t text;begin foreach t in array array['performance_baselines','performance_slos','observability_metrics','observability_trace_spans','operational_jobs','operational_dead_letters','cache_namespaces','integration_circuit_breakers','degradation_controls','dependency_health_snapshots','tenant_cost_metrics','release_performance_snapshots'] loop execute format('create policy %I on public.%I for all to authenticated using(private.is_superadmin()) with check(private.is_superadmin())','performance_superadmin_'||t,t);end loop;end$$;
grant select,insert,update on public.performance_baselines,public.performance_slos,public.observability_metrics,public.observability_trace_spans,public.operational_jobs,public.operational_dead_letters,public.cache_namespaces,public.integration_circuit_breakers,public.degradation_controls,public.dependency_health_snapshots,public.tenant_cost_metrics,public.release_performance_snapshots to authenticated;
grant all on public.performance_baselines,public.performance_slos,public.observability_metrics,public.observability_trace_spans,public.operational_jobs,public.operational_dead_letters,public.cache_namespaces,public.integration_circuit_breakers,public.degradation_controls,public.dependency_health_snapshots,public.tenant_cost_metrics,public.release_performance_snapshots to service_role;
grant usage,select on sequence public.observability_metrics_id_seq,public.dependency_health_snapshots_id_seq,public.tenant_cost_metrics_id_seq to authenticated,service_role;

insert into public.performance_baselines(environment,release_version,window_started_at,window_ended_at,request_count,p50_ms,p95_ms,p99_ms,error_rate_percent,cache_hit_percent,source,metadata)
select 'production','phase-25',now()-interval '24 hours',now(),23225,24,62,229.45,0.03,99.97,'supabase_logs_and_pg_stats',jsonb_build_object('measured_before_phase',26,'database_table_cache_percent',100,'current_connections',7,'max_connections',60,'blocked_sessions',0)
where not exists(select 1 from public.performance_baselines where release_version='phase-25' and organization_id is null);
insert into public.performance_slos(service_key,sli_key,target_operator,target_value,unit,evaluation_window,error_budget_percent,baseline_id,derivation)
select 'api','availability','gte',99.9,'percent','30d',0.1,b.id,'Initial internal target; review after 30 days of measured production traffic' from public.performance_baselines b where b.release_version='phase-25' and b.organization_id is null
on conflict(organization_id,service_key,sli_key) do nothing;
insert into public.performance_slos(service_key,sli_key,target_operator,target_value,unit,evaluation_window,error_budget_percent,baseline_id,derivation)
select 'api','p95_latency','lte',124,'ms','7d',null,b.id,'2x the measured pre-Phase-26 p95 of 62ms; recalibrate with post-release traffic' from public.performance_baselines b where b.release_version='phase-25' and b.organization_id is null
on conflict(organization_id,service_key,sli_key) do nothing;

insert into public.degradation_controls(capability_key,mode,priority,reason) values
 ('orders','normal',1,'Critical path'),('payments','normal',2,'Critical path'),('kitchen','normal',3,'Critical path'),('transactional_messages','normal',4,'Transactional path'),('campaigns','normal',5,'May be paused under load'),('analytics','normal',6,'May be degraded under load')
on conflict(capability_key) do nothing;
insert into public.dependency_health_snapshots(component_key,status,details) values
 ('database','operational','{"source":"phase26_initial_audit"}'),('storage','operational','{"source":"phase26_initial_audit"}'),('auth','operational','{"source":"phase26_initial_audit"}'),('queue','operational','{"source":"phase26_initial_audit"}'),('billing','operational','{"source":"phase26_initial_audit"}'),('whatsapp','operational','{"source":"phase26_initial_audit"}'),('ai','operational','{"source":"phase26_initial_audit"}'),('integrations','operational','{"source":"phase26_initial_audit"}'),('fiscal','operational','{"source":"phase26_initial_audit"}');

insert into public.saas_support_components(component_key,name,status,public_message) values
 ('workers','Workers','operational','Serviço operacional'),('realtime','Tempo real','operational','Serviço operacional'),('performance','Performance','operational','Serviço operacional')
on conflict(component_key) do update set name=excluded.name;
