-- MasterApp WhatsApp CRM - Phase 5
-- Extends official customers/orders/coupons/contacts. No parallel customer registry.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.normalize_customer_phone(value text)
returns text language sql immutable strict set search_path='' as $$
  select case
    when regexp_replace(value,'\D','','g') ~ '^55\d{10,11}$' then regexp_replace(value,'\D','','g')
    when regexp_replace(value,'\D','','g') ~ '^\d{10,11}$' then '55'||regexp_replace(value,'\D','','g')
    else regexp_replace(value,'\D','','g')
  end
$$;

alter table public.customers
  add column if not exists normalized_phone text,
  add column if not exists marketing_status text not null default 'unknown'
    check (marketing_status in ('unknown','opted_in','opted_out')),
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists birthday date,
  add column if not exists crm_notes text;

update public.customers set normalized_phone=public.normalize_customer_phone(phone)
where normalized_phone is null or normalized_phone='';

create or replace function private.set_customer_normalized_phone()
returns trigger language plpgsql set search_path='' as $$
begin new.normalized_phone:=public.normalize_customer_phone(new.phone); return new; end $$;
create trigger customers_normalize_phone before insert or update of phone on public.customers
for each row execute function private.set_customer_normalized_phone();
create index if not exists customers_normalized_phone_idx on public.customers(establishment_id,normalized_phone);

alter table public.whatsapp_contacts
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists normalized_phone text,
  add column if not exists marketing_status text not null default 'unknown'
    check (marketing_status in ('unknown','opted_in','opted_out')),
  add column if not exists marketing_consent_at timestamptz;
update public.whatsapp_contacts set normalized_phone=public.normalize_customer_phone(coalesce(phone_number,wa_id))
where normalized_phone is null or normalized_phone='';
update public.whatsapp_contacts wc set customer_id=(
  select c0.id from public.customers c0
  where c0.establishment_id=wc.establishment_id
    and c0.normalized_phone=public.normalize_customer_phone(coalesce(wc.phone_number,wc.wa_id))
  order by c0.created_at limit 1
) where wc.customer_id is null;
create index if not exists whatsapp_contacts_customer_idx on public.whatsapp_contacts(establishment_id,customer_id);
create index if not exists whatsapp_contacts_normalized_phone_idx on public.whatsapp_contacts(establishment_id,normalized_phone);

create or replace function private.link_whatsapp_customer()
returns trigger language plpgsql security definer set search_path='' as $$
declare linked uuid;
begin
  new.normalized_phone:=public.normalize_customer_phone(coalesce(new.phone_number,new.wa_id));
  if new.customer_id is null then
    select id into linked from public.customers
    where establishment_id=new.establishment_id and normalized_phone=new.normalized_phone
    order by created_at limit 1;
    new.customer_id:=linked;
  end if;
  return new;
end $$;
create trigger whatsapp_contacts_link_customer before insert or update of phone_number,wa_id on public.whatsapp_contacts
for each row execute function private.link_whatsapp_customer();

create table public.crm_member_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default false,
  can_edit_customer boolean not null default false,
  can_manage_segments boolean not null default false,
  can_create_campaign boolean not null default false,
  can_approve_campaign boolean not null default false,
  can_cancel_campaign boolean not null default false,
  can_view_metrics boolean not null default false,
  can_configure_loyalty boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(establishment_id,user_id)
);

