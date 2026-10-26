-- Split read and write policies so SELECT does not evaluate two permissive policies.
do $$
declare t text;
begin
 foreach t in array array['sales_permissions','sales_pipelines','sales_stages','sales_accounts','sales_contacts','sales_leads','sales_opportunities','opportunity_stage_history','sales_activities','sales_tasks','sales_demos','sales_proposals','sales_referrals','sales_targets','sales_templates','sales_automation_rules','sales_conversion_handoffs','sales_lead_capture_limits'] loop
  execute format('drop policy if exists %I on public.%I',t||'_manage',t);
  execute format('create policy %I on public.%I for insert to authenticated with check((select private.sales_allowed(''sales:manage'')))',t||'_insert',t);
  execute format('create policy %I on public.%I for update to authenticated using((select private.sales_allowed(''sales:manage''))) with check((select private.sales_allowed(''sales:manage'')))',t||'_update',t);
  execute format('create policy %I on public.%I for delete to authenticated using((select private.sales_allowed(''sales:manage'')))',t||'_delete',t);
 end loop;
end$$;
