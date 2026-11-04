-- Fase 98G (lote 1): prova das funções públicas. Rodar SÓ no masterapp-dev. Tudo desfeito no fim.
create or replace function pg_temp.phase98g1() returns table(scenario text, ok boolean, detail text) language plpgsql as $$
declare results jsonb := '[]'; i int; allowed int := 0; msg text; body text;
begin
  results := results || jsonb_build_object('s','anon não executa place_public_order (v1) nem set_store_open','ok',
    not has_function_privilege('anon','public.place_public_order(text,text,text,text,jsonb,text,text,text,text,integer)','execute')
    and not has_function_privilege('anon','public.set_store_open(uuid,boolean)','execute')
    and has_function_privilege('authenticated','public.set_store_open(uuid,boolean)','execute'),'d','privilégios');
  results := results || jsonb_build_object('s','anon continua executando o cardápio e o pedido v2','ok',
    has_function_privilege('anon','public.place_public_order_v2(text,text,text,text,jsonb,text,text,text,text,integer,jsonb)','execute')
    and has_function_privilege('anon','public.get_public_menu(text)','execute'),'d','privilégios');
  select pg_get_functiondef('public.place_public_order_v2(text,text,text,text,jsonb,text,text,text,text,integer,jsonb)'::regprocedure) into body;
  results := results || jsonb_build_object('s','checagem injetada nas 3 escritas públicas','ok',
    body ~ 'begin\s+perform private\.enforce_public_order_rate\(requested_slug\);'
    and pg_get_functiondef('public.start_web_chat_session(uuid,text,text)'::regprocedure) like '%public_rate_allow(''web_chat_session''%'
    and pg_get_functiondef('public.record_public_event(text,text,uuid,uuid,integer)'::regprocedure) like '%public_rate_allow(''public_event''%','d','definição');
  begin
    perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    for i in 1..31 loop
      if private.public_rate_allow('order_ip', 'loja-x|' || private.request_ip_key(), 30, interval '10 minutes') then allowed := allowed + 1; end if;
    end loop;
    results := results || jsonb_build_object('s','30 pedidos por IP passam, o 31º é barrado','ok', allowed = 30, 'd', allowed || ' permitidos; ip=' || private.request_ip_key());
    perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', true);
    results := results || jsonb_build_object('s','outro IP não é afetado','ok', private.public_rate_allow('order_ip', 'loja-x|' || private.request_ip_key(), 30, interval '10 minutes'), 'd', private.request_ip_key());
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
    results := results || jsonb_build_object('s','servidor (service_role) não entra no limite','ok', private.public_rate_allow('order_ip', 'loja-x|' || private.request_ip_key(), 30, interval '10 minutes'), 'd', 'service_role');
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin
      for i in 1..31 loop perform private.enforce_public_order_rate('loja-y'); end loop;
      results := results || jsonb_build_object('s','pedido barrado com mensagem clara','ok', false, 'd', 'não barrou');
    exception when others then
      get stacked diagnostics msg = message_text;
      results := results || jsonb_build_object('s','pedido barrado com mensagem clara','ok', msg like 'Muitos pedidos em pouco tempo%', 'd', msg);
    end;
    raise exception 'ROLLBACK98G';
  exception when others then
    if sqlerrm <> 'ROLLBACK98G' then results := results || jsonb_build_object('s','erro','ok',false,'d',sqlerrm); end if;
  end;
  return query select x->>'s', (x->>'ok')::boolean, x->>'d' from jsonb_array_elements(results) x;
end $$;
select * from pg_temp.phase98g1();
