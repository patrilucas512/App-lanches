-- Fase 99G: prova do registro de erros e do alerta app_errors. Rodar SÓ no masterapp-dev. Tudo desfeito no fim.
create or replace function pg_temp.phase99g() returns table(scenario text, ok boolean, detail text) language plpgsql as $$
declare results jsonb := '[]'; r jsonb; n int;
begin
  begin
    update public.pilot_alert_rules set enabled = (rule_key = 'app_errors');
    insert into public.app_error_events(environment, route, error_name, message, fingerprint)
      select 'development', '/api/teste/[id]', 'TypeError', 'falha simulada ' || g, md5('x' || (g % 3))::text::varchar(32) from generate_series(1, 10) g;
    insert into public.app_error_events(environment, route, error_name, message, fingerprint, occurred_at)
      select 'development', '/api/antigo', 'Error', 'antigo', 'old', now() - interval '15 days' from generate_series(1, 2);
    r := private.evaluate_pilot_alerts_and_purge(now());
    results := results || jsonb_build_object('s','1. 10 erros em 15 min abrem o alerta app_errors','ok', (r->>'opened')::int = 1
      and exists(select 1 from public.pilot_alerts where rule_key='app_errors' and status='open'), 'd', r::text);
    results := results || jsonb_build_object('s','2. erros com mais de 14 dias são apagados','ok', (r->>'purged_app_errors')::int = 2, 'd', r->>'purged_app_errors');
    select count(*) into n from public.notification_inbox_items where source_type='pilot_alert' and dedup_key='pilot_alert:app_errors' and domain='platform';
    results := results || jsonb_build_object('s','3. avisa o superadmin, não o dono','ok', n = 1 and not exists(select 1 from public.notification_inbox_items where dedup_key='pilot_alert:app_errors' and domain='tenant'), 'd', n || ' aviso');
    results := results || jsonb_build_object('s','4. só servidor grava; ninguém de fora lê','ok', not has_table_privilege('anon','public.app_error_events','select')
      and not has_table_privilege('authenticated','public.app_error_events','insert') and has_table_privilege('service_role','public.app_error_events','insert'), 'd', 'privilégios');
    results := results || jsonb_build_object('s','5. sinais antigos da 98F continuam','ok', to_regprocedure('private.pilot_alert_signals_base(timestamptz)') is not null, 'd', 'base');
    raise exception 'ROLLBACK99G';
  exception when others then
    if sqlerrm <> 'ROLLBACK99G' then results := results || jsonb_build_object('s','erro','ok',false,'d',sqlerrm); end if;
  end;
  return query select x->>'s', (x->>'ok')::boolean, x->>'d' from jsonb_array_elements(results) x;
end $$;
select * from pg_temp.phase99g();