create or replace function private.has_crm_permission(target_establishment uuid, requested_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role(target_establishment,array['owner','manager']::public.member_role[])
    or exists(select 1 from public.crm_member_permissions p
      where p.establishment_id=target_establishment and p.user_id=(select auth.uid()) and
      case requested_permission
        when 'view' then p.can_view when 'edit_customer' then p.can_edit_customer
        when 'manage_segments' then p.can_manage_segments when 'create_campaign' then p.can_create_campaign
        when 'approve_campaign' then p.can_approve_campaign when 'cancel_campaign' then p.can_cancel_campaign
        when 'view_metrics' then p.can_view_metrics when 'configure_loyalty' then p.can_configure_loyalty
        else false end)
$$;
revoke all on function private.has_crm_permission(uuid,text) from public,anon;
grant execute on function private.has_crm_permission(uuid,text) to authenticated;

create table public.crm_rules (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  recurring_min_orders integer not null default 3 check(recurring_min_orders between 2 and 100),
  recurring_period_days integer not null default 90 check(recurring_period_days between 7 and 730),
  vip_min_spent_cents bigint not null default 50000 check(vip_min_spent_cents>=0),
  vip_min_orders integer not null default 8 check(vip_min_orders between 2 and 1000),
  at_risk_days integer not null default 30 check(at_risk_days between 7 and 730),
  inactive_days integer not null default 60 check(inactive_days between 14 and 1460),
  attribution_window_days integer not null default 7 check(attribution_window_days between 1 and 90),
  max_campaigns_per_day integer not null default 3 check(max_campaigns_per_day between 1 and 50),
  max_promotional_messages_per_customer_7d integer not null default 2 check(max_promotional_messages_per_customer_7d between 1 and 20),
  minimum_campaign_interval_hours integer not null default 24 check(minimum_campaign_interval_hours between 1 and 720),
  updated_at timestamptz not null default now()
);

create table public.crm_consent_events (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  whatsapp_contact_id uuid references public.whatsapp_contacts(id) on delete set null,
  status text not null check(status in ('opted_in','opted_out')),
  origin text not null check(origin in ('customer_message','checkout','admin','imported_verified','other')),
  channel text not null default 'whatsapp',
  actor_id uuid references auth.users(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check(customer_id is not null or whatsapp_contact_id is not null)
);

create table public.crm_tags (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null, color text not null default '#ff5a36', automatic boolean not null default false,
  rule jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique(establishment_id,name)
);
create table public.crm_customer_tags (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag_id uuid not null references public.crm_tags(id) on delete cascade,
  source text not null check(source in ('manual','rule','campaign','system')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  primary key(customer_id,tag_id)
);

create table public.crm_segments (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null, description text, filters jsonb not null default '{}'::jsonb,
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(establishment_id,name)
);

create table public.whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  meta_template_id text, name text not null, category text not null, language text not null default 'pt_BR',
  status text not null check(status in ('pending','approved','rejected','paused','disabled')),
  body text not null, variables jsonb not null default '[]'::jsonb, components jsonb not null default '[]'::jsonb,
  synced_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(establishment_id,name,language)
);

create table public.crm_campaigns (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null, segment_id uuid not null references public.crm_segments(id),
  template_id uuid not null references public.whatsapp_message_templates(id), coupon_id uuid references public.coupons(id),
  product_id uuid references public.products(id), status text not null default 'draft'
    check(status in ('draft','scheduled','processing','completed','paused','cancelled','failed')),
  scheduled_at timestamptz, timezone text not null default 'America/Sao_Paulo', variables jsonb not null default '{}'::jsonb,
  variant_b_variables jsonb, estimated_recipients integer not null default 0,
  sent_count integer not null default 0, delivered_count integer not null default 0, read_count integer not null default 0,
  failed_count integer not null default 0, response_count integer not null default 0, order_count integer not null default 0,
  attributed_revenue_cents bigint not null default 0, dispatch_token uuid not null default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null, approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz, cancelled_by uuid references auth.users(id) on delete set null, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_campaign_recipients (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  whatsapp_contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  wa_id text not null, variant text not null default 'A' check(variant in ('A','B')),
  status text not null default 'pending' check(status in ('pending','processing','sent','delivered','read','failed','responded','skipped')),
  attempts integer not null default 0 check(attempts between 0 and 3), next_attempt_at timestamptz not null default now(),
  whatsapp_message_id text, error_message text, sent_at timestamptz, delivered_at timestamptz, read_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(campaign_id,customer_id), unique(campaign_id,whatsapp_contact_id)
);
create table public.crm_campaign_events (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  recipient_id uuid references public.crm_campaign_recipients(id) on delete set null,
  event_type text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.crm_campaign_attributions (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  revenue_cents integer not null check(revenue_cents>=0), attributed_at timestamptz not null default now(), unique(order_id)
);

create table public.crm_automations (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  automation_type text not null check(automation_type in ('first_order','post_sale','repurchase','inactive','vip')),
  enabled boolean not null default false, template_id uuid references public.whatsapp_message_templates(id), delay_hours integer not null default 24,
  settings jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), unique(establishment_id,automation_type)
);
create table public.crm_feedback (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade, order_id uuid not null references public.orders(id) on delete cascade,
  whatsapp_contact_id uuid references public.whatsapp_contacts(id) on delete set null,
  rating smallint check(rating between 1 and 5), comment text, needs_human_attention boolean not null default false,
  requested_at timestamptz not null default now(), answered_at timestamptz, created_at timestamptz not null default now(), unique(order_id)
);
create table public.crm_relationship_outbox (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  automation_id uuid not null references public.crm_automations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  whatsapp_contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade, automation_type text not null,
  scheduled_at timestamptz not null, status text not null default 'pending' check(status in('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check(attempts between 0 and 3), next_attempt_at timestamptz not null default now(),
  delivery_token uuid not null default gen_random_uuid(), whatsapp_message_id text, error_message text, sent_at timestamptz,
  idempotency_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(establishment_id,idempotency_key)
);

create table public.loyalty_programs (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  enabled boolean not null default false, earning_model text not null default 'spend' check(earning_model in ('spend','order')),
  points_per_real numeric(10,2) not null default 1 check(points_per_real>=0), points_per_order integer not null default 0 check(points_per_order>=0),
  updated_at timestamptz not null default now()
);
create table public.loyalty_accounts (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  balance integer not null default 0 check(balance>=0), lifetime_earned integer not null default 0, updated_at timestamptz not null default now(),
  primary key(establishment_id,customer_id)
);
create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade, order_id uuid references public.orders(id) on delete set null,
  event_type text not null check(event_type in ('earn','redeem','adjust','expire','refund')), points integer not null,
  idempotency_key text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique(establishment_id,idempotency_key)
);
create table public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null, points_cost integer not null check(points_cost>0), coupon_id uuid not null references public.coupons(id),
  minimum_order_cents integer not null default 0, active boolean not null default true, starts_at timestamptz, ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.crm_coupon_tokens (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  campaign_id uuid references public.crm_campaigns(id) on delete cascade, coupon_id uuid not null references public.coupons(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null, display_code text not null, used_at timestamptz, created_at timestamptz not null default now(),
  unique(establishment_id,display_code), unique(campaign_id,customer_id)
);

create index crm_segments_tenant_idx on public.crm_segments(establishment_id,active);
create index crm_campaigns_schedule_idx on public.crm_campaigns(scheduled_at) where status='scheduled';
create index crm_recipients_queue_idx on public.crm_campaign_recipients(next_attempt_at,created_at) where status in ('pending','failed');
create index crm_events_campaign_idx on public.crm_campaign_events(campaign_id,event_type,created_at);
create index crm_attribution_campaign_idx on public.crm_campaign_attributions(campaign_id,attributed_at);
create index crm_consent_customer_idx on public.crm_consent_events(establishment_id,customer_id,created_at desc);
create index crm_relationship_dispatch_idx on public.crm_relationship_outbox(next_attempt_at,scheduled_at) where status in('pending','failed');

create or replace function public.crm_customer_status(target_customer uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare c public.customers%rowtype; r public.crm_rules%rowtype; recent_orders integer;
begin
  select * into c from public.customers where id=target_customer;
  if not found then return null; end if;
  select * into r from public.crm_rules where establishment_id=c.establishment_id;
  if not found then r.recurring_min_orders:=3; r.recurring_period_days:=90; r.vip_min_spent_cents:=50000; r.vip_min_orders:=8; r.at_risk_days:=30; r.inactive_days:=60; end if;
  if c.last_order_at is null or c.last_order_at < now()-make_interval(days=>r.inactive_days) then return 'inactive'; end if;
  if c.total_spent_cents>=r.vip_min_spent_cents or c.total_orders>=r.vip_min_orders then return 'vip'; end if;
  if c.last_order_at < now()-make_interval(days=>r.at_risk_days) then return 'at_risk'; end if;
  select count(*) into recent_orders from public.orders where customer_id=c.id and status<>'canceled' and created_at>=now()-make_interval(days=>r.recurring_period_days);
  if recent_orders>=r.recurring_min_orders then return 'recurring'; end if;
  if c.total_orders<=1 then return 'new'; end if;
  return 'active';
end $$;

create or replace function private.crm_segment_customer_ids(target_segment uuid)
returns table(customer_id uuid) language plpgsql stable security definer set search_path='' as $$
declare s public.crm_segments%rowtype;
begin
  select * into s from public.crm_segments where id=target_segment and active;
  if not found then return; end if;
  return query select c.id from public.customers c
  where c.establishment_id=s.establishment_id
    and (not(s.filters?'status') or public.crm_customer_status(c.id)=s.filters->>'status')
    and (not(s.filters?'inactive_days') or c.last_order_at<=now()-make_interval(days=>(s.filters->>'inactive_days')::int))
    and (not(s.filters?'recent_days') or c.last_order_at>=now()-make_interval(days=>(s.filters->>'recent_days')::int))
    and (not(s.filters?'min_ticket_cents') or (case when c.total_orders>0 then c.total_spent_cents/c.total_orders else 0 end)>=(s.filters->>'min_ticket_cents')::bigint)
    and (not(s.filters?'source') or exists(select 1 from public.orders o where o.customer_id=c.id and o.source=s.filters->>'source'))
    and (not(s.filters?'weekend') or exists(select 1 from public.orders o where o.customer_id=c.id and extract(isodow from o.created_at) in (6,7)))
    and (not(s.filters?'product_id') or exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where o.customer_id=c.id and oi.product_id=(s.filters->>'product_id')::uuid))
    and (not(s.filters?'category_id') or exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id join public.products p on p.id=oi.product_id where o.customer_id=c.id and p.category_id=(s.filters->>'category_id')::uuid))
    and (not(s.filters?'abandoned_cart') or exists(select 1 from public.whatsapp_contacts wc join public.whatsapp_carts cart on cart.contact_id=wc.id where wc.customer_id=c.id and cart.status='abandoned'));
end $$;

create or replace function public.get_crm_dashboard(requested_establishment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_crm_permission(requested_establishment_id,'view_metrics') then raise exception 'Sem permissão para visualizar métricas do CRM.'; end if;
  return jsonb_build_object(
    'total_customers',(select count(*) from public.customers where establishment_id=requested_establishment_id),
    'new_customers',(select count(*) from public.customers where establishment_id=requested_establishment_id and created_at>=date_trunc('month',now())),
    'active_customers',(select count(*) from public.customers c where establishment_id=requested_establishment_id and public.crm_customer_status(c.id)='active'),
    'recurring_customers',(select count(*) from public.customers c where establishment_id=requested_establishment_id and public.crm_customer_status(c.id)='recurring'),
    'vip_customers',(select count(*) from public.customers c where establishment_id=requested_establishment_id and public.crm_customer_status(c.id)='vip'),
    'inactive_customers',(select count(*) from public.customers c where establishment_id=requested_establishment_id and public.crm_customer_status(c.id)='inactive'),
    'average_ticket_cents',(select coalesce(round(avg(total_cents)),0) from public.orders where establishment_id=requested_establishment_id and status<>'canceled'),
    'campaign_orders',(select count(*) from public.crm_campaign_attributions where establishment_id=requested_establishment_id),
    'campaign_revenue_cents',(select coalesce(sum(revenue_cents),0) from public.crm_campaign_attributions where establishment_id=requested_establishment_id),
    'repurchase_rate',(select case when count(*)=0 then 0 else round(100.0*count(*) filter(where total_orders>1)/count(*),1) end from public.customers where establishment_id=requested_establishment_id)
  );
end $$;

create or replace function public.list_crm_customers(requested_establishment_id uuid, requested_limit integer default 100)
returns table(id uuid,name text,phone text,marketing_status text,last_order_at timestamptz,total_orders integer,total_spent_cents bigint,average_ticket_cents bigint,status text,customer_tags jsonb,last_conversation_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_crm_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para visualizar clientes.'; end if;
  return query select c.id,c.name,c.phone,c.marketing_status,c.last_order_at,c.total_orders,c.total_spent_cents,
    case when c.total_orders>0 then c.total_spent_cents/c.total_orders else 0 end,public.crm_customer_status(c.id),
    coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'color',t.color,'source',ct.source) order by t.name) from public.crm_customer_tags ct join public.crm_tags t on t.id=ct.tag_id where ct.customer_id=c.id),'[]'::jsonb),
    (select max(wc.last_message_at) from public.whatsapp_contacts wc where wc.customer_id=c.id)
  from public.customers c where c.establishment_id=requested_establishment_id order by c.last_order_at desc nulls last limit least(greatest(requested_limit,1),500);
end $$;

create or replace function public.get_crm_customer_360(requested_establishment_id uuid, requested_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.customers%rowtype;
begin
  if auth.uid() is null or not private.has_crm_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para visualizar cliente.'; end if;
  select * into c from public.customers where id=requested_customer_id and establishment_id=requested_establishment_id;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  return jsonb_build_object('customer',to_jsonb(c)||jsonb_build_object('status',public.crm_customer_status(c.id),'average_ticket_cents',case when c.total_orders>0 then c.total_spent_cents/c.total_orders else 0 end),
    'orders',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,order_number,status,source,total_cents,created_at from public.orders where customer_id=c.id order by created_at desc limit 10)x),
    'preferences',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select oi.product_name,sum(oi.quantity)::bigint quantity from public.order_items oi join public.orders o on o.id=oi.order_id where o.customer_id=c.id group by oi.product_name order by quantity desc limit 5)x),
    'conversations',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select cv.id,cv.status,cv.last_message_preview,cv.last_message_at from public.whatsapp_conversations cv join public.whatsapp_contacts wc on wc.id=cv.contact_id where wc.customer_id=c.id order by cv.last_message_at desc limit 5)x),
    'campaigns',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select ca.name,r.status,r.sent_at from public.crm_campaign_recipients r join public.crm_campaigns ca on ca.id=r.campaign_id where r.customer_id=c.id order by r.created_at desc limit 10)x),
    'loyalty',(select to_jsonb(a) from public.loyalty_accounts a where a.establishment_id=requested_establishment_id and a.customer_id=c.id));
