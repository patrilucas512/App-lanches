-- Forecasts are only shown when the current period has the configured minimum sample.
alter function public.get_manager_copilot_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean) rename to get_manager_copilot_snapshot_raw;

create or replace function public.get_manager_copilot_snapshot(
  requested_establishment_id uuid, requested_start timestamptz, requested_end timestamptz,
  requested_compare_start timestamptz, requested_compare_end timestamptz, requested_all_units boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; minimum_sample integer;
begin
  payload:=public.get_manager_copilot_snapshot_raw(requested_establishment_id,requested_start,requested_end,requested_compare_start,requested_compare_end,requested_all_units);
  minimum_sample:=coalesce((payload->'settings'->>'minimum_order_sample')::integer,10);
  if coalesce((payload->'forecast'->>'sample_orders')::integer,0)<minimum_sample then
    payload:=jsonb_set(payload,'{forecast,revenue_cents}','null'::jsonb,true);
    payload:=jsonb_set(payload,'{forecast,basis}',to_jsonb('amostra insuficiente para projetar'::text),true);
  end if;
  return payload;
end $$;

revoke all on function public.get_manager_copilot_snapshot_raw(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.get_manager_copilot_snapshot_raw(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean) to service_role;
revoke all on function public.get_manager_copilot_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.get_manager_copilot_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean) to authenticated;
