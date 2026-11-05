-- quality: allow-nonconcurrent-index reason=new-empty-app-error-tables (índices da tabela criada nesta migration)
-- Fase 99G: registro de erros do app (rotas e APIs) que dura mais que a 1 hora de log do plano Hobby da Vercel.
-- * public.app_error_events: gravada só pelo servidor (instrumentation.ts -> lib/error-log.ts), já mascarada
--   (sem e-mail, telefone, CPF/CNPJ, tokens ou chaves; rota como modelo, sem query string). Retenção de 14 dias.
-- * Alerta novo 'app_errors' no avaliador da Fase 98F: N ou mais erros do app na janela.

create table if not exists public.app_error_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  environment text not null check (char_length(environment) <= 20),
  release text check (char_length(release) <= 12),
  route text not null check (char_length(route) <= 200),
  route_type text check (char_length(route_type) <= 20),
  method text check (char_length(method) <= 10),
  status integer not null default 500,
  error_name text not null check (char_length(error_name) <= 80),
  message text not null default '' check (char_length(message) <= 500),
  digest text check (char_length(digest) <= 80),
  fingerprint text not null check (char_length(fingerprint) <= 32)
);
create index if not exists app_error_events_time_idx on public.app_error_events(occurred_at desc);
create index if not exists app_error_events_fingerprint_idx on public.app_error_events(fingerprint, occurred_at desc);
alter table public.app_error_events enable row level security;
revoke all on public.app_error_events from anon, authenticated;
grant select on public.app_error_events to authenticated;
grant insert on public.app_error_events to service_role;
drop policy if exists app_error_events_superadmin_read on public.app_error_events;
create policy app_error_events_superadmin_read on public.app_error_events for select to authenticated using ((select private.is_superadmin()));

-- Retenção: apaga o que tem mais de 14 dias (roda junto com a avaliação dos alertas).
create or replace function private.purge_app_error_events()
returns integer language sql security definer set search_path = '' as $$
  with gone as (delete from public.app_error_events where occurred_at < now() - interval '14 days' returning 1) select count(*)::int from gone
$$;
revoke all on function private.purge_app_error_events() from public, anon, authenticated;

alter table public.pilot_alert_rules drop constraint if exists pilot_alert_rules_rule_key_check;
alter table public.pilot_alert_rules add constraint pilot_alert_rules_rule_key_check
  check (rule_key in ('stuck_order','payment_failed','payment_pending','worker_stale','printer_offline','api_error_rate','app_errors'));
insert into public.pilot_alert_rules(rule_key, threshold, window_minutes, cooldown_minutes, min_samples, notify_owner, description)
values ('app_errors', 10, 15, 60, 1, false, 'N ou mais erros do app (rotas e APIs, public.app_error_events) na janela.')
on conflict (rule_key) do nothing;

-- Os sinais da 98F continuam iguais; a função nova soma o sinal de erros do app.
do $$ begin
  if to_regprocedure('private.pilot_alert_signals_base(timestamptz)') is null then
    alter function private.pilot_alert_signals(timestamptz) rename to pilot_alert_signals_base;
  end if;
end $$;
create or replace function private.pilot_alert_signals(requested_now timestamptz default now())
returns table(rule_key text, establishment_id uuid, dedup_key text, severity text, title text, summary text, details jsonb)
language sql stable security definer set search_path = '' as $$
  select * from private.pilot_alert_signals_base(requested_now)
  union all
  select 'app_errors', null::uuid, 'app_errors', case when count(*) >= r.threshold * 3 then 'critical' else 'high' end,
    'Erros no app',
    count(*) || ' erro(s) do app nos últimos ' || r.window_minutes || ' min (' || count(distinct e.fingerprint) || ' tipo(s)).',
    jsonb_build_object('errors', count(*), 'kinds', count(distinct e.fingerprint),
      'top_routes', (select jsonb_agg(x) from (select e2.route, count(*) n from public.app_error_events e2
                     where e2.occurred_at > requested_now - make_interval(mins => r.window_minutes) group by e2.route order by 2 desc limit 3) x))
  from public.app_error_events e cross join public.pilot_alert_rules r
  where r.rule_key = 'app_errors' and r.enabled and e.occurred_at > requested_now - make_interval(mins => r.window_minutes)
  group by r.threshold, r.window_minutes
  having count(*) >= r.threshold
$$;
revoke all on function private.pilot_alert_signals(timestamptz) from public, anon, authenticated;
revoke all on function private.pilot_alert_signals_base(timestamptz) from public, anon, authenticated;

-- A avaliação passa a limpar os erros antigos (sem novo agendamento).
create or replace function private.evaluate_pilot_alerts_and_purge(requested_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.evaluate_pilot_alerts(requested_now) || jsonb_build_object('purged_app_errors', private.purge_app_error_events());
end $$;
revoke all on function private.evaluate_pilot_alerts_and_purge(timestamptz) from public, anon, authenticated;
