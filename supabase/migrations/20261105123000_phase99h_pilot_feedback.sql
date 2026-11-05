-- Fase 99H: botão "Relatar problema" do piloto (dono, gerente e equipe) abre chamado na Central de Suporte
-- (Fase 24, public.support_tickets). A RPC de chamados da Fase 24 exige membro da organização; garçom, cozinha,
-- caixa e entregador não são. Esta RPC aceita qualquer pessoa vinculada à loja.
-- Contexto gravado: só a página (sem query string e sem identificadores), horário, navegador e papel. Nenhum dado
-- de cliente é capturado automaticamente. Limite: 10 relatos por pessoa por hora.

create or replace function public.report_pilot_problem(requested_store_id uuid, requested_description text, requested_page text, requested_browser text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  store public.establishments%rowtype;
  role text;
  page text;
  ticket uuid;
  recent integer;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if length(btrim(coalesce(requested_description, ''))) not between 10 and 2000 then
    raise exception 'Descreva o problema em pelo menos 10 caracteres.' using errcode = '22023';
  end if;
  select * into store from public.establishments where id = requested_store_id;
  if store.id is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce(
    (select m.role::text from public.establishment_members m where m.establishment_id = store.id and m.user_id = uid and m.status = 'active' limit 1),
    (select 'waiter' from public.waiters w where w.establishment_id = store.id and w.user_id = uid limit 1),
    (select 'kitchen' from public.kitchen_operators k where k.establishment_id = store.id and k.user_id = uid limit 1),
    (select case when r.system_key = 'driver' then 'driver' else 'staff' end from public.custom_staff_members s
       join public.staff_roles r on r.id = s.role_id where s.establishment_id = store.id and s.user_id = uid limit 1)
  ) into role;
  if role is null and not private.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select count(*) into recent from public.support_tickets
    where created_by_user_id = uid and source = 'pilot_feedback' and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'Muitos relatos em pouco tempo. Tente de novo em alguns minutos.' using errcode = 'P0001'; end if;
  -- página sem query string; segmentos com cara de identificador viram :id
  select string_agg(case when seg ~* '^[0-9a-f-]{20,}$' or seg ~ '^\d{4,}$' or length(seg) > 40 then ':id' else seg end, '/' order by n)
    into page from unnest(string_to_array(split_part(left(coalesce(requested_page, ''), 300), '?', 1), '/')) with ordinality as t(seg, n);
  insert into public.support_tickets(establishment_id, organization_id, created_by, created_by_user_id, title, subject, description,
    category, priority, status, source, context_snapshot, last_customer_message_at)
  values (store.id, store.organization_id, uid, uid, 'Piloto: problema em ' || coalesce(nullif(page, ''), '/'), 'Piloto: problema em ' || coalesce(nullif(page, ''), '/'),
    btrim(requested_description), 'technical', 'normal', 'open', 'pilot_feedback',
    jsonb_build_object('page', page, 'browser', left(coalesce(requested_browser, ''), 300), 'reported_at', now(), 'role', coalesce(role, 'superadmin')),
    now())
  returning id into ticket;
  insert into public.support_ticket_messages(ticket_id, sender_type, sender_user_id, message)
  values (ticket, 'customer', uid, btrim(requested_description));
  return ticket;
end $$;
revoke all on function public.report_pilot_problem(uuid, text, text, text) from public, anon;
grant execute on function public.report_pilot_problem(uuid, text, text, text) to authenticated;

-- Painel do piloto (superadmin, só leitura): números agregados do dia por loja, sem dados de clientes.
-- O superadmin não lê pedidos pela RLS; esta função devolve só contagens e médias.
create or replace function public.superadmin_pilot_overview(requested_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  day_start timestamptz := date_trunc('day', requested_now at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  stuck_minutes integer := coalesce((select threshold::int from public.pilot_alert_rules where rule_key = 'stuck_order'), 30);
  result jsonb;
begin
  if not private.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select jsonb_build_object(
    'generated_at', requested_now,
    'day_start', day_start,
    'stuck_minutes', stuck_minutes,
    'stores', coalesce(jsonb_agg(s order by s->>'name'), '[]'::jsonb),
    'open_alerts', (select count(*) from public.pilot_alerts where status = 'open'),
    'errors_24h', (select count(*) from public.app_error_events where occurred_at > requested_now - interval '24 hours'),
    'top_errors', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
        select route, error_name, count(*) as total, max(occurred_at) as last_at
        from public.app_error_events where occurred_at > requested_now - interval '24 hours'
        group by route, error_name order by count(*) desc limit 10) e),
    'pilot_tickets_open', (select count(*) from public.support_tickets where source = 'pilot_feedback' and status not in ('resolved','closed'))
  ) into result
  from (
    select jsonb_build_object(
      'id', e.id, 'name', e.name, 'slug', e.slug,
      'orders_today', (select count(*) from public.orders o where o.establishment_id = e.id and o.created_at >= day_start),
      'orders_by_status', (select coalesce(jsonb_object_agg(st, n), '{}'::jsonb) from (select o.status::text st, count(*) n from public.orders o
          where o.establishment_id = e.id and o.created_at >= day_start group by 1) x),
      'stuck_orders', (select count(*) from public.orders o where o.establishment_id = e.id
          and o.status::text in ('new','confirmed','preparing','ready','out_for_delivery')
          and o.created_at > requested_now - interval '24 hours' and o.updated_at < requested_now - make_interval(mins => stuck_minutes)),
      'avg_queue_min', (select round(avg(extract(epoch from k.started_at - k.created_at)) / 60, 1) from public.kitchen_tickets k
          where k.establishment_id = e.id and k.created_at >= day_start and k.started_at is not null),
      'avg_prep_min', (select round(avg(extract(epoch from k.ready_at - k.started_at)) / 60, 1) from public.kitchen_tickets k
          where k.establishment_id = e.id and k.created_at >= day_start and k.ready_at is not null and k.started_at is not null),
      'avg_delivery_min', (select round(avg(extract(epoch from d.delivered_at - d.picked_up_at)) / 60, 1) from public.deliveries d
          where d.establishment_id = e.id and d.created_at >= day_start and d.delivered_at is not null and d.picked_up_at is not null),
      'payment_failures_today', (select count(*) from public.order_payment_transactions t where t.establishment_id = e.id
          and t.created_at >= day_start and t.status in ('declined','error','expired')),
      'payments_pending', (select count(*) from public.order_payment_transactions t where t.establishment_id = e.id and t.status = 'pending'),
      'printers', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'last_seen_at', p.last_seen_at) order by p.name), '[]'::jsonb)
          from public.printer_devices p where p.establishment_id = e.id and p.active),
      'open_alerts', (select count(*) from public.pilot_alerts a where a.establishment_id = e.id and a.status = 'open'),
      'pilot_tickets_open', (select count(*) from public.support_tickets t where t.establishment_id = e.id and t.source = 'pilot_feedback'
          and t.status not in ('resolved','closed'))
    ) s
    from public.establishments e
  ) stores;
  return result;
end $$;
revoke all on function public.superadmin_pilot_overview(timestamptz) from public, anon;
grant execute on function public.superadmin_pilot_overview(timestamptz) to authenticated;
