-- Phase 96E: retention executors for messages and voice. A policy on a dataset without an executor must say why.
alter table public.retention_policies add column no_executor_reason text;
alter table public.retention_policies add constraint retention_policies_executor_reason_check check(dataset in('inactive_customers','messages','voice_calls') or length(btrim(coalesce(no_executor_reason,'')))>=10) not valid;