end $$;

create or replace function public.estimate_crm_segment(requested_establishment_id uuid, requested_segment_id uuid)
returns integer language plpgsql stable security definer set search_path='' as $$
declare result integer;
begin
  if auth.uid() is null or not private.has_crm_permission(requested_establishment_id,'manage_segments') then raise exception 'Sem permissão para segmentos.'; end if;
  if not exists(select 1 from public.crm_segments where id=requested_segment_id and establishment_id=requested_establishment_id) then raise exception 'Segmento inválido.'; end if;
  select count(*) into result from private.crm_segment_customer_ids(requested_segment_id) ids
    join public.whatsapp_contacts wc on wc.customer_id=ids.customer_id and wc.establishment_id=requested_establishment_id
    join public.customers c on c.id=ids.customer_id
    where c.marketing_status='opted_in' and wc.marketing_opt_out=false and wc.blocked_at is null;
  return result;
end $$;

create or replace function public.set_customer_marketing_consent(requested_establishment_id uuid, requested_customer_id uuid, requested_contact_id uuid, requested_status text, requested_origin text, requested_channel text default 'whatsapp', requested_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
  allowed := auth.role()='service_role' or private.has_crm_permission(requested_establishment_id,'edit_customer');
  if not allowed then raise exception 'Sem permissão para alterar consentimento.'; end if;
  if requested_status not in('opted_in','opted_out') then raise exception 'Status de consentimento inválido.'; end if;
  update public.customers set marketing_status=requested_status,marketing_consent_at=now() where id=requested_customer_id and establishment_id=requested_establishment_id;
  update public.whatsapp_contacts set marketing_status=requested_status,marketing_consent_at=now(),marketing_opt_out=(requested_status='opted_out') where id=requested_contact_id and establishment_id=requested_establishment_id;
  insert into public.crm_consent_events(establishment_id,customer_id,whatsapp_contact_id,status,origin,channel,actor_id,evidence)
  values(requested_establishment_id,requested_customer_id,requested_contact_id,requested_status,requested_origin,requested_channel,auth.uid(),coalesce(requested_evidence,'{}'::jsonb));
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,auth.uid(),'crm.consent_changed','customer',requested_customer_id,jsonb_build_object('status',requested_status,'origin',requested_origin,'contact_id',requested_contact_id));
  return jsonb_build_object('status',requested_status,'changed_at',now());
