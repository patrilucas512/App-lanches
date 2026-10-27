-- Fase 14: assinaturas dos clientes finais. Mantida separada de public.subscriptions (SaaS MasterApp).
alter table public.plans
  add column if not exists subscriptions_enabled boolean not null default false,
  add column if not exists loyalty_club_enabled boolean not null default false,
  add column if not exists recurring_billing_enabled boolean not null default false;

alter table public.store_feature_flags
  add column if not exists subscriptions_enabled boolean not null default true,
  add column if not exists loyalty_club_enabled boolean not null default true,
  add column if not exists recurring_billing_enabled boolean not null default true;

update public.plans set subscriptions_enabled=true,loyalty_club_enabled=true,recurring_billing_enabled=true where active;

create table public.customer_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 2 and 100),
  description text,
  status text not null default 'draft' check(status in ('draft','active','paused','archived')),
  billing_interval text not null check(billing_interval in ('weekly','monthly','quarterly','yearly')),
  cancellation_policy text not null default 'end_of_cycle' check(cancellation_policy in ('immediate','end_of_cycle')),
  grace_period_days smallint not null default 3 check(grace_period_days between 0 and 30),
  trial_enabled boolean not null default false,
  trial_days smallint not null default 0 check(trial_days between 0 and 90),
  pause_enabled boolean not null default false,
  allow_multiple boolean not null default false,
  valid_all_stores boolean not null default false,
  eligible_store_ids uuid[] not null default '{}',
  terms_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.customer_subscription_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.customer_subscription_plans(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check(version>0),
  price_cents integer not null check(price_cents>=0),
  currency text not null default 'BRL' check(currency='BRL'),
  billing_interval text not null check(billing_interval in ('weekly','monthly','quarterly','yearly')),
  benefit_snapshot jsonb not null default '[]',
  effective_from timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique(plan_id,version)
);

create table public.customer_subscription_benefits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.customer_subscription_plans(id) on delete cascade,
  plan_version_id uuid not null references public.customer_subscription_plan_versions(id) on delete cascade,
  name text not null,
  description text,
  benefit_type text not null check(benefit_type in ('percentage_discount','fixed_discount','free_delivery','free_product','product_allowance','category_discount','bonus_points','priority_offer','exclusive_coupon')),
  value_numeric numeric(12,4),
  value_cents integer,
  quantity integer not null default 1 check(quantity>0),
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  coupon_id uuid references public.coupons(id) on delete set null,
  limit_period text not null default 'cycle' check(limit_period in ('order','day','week','month','cycle','total')),
  limit_quantity integer check(limit_quantity is null or limit_quantity>0),
  minimum_order_cents integer not null default 0 check(minimum_order_cents>=0),
  auto_apply boolean not null default true,
  stack_mode text not null default 'best' check(stack_mode in ('accumulate','exclusive','best','coupon_first','subscription_first')),
  priority integer not null default 100,
  eligible_store_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  organization_customer_id uuid references public.organization_customers(id) on delete restrict,
  plan_id uuid not null references public.customer_subscription_plans(id) on delete restrict,
  plan_version_id uuid not null references public.customer_subscription_plan_versions(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','trialing','active','past_due','paused','cancelled','expired')),
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  grace_period_ends_at timestamptz,
  cancelled_at timestamptz,
  cancellation_effective_at timestamptz,
  cancellation_reason text,
  cancellation_kind text check(cancellation_kind is null or cancellation_kind in ('voluntary','involuntary','administrative')),
  payment_provider text check(payment_provider is null or payment_provider in ('mercado_pago','pagarme','manual')),
  payment_provider_subscription_id text,
  payment_gateway_account_id uuid references public.payment_gateway_accounts(id) on delete set null,
  checkout_url text,
  consent_text text not null,
  consented_at timestamptz not null,
  consent_ip_hash text,
  manual_renewal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customer_subscription_provider_key on public.customer_subscriptions(payment_provider,payment_provider_subscription_id) where payment_provider_subscription_id is not null;
create unique index customer_subscription_single_plan on public.customer_subscriptions(organization_id,customer_id,plan_id) where status in ('pending','trialing','active','past_due','paused');
create index customer_subscription_customer_idx on public.customer_subscriptions(organization_id,organization_customer_id,status);
create index customer_subscription_metrics_idx on public.customer_subscriptions(organization_id,establishment_id,status,created_at);

create table public.customer_subscription_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.customer_subscriptions(id) on delete cascade,
  benefit_id uuid not null references public.customer_subscription_benefits(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  quantity integer not null default 1 check(quantity>0),
  amount_cents integer not null default 0 check(amount_cents>=0),
  usage_period_start timestamptz not null,
  usage_period_end timestamptz not null,
  source text not null default 'order' check(source in ('order','portal','admin','renewal')),
  reason text,
  idempotency_key text not null,
  used_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(organization_id,idempotency_key)
);
create index customer_subscription_usage_limit_idx on public.customer_subscription_usage(subscription_id,benefit_id,usage_period_start,used_at);

create table public.customer_subscription_billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.customer_subscriptions(id) on delete cascade,
  provider text not null check(provider in ('mercado_pago','pagarme','manual')),
  external_event_id text,
  external_payment_id text,
  event_type text not null check(event_type in ('subscription_created','subscription_activated','payment_succeeded','payment_failed','subscription_paused','subscription_cancelled','subscription_renewed','manual_renewal_requested')),
  amount_cents integer not null default 0 check(amount_cents>=0),
  status text not null,
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider,external_event_id)
);

