-- Phase 24 hardening: readable queue labels and explicit internal permissions.
alter table public.saas_support_agents add column if not exists permissions text[] not null default array['support:view','support:respond','support:assign','support:escalate','support:manage_sla','support:manage_kb','support:manage_incidents','support:run_diagnostics','support:execute_safe_actions'];
alter table public.saas_support_agents add constraint saas_support_agent_permissions_check check(permissions <@ array['support:view','support:respond','support:assign','support:escalate','support:manage_sla','support:manage_kb','support:manage_incidents','support:run_diagnostics','support:execute_safe_actions']::text[]);
drop policy if exists support_queues_customer_read on public.saas_support_queues;
create policy support_queues_customer_read on public.saas_support_queues for select to authenticated using(active and not restricted);
grant select on public.saas_support_queues to authenticated;
create or replace function private.saas_support_has_permission(requested_permission text) returns boolean language sql stable security definer set search_path='' as $$select private.is_superadmin() and (not exists(select 1 from public.saas_support_agents a where a.user_id=(select auth.uid()) and a.active) or exists(select 1 from public.saas_support_agents a where a.user_id=(select auth.uid()) and a.active and requested_permission=any(a.permissions)))$$;
revoke all on function private.saas_support_has_permission(text) from public,anon;
grant execute on function private.saas_support_has_permission(text) to authenticated,service_role;