end $$;

create or replace function public.approve_crm_campaign(requested_establishment_id uuid, requested_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign public.crm_campaigns%rowtype; rules public.crm_rules%rowtype; count_rec integer; company_tz text;
begin
  if auth.uid() is null or not private.has_crm_permission(requested_establishment_id,'approve_campaign') then raise exception 'Sem permissão para aprovar campanha.'; end if;
  select * into campaign from public.crm_campaigns where id=requested_campaign_id and establishment_id=requested_establishment_id for update;
  if not found or campaign.status<>'draft' then raise exception 'Campanha não está em rascunho.'; end if;
  if not exists(select 1 from public.whatsapp_message_templates where id=campaign.template_id and establishment_id=requested_establishment_id and status='approved') then raise exception 'Template oficial não está aprovado.'; end if;
  if campaign.product_id is not null and not exists(select 1 from public.products where id=campaign.product_id and establishment_id=requested_establishment_id and active) then raise exception 'Produto indisponível.'; end if;
  if campaign.coupon_id is not null and not exists(select 1 from public.coupons where id=campaign.coupon_id and establishment_id=requested_establishment_id and active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now())) then raise exception 'Cupom inválido.'; end if;
  insert into public.crm_rules(establishment_id) values(requested_establishment_id) on conflict do nothing;
  select * into rules from public.crm_rules where establishment_id=requested_establishment_id;
  if (select count(*) from public.crm_campaigns where establishment_id=requested_establishment_id and approved_at>=date_trunc('day',now()))>=rules.max_campaigns_per_day then raise exception 'Limite diário de campanhas atingido.'; end if;
  insert into public.crm_campaign_recipients(establishment_id,campaign_id,customer_id,whatsapp_contact_id,wa_id,variant)
  select requested_establishment_id,campaign.id,c.id,wc.id,wc.wa_id,case when campaign.variant_b_variables is not null and mod(abs(hashtext(c.id::text)),2)=1 then 'B' else 'A' end
  from private.crm_segment_customer_ids(campaign.segment_id) ids join public.customers c on c.id=ids.customer_id
  join lateral(select wc0.* from public.whatsapp_contacts wc0 where wc0.customer_id=c.id and wc0.establishment_id=requested_establishment_id and wc0.marketing_opt_out=false and wc0.blocked_at is null order by wc0.last_message_at desc nulls last limit 1) wc on true
  where c.marketing_status='opted_in'
    and (select count(*) from public.crm_campaign_recipients old where old.customer_id=c.id and old.establishment_id=requested_establishment_id and old.sent_at>=now()-interval '7 days')<rules.max_promotional_messages_per_customer_7d
    and not exists(select 1 from public.crm_campaign_recipients old where old.customer_id=c.id and old.establishment_id=requested_establishment_id and old.sent_at>=now()-make_interval(hours=>rules.minimum_campaign_interval_hours))
  on conflict do nothing;
  get diagnostics count_rec=row_count;
  if count_rec=0 then raise exception 'Nenhum destinatário elegível com consentimento.'; end if;
  select timezone into company_tz from public.establishment_settings where establishment_id=requested_establishment_id;
  update public.crm_campaigns set estimated_recipients=count_rec,approved_by=auth.uid(),approved_at=now(),timezone=coalesce(company_tz,'America/Sao_Paulo'),status=case when scheduled_at is not null and scheduled_at>now() then 'scheduled' else 'processing' end,updated_at=now() where id=campaign.id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,auth.uid(),'crm.campaign_approved','crm_campaign',campaign.id,jsonb_build_object('segment_id',campaign.segment_id,'template_id',campaign.template_id,'estimated_recipients',count_rec,'scheduled_at',campaign.scheduled_at));
  if campaign.scheduled_at is null or campaign.scheduled_at<=now() then
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/process-whatsapp-campaign-batch',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('campaign_id',campaign.id,'token',campaign.dispatch_token),timeout_milliseconds:=5000);
  end if;
  return jsonb_build_object('campaign_id',campaign.id,'recipients',count_rec,'status',case when campaign.scheduled_at is not null and campaign.scheduled_at>now() then 'scheduled' else 'processing' end);