create table public.customer_subscription_webhook_events (
  id uuid primary key default gen_random_uuid(),
  gateway_account_id uuid not null references public.payment_gateway_accounts(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  event_type text,
  signature_valid boolean not null,
  payload_hash text not null,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(gateway_account_id,provider,external_event_id)
);

create table public.subscription_member_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default true,
  can_manage_plans boolean not null default false,
  can_publish boolean not null default false,
  can_view_revenue boolean not null default false,
  can_cancel boolean not null default false,
  can_adjust_benefits boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(establishment_id,user_id)
);

alter table public.orders
  add column if not exists customer_subscription_id uuid references public.customer_subscriptions(id) on delete set null,
  add column if not exists applied_subscription_benefit_id uuid references public.customer_subscription_benefits(id) on delete set null,
  add column if not exists subscription_discount_cents integer not null default 0 check(subscription_discount_cents>=0);

create or replace function private.has_subscription_permission(target_store uuid,permission_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role(target_store,array['owner','manager']::public.member_role[])
  or exists(select 1 from public.subscription_member_permissions p where p.establishment_id=target_store and p.user_id=auth.uid() and p.can_view and case permission_name when 'manage' then p.can_manage_plans when 'publish' then p.can_publish when 'revenue' then p.can_view_revenue when 'cancel' then p.can_cancel when 'adjust' then p.can_adjust_benefits else true end)
$$;

create or replace function private.subscription_period_end(base_at timestamptz,interval_name text)
returns timestamptz language sql immutable set search_path='' as $$
  select case interval_name when 'weekly' then base_at+interval '7 days' when 'monthly' then base_at+interval '1 month' when 'quarterly' then base_at+interval '3 months' when 'yearly' then base_at+interval '1 year' else base_at+interval '1 month' end
$$;

create or replace function private.subscription_usage_window(subscription_row public.customer_subscriptions,period_name text)
returns tstzrange language sql stable set search_path='' as $$
  select case period_name when 'day' then tstzrange(date_trunc('day',now()),date_trunc('day',now())+interval '1 day','[)') when 'week' then tstzrange(date_trunc('week',now()),date_trunc('week',now())+interval '1 week','[)') when 'month' then tstzrange(date_trunc('month',now()),date_trunc('month',now())+interval '1 month','[)') when 'total' then tstzrange('-infinity', 'infinity','()') else tstzrange(coalesce(subscription_row.current_period_start,now()),coalesce(subscription_row.current_period_end,private.subscription_period_end(now(),'monthly')),'[)') end
$$;

create or replace function public.create_customer_subscription_plan(requested_establishment_id uuid,requested_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;p public.customer_subscription_plans%rowtype;v public.customer_subscription_plan_versions%rowtype;
begin
  if not private.has_subscription_permission(requested_establishment_id,'manage') then raise exception 'Sem permissão para criar planos.';end if;
  select * into e from public.establishments where id=requested_establishment_id;
  if e.id is null then raise exception 'Estabelecimento inválido.';end if;
  insert into public.customer_subscription_plans(organization_id,establishment_id,name,description,billing_interval,cancellation_policy,grace_period_days,trial_enabled,trial_days,pause_enabled,valid_all_stores,eligible_store_ids,terms_url,created_by)
  values(coalesce(e.organization_id,e.id),case when coalesce((requested_plan->>'valid_all_stores')::boolean,false) then null else e.id end,left(btrim(requested_plan->>'name'),100),nullif(left(btrim(coalesce(requested_plan->>'description','')),1200),''),coalesce(requested_plan->>'billing_interval','monthly'),coalesce(requested_plan->>'cancellation_policy','end_of_cycle'),coalesce((requested_plan->>'grace_period_days')::smallint,3),coalesce((requested_plan->>'trial_enabled')::boolean,false),coalesce((requested_plan->>'trial_days')::smallint,0),coalesce((requested_plan->>'pause_enabled')::boolean,false),coalesce((requested_plan->>'valid_all_stores')::boolean,false),coalesce(array(select jsonb_array_elements_text(coalesce(requested_plan->'eligible_store_ids','[]'))::uuid),'{}'),nullif(requested_plan->>'terms_url',''),auth.uid()) returning * into p;
  insert into public.customer_subscription_plan_versions(plan_id,organization_id,version,price_cents,billing_interval) values(p.id,p.organization_id,1,coalesce((requested_plan->>'price_cents')::integer,0),p.billing_interval) returning * into v;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(e.id,auth.uid(),'subscription_plan_created','customer_subscription_plan',p.id,jsonb_build_object('version',1,'price_cents',v.price_cents));
  return jsonb_build_object('plan',to_jsonb(p),'version',to_jsonb(v));
end $$;

create or replace function public.manage_customer_subscription_plan(requested_establishment_id uuid,requested_plan_id uuid,requested_action text,requested_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.customer_subscription_plans%rowtype;v public.customer_subscription_plan_versions%rowtype;next_version integer;price integer;
begin
  if not private.has_subscription_permission(requested_establishment_id,case when requested_action='publish' then 'publish' else 'manage' end) then raise exception 'Sem permissão.';end if;
  select * into p from public.customer_subscription_plans where id=requested_plan_id and organization_id=(select coalesce(organization_id,id) from public.establishments where id=requested_establishment_id) for update;
  if p.id is null then raise exception 'Plano inválido.';end if;
  if requested_action='publish' then update public.customer_subscription_plans set status='active',updated_at=now() where id=p.id;
  elsif requested_action='pause' then update public.customer_subscription_plans set status='paused',updated_at=now() where id=p.id;
  elsif requested_action='archive' then update public.customer_subscription_plans set status='archived',archived_at=now(),updated_at=now() where id=p.id;
  elsif requested_action='resume' then update public.customer_subscription_plans set status='active',updated_at=now() where id=p.id and archived_at is null;
  elsif requested_action='new_version' then
    select coalesce(max(version),0)+1 into next_version from public.customer_subscription_plan_versions where plan_id=p.id;
    price:=coalesce((requested_payload->>'price_cents')::integer,(select price_cents from public.customer_subscription_plan_versions where plan_id=p.id order by version desc limit 1));
    update public.customer_subscription_plan_versions set retired_at=coalesce(retired_at,now()) where plan_id=p.id and retired_at is null;
    insert into public.customer_subscription_plan_versions(plan_id,organization_id,version,price_cents,billing_interval) values(p.id,p.organization_id,next_version,price,coalesce(requested_payload->>'billing_interval',p.billing_interval)) returning * into v;
  else raise exception 'Ação inválida.';end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,auth.uid(),'subscription_plan_'||requested_action,'customer_subscription_plan',p.id,requested_payload);
  return jsonb_build_object('ok',true,'version',to_jsonb(v));
end $$;

create or replace function public.save_customer_subscription_benefit(requested_establishment_id uuid,requested_plan_version_id uuid,requested_benefit jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.customer_subscription_plan_versions%rowtype;b public.customer_subscription_benefits%rowtype;
begin
 if not private.has_subscription_permission(requested_establishment_id,'manage') then raise exception 'Sem permissão.';end if;
 select pv.* into v from public.customer_subscription_plan_versions pv join public.customer_subscription_plans p on p.id=pv.plan_id where pv.id=requested_plan_version_id and p.organization_id=(select coalesce(organization_id,id) from public.establishments where id=requested_establishment_id);
 if v.id is null then raise exception 'Versão inválida.';end if;
 insert into public.customer_subscription_benefits(organization_id,plan_id,plan_version_id,name,description,benefit_type,value_numeric,value_cents,quantity,product_id,category_id,coupon_id,limit_period,limit_quantity,minimum_order_cents,auto_apply,stack_mode,priority,eligible_store_ids)
 values(v.organization_id,v.plan_id,v.id,left(btrim(requested_benefit->>'name'),100),nullif(requested_benefit->>'description',''),requested_benefit->>'benefit_type',nullif(requested_benefit->>'value_numeric','')::numeric,nullif(requested_benefit->>'value_cents','')::integer,coalesce(nullif(requested_benefit->>'quantity','')::integer,1),nullif(requested_benefit->>'product_id','')::uuid,nullif(requested_benefit->>'category_id','')::uuid,nullif(requested_benefit->>'coupon_id','')::uuid,coalesce(requested_benefit->>'limit_period','cycle'),nullif(requested_benefit->>'limit_quantity','')::integer,coalesce(nullif(requested_benefit->>'minimum_order_cents','')::integer,0),coalesce((requested_benefit->>'auto_apply')::boolean,true),coalesce(requested_benefit->>'stack_mode','best'),coalesce(nullif(requested_benefit->>'priority','')::integer,100),coalesce(array(select jsonb_array_elements_text(coalesce(requested_benefit->'eligible_store_ids','[]'))::uuid),'{}')) returning * into b;
 update public.customer_subscription_plan_versions set benefit_snapshot=(select coalesce(jsonb_agg(to_jsonb(x) order by x.priority,x.created_at),'[]') from public.customer_subscription_benefits x where x.plan_version_id=v.id and x.active) where id=v.id;
 insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,auth.uid(),'subscription_benefit_created','customer_subscription_benefit',b.id,jsonb_build_object('type',b.benefit_type));
 return to_jsonb(b);
end $$;

create or replace function public.get_customer_subscription_dashboard(requested_establishment_id uuid,requested_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid;from_at timestamptz:=now()-make_interval(days=>least(greatest(requested_days,1),365));
begin
 if not private.has_subscription_permission(requested_establishment_id,'view') then raise exception 'Sem permissão.';end if;
 select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;
 return jsonb_build_object(
  'active_subscribers',(select count(*) from public.customer_subscriptions where organization_id=org and status in ('active','trialing')),
  'mrr_cents',(select coalesce(sum(case pv.billing_interval when 'weekly' then pv.price_cents*52/12 when 'monthly' then pv.price_cents when 'quarterly' then pv.price_cents/3 when 'yearly' then pv.price_cents/12 end),0)::bigint from public.customer_subscriptions s join public.customer_subscription_plan_versions pv on pv.id=s.plan_version_id where s.organization_id=org and s.status in ('active','trialing')),
  'new_subscriptions',(select count(*) from public.customer_subscriptions where organization_id=org and created_at>=from_at),
  'cancellations',(select count(*) from public.customer_subscriptions where organization_id=org and cancelled_at>=from_at),
  'past_due',(select count(*) from public.customer_subscriptions where organization_id=org and status='past_due'),
  'recurring_revenue_cents',(select coalesce(sum(amount_cents),0) from public.customer_subscription_billing_events where organization_id=org and event_type in ('payment_succeeded','subscription_renewed') and occurred_at>=from_at),
  'benefit_usage_cents',(select coalesce(sum(amount_cents),0) from public.customer_subscription_usage where organization_id=org and used_at>=from_at),
  'churn_percent',(select case when count(*) filter(where created_at<from_at)=0 then 0 else round(100.0*count(*) filter(where cancelled_at>=from_at)/count(*) filter(where created_at<from_at),2) end from public.customer_subscriptions where organization_id=org),
  'voluntary_churn',(select count(*) from public.customer_subscriptions where organization_id=org and cancellation_kind='voluntary' and cancelled_at>=from_at),
  'involuntary_churn',(select count(*) from public.customer_subscriptions where organization_id=org and cancellation_kind='involuntary' and cancelled_at>=from_at)
 );
end $$;

create or replace function public.get_customer_subscription_portal(requested_session_hash text,requested_slug text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;ids uuid[];
begin
 if auth.role()<>'service_role' then raise exception 'Operação interna.';end if;
 select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();
 select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
 if s.id is null or e.id is null then raise exception 'Sessão expirada.';end if;
 select array_agg(id) into ids from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id;
 return jsonb_build_object(
  'available_plans',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'billing_interval',p.billing_interval,'trial_enabled',p.trial_enabled,'trial_days',p.trial_days,'cancellation_policy',p.cancellation_policy,'terms_url',p.terms_url,'version_id',v.id,'price_cents',v.price_cents,'currency',v.currency,'benefits',v.benefit_snapshot) order by p.name),'[]') from public.customer_subscription_plans p join lateral(select * from public.customer_subscription_plan_versions pv where pv.plan_id=p.id and pv.retired_at is null order by pv.version desc limit 1)v on true where p.organization_id=s.organization_id and p.status='active' and (p.valid_all_stores or p.establishment_id=e.id or e.id=any(p.eligible_store_ids))),
  'subscriptions',(select coalesce(jsonb_agg(jsonb_build_object('id',cs.id,'status',cs.status,'plan_id',cs.plan_id,'plan_name',p.name,'price_cents',pv.price_cents,'billing_interval',pv.billing_interval,'started_at',cs.started_at,'current_period_start',cs.current_period_start,'current_period_end',cs.current_period_end,'next_billing_at',cs.next_billing_at,'cancelled_at',cs.cancelled_at,'cancellation_effective_at',cs.cancellation_effective_at,'manual_renewal',cs.manual_renewal,'benefits',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'description',b.description,'type',b.benefit_type,'value_numeric',b.value_numeric,'value_cents',b.value_cents,'quantity',b.quantity,'limit_period',b.limit_period,'limit_quantity',b.limit_quantity,'used',(select coalesce(sum(u.quantity),0) from public.customer_subscription_usage u where u.subscription_id=cs.id and u.benefit_id=b.id and u.used_at<@private.subscription_usage_window(cs,b.limit_period)))),'[]') from public.customer_subscription_benefits b where b.plan_version_id=cs.plan_version_id and b.active),'history',(select coalesce(jsonb_agg(jsonb_build_object('event_type',be.event_type,'amount_cents',be.amount_cents,'status',be.status,'occurred_at',be.occurred_at) order by be.occurred_at desc),'[]') from public.customer_subscription_billing_events be where be.subscription_id=cs.id)) order by cs.created_at desc),'[]') from public.customer_subscriptions cs join public.customer_subscription_plans p on p.id=cs.plan_id join public.customer_subscription_plan_versions pv on pv.id=cs.plan_version_id where cs.organization_id=s.organization_id and cs.customer_id=any(ids))
 );
