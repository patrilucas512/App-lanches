-- Security advisor hardening: workforce SECURITY DEFINER RPCs require authentication.
revoke all on function public.workforce_save_shift(uuid,uuid,uuid,timestamptz,timestamptz,integer,text) from public,anon;
revoke all on function public.workforce_publish_schedule(uuid,date,date) from public,anon;
revoke all on function public.workforce_copy_previous_week_preview(uuid,date) from public,anon;
revoke all on function public.workforce_record_clock(uuid,text,text,text) from public,anon;
revoke all on function public.workforce_request_clock_correction(uuid,text,timestamptz,text) from public,anon;
revoke all on function public.workforce_decide_clock_correction(uuid,boolean,text) from public,anon;
revoke all on function public.workforce_phase18_summary(uuid,date,date,boolean) from public,anon;
grant execute on function public.workforce_save_shift(uuid,uuid,uuid,timestamptz,timestamptz,integer,text),public.workforce_publish_schedule(uuid,date,date),public.workforce_copy_previous_week_preview(uuid,date),public.workforce_record_clock(uuid,text,text,text),public.workforce_request_clock_correction(uuid,text,timestamptz,text),public.workforce_decide_clock_correction(uuid,boolean,text),public.workforce_phase18_summary(uuid,date,date,boolean) to authenticated;

-- Supporting indexes for every frequently traversed workforce foreign key.
create index if not exists workforce_availability_org_store_idx on public.employee_availability(organization_id,store_id,available_on);
create index if not exists workforce_templates_scope_idx on public.work_shift_templates(organization_id,store_id,employee_id);
create index if not exists workforce_publications_org_idx on public.schedule_publications(organization_id,published_at desc);
create index if not exists workforce_swaps_scope_idx on public.shift_exchange_requests(organization_id,shift_id,status);
create index if not exists workforce_corrections_scope_idx on public.time_clock_correction_requests(organization_id,employee_id,status);
create index if not exists workforce_skills_scope_idx on public.employee_skills(organization_id,employee_id);
create index if not exists workforce_training_scope_idx on public.employee_training_records(organization_id,employee_id);
create index if not exists workforce_documents_scope_idx on public.employee_documents(organization_id,employee_id);
create index if not exists workforce_feedback_scope_idx on public.employee_feedback(organization_id,employee_id);
create index if not exists workforce_evaluations_scope_idx on public.employee_evaluations(organization_id,employee_id);
create index if not exists workforce_notifications_scope_idx on public.workforce_notifications(organization_id,employee_id,created_at desc);
