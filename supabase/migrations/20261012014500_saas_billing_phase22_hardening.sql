-- Phase 22 hardening: make the two idempotency indexes directly usable by
-- INSERT ... ON CONFLICT from PostgREST/RPC operations. PostgreSQL still
-- permits multiple NULL values in these composite unique indexes.
drop index if exists public.usage_events_org_idempotency_key;
create unique index usage_events_org_idempotency_key
  on public.usage_events(organization_id, idempotency_key);

drop index if exists public.saas_invoice_provider_ref;
create unique index saas_invoice_provider_ref
  on public.saas_invoices(provider, provider_invoice_id);

-- Usage ingestion and automated dunning are backend-only operations.
revoke execute on function public.record_saas_usage(uuid, uuid, text, numeric, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_saas_usage(uuid, uuid, text, numeric, text, bigint, jsonb)
  to service_role;

revoke execute on function public.process_saas_dunning()
  from public, anon, authenticated;
grant execute on function public.process_saas_dunning()
  to service_role;
