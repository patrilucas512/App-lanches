-- Daily aggregates are maintained by the order trigger and backend workers only.
revoke execute on function public.refresh_manager_daily_metrics(uuid,date) from authenticated;
grant execute on function public.refresh_manager_daily_metrics(uuid,date) to service_role;
