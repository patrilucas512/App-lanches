-- Phase 9: operational intelligence and manager copilot.
-- All analytical access is scoped by authenticated membership and explicit permissions.

create table public.manager_copilot_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default false,
  can_view_sales boolean not null default false,
  can_view_team boolean not null default false,
  can_view_campaigns boolean not null default false,
  can_view_costs boolean not null default false,
  can_view_all_units boolean not null default false,
  can_configure_alerts boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(establishment_id,user_id)
);

create table public.manager_copilot_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  enabled_categories text[] not null default array['sales','support','payments','delivery','inventory','campaigns','whatsapp','ai'],
  sensitivity text not null default 'balanced' check(sensitivity in ('conservative','balanced','sensitive')),
  minimum_order_sample integer not null default 10 check(minimum_order_sample between 3 and 1000),
  low_sales_percent integer not null default 20 check(low_sales_percent between 5 and 90),
  cancellation_percent integer not null default 15 check(cancellation_percent between 3 and 100),
  payment_failure_percent integer not null default 12 check(payment_failure_percent between 3 and 100),
  ai_fallback_percent integer not null default 25 check(ai_fallback_percent between 5 and 100),
  queue_threshold integer not null default 10 check(queue_threshold between 1 and 10000),
  internal_notifications boolean not null default true,
  whatsapp_opt_in boolean not null default false,
  email_opt_in boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.manager_copilot_query_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  question text not null check(char_length(question) between 1 and 1000),
  intent text not null,
  period jsonb not null default '{}',
  tools_used text[] not null default '{}',
  data_sources text[] not null default '{}',
  success boolean not null default true,
  fallback_used boolean not null default false,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index manager_copilot_audit_scope_idx on public.manager_copilot_query_audit(establishment_id,created_at desc);

