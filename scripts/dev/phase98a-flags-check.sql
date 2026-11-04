-- Fase 98A: prova da regra "flags só dentro do plano". Rodar SÓ no masterapp-dev (SQL Editor ou execute_sql).
-- Tudo acontece numa subtransação desfeita no fim; os resultados ficam numa variável e saem como linhas.
-- Esperado: todas as linhas com ok = true.
create or replace function pg_temp.phase98a_check() returns table(scenario text, ok boolean, detail text)
language plpgsql as $$
declare
  store uuid := (select id from public.establishments where slug = 'lanchonete-teste');
  owner_id uuid := (select m.user_id from public.establishment_members m where m.establishment_id = store and m.role = 'owner' and m.status = 'active' limit 1);
  staff_id uuid := (select m.user_id from public.establishment_members m where m.establishment_id = store and m.role not in ('owner','manager') limit 1);
  outsider_id uuid := (select u.id from auth.users u where not exists (select 1 from public.establishment_members m where m.user_id = u.id) limit 1);
  admin_id uuid;
  plan jsonb := private.store_plan_flags(store);
  off_flag text;
  on_flag text;
  results jsonb := '[]'::jsonb;
  msg text;
  n bigint;
begin
  select j.key into off_flag from jsonb_each(plan) j where j.key like '%\_enabled' and j.value = 'false'::jsonb
    and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='store_feature_flags' and c.column_name = j.key)
    order by j.key limit 1;
  select j.key into on_flag from jsonb_each(plan) j where j.key like '%\_enabled' and j.value = 'true'::jsonb
    and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='store_feature_flags' and c.column_name = j.key)
    order by j.key limit 1;
  begin
    execute format('update public.store_feature_flags set %I=false, %I=false, route_optimization_enabled=false, delivery_enabled=false where establishment_id=$1', off_flag, on_flag) using store;
    -- um superadmin de teste só dentro desta subtransação: o primeiro usuário sem loja
    admin_id := outsider_id;
    update public.profiles set is_superadmin = true where id = admin_id;
    outsider_id := (select u.id from auth.users u where u.id <> admin_id and not exists (select 1 from public.establishment_members m where m.user_id = u.id) limit 1);

    -- dono, pela API
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      execute format('update public.store_feature_flags set %I=true where establishment_id=$1', off_flag) using store;
      get diagnostics n = row_count;
      results := results || jsonb_build_object('s', '1. dono grava direto na tabela (PATCH da API) → recusa', 'ok', n = 0, 'd', n||' linhas alteradas');
    exception when insufficient_privilege then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '1. dono grava direto na tabela (PATCH da API) → recusa', 'ok', true, 'd', msg);
    end;
    begin
      execute 'insert into public.store_feature_flags(establishment_id) values ($1) on conflict do nothing' using store;
      results := results || jsonb_build_object('s', '2. dono insere linha direto (POST da API) → recusa', 'ok', false, 'd', 'aceitou');
    exception when insufficient_privilege then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '2. dono insere linha direto (POST da API) → recusa', 'ok', true, 'd', msg);
    end;
    begin
      perform public.set_store_feature_flags(store, jsonb_build_object(off_flag, true));
      results := results || jsonb_build_object('s', '3. dono liga '||off_flag||' (fora do plano) pela RPC → recusa', 'ok', false, 'd', 'aceitou');
    exception when insufficient_privilege then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '3. dono liga '||off_flag||' (fora do plano) pela RPC → recusa', 'ok', msg like 'FLAG_OUTSIDE_PLAN%', 'd', msg);
    end;
    begin
      perform public.set_store_feature_flags(store, '{"route_optimization_enabled": true}'::jsonb);
      results := results || jsonb_build_object('s', '4. dono liga route_optimization_enabled (só da loja, avançada) → recusa', 'ok', false, 'd', 'aceitou');
    exception when insufficient_privilege then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '4. dono liga route_optimization_enabled (só da loja, avançada) → recusa', 'ok', msg like 'FLAG_OUTSIDE_PLAN%', 'd', msg);
    end;
    begin
      perform public.set_store_feature_flags(store, jsonb_build_object(on_flag, true, 'delivery_enabled', true));
      perform public.set_store_feature_flags(store, jsonb_build_object(on_flag, false));
      results := results || jsonb_build_object('s', '5. dono liga e desliga '||on_flag||' (no plano) e liga delivery_enabled → aceita', 'ok', true, 'd', 'aceito');
    exception when others then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '5. dono liga e desliga '||on_flag||' (no plano) e liga delivery_enabled → aceita', 'ok', false, 'd', msg);
    end;
    begin
      perform public.set_store_feature_flags(store, '{"nao_existe_enabled": true}'::jsonb);
      results := results || jsonb_build_object('s', '6. flag inexistente → recusa', 'ok', false, 'd', 'aceitou');
    exception when invalid_parameter_value then
      results := results || jsonb_build_object('s', '6. flag inexistente → recusa', 'ok', true, 'd', 'UNKNOWN_FLAG');
    end;
    begin
      select count(*) into n from public.store_feature_flags where establishment_id = store;
      results := results || jsonb_build_object('s', '7. dono lê as flags da loja (has_store_access corrigida)', 'ok', n = 1, 'd', n||' linha');
    exception when others then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '7. dono lê as flags da loja (has_store_access corrigida)', 'ok', false, 'd', msg);
    end;
    reset role;

    -- funcionário da loja e usuário de fora
    if staff_id is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', staff_id, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        perform public.set_store_feature_flags(store, jsonb_build_object(on_flag, true));
        results := results || jsonb_build_object('s', '8. funcionário (não dono/gerente) usa a RPC → recusa', 'ok', false, 'd', 'aceitou');
      exception when insufficient_privilege then
        get stacked diagnostics msg = message_text;
        results := results || jsonb_build_object('s', '8. funcionário (não dono/gerente) usa a RPC → recusa', 'ok', msg = 'FORBIDDEN', 'd', msg);
      end;
      reset role;
    end if;
    if outsider_id is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', outsider_id, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        perform public.set_store_feature_flags(store, jsonb_build_object(on_flag, false));
        results := results || jsonb_build_object('s', '9. usuário de outra loja usa a RPC → recusa', 'ok', false, 'd', 'aceitou');
      exception when insufficient_privilege then
        get stacked diagnostics msg = message_text;
        results := results || jsonb_build_object('s', '9. usuário de outra loja usa a RPC → recusa', 'ok', msg = 'FORBIDDEN', 'd', msg);
      end;
      reset role;
    end if;
    results := results || jsonb_build_object('s', '10. anon não executa a RPC', 'ok',
      not has_function_privilege('anon', 'public.set_store_feature_flags(uuid,jsonb)', 'execute'), 'd', 'has_function_privilege');

    -- superadmin, pela API
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.set_store_feature_flags(store, jsonb_build_object(off_flag, true, 'route_optimization_enabled', true));
      results := results || jsonb_build_object('s', '11. superadmin liga '||off_flag||' e route_optimization_enabled → aceita', 'ok', true, 'd', 'aceito');
    exception when others then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '11. superadmin liga '||off_flag||' e route_optimization_enabled → aceita', 'ok', false, 'd', msg);
    end;
    reset role;

    -- servidor (service_role: billing, go-live da privacidade, scripts)
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    begin
      execute format('update public.store_feature_flags set %I=false where establishment_id=$1', off_flag) using store;
      results := results || jsonb_build_object('s', '12. servidor (service_role) grava direto → aceita', 'ok', true, 'd', 'aceito');
    exception when others then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s', '12. servidor (service_role) grava direto → aceita', 'ok', false, 'd', msg);
    end;
    reset role;

    select count(*) into n from public.store_feature_flag_audit a where a.establishment_id = store and a.created_at = now() and a.actor_kind = 'store_admin' and a.changed_by = owner_id;
    results := results || jsonb_build_object('s', '13. auditoria: mudanças do dono com autor', 'ok', n >= 2, 'd', n||' registros');
    select count(*) into n from public.store_feature_flag_audit a where a.establishment_id = store and a.created_at = now() and a.actor_kind = 'superadmin' and a.changed_by = admin_id;
    results := results || jsonb_build_object('s', '14. auditoria: mudança do superadmin', 'ok', n = 1, 'd', n||' registros');
    select count(*) into n from public.store_feature_flag_audit a where a.establishment_id = store and a.created_at = now() and a.actor_kind in ('server','system');
    results := results || jsonb_build_object('s', '15. auditoria: mudanças do servidor', 'ok', n >= 2, 'd', n||' registros');
    raise exception 'PHASE98A_ROLLBACK';
  exception when others then
    if sqlerrm <> 'PHASE98A_ROLLBACK' then
      results := results || jsonb_build_object('s', 'erro inesperado', 'ok', false, 'd', sqlerrm);
    end if;
  end;
  return query select r->>'s', (r->>'ok')::boolean, r->>'d' from jsonb_array_elements(results) r;
end $$;
select * from pg_temp.phase98a_check();
