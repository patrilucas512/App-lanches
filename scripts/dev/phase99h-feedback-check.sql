-- Fase 99H: prova do "Relatar problema". Rodar SÓ no masterapp-dev. Tudo desfeito no fim.
create or replace function pg_temp.phase99h() returns table(scenario text, ok boolean, detail text) language plpgsql as $$
declare
  store uuid := (select id from public.establishments where slug = 'lanchonete-teste');
  owner_id uuid := (select m.user_id from public.establishment_members m where m.establishment_id = store and m.role = 'owner' limit 1);
  waiter_id uuid := (select user_id from public.waiters where establishment_id = store limit 1);
  cook_id uuid := (select user_id from public.kitchen_operators where establishment_id = store limit 1);
  outsider uuid := (select u.id from auth.users u where not exists (select 1 from public.establishment_members m where m.user_id = u.id)
    and not exists (select 1 from public.waiters w where w.user_id = u.id) and not exists (select 1 from public.kitchen_operators k where k.user_id = u.id)
    and not exists (select 1 from public.custom_staff_members s where s.user_id = u.id) and not exists (select 1 from public.profiles p where p.id = u.id and p.is_superadmin) limit 1);
  results jsonb := '[]'; t uuid; row public.support_tickets%rowtype; msg text; i int;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    t := public.report_pilot_problem(store, 'A impressora não imprimiu a comanda do pedido.', '/painel/pedidos/3f1c2d9e-1234-4abc-9def-1234567890ab?cliente=Maria&tel=11999990000', 'Mozilla/5.0 Teste');
    select * into row from public.support_tickets where id = t;
    results := results || jsonb_build_object('s','1. dono abre chamado na Central de Suporte','ok', row.source = 'pilot_feedback' and row.status = 'open' and row.establishment_id = store, 'd', row.title);
    results := results || jsonb_build_object('s','2. página sem query string e sem identificadores','ok', row.context_snapshot->>'page' = '/painel/pedidos/:id'
      and row.context_snapshot::text not like '%Maria%' and row.context_snapshot::text not like '%11999990000%', 'd', row.context_snapshot::text);
    perform set_config('request.jwt.claims', json_build_object('sub', waiter_id, 'role', 'authenticated')::text, true);
    t := public.report_pilot_problem(store, 'Não consegui fechar a conta da mesa 1.', '/garcom/app', 'Android');
    results := results || jsonb_build_object('s','3. garçom também relata','ok', (select context_snapshot->>'role' from public.support_tickets where id = t) in ('waiter','attendant'), 'd', (select context_snapshot->>'role' from public.support_tickets where id = t));
    perform set_config('request.jwt.claims', json_build_object('sub', cook_id, 'role', 'authenticated')::text, true);
    t := public.report_pilot_problem(store, 'Comanda apareceu duplicada na tela.', '/cozinha', 'Chrome');
    results := results || jsonb_build_object('s','4. cozinha relata','ok', t is not null, 'd', (select context_snapshot->>'role' from public.support_tickets where id = t));
    perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
    begin
      perform public.report_pilot_problem(store, 'Tentativa de quem não é da loja.', '/painel', 'x');
      results := results || jsonb_build_object('s','5. quem não é da loja não abre chamado','ok', false, 'd', 'aceitou');
    exception when insufficient_privilege then
      results := results || jsonb_build_object('s','5. quem não é da loja não abre chamado','ok', true, 'd', 'FORBIDDEN');
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    begin
      for i in 1..10 loop perform public.report_pilot_problem(store, 'Relato repetido número ' || i, '/painel', 'x'); end loop;
      results := results || jsonb_build_object('s','6. limite de 10 por hora','ok', false, 'd', 'não barrou');
    exception when others then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s','6. limite de 10 por hora','ok', msg like 'Muitos relatos%', 'd', msg);
    end;
    results := results || jsonb_build_object('s','7. anon não executa','ok', not has_function_privilege('anon','public.report_pilot_problem(uuid,text,text,text)','execute'), 'd', 'privilégio');
    raise exception 'ROLLBACK99H';
  exception when others then
    if sqlerrm <> 'ROLLBACK99H' then results := results || jsonb_build_object('s','erro','ok',false,'d',sqlerrm); end if;
  end;
  return query select x->>'s', (x->>'ok')::boolean, x->>'d' from jsonb_array_elements(results) x;
end $$;
select * from pg_temp.phase99h();

-- Painel do piloto (superadmin_pilot_overview). O dev não tem superadmin: o teste marca um perfil e desfaz.
create or replace function pg_temp.p99h_overview() returns table(scenario text, ok boolean, detail text) language plpgsql as $$
declare own uuid := (select user_id from public.establishment_members where role='owner' limit 1);
  sa uuid := (select id from public.profiles where id <> own limit 1); r jsonb; results jsonb := '[]';
begin
  begin
    update public.profiles set is_superadmin = true where id = sa;
    perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
    r := public.superadmin_pilot_overview();
    results := results || jsonb_build_object('s','8. superadmin vê o painel do piloto','ok', jsonb_typeof(r->'stores') = 'array' and r ? 'errors_24h', 'd', left(r::text, 600));
    results := results || jsonb_build_object('s','9. painel sem dados de clientes','ok', r::text !~* '(customer_name|customer_phone|phone|email|address)', 'd', 'chaves agregadas');
    perform set_config('request.jwt.claims', json_build_object('sub', own, 'role','authenticated')::text, true);
    begin perform public.superadmin_pilot_overview();
      results := results || jsonb_build_object('s','10. dono não vê o painel do piloto','ok', false, 'd', 'aceitou');
    exception when insufficient_privilege then results := results || jsonb_build_object('s','10. dono não vê o painel do piloto','ok', true, 'd', 'FORBIDDEN'); end;
    raise exception 'ROLLBACK99H';
  exception when others then if sqlerrm <> 'ROLLBACK99H' then results := results || jsonb_build_object('s','erro','ok',false,'d',sqlerrm); end if; end;
  return query select x->>'s', (x->>'ok')::boolean, x->>'d' from jsonb_array_elements(results) x;
end $$;
select * from pg_temp.p99h_overview();
