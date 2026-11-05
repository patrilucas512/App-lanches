-- Fase 99C: prova de "alinhar a loja ao plano". Rodar SÓ no masterapp-dev. Tudo desfeito no fim.
create or replace function pg_temp.phase99c() returns table(scenario text, ok boolean, detail text) language plpgsql as $$
declare
  store uuid := (select id from public.establishments where slug = 'lanchonete-teste');
  org uuid := (select organization_id from public.establishments where slug = 'lanchonete-teste');
  owner_id uuid := (select m.user_id from public.establishment_members m where m.establishment_id = store and m.role = 'owner' limit 1);
  admin_id uuid := (select u.id from auth.users u where not exists (select 1 from public.establishment_members m where m.user_id = u.id) limit 1);
  results jsonb := '[]'; p jsonb; r jsonb; msg text; n int;
begin
  begin
    update public.profiles set is_superadmin = true where id = admin_id;
    update public.store_feature_flags set automation_center_enabled = true, wms_enabled = true where establishment_id = store;
    -- dono não pode
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    begin
      perform public.preview_store_plan_alignment(store);
      results := results || jsonb_build_object('s','1. dono não vê nem aplica a prévia','ok',false,'d','aceitou');
    exception when insufficient_privilege then
      results := results || jsonb_build_object('s','1. dono não vê nem aplica a prévia','ok',true,'d','FORBIDDEN');
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    p := public.preview_store_plan_alignment(store);
    results := results || jsonb_build_object('s','2. prévia lista o que some e o que fica','ok',(p->>'removes')::int > 0 and (p->>'stays_by_plan')::int > 0,
      'd', 'somem ' || (p->>'removes') || ', ficam pelo plano ' || (p->>'stays_by_plan') || ', usados ' || (p->>'kept_used'));
    -- uso recente de automação
    insert into public.automation_audit_events(organization_id, store_id, event_type, entity_type, reason) values (org, store, 'rule_run', 'rule', 'teste 99C');
    p := public.preview_store_plan_alignment(store);
    results := results || jsonb_build_object('s','3. módulo usado nos últimos 30 dias aparece como mantido','ok',
      exists(select 1 from jsonb_array_elements(p->'items') x where x->>'flag' = 'automation_center_enabled' and x->>'action' = 'keep_used' and (x->>'used_30d')::boolean),
      'd', (select x::text from jsonb_array_elements(p->'items') x where x->>'flag' = 'automation_center_enabled'));
    begin
      perform public.align_store_to_plan(store, 'outra-loja', '{}');
      results := results || jsonb_build_object('s','4. sem digitar o slug certo não aplica','ok',false,'d','aplicou');
    exception when invalid_parameter_value then
      results := results || jsonb_build_object('s','4. sem digitar o slug certo não aplica','ok',true,'d','CONFIRMATION_MISMATCH');
    end;
    r := public.align_store_to_plan(store, 'lanchonete-teste', '{}');
    results := results || jsonb_build_object('s','5. alinha e mantém o módulo usado sem confirmação','ok',
      (select automation_center_enabled from public.store_feature_flags where establishment_id = store)
      and not (select wms_enabled from public.store_feature_flags where establishment_id = store)
      and r->'kept_used' ? 'automation_center_enabled',
      'd', 'desligados ' || jsonb_array_length(r->'turned_off') || ', mantidos ' || (r->'kept_used')::text);
    r := public.align_store_to_plan(store, 'lanchonete-teste', array['automation_center_enabled']);
    results := results || jsonb_build_object('s','6. desliga o usado só com confirmação explícita','ok',
      not (select automation_center_enabled from public.store_feature_flags where establishment_id = store), 'd', r::text);
    p := public.preview_store_plan_alignment(store);
    results := results || jsonb_build_object('s','7. depois de alinhar nada mais some; só ficam os usados não confirmados','ok', (p->>'removes')::int = 0 and (p->>'kept_used')::int = jsonb_array_length(r->'kept_used'), 'd', 'somem ' || (p->>'removes') || ', usados mantidos ' || (p->>'kept_used'));
    select count(*) into n from public.store_feature_flag_audit a where a.establishment_id = store and a.created_at = now() and a.actor_kind = 'superadmin' and a.changed_by = admin_id;
    results := results || jsonb_build_object('s','8. auditoria registra o superadmin','ok', n >= 2, 'd', n || ' registros');
    results := results || jsonb_build_object('s','9. anon não executa','ok', not has_function_privilege('anon','public.align_store_to_plan(uuid,text,text[])','execute')
      and not has_function_privilege('anon','public.preview_store_plan_alignment(uuid)','execute'), 'd', 'privilégios');
    raise exception 'ROLLBACK99C';
  exception when others then
    if sqlerrm <> 'ROLLBACK99C' then results := results || jsonb_build_object('s','erro','ok',false,'d',sqlerrm); end if;
  end;
  return query select x->>'s', (x->>'ok')::boolean, x->>'d' from jsonb_array_elements(results) x;
end $$;
select * from pg_temp.phase99c();