end $$;

create or replace function public.cancel_crm_campaign(requested_establishment_id uuid, requested_campaign_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_crm_permission(requested_establishment_id,'cancel_campaign') then raise exception 'Sem permissão para cancelar campanha.'; end if;
  update public.crm_campaigns set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),updated_at=now()
    where id=requested_campaign_id and establishment_id=requested_establishment_id and status in('draft','scheduled','paused','processing');
  update public.crm_campaign_recipients set status='skipped',updated_at=now() where campaign_id=requested_campaign_id and status='pending';
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,auth.uid(),'crm.campaign_cancelled','crm_campaign',requested_campaign_id,'{}');
end $$;

create or replace function public.get_loyalty_balance(requested_establishment_id uuid, requested_customer_id uuid)
returns integer language plpgsql stable security definer set search_path='' as $$
declare result integer;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or not private.has_crm_permission(requested_establishment_id,'view')) then raise exception 'Sem permissão para consultar fidelidade.'; end if;
  select coalesce(balance,0) into result from public.loyalty_accounts where establishment_id=requested_establishment_id and customer_id=requested_customer_id;
  return coalesce(result,0);
end $$;

create or replace function private.crm_order_completed()
returns trigger language plpgsql security definer set search_path='' as $$
declare program public.loyalty_programs%rowtype; earned integer; source_campaign uuid; rules public.crm_rules%rowtype; contact uuid; automation public.crm_automations%rowtype;
begin
  if new.status<>'completed' or old.status='completed' or new.customer_id is null then return new; end if;
  select * into program from public.loyalty_programs where establishment_id=new.establishment_id and enabled;
  if found then
    earned:=case when program.earning_model='spend' then floor((new.total_cents/100.0)*program.points_per_real)::int else program.points_per_order end;
    if earned>0 then
      insert into public.loyalty_ledger(establishment_id,customer_id,order_id,event_type,points,idempotency_key,metadata)
      values(new.establishment_id,new.customer_id,new.id,'earn',earned,'order:'||new.id,jsonb_build_object('total_cents',new.total_cents)) on conflict do nothing;
      if found then insert into public.loyalty_accounts(establishment_id,customer_id,balance,lifetime_earned) values(new.establishment_id,new.customer_id,earned,earned)
        on conflict(establishment_id,customer_id) do update set balance=public.loyalty_accounts.balance+excluded.balance,lifetime_earned=public.loyalty_accounts.lifetime_earned+excluded.lifetime_earned,updated_at=now(); end if;
    end if;
  end if;
  select * into rules from public.crm_rules where establishment_id=new.establishment_id;
  select r.campaign_id into source_campaign from public.crm_campaign_recipients r
    where r.customer_id=new.customer_id and r.sent_at is not null and r.sent_at<=new.created_at
      and r.sent_at>=new.created_at-make_interval(days=>coalesce(rules.attribution_window_days,7))
    order by r.sent_at desc limit 1;
  if source_campaign is not null then
    insert into public.crm_campaign_attributions(establishment_id,campaign_id,customer_id,order_id,revenue_cents)
    values(new.establishment_id,source_campaign,new.customer_id,new.id,new.total_cents) on conflict(order_id) do nothing;
    if found then update public.crm_campaigns set order_count=order_count+1,attributed_revenue_cents=attributed_revenue_cents+new.total_cents where id=source_campaign; end if;
  end if;
  if exists(select 1 from public.crm_automations where establishment_id=new.establishment_id and automation_type='post_sale' and enabled) then
    select id into contact from public.whatsapp_contacts where customer_id=new.customer_id and establishment_id=new.establishment_id order by last_message_at desc nulls last limit 1;
    insert into public.crm_feedback(establishment_id,customer_id,order_id,whatsapp_contact_id) values(new.establishment_id,new.customer_id,new.id,contact) on conflict(order_id) do nothing;
  end if;
  if contact is null then select id into contact from public.whatsapp_contacts where customer_id=new.customer_id and establishment_id=new.establishment_id order by last_message_at desc nulls last limit 1; end if;
  if contact is not null then
    for automation in select * from public.crm_automations where establishment_id=new.establishment_id and enabled and template_id is not null
      and (automation_type='post_sale' or automation_type='first_order' and (select total_orders from public.customers where id=new.customer_id)<=1 or automation_type='vip' and public.crm_customer_status(new.customer_id)='vip')
    loop
      insert into public.crm_relationship_outbox(establishment_id,automation_id,customer_id,whatsapp_contact_id,order_id,automation_type,scheduled_at,next_attempt_at,idempotency_key)
      values(new.establishment_id,automation.id,new.customer_id,contact,new.id,automation.automation_type,now()+make_interval(hours=>automation.delay_hours),now()+make_interval(hours=>automation.delay_hours),automation.automation_type||':order:'||new.id)
      on conflict do nothing;
    end loop;
  end if;
  return new;