create table public.manager_copilot_feedback (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  query_audit_id uuid not null references public.manager_copilot_query_audit(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  useful boolean not null,
  comment text check(comment is null or char_length(comment)<=1000),
  created_at timestamptz not null default now(),
  unique(query_audit_id,user_id)
);

create table public.manager_daily_metrics (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  metric_date date not null,
  approved_orders integer not null default 0,
  cancelled_orders integer not null default 0,
  pending_orders integer not null default 0,
  revenue_cents bigint not null default 0,
  delivery_orders integer not null default 0,
  whatsapp_orders integer not null default 0,
  ai_orders integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key(establishment_id,metric_date)
);
create index manager_daily_metrics_date_idx on public.manager_daily_metrics(metric_date desc,establishment_id);

alter table public.manager_copilot_permissions enable row level security;
alter table public.manager_copilot_settings enable row level security;
alter table public.manager_copilot_query_audit enable row level security;
alter table public.manager_copilot_feedback enable row level security;
alter table public.manager_daily_metrics enable row level security;

create or replace function private.has_manager_copilot_permission(requested_establishment_id uuid, requested_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.establishment_members em
    where em.establishment_id=requested_establishment_id and em.user_id=(select auth.uid()) and em.status='active'
      and (
        em.role in ('owner','manager')
        or exists(
          select 1 from public.manager_copilot_permissions p
          where p.establishment_id=em.establishment_id and p.user_id=em.user_id and p.can_view
            and case requested_permission
              when 'view' then p.can_view
              when 'sales' then p.can_view_sales
              when 'team' then p.can_view_team
              when 'campaigns' then p.can_view_campaigns
              when 'costs' then p.can_view_costs
              when 'all_units' then p.can_view_all_units
              when 'configure_alerts' then p.can_configure_alerts
              else false end
        )
      )
  )
$$;

create policy manager_copilot_permissions_owner_read on public.manager_copilot_permissions for select to authenticated
  using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy manager_copilot_settings_member_read on public.manager_copilot_settings for select to authenticated
  using(private.has_manager_copilot_permission(establishment_id,'view'));
create policy manager_copilot_audit_self_read on public.manager_copilot_query_audit for select to authenticated
  using(user_id=(select auth.uid()) or private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy manager_copilot_feedback_self_read on public.manager_copilot_feedback for select to authenticated
  using(user_id=(select auth.uid()) or private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy manager_daily_metrics_member_read on public.manager_daily_metrics for select to authenticated
  using(private.has_manager_copilot_permission(establishment_id,'view'));

create or replace function private.manager_sales_summary(requested_store_ids uuid[], requested_start timestamptz, requested_end timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'total_orders',count(*),
    'approved_orders',count(*) filter(where o.status='completed' or o.online_payment_status='approved'),
    'cancelled_orders',count(*) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back')),
    'pending_orders',count(*) filter(where not(o.status='completed' or o.online_payment_status='approved') and not(o.status='canceled' or coalesce(o.online_payment_status,'') in ('canceled','declined','refunded','charged_back'))),
    'revenue_cents',coalesce(sum(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved'),0),
    'average_ticket_cents',coalesce(round(avg(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved')),0),
    'approved_percent',case when count(*)=0 then 0 else round(100.0*count(*) filter(where o.status='completed' or o.online_payment_status='approved')/count(*),1) end,
    'cancelled_percent',case when count(*)=0 then 0 else round(100.0*count(*) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back'))/count(*),1) end,
    'whatsapp_orders',count(*) filter(where lower(coalesce(o.source,'')) like '%whatsapp%'),
    'delivery_orders',count(*) filter(where o.fulfillment_type='delivery')
  )
  from public.orders o
  where o.establishment_id=any(requested_store_ids) and o.created_at>=requested_start and o.created_at<requested_end
$$;

create or replace function public.refresh_manager_daily_metrics(requested_establishment_id uuid, requested_date date default current_date)
returns void language plpgsql security definer set search_path='' as $$
declare tz text; day_start timestamptz; day_end timestamptz;
begin
  if (select auth.uid()) is not null and not private.has_manager_copilot_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para atualizar métricas.'; end if;
  select coalesce(timezone,'America/Sao_Paulo') into tz from public.establishments where id=requested_establishment_id;
  if tz is null then raise exception 'Estabelecimento inválido.'; end if;
  day_start:=(requested_date::timestamp at time zone tz); day_end:=((requested_date+1)::timestamp at time zone tz);
  insert into public.manager_daily_metrics(establishment_id,metric_date,approved_orders,cancelled_orders,pending_orders,revenue_cents,delivery_orders,whatsapp_orders,ai_orders,refreshed_at)
  select requested_establishment_id,requested_date,
    count(*) filter(where o.status='completed' or o.online_payment_status='approved'),
    count(*) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back')),
    count(*) filter(where not(o.status='completed' or o.online_payment_status='approved') and not(o.status='canceled' or coalesce(o.online_payment_status,'') in ('canceled','declined','refunded','charged_back'))),
    coalesce(sum(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved'),0),
    count(*) filter(where o.fulfillment_type='delivery'),count(*) filter(where lower(coalesce(o.source,'')) like '%whatsapp%'),
    count(*) filter(where exists(select 1 from public.ai_conversation_analysis a where a.generated_order_id=o.id)),now()
  from public.orders o where o.establishment_id=requested_establishment_id and o.created_at>=day_start and o.created_at<day_end
  on conflict(establishment_id,metric_date) do update set approved_orders=excluded.approved_orders,cancelled_orders=excluded.cancelled_orders,pending_orders=excluded.pending_orders,revenue_cents=excluded.revenue_cents,delivery_orders=excluded.delivery_orders,whatsapp_orders=excluded.whatsapp_orders,ai_orders=excluded.ai_orders,refreshed_at=now();
end $$;

create or replace function private.refresh_manager_daily_metrics_from_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_tz text; new_tz text;
begin
  if tg_op<>'DELETE' then
    select coalesce(timezone,'America/Sao_Paulo') into new_tz from public.establishments where id=new.establishment_id;
    perform public.refresh_manager_daily_metrics(new.establishment_id,(new.created_at at time zone new_tz)::date);
  end if;
  if tg_op<>'INSERT' and (tg_op='DELETE' or old.establishment_id<>new.establishment_id or old.created_at<>new.created_at) then
    select coalesce(timezone,'America/Sao_Paulo') into old_tz from public.establishments where id=old.establishment_id;
    perform public.refresh_manager_daily_metrics(old.establishment_id,(old.created_at at time zone old_tz)::date);
  end if;
  return coalesce(new,old);
end $$;
create trigger refresh_manager_daily_metrics_after_order after insert or update or delete on public.orders for each row execute function private.refresh_manager_daily_metrics_from_order();

insert into public.manager_daily_metrics(establishment_id,metric_date,approved_orders,cancelled_orders,pending_orders,revenue_cents,delivery_orders,whatsapp_orders,ai_orders,refreshed_at)
select o.establishment_id,(o.created_at at time zone coalesce(e.timezone,'America/Sao_Paulo'))::date,
  count(*) filter(where o.status='completed' or o.online_payment_status='approved'),
  count(*) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back')),
  count(*) filter(where not(o.status='completed' or o.online_payment_status='approved') and not(o.status='canceled' or coalesce(o.online_payment_status,'') in ('canceled','declined','refunded','charged_back'))),
  coalesce(sum(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved'),0),
  count(*) filter(where o.fulfillment_type='delivery'),count(*) filter(where lower(coalesce(o.source,'')) like '%whatsapp%'),
  count(*) filter(where exists(select 1 from public.ai_conversation_analysis a where a.generated_order_id=o.id)),now()
from public.orders o join public.establishments e on e.id=o.establishment_id
where o.created_at>=now()-interval '400 days'
group by o.establishment_id,(o.created_at at time zone coalesce(e.timezone,'America/Sao_Paulo'))::date
on conflict(establishment_id,metric_date) do update set approved_orders=excluded.approved_orders,cancelled_orders=excluded.cancelled_orders,pending_orders=excluded.pending_orders,revenue_cents=excluded.revenue_cents,delivery_orders=excluded.delivery_orders,whatsapp_orders=excluded.whatsapp_orders,ai_orders=excluded.ai_orders,refreshed_at=now();

create or replace function public.get_manager_copilot_snapshot(
  requested_establishment_id uuid, requested_start timestamptz, requested_end timestamptz,
  requested_compare_start timestamptz, requested_compare_end timestamptz, requested_all_units boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid()); org_id uuid; tz text; store_ids uuid[]; all_units boolean:=false;
  permissions jsonb; settings record; current_sales jsonb; previous_sales jsonb; baseline jsonb;
  products jsonb; units jsonb; hourly jsonb; payments jsonb; delivery jsonb; campaigns jsonb; crm jsonb;
  support jsonb; ai jsonb; inventory jsonb; operational jsonb; sources text[];
  sales_delta numeric; order_delta numeric; sample integer; cancel_rate numeric; payment_fail_rate numeric; fallback_rate numeric;
  alerts jsonb:='[]'::jsonb; forecast jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if requested_start is null or requested_end is null or requested_compare_start is null or requested_compare_end is null or requested_start>=requested_end or requested_compare_start>=requested_compare_end then raise exception 'Período inválido.'; end if;
  if requested_end-requested_start>interval '370 days' or requested_compare_end-requested_compare_start>interval '370 days' then raise exception 'O período máximo é de 370 dias.'; end if;
  select organization_id,coalesce(timezone,'America/Sao_Paulo') into org_id,tz from public.establishments where id=requested_establishment_id;
  if org_id is null or not private.has_manager_copilot_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para acessar a inteligência.'; end if;

  all_units:=requested_all_units and private.has_manager_copilot_permission(requested_establishment_id,'all_units') and exists(select 1 from public.organization_members om where om.organization_id=org_id and om.user_id=actor and om.active and om.all_stores);
  if all_units then
    select array_agg(e.id order by e.name) into store_ids from public.establishments e where e.organization_id=org_id and e.active and e.unit_status='active';
  else store_ids:=array[requested_establishment_id]; end if;

  permissions:=jsonb_build_object('view',true,'sales',private.has_manager_copilot_permission(requested_establishment_id,'sales'),'team',private.has_manager_copilot_permission(requested_establishment_id,'team'),'campaigns',private.has_manager_copilot_permission(requested_establishment_id,'campaigns'),'costs',private.has_manager_copilot_permission(requested_establishment_id,'costs'),'all_units',private.has_manager_copilot_permission(requested_establishment_id,'all_units'),'configure_alerts',private.has_manager_copilot_permission(requested_establishment_id,'configure_alerts'));
  insert into public.manager_copilot_settings(establishment_id) values(requested_establishment_id) on conflict do nothing;
  select * into settings from public.manager_copilot_settings where establishment_id=requested_establishment_id;

  current_sales:=private.manager_sales_summary(store_ids,requested_start,requested_end);
  previous_sales:=private.manager_sales_summary(store_ids,requested_compare_start,requested_compare_end);
  sales_delta:=case when (previous_sales->>'revenue_cents')::numeric=0 then null else round(100*((current_sales->>'revenue_cents')::numeric-(previous_sales->>'revenue_cents')::numeric)/(previous_sales->>'revenue_cents')::numeric,1) end;
  order_delta:=case when (previous_sales->>'approved_orders')::numeric=0 then null else round(100*((current_sales->>'approved_orders')::numeric-(previous_sales->>'approved_orders')::numeric)/(previous_sales->>'approved_orders')::numeric,1) end;
  current_sales:=current_sales||jsonb_build_object('revenue_delta_percent',sales_delta,'orders_delta_percent',order_delta);

  select jsonb_build_object('days',count(*),'average_revenue_cents',coalesce(round(avg(revenue_cents)),0),'average_orders',coalesce(round(avg(approved_orders),1),0),'same_weekday_average_revenue_cents',coalesce(round(avg(revenue_cents) filter(where extract(isodow from metric_date)=extract(isodow from requested_start at time zone tz))),0)) into baseline
  from public.manager_daily_metrics where establishment_id=any(store_ids) and metric_date>=(requested_start at time zone tz)::date-28 and metric_date<(requested_start at time zone tz)::date;

  select coalesce(jsonb_agg(x order by (x->>'quantity')::int desc),'[]'::jsonb) into products from (
    select jsonb_build_object('product_id',oi.product_id,'name',oi.product_name,'quantity',sum(oi.quantity),'revenue_cents',sum(oi.total_cents),'orders',count(distinct oi.order_id),'addon_rate_percent',round(100.0*count(*) filter(where jsonb_array_length(coalesce(oi.addons,'[]'))>0)/greatest(count(*),1),1),'cancelled_quantity',sum(oi.quantity) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back'))) x
    from public.order_items oi join public.orders o on o.id=oi.order_id and o.establishment_id=oi.establishment_id
    where oi.establishment_id=any(store_ids) and o.created_at>=requested_start and o.created_at<requested_end
    group by oi.product_id,oi.product_name order by sum(oi.quantity) desc limit 20
  ) q;

  select coalesce(jsonb_agg(x order by (x->>'revenue_cents')::bigint desc),'[]'::jsonb) into units from (
    select jsonb_build_object('id',e.id,'name',e.name,'open',coalesce(sm.store_open,true),'capacity',e.capacity_level,'revenue_cents',coalesce(sum(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved'),0),'orders',count(o.id) filter(where o.status='completed' or o.online_payment_status='approved'),'average_ticket_cents',coalesce(round(avg(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved')),0),'cancelled',count(o.id) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back'))) x
    from public.establishments e left join public.service_modes sm on sm.establishment_id=e.id left join public.orders o on o.establishment_id=e.id and o.created_at>=requested_start and o.created_at<requested_end
    where e.id=any(store_ids) group by e.id,e.name,e.capacity_level,sm.store_open
  ) q;

  select coalesce(jsonb_agg(x order by (x->>'hour')::int),'[]'::jsonb) into hourly from (
    select jsonb_build_object('hour',extract(hour from o.created_at at time zone tz)::int,'orders',count(*) filter(where o.status='completed' or o.online_payment_status='approved'),'revenue_cents',coalesce(sum(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved'),0),'cancelled',count(*) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back'))) x
    from public.orders o where o.establishment_id=any(store_ids) and o.created_at>=requested_start and o.created_at<requested_end group by extract(hour from o.created_at at time zone tz)
  ) q;

  select coalesce(jsonb_agg(x order by (x->>'orders')::int desc),'[]'::jsonb) into payments from (
    select jsonb_build_object('method',coalesce(o.payment_method,'not_informed'),'orders',count(*),'revenue_cents',coalesce(sum(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved'),0),'failures',count(*) filter(where o.online_payment_status in ('canceled','declined','expired','refunded','charged_back'))) x
    from public.orders o where o.establishment_id=any(store_ids) and o.created_at>=requested_start and o.created_at<requested_end group by o.payment_method
  ) q;
  select case when count(*)=0 then 0 else round(100.0*count(*) filter(where status in ('failed','declined','expired','canceled'))/count(*),1) end into payment_fail_rate from public.order_payment_transactions where establishment_id=any(store_ids) and created_at>=requested_start and created_at<requested_end;

  select jsonb_build_object('total',count(*),'delivered',count(*) filter(where d.status::text='delivered'),'active',count(*) filter(where d.status::text not in ('delivered','canceled','failed','returned_to_store')),'cancelled',count(*) filter(where d.status::text in ('canceled','failed','returned_to_store')),'average_minutes',coalesce(round(avg(extract(epoch from(d.delivered_at-d.created_at))/60) filter(where d.delivered_at is not null),1),0),'late',count(*) filter(where d.delivered_at>d.estimated_arrival_at and d.estimated_arrival_at is not null),'regions',coalesce((select jsonb_agg(r order by (r->>'orders')::int desc) from (select jsonb_build_object('region',coalesce(o.delivery_address->>'bairro','Não informado'),'orders',count(*),'late',count(*) filter(where dd.delivered_at>dd.estimated_arrival_at and dd.estimated_arrival_at is not null)) r from public.deliveries dd join public.orders o on o.id=dd.order_id where dd.establishment_id=any(store_ids) and dd.created_at>=requested_start and dd.created_at<requested_end group by coalesce(o.delivery_address->>'bairro','Não informado') order by count(*) desc limit 10) z),'[]'::jsonb)) into delivery
  from public.deliveries d where d.establishment_id=any(store_ids) and d.created_at>=requested_start and d.created_at<requested_end;

  select coalesce(jsonb_agg(x order by (x->>'revenue_cents')::bigint desc),'[]'::jsonb) into campaigns from (
    select jsonb_build_object('id',c.id,'name',c.name,'status',c.status,'sent',c.sent_count,'delivered',c.delivered_count,'read',c.read_count,'failed',c.failed_count,'responses',c.response_count,'orders',count(distinct a.order_id),'revenue_cents',coalesce(sum(a.revenue_cents),0),'conversion_percent',case when c.delivered_count=0 then 0 else round(100.0*count(distinct a.order_id)/c.delivered_count,1) end) x
    from public.crm_campaigns c left join public.crm_campaign_attributions a on a.campaign_id=c.id and a.attributed_at>=requested_start and a.attributed_at<requested_end
    where c.establishment_id=any(store_ids) and c.created_at<requested_end group by c.id order by coalesce(sum(a.revenue_cents),0) desc limit 20
  ) q;

  select jsonb_build_object('customers',count(*),'new_customers',count(*) filter(where c.created_at>=requested_start and c.created_at<requested_end),'recurring_customers',count(*) filter(where c.total_orders>1 and c.last_order_at>=requested_start and c.last_order_at<requested_end),'inactive_customers',count(*) filter(where c.last_order_at<requested_start-interval '60 days'),'vip_customers',count(*) filter(where c.total_orders>=10 or c.total_spent_cents>=100000),'customer_revenue_cents',coalesce(sum(c.total_spent_cents) filter(where c.last_order_at>=requested_start and c.last_order_at<requested_end),0)) into crm
  from public.customers c where c.establishment_id=any(store_ids);

  select jsonb_build_object('waiting',count(*) filter(where wc.operational_status in ('queued','assignment_pending')),'in_progress',count(*) filter(where wc.operational_status='in_progress'),'sla_breached',count(*) filter(where wc.sla_breached_at is not null),'average_first_response_minutes',coalesce(round(avg(extract(epoch from(wc.first_response_at-wc.queued_at))/60) filter(where wc.first_response_at is not null),1),0),'average_resolution_minutes',coalesce(round(avg(extract(epoch from(wc.resolved_at-wc.queued_at))/60) filter(where wc.resolved_at is not null),1),0),'active_agents',(select count(*) from public.support_agent_presence p where p.organization_id=org_id and p.status in ('online','available','busy') and p.last_seen_at>now()-interval '5 minutes'),'satisfaction',coalesce((select round(avg(r.rating),1) from public.support_satisfaction_ratings r where r.establishment_id=any(store_ids) and r.created_at>=requested_start and r.created_at<requested_end),0)) into support
  from public.whatsapp_conversations wc where coalesce(wc.selected_store_id,wc.establishment_id)=any(store_ids) and wc.last_message_at>=requested_start and wc.last_message_at<requested_end;

  select jsonb_build_object('processed',count(*) filter(where u.event_type='ai_message_processed'),'fallbacks',count(*) filter(where u.event_type in ('ai_fallback','ai_unknown_question')),'transfers',count(*) filter(where u.event_type='ai_handoff'),'orders',count(*) filter(where u.event_type='ai_order_created'),'estimated_cost_micros',coalesce(sum(u.estimated_cost_micros),0),'revenue_cents',coalesce((select sum(a.generated_sale_cents) from public.ai_conversation_analysis a where a.establishment_id=any(store_ids) and a.created_at>=requested_start and a.created_at<requested_end),0)) into ai
  from public.ai_usage_events u where u.establishment_id=any(store_ids) and u.created_at>=requested_start and u.created_at<requested_end;
  fallback_rate:=case when (ai->>'processed')::numeric+(ai->>'fallbacks')::numeric=0 then 0 else round(100*(ai->>'fallbacks')::numeric/((ai->>'processed')::numeric+(ai->>'fallbacks')::numeric),1) end;
  ai:=ai||jsonb_build_object('fallback_percent',fallback_rate);

  select jsonb_build_object('critical_count',count(*) filter(where i.active and (i.needs_restock or i.balance<=i.minimum)),'items',coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'balance',i.balance,'minimum',i.minimum,'unit',i.unit) order by (i.balance-i.minimum)) filter(where i.active and (i.needs_restock or i.balance<=i.minimum)),'[]'::jsonb)) into inventory
  from public.inventory_items i where i.establishment_id=any(store_ids);

  select jsonb_build_object('whatsapp_connected',coalesce(bool_or(w.status='connected' and w.webhook_status='verified'),false),'open_support_alerts',(select count(*) from public.support_alerts s where s.establishment_id=any(store_ids) and s.status='open'),'unexpected_closed_units',(select count(*) from public.service_modes sm join public.establishments e on e.id=sm.establishment_id where sm.establishment_id=any(store_ids) and not sm.store_open and e.unit_status='active')) into operational
  from public.whatsapp_connections w where w.establishment_id=any(store_ids);

  sample:=(current_sales->>'total_orders')::int; cancel_rate:=(current_sales->>'cancelled_percent')::numeric;
  if 'sales'=any(settings.enabled_categories) and sample>=settings.minimum_order_sample and sales_delta is not null and sales_delta<=-settings.low_sales_percent then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','sales_drop','level','attention','category','sales','title','Vendas abaixo do período comparado','message','O faturamento caiu '||abs(sales_delta)||'% com amostra suficiente.','action_label','Ver vendas','action_href','/painel/inteligencia?tab=vendas')); end if;
  if 'sales'=any(settings.enabled_categories) and sample>=settings.minimum_order_sample and cancel_rate>=settings.cancellation_percent then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','cancellation_peak','level',case when cancel_rate>=settings.cancellation_percent*1.5 then 'critical' else 'attention' end,'category','sales','title','Cancelamentos acima do limite','message',cancel_rate||'% dos pedidos foram cancelados.','action_label','Ver pedidos','action_href','/painel/pedidos')); end if;
  if 'support'=any(settings.enabled_categories) and (support->>'waiting')::int>=settings.queue_threshold then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','queue_overload','level','critical','category','support','title','Fila de atendimento sobrecarregada','message',(support->>'waiting')||' clientes estão aguardando.','action_label','Ver fila','action_href','/painel/whatsapp/supervisao')); end if;
  if 'support'=any(settings.enabled_categories) and (support->>'sla_breached')::int>=3 then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','sla_breached','level','attention','category','support','title','SLA acima do esperado','message',(support->>'sla_breached')||' conversas ultrapassaram o SLA.','action_label','Abrir supervisão','action_href','/painel/whatsapp/supervisao')); end if;
  if 'payments'=any(settings.enabled_categories) and sample>=settings.minimum_order_sample and payment_fail_rate>=settings.payment_failure_percent then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','payment_failures','level','critical','category','payments','title','Falhas de pagamento elevadas','message',payment_fail_rate||'% das tentativas falharam.','action_label','Ver vendas','action_href','/painel')); end if;
  if 'whatsapp'=any(settings.enabled_categories) and not (operational->>'whatsapp_connected')::boolean then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','whatsapp_disconnected','level','critical','category','whatsapp','title','WhatsApp desconectado','message','A conexão principal não está verificada.','action_label','Abrir WhatsApp','action_href','/painel/whatsapp')); end if;
  if 'ai'=any(settings.enabled_categories) and ((ai->>'processed')::int+(ai->>'fallbacks')::int)>=10 and fallback_rate>=settings.ai_fallback_percent then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','ai_fallback','level','attention','category','ai','title','Fallback da IA elevado','message',fallback_rate||'% das interações precisaram de fallback.','action_label','Ver Atendente IA','action_href','/painel/atendente-ia')); end if;
  if 'inventory'=any(settings.enabled_categories) and (inventory->>'critical_count')::int>0 then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','critical_stock','level','attention','category','inventory','title','Estoque crítico','message',(inventory->>'critical_count')||' item(ns) chegaram ao mínimo.','action_label','Ver estoque','action_href','/painel/estoque')); end if;
  if 'delivery'=any(settings.enabled_categories) and (delivery->>'total')::int>=5 and (delivery->>'late')::int>=3 then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','delivery_delay','level','attention','category','delivery','title','Entregas com atraso','message',(delivery->>'late')||' entregas passaram da previsão.','action_label','Monitorar entregas','action_href','/painel/pedidos#despacho-entregas')); end if;
  if (operational->>'unexpected_closed_units')::int>0 then alerts:=alerts||jsonb_build_array(jsonb_build_object('id','closed_units','level','critical','category','operation','title','Unidade fechada','message',(operational->>'unexpected_closed_units')||' unidade(s) ativa(s) estão fechadas.','action_label','Ver unidades','action_href','/painel/unidades')); end if;

  forecast:=jsonb_build_object('estimated',true,'label','Estimativa','revenue_cents',case when requested_end>now() and extract(epoch from(now()-requested_start))>3600 then round((current_sales->>'revenue_cents')::numeric*extract(epoch from(requested_end-requested_start))/extract(epoch from(now()-requested_start))) else null end,'basis','ritmo atual do período','sample_orders',(current_sales->>'approved_orders')::int);
  sources:=array['orders','order_items','manager_daily_metrics','deliveries','order_payment_transactions','crm_campaign_attributions','customers','whatsapp_conversations','support_agent_presence','ai_usage_events','inventory_items'];
  return jsonb_build_object('version','manager_metrics_v1','generated_at',now(),'scope',jsonb_build_object('organization_id',org_id,'establishment_id',requested_establishment_id,'store_ids',to_jsonb(store_ids),'all_units',all_units,'timezone',tz),'period',jsonb_build_object('start',requested_start,'end',requested_end,'compare_start',requested_compare_start,'compare_end',requested_compare_end),'permissions',permissions,'settings',to_jsonb(settings)-'updated_by','sources',to_jsonb(sources),'sales',case when (permissions->>'sales')::boolean then current_sales else current_sales-'revenue_cents'-'average_ticket_cents'-'revenue_delta_percent' end,'comparison',case when (permissions->>'sales')::boolean then previous_sales else previous_sales-'revenue_cents'-'average_ticket_cents' end,'baseline',case when (permissions->>'sales')::boolean then baseline else baseline-'average_revenue_cents'-'same_weekday_average_revenue_cents' end,'products',products,'units',units,'hourly',hourly,'payments',case when (permissions->>'sales')::boolean then payments else '[]'::jsonb end,'delivery',delivery,'campaigns',case when (permissions->>'campaigns')::boolean then campaigns else '[]'::jsonb end,'crm',crm,'support',case when (permissions->>'team')::boolean then support else support-'satisfaction'-'active_agents' end,'ai',case when (permissions->>'costs')::boolean then ai else ai-'estimated_cost_micros' end,'inventory',inventory,'operational',operational,'alerts',alerts,'forecast',case when (permissions->>'sales')::boolean then forecast else forecast-'revenue_cents' end);
end $$;

create or replace function public.record_manager_copilot_query(requested_establishment_id uuid,requested_question text,requested_intent text,requested_period jsonb,requested_tools text[],requested_sources text[],requested_success boolean,requested_fallback boolean,requested_latency_ms integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved_id uuid; org_id uuid;
begin
  if not private.has_manager_copilot_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para registrar consulta.'; end if;
  select organization_id into org_id from public.establishments where id=requested_establishment_id;
  insert into public.manager_copilot_query_audit(organization_id,establishment_id,user_id,question,intent,period,tools_used,data_sources,success,fallback_used,latency_ms)
  values(org_id,requested_establishment_id,(select auth.uid()),left(btrim(requested_question),1000),left(requested_intent,80),coalesce(requested_period,'{}'),coalesce(requested_tools,'{}'),coalesce(requested_sources,'{}'),requested_success,requested_fallback,requested_latency_ms) returning id into saved_id;
  return saved_id;
end $$;

create or replace function public.save_manager_copilot_feedback(requested_establishment_id uuid,requested_query_audit_id uuid,requested_useful boolean,requested_comment text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_manager_copilot_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para enviar feedback.'; end if;
  if not exists(select 1 from public.manager_copilot_query_audit where id=requested_query_audit_id and establishment_id=requested_establishment_id and user_id=(select auth.uid())) then raise exception 'Consulta inválida.'; end if;
  insert into public.manager_copilot_feedback(establishment_id,query_audit_id,user_id,useful,comment) values(requested_establishment_id,requested_query_audit_id,(select auth.uid()),requested_useful,nullif(left(btrim(coalesce(requested_comment,'')),1000),''))
  on conflict(query_audit_id,user_id) do update set useful=excluded.useful,comment=excluded.comment;
end $$;

create or replace function public.configure_manager_copilot_alerts(requested_establishment_id uuid,requested_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.manager_copilot_settings;
begin
  if not private.has_manager_copilot_permission(requested_establishment_id,'configure_alerts') then raise exception 'Sem permissão para configurar alertas.'; end if;
  insert into public.manager_copilot_settings(establishment_id,enabled_categories,sensitivity,minimum_order_sample,low_sales_percent,cancellation_percent,payment_failure_percent,ai_fallback_percent,queue_threshold,internal_notifications,whatsapp_opt_in,email_opt_in,updated_by)
  values(requested_establishment_id,coalesce(array(select jsonb_array_elements_text(requested_settings->'enabled_categories')),array['sales','support','payments','delivery','inventory','campaigns','whatsapp','ai']),coalesce(nullif(requested_settings->>'sensitivity',''),'balanced'),coalesce((requested_settings->>'minimum_order_sample')::int,10),coalesce((requested_settings->>'low_sales_percent')::int,20),coalesce((requested_settings->>'cancellation_percent')::int,15),coalesce((requested_settings->>'payment_failure_percent')::int,12),coalesce((requested_settings->>'ai_fallback_percent')::int,25),coalesce((requested_settings->>'queue_threshold')::int,10),coalesce((requested_settings->>'internal_notifications')::boolean,true),coalesce((requested_settings->>'whatsapp_opt_in')::boolean,false),coalesce((requested_settings->>'email_opt_in')::boolean,false),(select auth.uid()))
  on conflict(establishment_id) do update set enabled_categories=excluded.enabled_categories,sensitivity=excluded.sensitivity,minimum_order_sample=excluded.minimum_order_sample,low_sales_percent=excluded.low_sales_percent,cancellation_percent=excluded.cancellation_percent,payment_failure_percent=excluded.payment_failure_percent,ai_fallback_percent=excluded.ai_fallback_percent,queue_threshold=excluded.queue_threshold,internal_notifications=excluded.internal_notifications,whatsapp_opt_in=excluded.whatsapp_opt_in,email_opt_in=excluded.email_opt_in,updated_by=(select auth.uid()),updated_at=now() returning * into saved;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'intelligence.alerts_configured','manager_copilot_settings',requested_establishment_id,requested_settings);
  return to_jsonb(saved)-'updated_by';
end $$;

create or replace function public.set_manager_copilot_permissions(requested_establishment_id uuid,requested_user_id uuid,requested_permissions jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente administradores podem alterar permissões.'; end if;
  if not exists(select 1 from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id and status='active') then raise exception 'Funcionário não pertence ao estabelecimento.'; end if;
  insert into public.manager_copilot_permissions(establishment_id,user_id,can_view,can_view_sales,can_view_team,can_view_campaigns,can_view_costs,can_view_all_units,can_configure_alerts)
  values(requested_establishment_id,requested_user_id,coalesce((requested_permissions->>'can_view')::boolean,false),coalesce((requested_permissions->>'can_view_sales')::boolean,false),coalesce((requested_permissions->>'can_view_team')::boolean,false),coalesce((requested_permissions->>'can_view_campaigns')::boolean,false),coalesce((requested_permissions->>'can_view_costs')::boolean,false),coalesce((requested_permissions->>'can_view_all_units')::boolean,false),coalesce((requested_permissions->>'can_configure_alerts')::boolean,false))
  on conflict(establishment_id,user_id) do update set can_view=excluded.can_view,can_view_sales=excluded.can_view_sales,can_view_team=excluded.can_view_team,can_view_campaigns=excluded.can_view_campaigns,can_view_costs=excluded.can_view_costs,can_view_all_units=excluded.can_view_all_units,can_configure_alerts=excluded.can_configure_alerts,updated_at=now();
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'intelligence.permissions_updated','profile',requested_user_id,requested_permissions);
end $$;

revoke all on table public.manager_copilot_permissions,public.manager_copilot_settings,public.manager_copilot_query_audit,public.manager_copilot_feedback,public.manager_daily_metrics from anon,authenticated;
grant select on table public.manager_copilot_permissions,public.manager_copilot_settings,public.manager_copilot_query_audit,public.manager_copilot_feedback,public.manager_daily_metrics to service_role;
revoke all on function public.get_manager_copilot_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean),public.record_manager_copilot_query(uuid,text,text,jsonb,text[],text[],boolean,boolean,integer),public.save_manager_copilot_feedback(uuid,uuid,boolean,text),public.configure_manager_copilot_alerts(uuid,jsonb),public.set_manager_copilot_permissions(uuid,uuid,jsonb),public.refresh_manager_daily_metrics(uuid,date) from public,anon;
grant execute on function public.get_manager_copilot_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean),public.record_manager_copilot_query(uuid,text,text,jsonb,text[],text[],boolean,boolean,integer),public.save_manager_copilot_feedback(uuid,uuid,boolean,text),public.configure_manager_copilot_alerts(uuid,jsonb),public.set_manager_copilot_permissions(uuid,uuid,jsonb),public.refresh_manager_daily_metrics(uuid,date) to authenticated;
grant execute on function public.refresh_manager_daily_metrics(uuid,date) to service_role;

