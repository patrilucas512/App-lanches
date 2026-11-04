-- Fase 98F: cenários simulados dos alertas do piloto. Rodar SÓ no masterapp-dev.
-- Tudo acontece numa subtransação desfeita no fim; o resultado sai como linhas (ok = true em todas).
create or replace function pg_temp.phase98f_check() returns table(scenario text, ok boolean, detail text)
language plpgsql as $$
declare
  store uuid := (select id from public.establishments where slug = 'lanchonete-teste');
  t0 timestamptz := now();
  order_id uuid;
  gateway uuid;
  r jsonb;
  results jsonb := '[]'::jsonb;
  n bigint;
  m bigint;
begin
  begin
    -- só os alertas desta simulação: limpa o que estiver aberto (desfeito no fim)
    update public.pilot_alerts set status = 'resolved', resolved_at = t0 where status = 'open';
    update public.pilot_alert_rules set enabled = rule_key in ('stuck_order','payment_failed','payment_pending','printer_offline');

    -- pedido parado: um pedido aberto sem atualização há 2 h
    select o.id into order_id from public.orders o where o.establishment_id = store order by o.created_at desc limit 1;
    alter table public.orders disable trigger user;
    -- os outros pedidos de teste abertos ficariam "parados" na hora simulada; fecha todos menos o do cenário
    update public.orders set status = 'completed' where establishment_id = store and id <> order_id and status::text in ('new','confirmed','preparing','ready','out_for_delivery');
    update public.orders set status = 'preparing', created_at = t0 - interval '3 hours', updated_at = t0 - interval '2 hours' where id = order_id;
    alter table public.orders enable trigger user;
    -- 3 pagamentos recusados agora e 1 pendente há 40 min
    insert into public.payment_gateway_accounts(establishment_id, provider, active, environment) values (store, 'mercado_pago', true, 'test') returning id into gateway;
    insert into public.order_payment_transactions(establishment_id, order_id, gateway_account_id, provider, status, amount_cents, idempotency_key, declined_at, created_at, updated_at)
    select store, order_id, gateway, 'mercado_pago', 'declined', 1000, 'e2e-98f-' || g, t0 - interval '5 minutes', t0 - interval '6 minutes', t0 - interval '5 minutes' from generate_series(1, 3) g;
    insert into public.order_payment_transactions(establishment_id, order_id, gateway_account_id, provider, status, amount_cents, idempotency_key, created_at, updated_at)
    values (store, order_id, gateway, 'mercado_pago', 'pending', 1000, 'e2e-98f-pending', t0 - interval '40 minutes', t0 - interval '40 minutes');
    -- impressora ativa sem sinal há 20 min
    insert into public.printer_devices(establishment_id, name, printer_name, token_hash, active, last_seen_at, auto_print)
    values (store, 'Cozinha E2E', 'E2E-80mm', '\x00'::bytea, true, t0 - interval '20 minutes', true);

    -- 1ª avaliação: abre um alerta por sinal e avisa
    r := private.evaluate_pilot_alerts(t0);
    results := results || jsonb_build_object('s', '1. abre os 4 alertas simulados', 'ok', (r->>'opened')::int = 4 and (r->>'notified')::int = 4, 'd', r::text);
    select count(*) into n from public.pilot_alerts where status = 'open' and establishment_id = store and rule_key in ('stuck_order','payment_failed','payment_pending','printer_offline');
    results := results || jsonb_build_object('s', '2. um alerta aberto por regra na loja', 'ok', n = 4, 'd', n || ' abertos');
    select count(*) into n from public.notification_inbox_items where source_type = 'pilot_alert' and domain = 'platform' and status = 'unread';
    select count(*) into m from public.notification_inbox_items where source_type = 'pilot_alert' and domain = 'tenant' and store_id = store and recipient_role_id = 'owner';
    results := results || jsonb_build_object('s', '3. avisa o superadmin (4) e o dono da loja (4)', 'ok', n = 4 and m = 4, 'd', n || ' superadmin, ' || m || ' dono');

    -- 2ª avaliação 5 min depois: mesmo alerta, sem novo aviso (cooldown)
    r := private.evaluate_pilot_alerts(t0 + interval '5 minutes');
    results := results || jsonb_build_object('s', '4. reavaliação dentro do cooldown não duplica nem avisa', 'ok', (r->>'opened')::int = 0 and (r->>'repeated')::int = 4 and (r->>'notified')::int = 0, 'd', r::text);
    select count(*) into n from public.pilot_alerts where establishment_id = store and status = 'open';
    results := results || jsonb_build_object('s', '5. continua um alerta por regra', 'ok', n = 4, 'd', n || ' abertos');

    -- 3ª avaliação depois do cooldown: avisa de novo no mesmo item (sem nova linha)
    r := private.evaluate_pilot_alerts(t0 + interval '70 minutes');
    select count(*), coalesce(max(occurrence_count), 0) into n, m from public.notification_inbox_items where source_type = 'pilot_alert' and domain = 'platform' and dedup_key = 'pilot_alert:printer_offline:' || (select id from public.printer_devices where name = 'Cozinha E2E');
    results := results || jsonb_build_object('s', '6. depois do cooldown avisa de novo no mesmo item', 'ok', (r->>'notified')::int >= 1 and n = 1 and m = 2, 'd', r::text || ' / itens=' || n || ' ocorrências=' || m);

    -- sinal some: a impressora volta, o pedido anda
    update public.printer_devices set last_seen_at = t0 + interval '70 minutes' where name = 'Cozinha E2E';
    alter table public.orders disable trigger user;
    update public.orders set status = 'completed', updated_at = t0 + interval '70 minutes' where id = order_id;
    alter table public.orders enable trigger user;
    r := private.evaluate_pilot_alerts(t0 + interval '71 minutes');
    select count(*) into n from public.pilot_alerts where establishment_id = store and status = 'open' and rule_key in ('printer_offline','stuck_order');
    select count(*) into m from public.notification_inbox_items where source_type = 'pilot_alert' and dedup_key like 'pilot_alert:printer_offline:%' and status <> 'resolved';
    results := results || jsonb_build_object('s', '7. resolve alerta e aviso quando o sinal some', 'ok', (r->>'resolved')::int = 2 and n = 0 and m = 0, 'd', r::text);

    -- regra desligada não gera alerta
    update public.pilot_alert_rules set enabled = false;
    r := private.evaluate_pilot_alerts(t0 + interval '72 minutes');
    results := results || jsonb_build_object('s', '8. regra desligada não alerta (e fecha os abertos)', 'ok', (r->>'opened')::int = 0, 'd', r::text);

    -- quem lê: anon não lê; dono lê só a loja dele
    results := results || jsonb_build_object('s', '9. anon não lê alertas nem executa a avaliação', 'ok',
      not has_table_privilege('anon', 'public.pilot_alerts', 'select') and not has_function_privilege('authenticated', 'private.evaluate_pilot_alerts(timestamptz)', 'execute'), 'd', 'privilégios');
    raise exception 'PHASE98F_ROLLBACK';
  exception when others then
    if sqlerrm <> 'PHASE98F_ROLLBACK' then results := results || jsonb_build_object('s', 'erro inesperado', 'ok', false, 'd', sqlerrm); end if;
  end;
  return query select x->>'s', (x->>'ok')::boolean, x->>'d' from jsonb_array_elements(results) x;
end $$;
select * from pg_temp.phase98f_check();