end $$;
create trigger orders_crm_completed after update of status on public.orders for each row execute function private.crm_order_completed();

create or replace function private.refresh_crm_campaign_metrics()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(new.campaign_id,old.campaign_id);
begin
  update public.crm_campaigns c set
    sent_count=(select count(*) from public.crm_campaign_recipients where campaign_id=target and status in('sent','delivered','read','responded')),
    delivered_count=(select count(*) from public.crm_campaign_recipients where campaign_id=target and status in('delivered','read','responded')),
    read_count=(select count(*) from public.crm_campaign_recipients where campaign_id=target and status in('read','responded')),
    response_count=(select count(*) from public.crm_campaign_recipients where campaign_id=target and status='responded'),
    failed_count=(select count(*) from public.crm_campaign_recipients where campaign_id=target and status='failed'),updated_at=now()
  where c.id=target;
  return coalesce(new,old);
end $$;
create trigger crm_recipients_refresh_metrics after insert or update of status on public.crm_campaign_recipients
for each row execute function private.refresh_crm_campaign_metrics();

create or replace function private.crm_track_campaign_response()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  if new.direction<>'inbound' then return new; end if;
  select id into recipient from public.crm_campaign_recipients
    where whatsapp_contact_id=new.contact_id and sent_at>=new.message_timestamp-interval '14 days'
      and sent_at<=new.message_timestamp and status in('sent','delivered','read')
    order by sent_at desc limit 1;
  if recipient is not null then
    update public.crm_campaign_recipients set status='responded',updated_at=now() where id=recipient;
    insert into public.crm_campaign_events(establishment_id,campaign_id,recipient_id,event_type,metadata)
    select establishment_id,campaign_id,id,'response',jsonb_build_object('message_id',new.id) from public.crm_campaign_recipients where id=recipient;
  end if;
  return new;
