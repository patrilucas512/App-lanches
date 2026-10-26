revoke all on function public.process_due_copilot_temporary_operations(integer) from public,anon,authenticated;
grant execute on function public.process_due_copilot_temporary_operations(integer) to service_role;

revoke all on function private.copilot_action_role(uuid) from public,anon,authenticated;
revoke all on function private.copilot_action_allowed(uuid,text) from public,anon,authenticated;
revoke all on function private.copilot_event(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.execute_copilot_action(uuid) from public,anon,authenticated;

grant execute on function private.copilot_action_role(uuid) to service_role;
grant execute on function private.copilot_action_allowed(uuid,text) to service_role;
grant execute on function private.copilot_event(uuid,text,jsonb) to service_role;
grant execute on function private.execute_copilot_action(uuid) to service_role;
