-- Fase 99E: prova das correções encontradas pelos fluxos completos. Rodar SÓ no masterapp-dev. Tudo desfeito no fim.
create or replace function pg_temp.phase99e() returns table(scenario text, ok boolean, detail text) language plpgsql as $$
declare
  store uuid := (select id from public.establishments where slug = 'lanchonete-teste');
  waiter_id uuid := (select user_id from public.waiters where establishment_id = store limit 1);
  cook_id uuid := (select user_id from public.kitchen_operators where establishment_id = store limit 1);
  results jsonb := '[]'; s jsonb; o uuid; msg text; zone uuid; other uuid;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', waiter_id, 'role', 'authenticated')::text, true);
    begin
      s := public.open_table_session_by_label('Prova 99E', 'Cliente Prova', 2, null);
      results := results || jsonb_build_object('s','1. garçom abre mesa (loja e organização preenchidas)','ok',
        (select organization_id is not null and store_id = store from public.table_sessions where id = (s->>'id')::uuid), 'd', s->>'id');
    exception when others then results := results || jsonb_build_object('s','1. garçom abre mesa','ok',false,'d',sqlerrm); end;

    perform set_config('request.jwt.claims', json_build_object('sub', cook_id, 'role', 'authenticated')::text, true);
    select id into o from public.orders where establishment_id = store order by created_at desc limit 1;
    begin
      update public.orders set updated_at = now() where id = o;
      results := results || jsonb_build_object('s','2. cozinha muda o pedido sem permissão do Copiloto','ok',true,'d','sem erro');
    exception when others then results := results || jsonb_build_object('s','2. cozinha muda o pedido','ok',false,'d',sqlerrm); end;
    begin
      perform public.refresh_manager_daily_metrics(store, current_date);
      results := results || jsonb_build_object('s','3. atualizar métricas pela tela continua exigindo permissão','ok',false,'d','aceitou');
    exception when others then results := results || jsonb_build_object('s','3. atualizar métricas pela tela continua exigindo permissão','ok', sqlerrm like 'Sem permissão%','d',sqlerrm); end;

    perform set_config('request.jwt.claims', '', true);
    begin
      update public.driver_availability set status = 'offered' where driver_profile_id = (select id from public.driver_profiles where establishment_id = store limit 1);
      update public.driver_availability set status = 'collecting' where driver_profile_id = (select id from public.driver_profiles where establishment_id = store limit 1);
      results := results || jsonb_build_object('s','4. status de chamada do motoboy aceito','ok',true,'d','offered e collecting');
    exception when others then results := results || jsonb_build_object('s','4. status de chamada do motoboy','ok',false,'d',sqlerrm); end;

    -- loja nova (sem delivery_settings) ganha a configuração ao criar a primeira zona
    insert into public.establishments(name, slug, organization_id)
      select 'Prova 99E', 'prova-99e-' || substr(md5(random()::text), 1, 6), organization_id from public.establishments where id = store
      returning id into other;
    insert into public.delivery_zones(establishment_id, name, fee_cents) values (other, 'Centro', 500) returning id into zone;
    results := results || jsonb_build_object('s','5. primeira zona cria a configuração de entrega','ok',
      exists (select 1 from public.delivery_settings where establishment_id = other and fee_model = 'neighborhood'), 'd', other);
    raise exception 'ROLLBACK99E';
  exception when others then
    if sqlerrm <> 'ROLLBACK99E' then results := results || jsonb_build_object('s','erro','ok',false,'d',sqlerrm); end if;
  end;
  return query select x->>'s', (x->>'ok')::boolean, x->>'d' from jsonb_array_elements(results) x;
end $$;
select * from pg_temp.phase99e();