end $$;
create trigger whatsapp_messages_crm_response after insert on public.whatsapp_messages
for each row execute function private.crm_track_campaign_response();

create or replace function private.activate_due_crm_campaigns()
returns void language plpgsql security definer set search_path='' as $$
declare item record;
begin
  for item in update public.crm_campaigns set status='processing',updated_at=now() where status='scheduled' and scheduled_at<=now() returning id,dispatch_token loop
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/process-whatsapp-campaign-batch',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('campaign_id',item.id,'token',item.dispatch_token),timeout_milliseconds:=5000);
  end loop;
end $$;
revoke all on function private.activate_due_crm_campaigns() from public,anon,authenticated;

create or replace function private.activate_due_relationship_automations()
returns void language plpgsql security definer set search_path='' as $$
declare item record;
begin
  -- Recompra/inatividade are created once per customer and calendar day, never as an unbounded blast.
  insert into public.crm_relationship_outbox(establishment_id,automation_id,customer_id,whatsapp_contact_id,automation_type,scheduled_at,next_attempt_at,idempotency_key)
  select a.establishment_id,a.id,c.id,wc.id,a.automation_type,now(),now(),a.automation_type||':'||c.id||':'||current_date
  from public.crm_automations a join public.customers c on c.establishment_id=a.establishment_id
  join lateral(select id from public.whatsapp_contacts where customer_id=c.id and establishment_id=c.establishment_id and marketing_opt_out=false and blocked_at is null order by last_message_at desc nulls last limit 1)wc on true
  where a.enabled and a.template_id is not null and a.automation_type in('repurchase','inactive') and c.marketing_status='opted_in'
    and c.last_order_at<=now()-make_interval(hours=>a.delay_hours)
  on conflict do nothing;
  for item in select id,delivery_token from public.crm_relationship_outbox where status in('pending','failed') and scheduled_at<=now() and next_attempt_at<=now() and attempts<3 order by created_at limit 20 loop
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/process-whatsapp-relationship-automation',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('event_id',item.id,'token',item.delivery_token),timeout_milliseconds:=5000);
  end loop;
end $$;
revoke all on function private.activate_due_relationship_automations() from public,anon,authenticated;
select cron.schedule('masterapp-crm-campaigns','* * * * *','select private.activate_due_crm_campaigns()');
select cron.schedule('masterapp-crm-automations','*/5 * * * *','select private.activate_due_relationship_automations()');

