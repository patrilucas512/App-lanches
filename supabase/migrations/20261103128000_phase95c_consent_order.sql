-- Phase 95C fix: two consent rows can share the same timestamp (a legacy write and a revocation in one transaction).
-- A sequence breaks the tie, so the latest row is always the one written last.
alter table public.consent_records add column seq bigint generated always as identity;
create or replace view public.consent_current with(security_invoker=true) as
 select distinct on(context_id,subject_ref,purpose_key,channel) * from public.consent_records order by context_id,subject_ref,purpose_key,channel,recorded_at desc,seq desc;
revoke all on public.consent_current from public,anon,authenticated;grant select on public.consent_current to service_role;
