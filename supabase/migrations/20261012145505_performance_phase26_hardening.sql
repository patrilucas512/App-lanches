-- Phase 26 hardening: internal control RPCs are server-only.
-- The API verifies the superadmin and calls these functions through the service role.
revoke all on function public.retry_dead_letter_job(uuid),public.invalidate_cache_namespace(text,uuid,uuid,text),public.get_performance_summary() from authenticated,anon,public;
grant execute on function public.retry_dead_letter_job(uuid),public.invalidate_cache_namespace(text,uuid,uuid,text),public.get_performance_summary() to service_role;

-- Cover the foreign keys used by operational retention/deletion paths without indexing every FK.
create index if not exists performance_slos_baseline_idx on public.performance_slos(baseline_id) where baseline_id is not null;
create index if not exists operational_jobs_store_idx on public.operational_jobs(store_id) where store_id is not null;
create index if not exists operational_dlq_org_open_idx on public.operational_dead_letters(organization_id,failed_at desc) where reprocessed_at is null;
create index if not exists operational_dlq_store_idx on public.operational_dead_letters(store_id) where store_id is not null;
create index if not exists operational_dlq_reprocessed_by_idx on public.operational_dead_letters(reprocessed_by) where reprocessed_by is not null;
create index if not exists operational_dlq_replacement_idx on public.operational_dead_letters(replacement_job_id) where replacement_job_id is not null;
create index if not exists trace_spans_org_time_idx on public.observability_trace_spans(organization_id,started_at desc) where organization_id is not null;
create index if not exists trace_spans_store_time_idx on public.observability_trace_spans(store_id,started_at desc) where store_id is not null;
create index if not exists observability_metrics_store_time_idx on public.observability_metrics(store_id,recorded_at desc) where store_id is not null;
create index if not exists circuit_breakers_org_idx on public.integration_circuit_breakers(organization_id) where organization_id is not null;
create index if not exists degradation_controls_enabled_by_idx on public.degradation_controls(enabled_by) where enabled_by is not null;
create index if not exists tenant_cost_store_period_idx on public.tenant_cost_metrics(store_id,period_ended_at desc) where store_id is not null;
create index if not exists release_performance_baseline_idx on public.release_performance_snapshots(baseline_id) where baseline_id is not null;