-- RLS: every exposed CRM table is tenant-scoped; writes use guarded RPCs or explicit policies.
do $$ declare n text; begin foreach n in array array[
  'crm_member_permissions','crm_rules','crm_consent_events','crm_tags','crm_customer_tags','crm_segments','whatsapp_message_templates',
  'crm_campaigns','crm_campaign_recipients','crm_campaign_events','crm_campaign_attributions','crm_automations','crm_feedback','crm_relationship_outbox',
  'loyalty_programs','loyalty_accounts','loyalty_ledger','loyalty_rewards','crm_coupon_tokens'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from anon',n);
  execute format('grant select on public.%I to authenticated',n);
  execute format('create policy %I on public.%I for select to authenticated using (private.has_crm_permission(establishment_id,''view''))','crm_read_'||n,n);
end loop; end $$;
create policy crm_permissions_owner_write on public.crm_member_permissions for all to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy crm_rules_owner_write on public.crm_rules for all to authenticated using(private.has_crm_permission(establishment_id,'configure_loyalty')) with check(private.has_crm_permission(establishment_id,'configure_loyalty'));
create policy crm_segments_write on public.crm_segments for all to authenticated using(private.has_crm_permission(establishment_id,'manage_segments')) with check(private.has_crm_permission(establishment_id,'manage_segments'));
create policy crm_tags_write on public.crm_tags for all to authenticated using(private.has_crm_permission(establishment_id,'edit_customer')) with check(private.has_crm_permission(establishment_id,'edit_customer'));
create policy crm_customer_tags_write on public.crm_customer_tags for all to authenticated using(private.has_crm_permission(establishment_id,'edit_customer')) with check(private.has_crm_permission(establishment_id,'edit_customer'));
create policy crm_templates_write on public.whatsapp_message_templates for all to authenticated using(private.has_crm_permission(establishment_id,'create_campaign')) with check(private.has_crm_permission(establishment_id,'create_campaign'));
create policy crm_campaigns_write on public.crm_campaigns for insert to authenticated with check(private.has_crm_permission(establishment_id,'create_campaign') and created_by=(select auth.uid()) and status='draft');
create policy crm_campaigns_update on public.crm_campaigns for update to authenticated using(private.has_crm_permission(establishment_id,'create_campaign')) with check(private.has_crm_permission(establishment_id,'create_campaign'));
create policy crm_automations_write on public.crm_automations for all to authenticated using(private.has_crm_permission(establishment_id,'create_campaign')) with check(private.has_crm_permission(establishment_id,'create_campaign'));
create policy loyalty_program_write on public.loyalty_programs for all to authenticated using(private.has_crm_permission(establishment_id,'configure_loyalty')) with check(private.has_crm_permission(establishment_id,'configure_loyalty'));
create policy loyalty_rewards_write on public.loyalty_rewards for all to authenticated using(private.has_crm_permission(establishment_id,'configure_loyalty')) with check(private.has_crm_permission(establishment_id,'configure_loyalty'));
grant insert,update,delete on public.crm_member_permissions,public.crm_rules,public.crm_tags,public.crm_customer_tags,public.crm_segments,public.whatsapp_message_templates,public.crm_campaigns,public.crm_automations,public.loyalty_programs,public.loyalty_rewards to authenticated;

revoke all on function public.crm_customer_status(uuid),public.get_crm_dashboard(uuid),public.list_crm_customers(uuid,integer),public.get_crm_customer_360(uuid,uuid),public.estimate_crm_segment(uuid,uuid),public.set_customer_marketing_consent(uuid,uuid,uuid,text,text,text,jsonb),public.approve_crm_campaign(uuid,uuid),public.cancel_crm_campaign(uuid,uuid),public.get_loyalty_balance(uuid,uuid) from public,anon;
grant execute on function public.get_crm_dashboard(uuid),public.list_crm_customers(uuid,integer),public.get_crm_customer_360(uuid,uuid),public.estimate_crm_segment(uuid,uuid),public.set_customer_marketing_consent(uuid,uuid,uuid,text,text,text,jsonb),public.approve_crm_campaign(uuid,uuid),public.cancel_crm_campaign(uuid,uuid),public.get_loyalty_balance(uuid,uuid) to authenticated;
grant execute on function public.crm_customer_status(uuid) to authenticated,service_role;

insert into public.crm_rules(establishment_id) select id from public.establishments on conflict do nothing;
insert into public.loyalty_programs(establishment_id) select id from public.establishments on conflict do nothing;
insert into public.crm_automations(establishment_id,automation_type,enabled,delay_hours)
select e.id,t.kind,false,t.delay from public.establishments e cross join(values('first_order',1),('post_sale',24),('repurchase',720),('inactive',1440),('vip',1))t(kind,delay)
on conflict do nothing;
insert into public.crm_segments(establishment_id,name,description,filters)
select e.id,s.name,s.description,s.filters from public.establishments e cross join(values
  ('Clientes VIP','Gasto ou frequência acima das regras configuradas','{"status":"vip"}'::jsonb),
  ('Inativos há 30 dias','Sem compra nos últimos 30 dias','{"inactive_days":30}'::jsonb),
  ('Compraram nos últimos 7 dias','Clientes recentes','{"recent_days":7}'::jsonb),
  ('Pedidos pelo WhatsApp','Já compraram pelo atendimento oficial','{"source":"whatsapp"}'::jsonb),
  ('Compras no fim de semana','Clientes com pedidos aos sábados ou domingos','{"weekend":true}'::jsonb),
  ('Carrinho abandonado','Clientes com carrinho abandonado no WhatsApp','{"abandoned_cart":true}'::jsonb)
)s(name,description,filters) on conflict do nothing;
