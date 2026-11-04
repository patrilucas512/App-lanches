-- quality: allow-nonconcurrent-index reason=new-empty-pilot-alert-tables (os índices são de tabelas criadas nesta migration)
-- Fase 98F: alertas automáticos do piloto (as consultas do docs/loja-piloto-runbook.md, seção 4.2).
--
-- private.evaluate_pilot_alerts() roda dentro do banco (pg_cron), sem depender do app nem do bypass da Vercel:
--   1. calcula os sinais de cada regra ligada em public.pilot_alert_rules;
--   2. abre um alerta por dedup_key, ou só atualiza o mesmo alerta aberto (sem duplicar);
--   3. avisa na central de notificações (Fase 52): o superadmin (domínio 'platform') sempre e o dono da loja
--      (domínio 'tenant', papel 'owner') quando a regra pede; repete o aviso só depois do cooldown;
--   4. resolve os alertas cujo sinal sumiu.
-- O agendamento fica em scripts/dev/pilot-alerts-cron.sql (dev). Em produção, só com aprovação.

create table if not exists public.pilot_alert_rules (
  rule_key text primary key check (rule_key in ('stuck_order','payment_failed','payment_pending','worker_stale','printer_offline','api_error_rate')),
  enabled boolean not null default true,
  threshold numeric not null check (threshold > 0),
  window_minutes integer not null check (window_minutes between 1 and 10080),
  cooldown_minutes integer not null default 60 check (cooldown_minutes between 5 and 1440),
  min_samples integer not null default 1 check (min_samples >= 1),
  notify_owner boolean not null default true,
  description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.pilot_alert_rules(rule_key, threshold, window_minutes, cooldown_minutes, min_samples, notify_owner, description) values
  ('stuck_order', 45, 1440, 60, 1, true, 'Pedido aberto sem mudar de status há mais de N minutos (threshold).'),
  ('payment_failed', 3, 60, 60, 1, true, 'N ou mais pagamentos online recusados, com erro ou expirados na janela.'),
  ('payment_pending', 30, 360, 60, 1, true, 'Pagamento online pendente há mais de N minutos.'),
  ('worker_stale', 30, 180, 120, 1, false, 'Job ativo do pg_cron sem execução com sucesso há mais de N minutos.'),
  ('printer_offline', 10, 1440, 60, 1, true, 'Impressora ativa com impressão automática sem sinal há mais de N minutos.'),
  ('api_error_rate', 0.2, 15, 60, 10, false, 'Fração de respostas com erro acima de N (workers: qualquer resposta fora de 2xx, como 401 por segredo ausente; API pública: 5xx), com pelo menos min_samples chamadas.')
on conflict (rule_key) do nothing;
alter table public.pilot_alert_rules enable row level security;
revoke all on public.pilot_alert_rules from anon, authenticated;
grant select, update on public.pilot_alert_rules to authenticated;
drop policy if exists pilot_alert_rules_superadmin on public.pilot_alert_rules;
create policy pilot_alert_rules_superadmin on public.pilot_alert_rules for all to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

create table if not exists public.pilot_alerts (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null references public.pilot_alert_rules(rule_key),
  establishment_id uuid references public.establishments(id) on delete cascade,
  dedup_key text not null,
  severity text not null check (severity in ('medium','high','critical')),
  title text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved')),
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz,
  notifications_sent integer not null default 0,
  resolved_at timestamptz
);
create unique index if not exists pilot_alerts_open_dedup_idx on public.pilot_alerts(dedup_key) where status = 'open';
create index if not exists pilot_alerts_store_idx on public.pilot_alerts(establishment_id, status, last_seen_at desc);
create index if not exists pilot_alerts_rule_idx on public.pilot_alerts(rule_key);
alter table public.pilot_alerts enable row level security;
revoke all on public.pilot_alerts from anon, authenticated;
grant select on public.pilot_alerts to authenticated;
drop policy if exists pilot_alerts_read on public.pilot_alerts;
create policy pilot_alerts_read on public.pilot_alerts for select to authenticated
  using ((select private.is_superadmin()) or (establishment_id is not null and private.has_role(establishment_id, array['owner'::public.member_role,'manager'::public.member_role])));

-- Sinais atuais de todas as regras ligadas: uma linha por alerta que deveria estar aberto.
create or replace function private.pilot_alert_signals(requested_now timestamptz default now())
returns table(rule_key text, establishment_id uuid, dedup_key text, severity text, title text, summary text, details jsonb)
language sql stable security definer set search_path = '' as $$
  with r as (select * from public.pilot_alert_rules where enabled)
  -- pedido travado: aberto e sem atualização há mais de threshold minutos (criado dentro da janela)
  select 'stuck_order', o.establishment_id, 'stuck_order:' || o.establishment_id,
    case when count(*) >= 5 then 'critical' else 'high' end,
    'Pedidos parados',
    count(*) || ' pedido(s) sem avançar há mais de ' || r.threshold::int || ' min (mais antigo: #' || min(o.order_number) || ').',
    jsonb_build_object('orders', count(*), 'oldest_update', min(o.updated_at), 'statuses', jsonb_agg(distinct o.status))
  from public.orders o cross join r
  where r.rule_key = 'stuck_order' and o.status::text in ('new','confirmed','preparing','ready','out_for_delivery')
    and o.created_at > requested_now - make_interval(mins => r.window_minutes)
    and o.updated_at < requested_now - make_interval(mins => r.threshold::int)
  group by o.establishment_id, r.threshold
  union all
  -- pagamento falho: recusas, erros ou expirações na janela
  select 'payment_failed', t.establishment_id, 'payment_failed:' || t.establishment_id, 'high',
    'Pagamentos online falhando',
    count(*) || ' pagamento(s) recusado(s), com erro ou expirado(s) nos últimos ' || r.window_minutes || ' min.',
    jsonb_build_object('failures', count(*), 'statuses', jsonb_agg(distinct t.status))
  from public.order_payment_transactions t cross join r
  where r.rule_key = 'payment_failed' and t.status in ('declined','error','expired')
    and coalesce(t.declined_at, t.updated_at, t.created_at) > requested_now - make_interval(mins => r.window_minutes)
  group by t.establishment_id, r.threshold, r.window_minutes
  having count(*) >= r.threshold
  union all
  -- pagamento pendente além do normal
  select 'payment_pending', t.establishment_id, 'payment_pending:' || t.establishment_id, 'medium',
    'Pagamentos pendentes há muito tempo',
    count(*) || ' pagamento(s) online pendente(s) há mais de ' || r.threshold::int || ' min.',
    jsonb_build_object('pending', count(*), 'oldest', min(t.created_at))
  from public.order_payment_transactions t cross join r
  where r.rule_key = 'payment_pending' and t.status = 'pending'
    and t.created_at > requested_now - make_interval(mins => r.window_minutes)
    and t.created_at < requested_now - make_interval(mins => r.threshold::int)
  group by t.establishment_id, r.threshold
  union all
  -- worker parado: job ativo sem sucesso há mais que o maior entre o limite e 2× o intervalo real do job
  -- (o intervalo vem das últimas execuções; um job de hora em hora não alarma com limite de 30 min)
  select 'worker_stale', null::uuid, 'worker_stale:' || w.jobname, 'high',
    'Rotina automática parada',
    'O job ' || w.jobname || ' não roda com sucesso há ' || coalesce(round(extract(epoch from requested_now - w.last_success) / 60)::text || ' min', 'muito tempo (nunca teve sucesso)') || '.',
    jsonb_build_object('job', w.jobname, 'schedule', w.schedule, 'last_success', w.last_success, 'last_status', w.last_status,
      'expected_gap_minutes', round(extract(epoch from w.gap) / 60))
  from (
    select j.jobname, j.schedule,
      (select max(d.end_time) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded') as last_success,
      (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_status,
      (select (max(x.start_time) - min(x.start_time)) / greatest(count(*) - 1, 1)
         from (select d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 10) x) as gap,
      (select count(*) from cron.job_run_details d where d.jobid = j.jobid) as runs
    from cron.job j where j.active and j.jobname like 'masterapp-%' and j.jobname <> 'masterapp-pilot-alerts'
  ) w cross join r
  where r.rule_key = 'worker_stale' and w.runs >= 2
    and coalesce(w.last_success, '-infinity'::timestamptz)
        < requested_now - greatest(make_interval(mins => r.threshold::int), 2 * coalesce(w.gap, interval '0'))
  union all
  -- impressora da cozinha sem sinal
  select 'printer_offline', p.establishment_id, 'printer_offline:' || p.id, 'high',
    'Impressora da cozinha sem sinal',
    'A impressora "' || p.name || '" não dá sinal há mais de ' || r.threshold::int || ' min.',
    jsonb_build_object('printer_id', p.id, 'last_seen_at', p.last_seen_at)
  from public.printer_devices p cross join r
  where r.rule_key = 'printer_offline' and p.active and coalesce(p.auto_print, true)
    and p.last_seen_at is not null and p.last_seen_at < requested_now - make_interval(mins => r.threshold::int)
    and p.last_seen_at > requested_now - make_interval(mins => r.window_minutes)
  union all
  -- taxa de erro: chamadas dos workers (pg_net) e da API pública
  select 'api_error_rate', null::uuid, 'api_error_rate', 'critical',
    'Taxa de erro alta nas chamadas',
    round(100.0 * sum(e.failed) / count(*)) || '% de erro em ' || count(*) || ' chamadas nos últimos ' || max(r.window_minutes) || ' min.',
    jsonb_build_object('calls', count(*), 'failed', sum(e.failed), 'sources', jsonb_agg(distinct e.source))
  from (
    select 'workers'::text as source, case when h.status_code is null or h.status_code not between 200 and 299 or h.timed_out or h.error_msg is not null then 1 else 0 end as failed, h.created
    from net._http_response h
    union all
    select 'api_publica', case when l.status_code >= 500 then 1 else 0 end, l.created_at from public.api_request_logs l
  ) e cross join r
  where r.rule_key = 'api_error_rate' and e.created > requested_now - make_interval(mins => r.window_minutes)
  group by r.threshold, r.min_samples
  having count(*) >= r.min_samples and sum(e.failed)::numeric / count(*) > r.threshold
$$;
revoke all on function private.pilot_alert_signals(timestamptz) from public, anon, authenticated;

create or replace function private.notify_pilot_alert(requested_alert public.pilot_alerts, requested_notify_owner boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  target record;
begin
  if requested_notify_owner and requested_alert.establishment_id is not null then
    select e.organization_id into org from public.establishments e where e.id = requested_alert.establishment_id;
  end if;
  -- superadmin (domínio 'platform', sem organização) e, quando a regra pede, o dono da loja.
  -- Atualiza o aviso aberto com a mesma chave em vez de criar outro (o índice único não cobre organização nula).
  for target in
    select 'platform'::text as domain, null::uuid as organization_id, 'superadmin'::text as role, '/superadmin/alertas'::text as route
    union all
    select 'tenant', org, 'owner',
      case requested_alert.rule_key when 'printer_offline' then '/painel/configuracoes' when 'stuck_order' then '/painel/pedidos' else '/painel' end
    where org is not null
  loop
    update public.notification_inbox_items n
      set occurrence_count = n.occurrence_count + 1, last_occurrence_at = now(), summary = requested_alert.summary,
          priority = requested_alert.severity, status = 'unread', read_at = null
    where n.domain = target.domain and n.organization_id is not distinct from target.organization_id
      and n.recipient_role_id = target.role and n.dedup_key = 'pilot_alert:' || requested_alert.dedup_key
      and n.status <> all (array['resolved','dismissed','expired']);
    if not found then
      insert into public.notification_inbox_items(domain, organization_id, store_id, recipient_role_id, source_type, source_id, event_type,
        category, title, summary, priority, status, dedup_key, route, metadata, occurrence_count, first_occurrence_at, last_occurrence_at)
      values (target.domain, target.organization_id, requested_alert.establishment_id, target.role, 'pilot_alert', requested_alert.id::text,
        'pilot_alert.' || requested_alert.rule_key, 'operations', requested_alert.title, requested_alert.summary, requested_alert.severity,
        'unread', 'pilot_alert:' || requested_alert.dedup_key, target.route,
        jsonb_build_object('rule', requested_alert.rule_key), 1, now(), now());
    end if;
  end loop;
end $$;
revoke all on function private.notify_pilot_alert(public.pilot_alerts, boolean) from public, anon, authenticated;

create or replace function private.evaluate_pilot_alerts(requested_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  a public.pilot_alerts;
  rule public.pilot_alert_rules;
  opened integer := 0; repeated integer := 0; notified integer := 0; resolved integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('masterapp.pilot_alerts'));
  create temporary table if not exists pg_temp.pilot_alert_current(dedup_key text primary key) on commit drop;
  truncate pg_temp.pilot_alert_current;
  for s in select * from private.pilot_alert_signals(requested_now) loop
    insert into pg_temp.pilot_alert_current values (s.dedup_key) on conflict do nothing;
    select * into rule from public.pilot_alert_rules where rule_key = s.rule_key;
    select * into a from public.pilot_alerts where dedup_key = s.dedup_key and status = 'open' for update;
    if a.id is null then
      insert into public.pilot_alerts(rule_key, establishment_id, dedup_key, severity, title, summary, details, first_seen_at, last_seen_at)
      values (s.rule_key, s.establishment_id, s.dedup_key, s.severity, s.title, s.summary, s.details, requested_now, requested_now)
      returning * into a;
      opened := opened + 1;
    else
      update public.pilot_alerts set occurrences = occurrences + 1, last_seen_at = requested_now, severity = s.severity,
        summary = s.summary, details = s.details where id = a.id returning * into a;
      repeated := repeated + 1;
    end if;
    if a.last_notified_at is null or a.last_notified_at < requested_now - make_interval(mins => rule.cooldown_minutes) then
      perform private.notify_pilot_alert(a, rule.notify_owner);
      update public.pilot_alerts set last_notified_at = requested_now, notifications_sent = notifications_sent + 1 where id = a.id;
      notified := notified + 1;
    end if;
    a := null;
  end loop;
  with gone as (
    update public.pilot_alerts p set status = 'resolved', resolved_at = requested_now
    where p.status = 'open' and not exists (select 1 from pg_temp.pilot_alert_current c where c.dedup_key = p.dedup_key)
    returning p.dedup_key
  ), notes as (
    update public.notification_inbox_items n set status = 'resolved', resolved_at = requested_now
    from gone where n.dedup_key = 'pilot_alert:' || gone.dedup_key and n.status <> all (array['resolved','dismissed','expired'])
    returning n.id
  )
  select count(*) into resolved from gone;
  return jsonb_build_object('opened', opened, 'repeated', repeated, 'notified', notified, 'resolved', resolved, 'at', requested_now);
end $$;
revoke all on function private.evaluate_pilot_alerts(timestamptz) from public, anon, authenticated;