end $$;

create or replace function public.begin_customer_subscription_checkout(requested_session_hash text,requested_slug text,requested_plan_version_id uuid,requested_provider text,requested_consent_text text,requested_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;p public.customer_subscription_plans%rowtype;v public.customer_subscription_plan_versions%rowtype;a public.payment_gateway_accounts%rowtype;cs public.customer_subscriptions%rowtype;manual boolean;
begin
 if auth.role()<>'service_role' then raise exception 'Operação interna.';end if;
 if char_length(btrim(requested_consent_text))<20 then raise exception 'Confirme explicitamente a cobrança e os termos.';end if;
 select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();
 select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
 select pv.* into v from public.customer_subscription_plan_versions pv join public.customer_subscription_plans p0 on p0.id=pv.plan_id where pv.id=requested_plan_version_id and pv.retired_at is null and p0.status='active' and p0.organization_id=s.organization_id;
 select * into p from public.customer_subscription_plans where id=v.plan_id;
 if s.id is null or e.id is null or p.id is null or not(p.valid_all_stores or p.establishment_id=e.id or e.id=any(p.eligible_store_ids)) then raise exception 'Plano indisponível.';end if;
 if exists(select 1 from public.customer_subscriptions x where x.organization_id=s.organization_id and x.customer_id=s.customer_id and x.plan_id=p.id and x.status in('pending','trialing','active','past_due','paused')) and not p.allow_multiple then raise exception 'Você já possui este plano.';end if;
 if p.trial_enabled and exists(select 1 from public.customer_subscriptions x where x.organization_id=s.organization_id and x.organization_customer_id is not distinct from s.organization_customer_id and x.plan_id=p.id and x.started_at is not null) then raise exception 'O período de teste deste plano já foi utilizado.';end if;
 select * into a from public.payment_gateway_accounts where establishment_id=e.id and provider=requested_provider and active and secret_id is not null;
 if a.id is null then raise exception 'Forma de pagamento indisponível.';end if;
 manual:=requested_provider='pagarme';
 insert into public.customer_subscriptions(organization_id,establishment_id,customer_id,organization_customer_id,plan_id,plan_version_id,status,payment_provider,payment_gateway_account_id,consent_text,consented_at,consent_ip_hash,manual_renewal)
 values(s.organization_id,e.id,s.customer_id,s.organization_customer_id,p.id,v.id,'pending',requested_provider,a.id,left(requested_consent_text,1000),now(),requested_ip_hash,manual) returning * into cs;
 insert into public.customer_subscription_billing_events(organization_id,subscription_id,provider,event_type,status,metadata) values(s.organization_id,cs.id,requested_provider,'subscription_created','pending',jsonb_build_object('manual_renewal',manual));
 return jsonb_build_object('subscription_id',cs.id,'account_id',a.id,'provider',a.provider,'environment',a.environment,'plan_name',p.name,'price_cents',v.price_cents,'billing_interval',v.billing_interval,'customer_id',s.customer_id,'manual_renewal',manual);
end $$;

create or replace function public.record_customer_subscription_checkout(requested_subscription_id uuid,requested_external_id text,requested_checkout_url text,requested_manual_renewal boolean)
returns void language plpgsql security definer set search_path='' as $$
begin if auth.role()<>'service_role' then raise exception 'Operação interna.';end if;update public.customer_subscriptions set payment_provider_subscription_id=requested_external_id,checkout_url=requested_checkout_url,manual_renewal=requested_manual_renewal,updated_at=now() where id=requested_subscription_id and status='pending';end $$;

create or replace function public.process_customer_subscription_event(requested_gateway_account_id uuid,requested_external_event_id text,requested_external_subscription_id text,requested_event_type text,requested_status text,requested_amount_cents integer,requested_period_start timestamptz,requested_period_end timestamptz,requested_payload_hash text,requested_signature_valid boolean,requested_metadata jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.payment_gateway_accounts%rowtype;cs public.customer_subscriptions%rowtype;event_id uuid;new_status text;event_name text;period_start timestamptz;period_end timestamptz;
begin
 if auth.role()<>'service_role' then raise exception 'Operação interna.';end if;
 select * into a from public.payment_gateway_accounts where id=requested_gateway_account_id;
 if a.id is null or not requested_signature_valid then raise exception 'Webhook não autorizado.';end if;
 insert into public.customer_subscription_webhook_events(gateway_account_id,provider,external_event_id,event_type,signature_valid,payload_hash) values(a.id,a.provider,requested_external_event_id,requested_event_type,true,requested_payload_hash) on conflict do nothing returning id into event_id;
 if event_id is null then return jsonb_build_object('ok',true,'duplicate',true);end if;
 select * into cs from public.customer_subscriptions where payment_gateway_account_id=a.id and (payment_provider_subscription_id=requested_external_subscription_id or id::text=requested_external_subscription_id) for update;
 if cs.id is null then update public.customer_subscription_webhook_events set error_message='Assinatura não encontrada' where id=event_id;raise exception 'Assinatura não encontrada.';end if;
 event_name:=case when requested_event_type in('subscription_created','subscription_activated','payment_succeeded','payment_failed','subscription_paused','subscription_cancelled','subscription_renewed') then requested_event_type else 'subscription_created' end;
 new_status:=case when requested_status in('authorized','active','approved','paid') then 'active' when requested_status in('failed','rejected','past_due') then 'past_due' when requested_status='paused' then 'paused' when requested_status in('cancelled','canceled') then 'cancelled' when requested_status='expired' then 'expired' else cs.status end;
 period_start:=coalesce(requested_period_start,case when new_status='active' then now() else cs.current_period_start end);
 period_end:=coalesce(requested_period_end,case when new_status='active' then private.subscription_period_end(period_start,(select billing_interval from public.customer_subscription_plan_versions where id=cs.plan_version_id)) else cs.current_period_end end);
 update public.customer_subscriptions set status=new_status,started_at=case when new_status='active' then coalesce(started_at,now()) else started_at end,current_period_start=period_start,current_period_end=period_end,next_billing_at=case when new_status='active' then period_end else next_billing_at end,grace_period_ends_at=case when new_status='past_due' then now()+make_interval(days=>(select grace_period_days from public.customer_subscription_plans where id=cs.plan_id)) else null end,cancelled_at=case when new_status='cancelled' then coalesce(cancelled_at,now()) else cancelled_at end,cancellation_kind=case when new_status='cancelled' and event_name='payment_failed' then 'involuntary' else cancellation_kind end,updated_at=now() where id=cs.id;
 insert into public.customer_subscription_billing_events(organization_id,subscription_id,provider,external_event_id,event_type,amount_cents,status,period_start,period_end,metadata) values(cs.organization_id,cs.id,a.provider,requested_external_event_id,event_name,greatest(coalesce(requested_amount_cents,0),0),requested_status,period_start,period_end,requested_metadata) on conflict(provider,external_event_id) do nothing;
 insert into public.customer_notifications(organization_id,establishment_id,customer_id,notification_type,title,body) values(cs.organization_id,coalesce(cs.establishment_id,a.establishment_id),cs.customer_id,'subscription_'||new_status,case new_status when 'active' then 'Assinatura ativa' when 'past_due' then 'Pagamento da assinatura pendente' when 'cancelled' then 'Assinatura cancelada' else 'Assinatura atualizada' end,case new_status when 'past_due' then 'Atualize o pagamento pelo portal. Seus benefícios respeitam o período de tolerância.' else 'Consulte os detalhes e benefícios em Minha Conta.' end);
 update public.customer_subscription_webhook_events set processed_at=now() where id=event_id;
 return jsonb_build_object('ok',true,'duplicate',false,'subscription_id',cs.id,'status',new_status);
exception when others then update public.customer_subscription_webhook_events set error_message=sqlerrm where id=event_id;raise;end $$;

create or replace function public.customer_subscription_portal_action(requested_session_hash text,requested_slug text,requested_subscription_id uuid,requested_action text,requested_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;e public.establishments%rowtype;cs public.customer_subscriptions%rowtype;p public.customer_subscription_plans%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'Operação interna.';end if;
 select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
 select * into cs from public.customer_subscriptions where id=requested_subscription_id and organization_id=s.organization_id and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id) for update;select * into p from public.customer_subscription_plans where id=cs.plan_id;
 if s.id is null or e.id is null or cs.id is null then raise exception 'Assinatura não autorizada.';end if;
 if requested_action='preview_cancel' then return jsonb_build_object('requires_confirmation',true,'policy',p.cancellation_policy,'effective_at',case when p.cancellation_policy='immediate' then now() else cs.current_period_end end,'message',case when p.cancellation_policy='immediate' then 'Os benefícios serão encerrados imediatamente.' else 'Os benefícios continuam até o fim do ciclo atual.' end);
 elsif requested_action='cancel' then if not requested_confirm then raise exception 'Confirmação obrigatória.';end if;update public.customer_subscriptions set cancelled_at=now(),cancellation_effective_at=case when p.cancellation_policy='immediate' then now() else current_period_end end,status=case when p.cancellation_policy='immediate' then 'cancelled' else status end,cancellation_kind='voluntary',updated_at=now() where id=cs.id;insert into public.customer_subscription_billing_events(organization_id,subscription_id,provider,event_type,status,metadata) values(cs.organization_id,cs.id,coalesce(cs.payment_provider,'manual'),'subscription_cancelled','requested',jsonb_build_object('effective_at',case when p.cancellation_policy='immediate' then now() else cs.current_period_end end));
 elsif requested_action='reactivate' then if cs.cancellation_effective_at is null or cs.cancellation_effective_at<=now() then raise exception 'Esta assinatura exige uma nova contratação.';end if;update public.customer_subscriptions set cancelled_at=null,cancellation_effective_at=null,cancellation_kind=null,updated_at=now() where id=cs.id;
 elsif requested_action='pause' and p.pause_enabled then update public.customer_subscriptions set status='paused',updated_at=now() where id=cs.id and status='active';
 else raise exception 'Ação indisponível.';end if;
 insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(e.id,'customer_subscription_'||requested_action,'customer_subscription',cs.id,jsonb_build_object('customer_id',s.customer_id));
 return jsonb_build_object('ok',true,'message','Solicitação registrada com segurança.');
end $$;

create or replace function public.get_customer_subscription_tools(requested_establishment_id uuid,requested_phone text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare normalized text:=regexp_replace(requested_phone,'\D','','g');c public.customers%rowtype;org uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Operação interna.';end if;select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;select * into c from public.customers where organization_customer_id in(select id from public.organization_customers where organization_id=org and normalized_phone in(normalized,'55'||normalized)) or (establishment_id=requested_establishment_id and regexp_replace(phone,'\D','','g') in(normalized,'55'||normalized)) order by last_order_at desc nulls last limit 1;
 return jsonb_build_object('customer_id',c.id,'subscriptions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'plan',p.name,'status',s.status,'next_billing_at',s.next_billing_at,'current_period_end',s.current_period_end,'benefits',pv.benefit_snapshot)),'[]') from public.customer_subscriptions s join public.customer_subscription_plans p on p.id=s.plan_id join public.customer_subscription_plan_versions pv on pv.id=s.plan_version_id where s.organization_id=org and (s.customer_id=c.id or s.organization_customer_id=c.organization_customer_id)));
end $$;

create or replace function private.apply_customer_subscription_benefit()
returns trigger language plpgsql set search_path='' as $$
declare org uuid;cs public.customer_subscriptions%rowtype;b public.customer_subscription_benefits%rowtype;computed integer:=0;used_count integer:=0;usage_window tstzrange;
begin
 if new.customer_id is null then return new;end if;select coalesce(organization_id,id) into org from public.establishments where id=new.establishment_id;
 select s.* into cs from public.customer_subscriptions s join public.customer_subscription_plans p on p.id=s.plan_id where s.organization_id=org and (s.customer_id=new.customer_id or s.organization_customer_id=(select organization_customer_id from public.customers where id=new.customer_id)) and (s.status in('active','trialing') or (s.status='past_due' and s.grace_period_ends_at>now())) and (s.current_period_end is null or s.current_period_end>now()) and (p.valid_all_stores or p.establishment_id=new.establishment_id or new.establishment_id=any(p.eligible_store_ids)) order by case s.status when 'active' then 1 when 'trialing' then 2 else 3 end,s.created_at limit 1;
 if cs.id is null then return new;end if;
 for b in select * from public.customer_subscription_benefits x where x.plan_version_id=cs.plan_version_id and x.active and x.auto_apply and x.benefit_type in('percentage_discount','fixed_discount','free_delivery') and new.subtotal_cents>=x.minimum_order_cents and (cardinality(x.eligible_store_ids)=0 or new.establishment_id=any(x.eligible_store_ids)) order by x.priority,x.created_at loop
  usage_window:=private.subscription_usage_window(cs,b.limit_period);select coalesce(sum(quantity),0) into used_count from public.customer_subscription_usage where subscription_id=cs.id and benefit_id=b.id and used_at<@usage_window;
  if b.limit_quantity is not null and used_count>=b.limit_quantity then continue;end if;
  computed:=case b.benefit_type when 'percentage_discount' then least(new.subtotal_cents,round(new.subtotal_cents*coalesce(b.value_numeric,0)/100.0)::integer) when 'fixed_discount' then least(new.subtotal_cents,coalesce(b.value_cents,0)) when 'free_delivery' then new.delivery_fee_cents else 0 end;
  if computed<=0 then continue;end if;
  if b.benefit_type='free_delivery' then new.delivery_fee_cents:=0;new.total_cents:=greatest(0,new.total_cents-computed);else
    if b.stack_mode='accumulate' or b.stack_mode='subscription_first' then new.discount_cents:=new.discount_cents+computed;new.total_cents:=greatest(0,new.total_cents-computed);
    elsif new.discount_cents=0 or computed>new.discount_cents then new.total_cents:=greatest(0,new.total_cents-greatest(computed-new.discount_cents,0));new.discount_cents:=greatest(new.discount_cents,computed);else continue;end if;
  end if;
  new.customer_subscription_id:=cs.id;new.applied_subscription_benefit_id:=b.id;new.subscription_discount_cents:=computed;exit;
 end loop;return new;
end $$;

create or replace function private.record_customer_subscription_usage()
returns trigger language plpgsql set search_path='' as $$
declare cs public.customer_subscriptions%rowtype;b public.customer_subscription_benefits%rowtype;usage_window tstzrange;
begin if new.customer_subscription_id is null or new.applied_subscription_benefit_id is null or new.subscription_discount_cents<=0 then return new;end if;select * into cs from public.customer_subscriptions where id=new.customer_subscription_id;select * into b from public.customer_subscription_benefits where id=new.applied_subscription_benefit_id;usage_window:=private.subscription_usage_window(cs,b.limit_period);insert into public.customer_subscription_usage(organization_id,subscription_id,benefit_id,order_id,quantity,amount_cents,usage_period_start,usage_period_end,idempotency_key) values(cs.organization_id,cs.id,b.id,new.id,1,new.subscription_discount_cents,lower(usage_window),upper(usage_window),'order-'||new.id||'-benefit-'||b.id) on conflict do nothing;insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(new.establishment_id,'subscription_benefit_applied','order',new.id,jsonb_build_object('subscription_id',cs.id,'benefit_id',b.id,'amount_cents',new.subscription_discount_cents));return new;end $$;

drop trigger if exists apply_customer_subscription_benefit on public.orders;
create trigger apply_customer_subscription_benefit before insert on public.orders for each row execute function private.apply_customer_subscription_benefit();
drop trigger if exists record_customer_subscription_usage on public.orders;
create trigger record_customer_subscription_usage after insert on public.orders for each row execute function private.record_customer_subscription_usage();

do $$declare t text;begin foreach t in array array['customer_subscription_plans','customer_subscription_plan_versions','customer_subscription_benefits','customer_subscriptions','customer_subscription_usage','customer_subscription_billing_events','customer_subscription_webhook_events','subscription_member_permissions'] loop execute format('alter table public.%I enable row level security',t);end loop;end $$;

create policy customer_subscription_plans_read on public.customer_subscription_plans for select to authenticated using(establishment_id is null and private.has_organization_role(organization_id,array['owner','admin','supervisor','analyst']) or establishment_id is not null and private.has_subscription_permission(establishment_id,'view'));
create policy customer_subscription_plans_write on public.customer_subscription_plans for all to authenticated using(establishment_id is not null and private.has_subscription_permission(establishment_id,'manage')) with check(establishment_id is not null and private.has_subscription_permission(establishment_id,'manage'));
create policy customer_subscription_versions_read on public.customer_subscription_plan_versions for select to authenticated using(exists(select 1 from public.customer_subscription_plans p where p.id=plan_id and (p.establishment_id is null and private.has_organization_role(p.organization_id,array['owner','admin','supervisor','analyst']) or p.establishment_id is not null and private.has_subscription_permission(p.establishment_id,'view'))));
create policy customer_subscription_benefits_read on public.customer_subscription_benefits for select to authenticated using(exists(select 1 from public.customer_subscription_plans p where p.id=plan_id and (p.establishment_id is null and private.has_organization_role(p.organization_id,array['owner','admin','supervisor','analyst']) or p.establishment_id is not null and private.has_subscription_permission(p.establishment_id,'view'))));
create policy customer_subscriptions_read on public.customer_subscriptions for select to authenticated using((establishment_id is not null and private.has_subscription_permission(establishment_id,'view')) or private.has_organization_role(organization_id,array['owner','admin','supervisor','analyst']));
create policy customer_subscription_usage_read on public.customer_subscription_usage for select to authenticated using(private.has_organization_role(organization_id,array['owner','admin','supervisor','analyst']));
create policy customer_subscription_billing_read on public.customer_subscription_billing_events for select to authenticated using(private.has_organization_role(organization_id,array['owner','admin','supervisor','analyst']));
create policy subscription_permissions_admin on public.subscription_member_permissions for all to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy subscription_webhooks_deny on public.customer_subscription_webhook_events for all to authenticated using(false) with check(false);

revoke all on public.customer_subscription_plans,public.customer_subscription_plan_versions,public.customer_subscription_benefits,public.customer_subscriptions,public.customer_subscription_usage,public.customer_subscription_billing_events,public.customer_subscription_webhook_events,public.subscription_member_permissions from public,anon;
grant select on public.customer_subscription_plans,public.customer_subscription_plan_versions,public.customer_subscription_benefits,public.customer_subscriptions,public.customer_subscription_usage,public.customer_subscription_billing_events,public.subscription_member_permissions to authenticated;
grant all on public.customer_subscription_plans,public.customer_subscription_plan_versions,public.customer_subscription_benefits,public.customer_subscriptions,public.customer_subscription_usage,public.customer_subscription_billing_events,public.customer_subscription_webhook_events,public.subscription_member_permissions to service_role;
grant insert,update,delete on public.subscription_member_permissions to authenticated;

revoke all on function public.create_customer_subscription_plan(uuid,jsonb),public.manage_customer_subscription_plan(uuid,uuid,text,jsonb),public.save_customer_subscription_benefit(uuid,uuid,jsonb),public.get_customer_subscription_dashboard(uuid,integer) from public,anon;
grant execute on function public.create_customer_subscription_plan(uuid,jsonb),public.manage_customer_subscription_plan(uuid,uuid,text,jsonb),public.save_customer_subscription_benefit(uuid,uuid,jsonb),public.get_customer_subscription_dashboard(uuid,integer) to authenticated,service_role;
revoke all on function public.get_customer_subscription_portal(text,text),public.begin_customer_subscription_checkout(text,text,uuid,text,text,text),public.record_customer_subscription_checkout(uuid,text,text,boolean),public.process_customer_subscription_event(uuid,text,text,text,text,integer,timestamptz,timestamptz,text,boolean,jsonb),public.customer_subscription_portal_action(text,text,uuid,text,boolean),public.get_customer_subscription_tools(uuid,text) from public,anon,authenticated;
grant execute on function public.get_customer_subscription_portal(text,text),public.begin_customer_subscription_checkout(text,text,uuid,text,text,text),public.record_customer_subscription_checkout(uuid,text,text,boolean),public.process_customer_subscription_event(uuid,text,text,text,text,integer,timestamptz,timestamptz,text,boolean,jsonb),public.customer_subscription_portal_action(text,text,uuid,text,boolean),public.get_customer_subscription_tools(uuid,text) to service_role;

insert into public.crm_segments(establishment_id,name,description,filters)
select e.id,x.name,x.description,x.filters from public.establishments e cross join lateral(values
 ('Assinantes ativos','Clientes com assinatura ativa',jsonb_build_object('subscription_status','active')),
 ('Assinaturas em atraso','Clientes em past_due',jsonb_build_object('subscription_status','past_due')),
 ('Assinaturas canceladas','Clientes que cancelaram',jsonb_build_object('subscription_status','cancelled'))
)x(name,description,filters) where not exists(select 1 from public.crm_segments s where s.establishment_id=e.id and s.name=x.name);
