-- Run after the Phase 17 migration inside BEGIN ... ROLLBACK.
do $$
begin
  assert private.delivery_distance_meters(0,0,0,0) = 0, 'identical coordinates';
  assert private.delivery_distance_meters(0,0,0,1) between 111000 and 111300, 'one equatorial degree';
  assert private.delivery_distance_meters(-22,-43,-22.0001,-43) < 75, 'stationary tolerance';
  assert private.delivery_distance_meters(-22,-43,-22.01,-43) > 250, 'away from destination';
  assert private.delivery_distance_meters(null,0,0,0) is null, 'unknown destination stays unknown';
  assert not has_function_privilege('anon','private.current_delivery_operational_alerts(uuid)','EXECUTE'), 'private detector';
  assert not has_function_privilege('anon','public.refresh_delivery_operational_alerts(uuid)','EXECUTE'), 'admin refresh';
  begin
    perform public.confirm_delivery_destination_location('00000000-0000-0000-0000-000000000000',0,0);
    raise exception 'unknown token was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Pedido indisponível para confirmar localização.' then raise; end if;
  end;
  begin
    perform public.confirm_delivery_destination_location('00000000-0000-0000-0000-000000000000',91,0);
    raise exception 'invalid latitude was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Localização inválida.' then raise; end if;
  end;
  assert (select count(*) = 0 from private.current_delivery_operational_alerts('00000000-0000-0000-0000-000000000000')), 'tenant isolation';
end $$;
