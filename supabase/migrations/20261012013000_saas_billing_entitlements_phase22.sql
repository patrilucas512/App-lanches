-- Phase 22: billing, subscriptions, entitlements and metered usage for MasterApp itself.
-- This domain is organization-scoped and intentionally separate from customer_subscription_*.

alter table public.subscriptions alter column status drop default;
alter table public.subscriptions alter column status type text using status::text;
alter table public.subscriptions alter column status set default 'trialing';
do $$begin if not exists(select 1 from pg_constraint where conname='subscriptions_status_phase22_check') then
 alter table public.subscriptions add constraint subscriptions_status_phase22_check check(status in('trialing','active','past_due','suspended','cancelled','canceled','expired','unpaid','incomplete'));
end if;end$$;

alter table public.subscriptions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists price_id uuid,
  add column if not exists provider text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_subscription_id text,
  add column if not exists grace_ends_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists consent_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.subscriptions s set organization_id=e.organization_id
from public.establishments e where e.id=s.establishment_id and s.organization_id is null;
create unique index if not exists subscriptions_one_per_organization on public.subscriptions(organization_id) where organization_id is not null;
create index if not exists subscriptions_status_period_idx on public.subscriptions(status,current_period_end);

create table if not exists public.saas_prices(
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.plans(id) on delete restrict,
 version integer not null, billing_cycle text not null check(billing_cycle in('monthly','annual')),
 currency text not null default 'BRL', amount_cents integer not null check(amount_cents>=0),
 provider text, provider_price_id text, active boolean not null default true,
 effective_from timestamptz not null default now(), effective_until timestamptz,
 created_at timestamptz not null default now(), unique(plan_id,version,billing_cycle)
);
insert into public.saas_prices(plan_id,version,billing_cycle,amount_cents)
select id,1,'monthly',monthly_price_cents from public.plans on conflict do nothing;
insert into public.saas_prices(plan_id,version,billing_cycle,amount_cents)
select id,1,'annual',annual_price_cents from public.plans on conflict do nothing;
alter table public.subscriptions add constraint subscriptions_price_fk foreign key(price_id) references public.saas_prices(id) on delete restrict;

create table if not exists public.saas_features(
 key text primary key check(key~'^[a-z0-9_.-]+$'), name text not null, description text not null default '',
 value_type text not null default 'boolean' check(value_type in('boolean','integer','decimal','text')),
 unit text, hard_limit boolean not null default false, fallback_behavior text not null default 'upgrade_prompt',
 public boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.saas_plan_features(
 plan_id uuid not null references public.plans(id) on delete cascade, feature_key text not null references public.saas_features(key) on delete cascade,
 enabled boolean not null default true, limit_value numeric, config jsonb not null default '{}'::jsonb,
 primary key(plan_id,feature_key)
);

insert into public.saas_features(key,name,value_type,unit,hard_limit,fallback_behavior) values
 ('stores','Estabelecimentos','integer','unidades',true,'block_create'),('products','Produtos','integer','produtos',true,'block_create'),
 ('team_members','Funcionários','integer','usuários',true,'block_create'),('cashier','Sistema PDV','boolean',null,true,'upgrade_prompt'),
 ('inventory','Estoque','boolean',null,true,'upgrade_prompt'),('delivery','Sistema de entrega','boolean',null,true,'upgrade_prompt'),
 ('waiter_mode','Modo garçom','boolean',null,true,'upgrade_prompt'),('kitchen','Cozinha','boolean',null,true,'upgrade_prompt'),
 ('orders_month','Pedidos mensais','integer','pedidos',true,'read_only'),('ai_tokens','Tokens de IA','integer','tokens',false,'human_handoff'),
 ('voice_minutes','Minutos de voz','integer','minutos',false,'human_handoff'),('whatsapp_messages','Mensagens WhatsApp','integer','mensagens',false,'human_handoff'),
 ('api_requests','Requisições de API','integer','requisições',true,'rate_limit'),('storage_bytes','Armazenamento','integer','bytes',true,'block_upload'),
 ('campaign_contacts','Contatos em campanhas','integer','contatos',true,'block_send'),('marketplace_paid_apps','Apps pagos','boolean',null,true,'upgrade_prompt')
on conflict(key) do update set name=excluded.name,value_type=excluded.value_type,unit=excluded.unit,hard_limit=excluded.hard_limit,fallback_behavior=excluded.fallback_behavior;

insert into public.saas_plan_features(plan_id,feature_key,enabled,limit_value)
select p.id,x.key,x.enabled,x.limit_value from public.plans p cross join lateral(values
 ('stores',true,p.max_establishments::numeric),('products',true,p.max_products::numeric),('team_members',p.staff_management_enabled,p.max_team_members::numeric),
 ('cashier',p.cashier_enabled,p.max_cashiers::numeric),('inventory',p.inventory_enabled,p.max_inventory_items::numeric),
 ('delivery',p.drivers_enabled,p.max_drivers::numeric),('waiter_mode',p.waiter_mode_enabled,p.max_waiters::numeric),
 ('kitchen',p.kitchen_enabled,null::numeric),('orders_month',true,p.max_monthly_orders::numeric),('voice_minutes',p.voice_ai_enabled,p.included_voice_minutes::numeric),
 ('api_requests',p.public_api_enabled,null::numeric),('marketplace_paid_apps',p.paid_apps_enabled,p.max_app_installations::numeric)
)x(key,enabled,limit_value) on conflict(plan_id,feature_key) do update set enabled=excluded.enabled,limit_value=excluded.limit_value;

create table if not exists public.saas_addons(
 id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, description text not null default '',
 feature_key text references public.saas_features(key), quantity_increment numeric not null default 1,
 monthly_price_cents integer not null default 0 check(monthly_price_cents>=0), annual_price_cents integer not null default 0 check(annual_price_cents>=0),
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.organization_addons(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 addon_id uuid not null references public.saas_addons(id) on delete restrict, quantity numeric not null default 1 check(quantity>0),
 status text not null default 'active' check(status in('pending','active','cancel_at_period_end','cancelled')),
 current_period_start timestamptz, current_period_end timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,addon_id)
);

create table if not exists public.usage_meters(
 key text primary key, name text not null, feature_key text references public.saas_features(key), aggregation text not null check(aggregation in('sum','max','last')),
 unit text not null, billable boolean not null default false, overage_unit_price_micros bigint not null default 0,
 active boolean not null default true, created_at timestamptz not null default now()
);
insert into public.usage_meters(key,name,feature_key,aggregation,unit,billable) values
 ('orders','Pedidos','orders_month','sum','pedidos',false),('ai_tokens','Tokens de IA','ai_tokens','sum','tokens',true),
 ('voice_minutes','Minutos de voz','voice_minutes','sum','minutos',true),('whatsapp_messages','Mensagens WhatsApp','whatsapp_messages','sum','mensagens',true),
 ('api_requests','Requisições de API','api_requests','sum','requisições',false),('storage_bytes','Armazenamento','storage_bytes','max','bytes',true),
 ('campaign_contacts','Contatos de campanha','campaign_contacts','sum','contatos',true)
on conflict(key) do update set feature_key=excluded.feature_key,aggregation=excluded.aggregation,unit=excluded.unit;
insert into public.usage_meters(key,name,aggregation,unit,billable) values('legacy_event','Eventos operacionais legados','sum','eventos',false) on conflict(key) do nothing;
alter table public.usage_events
 add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
 add column if not exists meter_key text references public.usage_meters(key),
 add column if not exists idempotency_key text,
 add column if not exists quantity numeric not null default 1 check(quantity>=0),
 add column if not exists provider_cost_micros bigint not null default 0,
 add column if not exists billable_amount_micros bigint not null default 0,
 add column if not exists source text not null default 'masterapp',
 add column if not exists occurred_at timestamptz not null default now();
update public.usage_events u set organization_id=e.organization_id,meter_key=coalesce(u.meter_key,'legacy_event'),idempotency_key=coalesce(u.idempotency_key,'legacy:'||u.id),occurred_at=coalesce(u.occurred_at,u.created_at) from public.establishments e where e.id=u.establishment_id and (u.organization_id is null or u.meter_key is null or u.idempotency_key is null);
create unique index if not exists usage_events_org_idempotency_key on public.usage_events(organization_id,idempotency_key);
create index if not exists usage_events_period_idx on public.usage_events(organization_id,meter_key,occurred_at desc);
create table if not exists public.usage_aggregates(
 organization_id uuid not null references public.organizations(id) on delete cascade, meter_key text not null references public.usage_meters(key),
 period_start date not null, period_end date not null, quantity numeric not null default 0, provider_cost_micros bigint not null default 0,
 billable_amount_micros bigint not null default 0, last_event_at timestamptz, updated_at timestamptz not null default now(),
 primary key(organization_id,meter_key,period_start)
);

create table if not exists public.saas_invoices(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 subscription_id uuid references public.subscriptions(id) on delete set null, number bigint generated always as identity unique,
 status text not null default 'draft' check(status in('draft','open','paid','void','uncollectible','refunded')),
 currency text not null default 'BRL', subtotal_cents bigint not null default 0, discount_cents bigint not null default 0,
 credit_cents bigint not null default 0, total_cents bigint not null default 0, amount_paid_cents bigint not null default 0,
 period_start timestamptz, period_end timestamptz, due_at timestamptz, paid_at timestamptz, hosted_url text, pdf_url text,
 provider text, provider_invoice_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists saas_invoice_provider_ref on public.saas_invoices(provider,provider_invoice_id);
create table if not exists public.saas_invoice_items(
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.saas_invoices(id) on delete cascade,
 item_type text not null check(item_type in('plan','addon','usage','discount','credit','adjustment','tax')),
 description text not null, quantity numeric not null default 1, unit_amount_cents bigint not null, amount_cents bigint not null,
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.saas_payments(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 invoice_id uuid references public.saas_invoices(id) on delete set null, provider text not null, provider_payment_id text not null,
 status text not null check(status in('pending','authorized','paid','failed','refunded','chargeback')),
 amount_cents bigint not null check(amount_cents>=0), failure_code text, failure_message text, paid_at timestamptz,
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(provider,provider_payment_id)
);
create table if not exists public.saas_gateway_events(
 id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null, event_type text not null,
 payload_hash text not null, status text not null default 'received' check(status in('received','processed','ignored','failed')),
 attempts integer not null default 0, error_message text, received_at timestamptz not null default now(), processed_at timestamptz,
 unique(provider,provider_event_id)
);

create table if not exists public.billing_contacts(
 organization_id uuid primary key references public.organizations(id) on delete cascade, owner_user_id uuid references public.profiles(id) on delete set null,
 name text, email text, phone text, tax_document text, address jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.billing_member_permissions(
 organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,
 can_view boolean not null default true,can_manage boolean not null default false,can_update_payment_method boolean not null default false,
 can_change_plan boolean not null default false,can_view_usage boolean not null default true,updated_at timestamptz not null default now(),
 primary key(organization_id,user_id)
);
create table if not exists public.billing_credits(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 amount_cents bigint not null check(amount_cents<>0),remaining_cents bigint not null,reason text not null,expires_at timestamptz,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now()
);
create table if not exists public.billing_adjustments(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 invoice_id uuid references public.saas_invoices(id),amount_cents bigint not null check(amount_cents<>0),reason text not null,
 approved_by uuid references public.profiles(id),created_at timestamptz not null default now()
);
create table if not exists public.saas_plan_changes(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 subscription_id uuid not null references public.subscriptions(id) on delete cascade,from_plan_id uuid references public.plans(id),to_plan_id uuid not null references public.plans(id),
 change_type text not null check(change_type in('upgrade','downgrade','cancel','reactivate')),
 effective_at timestamptz not null,proration_cents bigint not null default 0,conflicts jsonb not null default '[]'::jsonb,
 consent_snapshot jsonb not null default '{}'::jsonb,status text not null default 'scheduled' check(status in('preview','scheduled','applied','cancelled','failed')),
 requested_by uuid references public.profiles(id),created_at timestamptz not null default now()
);
create table if not exists public.saas_dunning_events(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 subscription_id uuid not null references public.subscriptions(id) on delete cascade,event_type text not null,
 attempt integer not null default 1,next_attempt_at timestamptz,message text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create table if not exists public.saas_billing_notifications(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 event_type text not null,channel text not null check(channel in('in_app','email','whatsapp','webhook')),recipient text,status text not null default 'pending',
 payload jsonb not null default '{}'::jsonb,sent_at timestamptz,created_at timestamptz not null default now()
);
create table if not exists public.marketplace_billing_records(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 installation_id uuid references public.app_installations(id) on delete set null,app_id uuid not null references public.partner_apps(id) on delete restrict,
 gross_cents bigint not null default 0,platform_fee_cents bigint not null default 0,partner_amount_cents bigint not null default 0,
 status text not null default 'pending',period_start date,period_end date,created_at timestamptz not null default now()
);

alter table public.platform_coupons add column if not exists starts_at timestamptz,add column if not exists first_payment_only boolean not null default false,
 add column if not exists minimum_amount_cents integer,add column if not exists max_discount_cents integer,add column if not exists metadata jsonb not null default '{}'::jsonb;
create or replace view public.saas_coupons with(security_invoker=true) as select * from public.platform_coupons;

create or replace function private.billing_member(target_org uuid,permission_key text default 'view') returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_superadmin() or exists(select 1 from public.organization_members m left join public.billing_member_permissions p on p.organization_id=m.organization_id and p.user_id=m.user_id where m.organization_id=target_org and m.user_id=(select auth.uid()) and m.active and (m.role in('owner','admin') or case permission_key when 'manage' then p.can_manage when 'update_payment_method' then p.can_update_payment_method when 'change_plan' then p.can_change_plan when 'view_usage' then coalesce(p.can_view_usage,p.can_view) else coalesce(p.can_view,true) end));
$$;

create or replace function public.saas_effective_entitlement(requested_organization_id uuid,requested_feature text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r record;extra numeric:=0;begin
 if not private.billing_member(requested_organization_id,'view') and current_user not in('service_role','postgres') then raise exception 'Acesso negado.';end if;
 select f.key,f.name,f.hard_limit,f.fallback_behavior,pf.enabled,pf.limit_value,s.status,p.name plan_name into r
 from public.subscriptions s join public.plans p on p.id=s.plan_id join public.saas_features f on f.key=requested_feature
 left join public.saas_plan_features pf on pf.plan_id=p.id and pf.feature_key=f.key
 where s.organization_id=requested_organization_id order by s.created_at desc limit 1;
 select coalesce(sum(oa.quantity*a.quantity_increment),0) into extra from public.organization_addons oa join public.saas_addons a on a.id=oa.addon_id where oa.organization_id=requested_organization_id and oa.status='active' and a.feature_key=requested_feature;
 if r.key is null then return jsonb_build_object('feature',requested_feature,'enabled',false,'limit',0,'reason','no_subscription');end if;
 return jsonb_build_object('feature',r.key,'name',r.name,'enabled',coalesce(r.enabled,false) and r.status::text in('trialing','active','past_due'),'limit',case when r.limit_value is null then null else r.limit_value+extra end,'base_limit',r.limit_value,'addon_limit',extra,'hard_limit',r.hard_limit,'fallback',r.fallback_behavior,'subscription_status',r.status,'plan',r.plan_name);
end$$;

create or replace function public.record_saas_usage(requested_organization_id uuid,requested_establishment_id uuid,requested_meter text,requested_quantity numeric,requested_idempotency_key text,requested_provider_cost_micros bigint default 0,requested_metadata jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.usage_meters%rowtype;e public.usage_events%rowtype;period date:=date_trunc('month',now())::date;ent jsonb;used numeric;lim numeric;begin
 if current_user not in('service_role','postgres') and not private.billing_member(requested_organization_id,'manage') then raise exception 'Sem permissão billing:manage.';end if;
 select * into m from public.usage_meters where key=requested_meter and active;if m.key is null then raise exception 'Medidor inválido.';end if;
 insert into public.usage_events(organization_id,establishment_id,meter_key,idempotency_key,quantity,provider_cost_micros,billable_amount_micros,metadata)
 values(requested_organization_id,requested_establishment_id,requested_meter,requested_idempotency_key,requested_quantity,greatest(requested_provider_cost_micros,0),case when m.billable then requested_quantity*m.overage_unit_price_micros else 0 end,requested_metadata)
 on conflict(organization_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into e;
 insert into public.usage_aggregates(organization_id,meter_key,period_start,period_end,quantity,provider_cost_micros,billable_amount_micros,last_event_at)
 select requested_organization_id,requested_meter,period,(period+interval '1 month')::date,
 case m.aggregation when 'max' then max(quantity) when 'last' then (array_agg(quantity order by occurred_at desc))[1] else sum(quantity) end,
 sum(provider_cost_micros),sum(billable_amount_micros),max(occurred_at) from public.usage_events where organization_id=requested_organization_id and meter_key=requested_meter and occurred_at>=period and occurred_at<period+interval '1 month'
 on conflict(organization_id,meter_key,period_start) do update set quantity=excluded.quantity,provider_cost_micros=excluded.provider_cost_micros,billable_amount_micros=excluded.billable_amount_micros,last_event_at=excluded.last_event_at,updated_at=now();
 select quantity into used from public.usage_aggregates where organization_id=requested_organization_id and meter_key=requested_meter and period_start=period;
 ent:=public.saas_effective_entitlement(requested_organization_id,m.feature_key);lim:=nullif(ent->>'limit','')::numeric;
 if not coalesce((ent->>'enabled')::boolean,false) or lim is not null and used>lim and coalesce((ent->>'hard_limit')::boolean,false) then raise exception 'Limite do plano atingido. Faça upgrade ou contrate um adicional.';end if;
 return ent||jsonb_build_object('used',used,'remaining',case when lim is null then null else greatest(lim-used,0) end,'event_id',e.id);
end$$;

create or replace function public.get_saas_billing_portal(requested_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin if not private.billing_member(requested_organization_id,'view') then raise exception 'Sem permissão billing:view.';end if;
 select jsonb_build_object(
  'subscription',(select to_jsonb(x) from(select s.id,s.status,s.billing_cycle,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_at_period_end,s.grace_ends_at,s.suspended_at,p.id plan_id,p.name plan_name,p.description,p.monthly_price_cents,p.annual_price_cents from public.subscriptions s join public.plans p on p.id=s.plan_id where s.organization_id=requested_organization_id order by s.created_at desc limit 1)x),
  'usage',(select coalesce(jsonb_agg(to_jsonb(u) order by u.meter_key),'[]') from public.usage_aggregates u where u.organization_id=requested_organization_id and u.period_start=date_trunc('month',now())::date),
  'invoices',(select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc),'[]') from(select id,number,status,total_cents,amount_paid_cents,due_at,paid_at,hosted_url,pdf_url,created_at from public.saas_invoices where organization_id=requested_organization_id order by created_at desc limit 24)i),
  'addons',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from(select oa.id,oa.quantity,oa.status,x.name,x.monthly_price_cents from public.organization_addons oa join public.saas_addons x on x.id=oa.addon_id where oa.organization_id=requested_organization_id)a),
  'estimated_next_invoice_cents',(select coalesce(case when s.billing_cycle='annual' then p.annual_price_cents else p.monthly_price_cents end,0)+(select coalesce(sum(case when s.billing_cycle='annual' then a.annual_price_cents else a.monthly_price_cents end*oa.quantity),0) from public.organization_addons oa join public.saas_addons a on a.id=oa.addon_id where oa.organization_id=requested_organization_id and oa.status='active') from public.subscriptions s join public.plans p on p.id=s.plan_id where s.organization_id=requested_organization_id limit 1)
 ) into result;return result;end$$;

create or replace function public.preview_saas_plan_change(requested_organization_id uuid,requested_plan_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_sub record;target public.plans%rowtype;stores integer;members integer;conflicts jsonb:='[]';proration bigint:=0;remaining_seconds numeric;total_seconds numeric;begin
 if not private.billing_member(requested_organization_id,'change_plan') then raise exception 'Sem permissão billing:change_plan.';end if;
 select s.*,p.monthly_price_cents current_price into current_sub from public.subscriptions s join public.plans p on p.id=s.plan_id where s.organization_id=requested_organization_id limit 1;
 select * into target from public.plans where id=requested_plan_id and active;if target.id is null then raise exception 'Plano indisponível.';end if;
 select count(*) into stores from public.establishments where organization_id=requested_organization_id and unit_status<>'archived';
 select count(*) into members from public.organization_members where organization_id=requested_organization_id and active;
 if target.max_establishments is not null and stores>target.max_establishments then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('resource','stores','current',stores,'limit',target.max_establishments));end if;
 if target.max_team_members is not null and members>target.max_team_members then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('resource','team_members','current',members,'limit',target.max_team_members));end if;
 if current_sub.current_price is not null and current_sub.current_period_end>now() then
  remaining_seconds:=greatest(extract(epoch from (current_sub.current_period_end-now())),0);
  total_seconds:=greatest(extract(epoch from (current_sub.current_period_end-current_sub.current_period_start)),1);
  proration:=round((target.monthly_price_cents-current_sub.current_price)*remaining_seconds/total_seconds);
 end if;
 return jsonb_build_object('from_plan_id',current_sub.plan_id,'to_plan_id',target.id,'change_type',case when target.monthly_price_cents>=coalesce(current_sub.current_price,0) then 'upgrade' else 'downgrade' end,'proration_cents',proration,'effective_at',case when target.monthly_price_cents>=coalesce(current_sub.current_price,0) then now() else current_sub.current_period_end end,'conflicts',conflicts,'data_will_be_deleted',false);
end$$;

create or replace function public.request_saas_plan_change(requested_organization_id uuid,requested_plan_id uuid,requested_consent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preview jsonb;sub public.subscriptions%rowtype;change_id uuid;begin
 if coalesce((requested_consent->>'accepted')::boolean,false)=false then raise exception 'Confirme o plano, preço e vigência.';end if;
 preview:=public.preview_saas_plan_change(requested_organization_id,requested_plan_id);select * into sub from public.subscriptions where organization_id=requested_organization_id for update;
 insert into public.saas_plan_changes(organization_id,subscription_id,from_plan_id,to_plan_id,change_type,effective_at,proration_cents,conflicts,consent_snapshot,requested_by)
 values(requested_organization_id,sub.id,sub.plan_id,requested_plan_id,preview->>'change_type',(preview->>'effective_at')::timestamptz,(preview->>'proration_cents')::bigint,preview->'conflicts',requested_consent,(select auth.uid())) returning id into change_id;
 if preview->>'change_type'='upgrade' and jsonb_array_length(preview->'conflicts')=0 then update public.subscriptions set plan_id=requested_plan_id,updated_at=now() where id=sub.id;update public.saas_plan_changes set status='applied' where id=change_id;end if;
 insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,new_value) values((select auth.uid()),'billing.plan_change_requested','saas_plan_change',change_id,preview||requested_consent);
 return preview||jsonb_build_object('change_id',change_id);
end$$;

create or replace function public.manage_saas_subscription(requested_organization_id uuid,requested_action text,requested_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.subscriptions%rowtype;begin if not private.billing_member(requested_organization_id,'manage') then raise exception 'Sem permissão billing:manage.';end if;
 select * into s from public.subscriptions where organization_id=requested_organization_id for update;if s.id is null then raise exception 'Assinatura não encontrada.';end if;
 if requested_action='cancel' then update public.subscriptions set cancel_at_period_end=true,canceled_at=now(),cancellation_reason=requested_reason,updated_at=now() where id=s.id;
 elsif requested_action='reactivate' then update public.subscriptions set cancel_at_period_end=false,canceled_at=null,cancellation_reason=null,status=case when current_period_end>now() then 'active' else status end,updated_at=now() where id=s.id;
 else raise exception 'Ação inválida.';end if;
 insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,reason) values((select auth.uid()),'billing.subscription_'||requested_action,'subscription',s.id,requested_reason);
 return jsonb_build_object('ok',true,'action',requested_action,'effective_at',case when requested_action='cancel' then s.current_period_end else now() end);
end$$;

create or replace function public.process_saas_dunning() returns integer language plpgsql security definer set search_path='' as $$
declare affected integer:=0;r record;begin if current_user not in('service_role','postgres') then raise exception 'Servidor apenas.';end if;
 for r in select * from public.subscriptions where status='past_due' and coalesce(grace_ends_at,payment_failed_at+interval '7 days')<=now() loop
  update public.subscriptions set status='suspended',suspended_at=now(),updated_at=now() where id=r.id;
  insert into public.saas_dunning_events(organization_id,subscription_id,event_type,message) values(r.organization_id,r.id,'subscription_suspended','Período de tolerância encerrado. Histórico preservado em modo leitura.');affected:=affected+1;
 end loop;return affected;end$$;

create or replace function public.public_saas_plans() returns table(code text,name text,description text,monthly_price_cents integer,annual_price_cents integer,features jsonb)
language sql stable security invoker set search_path='' as $$select p.code,p.name,p.description,p.monthly_price_cents,p.annual_price_cents,coalesce((select jsonb_agg(jsonb_build_object('key',f.key,'name',f.name,'enabled',pf.enabled,'limit',pf.limit_value) order by f.name) from public.saas_plan_features pf join public.saas_features f on f.key=pf.feature_key where pf.plan_id=p.id and f.public),'[]') from public.plans p where p.active order by p.sort_order,p.monthly_price_cents$$;

create or replace function public.saas_billing_metrics(requested_start date default date_trunc('month',now())::date,requested_end date default current_date) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when private.is_superadmin() then jsonb_build_object(
 'mrr_cents',coalesce(sum(case when s.status='active' then case when s.billing_cycle='annual' then p.annual_price_cents/12 else p.monthly_price_cents end else 0 end),0),
 'arr_cents',coalesce(sum(case when s.status='active' then case when s.billing_cycle='annual' then p.annual_price_cents else p.monthly_price_cents*12 end else 0 end),0),
 'active_accounts',count(*) filter(where s.status='active'),'trialing',count(*) filter(where s.status='trialing'),'past_due',count(*) filter(where s.status='past_due'),'suspended',count(*) filter(where s.status='suspended'),
 'cancelled',count(*) filter(where s.status::text in('canceled','expired')),
 'arpa_cents',coalesce(sum(case when s.status='active' then case when s.billing_cycle='annual' then p.annual_price_cents/12 else p.monthly_price_cents end else 0 end)/nullif(count(*) filter(where s.status='active'),0),0),
 'gross_revenue_cents',(select coalesce(sum(amount_cents),0) from public.saas_payments where status='paid' and created_at::date between requested_start and requested_end),
 'refunds_cents',(select coalesce(sum(amount_cents),0) from public.saas_payments where status='refunded' and created_at::date between requested_start and requested_end),
 'provider_cost_micros',(select coalesce(sum(provider_cost_micros),0) from public.usage_events where occurred_at::date between requested_start and requested_end),
 'usage_revenue_micros',(select coalesce(sum(billable_amount_micros),0) from public.usage_events where occurred_at::date between requested_start and requested_end)) else null end from public.subscriptions s join public.plans p on p.id=s.plan_id;
$$;

do $$declare t text;begin foreach t in array array['saas_prices','saas_features','saas_plan_features','saas_addons','organization_addons','usage_meters','usage_events','usage_aggregates','saas_invoices','saas_invoice_items','saas_payments','saas_gateway_events','billing_contacts','billing_member_permissions','billing_credits','billing_adjustments','saas_plan_changes','saas_dunning_events','saas_billing_notifications','marketplace_billing_records'] loop execute format('alter table public.%I enable row level security',t);end loop;end$$;

do $$declare t text;begin foreach t in array array['organization_addons','usage_events','usage_aggregates','saas_invoices','saas_payments','billing_contacts','billing_member_permissions','billing_credits','billing_adjustments','saas_plan_changes','saas_dunning_events','saas_billing_notifications','marketplace_billing_records'] loop
 execute format('create policy %I on public.%I for select to authenticated using ((select private.billing_member(organization_id,''view'')))',t||'_billing_read',t);end loop;end$$;
create policy saas_invoice_items_billing_read on public.saas_invoice_items for select to authenticated using(exists(select 1 from public.saas_invoices i where i.id=invoice_id and private.billing_member(i.organization_id,'view')));
create policy saas_catalog_authenticated_read on public.saas_features for select to authenticated using(true);
create policy saas_meters_authenticated_read on public.usage_meters for select to authenticated using(true);
create policy saas_prices_authenticated_read on public.saas_prices for select to authenticated using(true);
create policy saas_plan_features_authenticated_read on public.saas_plan_features for select to authenticated using(true);
create policy saas_addons_authenticated_read on public.saas_addons for select to authenticated using(active);
create policy saas_gateway_superadmin_read on public.saas_gateway_events for select to authenticated using((select private.is_superadmin()));
create policy saas_prices_superadmin_manage on public.saas_prices for all to authenticated using((select private.is_superadmin())) with check((select private.is_superadmin()));
create policy saas_features_superadmin_manage on public.saas_features for all to authenticated using((select private.is_superadmin())) with check((select private.is_superadmin()));
create policy saas_plan_features_superadmin_manage on public.saas_plan_features for all to authenticated using((select private.is_superadmin())) with check((select private.is_superadmin()));
create policy saas_addons_superadmin_manage on public.saas_addons for all to authenticated using((select private.is_superadmin())) with check((select private.is_superadmin()));
create policy saas_meters_superadmin_manage on public.usage_meters for all to authenticated using((select private.is_superadmin())) with check((select private.is_superadmin()));

grant select on public.saas_prices,public.saas_features,public.saas_plan_features,public.saas_addons,public.organization_addons,public.usage_meters,public.usage_events,public.usage_aggregates,public.saas_invoices,public.saas_invoice_items,public.saas_payments,public.billing_contacts,public.billing_member_permissions,public.billing_credits,public.billing_adjustments,public.saas_plan_changes,public.saas_dunning_events,public.saas_billing_notifications,public.marketplace_billing_records,public.saas_coupons to authenticated;
grant insert,update,delete on public.saas_prices,public.saas_features,public.saas_plan_features,public.saas_addons,public.usage_meters to authenticated;
grant all on public.saas_prices,public.saas_features,public.saas_plan_features,public.saas_addons,public.organization_addons,public.usage_meters,public.usage_events,public.usage_aggregates,public.saas_invoices,public.saas_invoice_items,public.saas_payments,public.saas_gateway_events,public.billing_contacts,public.billing_member_permissions,public.billing_credits,public.billing_adjustments,public.saas_plan_changes,public.saas_dunning_events,public.saas_billing_notifications,public.marketplace_billing_records to service_role;
grant select on public.plans,public.saas_features,public.saas_plan_features to anon;

revoke all on function private.billing_member(uuid,text) from public,anon,authenticated;
grant execute on function private.billing_member(uuid,text) to authenticated,service_role;
revoke all on function public.saas_effective_entitlement(uuid,text),public.record_saas_usage(uuid,uuid,text,numeric,text,bigint,jsonb),public.get_saas_billing_portal(uuid),public.preview_saas_plan_change(uuid,uuid),public.request_saas_plan_change(uuid,uuid,jsonb),public.manage_saas_subscription(uuid,text,text),public.process_saas_dunning(),public.saas_billing_metrics(date,date) from public,anon;
grant execute on function public.saas_effective_entitlement(uuid,text),public.get_saas_billing_portal(uuid),public.preview_saas_plan_change(uuid,uuid),public.request_saas_plan_change(uuid,uuid,jsonb),public.manage_saas_subscription(uuid,text,text) to authenticated,service_role;
grant execute on function public.record_saas_usage(uuid,uuid,text,numeric,text,bigint,jsonb),public.process_saas_dunning() to service_role;
grant execute on function public.saas_billing_metrics(date,date) to authenticated;
grant execute on function public.public_saas_plans() to public,anon,authenticated;

create or replace function private.version_saas_plan_price() returns trigger language plpgsql security definer set search_path='' as $$
declare next_version integer;begin
 if new.monthly_price_cents is distinct from old.monthly_price_cents then
  select coalesce(max(version),0)+1 into next_version from public.saas_prices where plan_id=new.id and billing_cycle='monthly';
  update public.saas_prices set active=false,effective_until=now() where plan_id=new.id and billing_cycle='monthly' and active;
  insert into public.saas_prices(plan_id,version,billing_cycle,amount_cents) values(new.id,next_version,'monthly',new.monthly_price_cents);
 end if;
 if new.annual_price_cents is distinct from old.annual_price_cents then
  select coalesce(max(version),0)+1 into next_version from public.saas_prices where plan_id=new.id and billing_cycle='annual';
  update public.saas_prices set active=false,effective_until=now() where plan_id=new.id and billing_cycle='annual' and active;
  insert into public.saas_prices(plan_id,version,billing_cycle,amount_cents) values(new.id,next_version,'annual',new.annual_price_cents);
 end if;return new;end$$;
drop trigger if exists saas_plan_price_versioning on public.plans;
create trigger saas_plan_price_versioning after update of monthly_price_cents,annual_price_cents on public.plans for each row execute function private.version_saas_plan_price();
revoke all on function private.version_saas_plan_price() from public,anon,authenticated;

create or replace function private.capture_saas_usage_event() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;meter text;qty numeric:=1;idem text;cost bigint:=0;inserted integer;period date:=date_trunc('month',now())::date;begin
 select organization_id into org from public.establishments where id=new.establishment_id;if org is null then return new;end if;
 if tg_table_name='orders' then meter:='orders';idem:='order:'||new.id;
 elsif tg_table_name='whatsapp_messages' then meter:='whatsapp_messages';idem:='whatsapp:'||new.id;
 elsif tg_table_name='ai_usage_events' then meter:='ai_tokens';qty:=coalesce(new.input_tokens,0)+coalesce(new.output_tokens,0);cost:=coalesce(new.estimated_cost_micros,0);idem:='ai:'||new.id;
 elsif tg_table_name='voice_cost_usage' then meter:='voice_minutes';qty:=ceil(coalesce(new.telephony_seconds,0)::numeric/60);cost:=coalesce(new.estimated_cost_cents,0)*10000;idem:='voice:'||new.id;
 else return new;end if;
 insert into public.usage_events(organization_id,establishment_id,meter_key,idempotency_key,quantity,provider_cost_micros,source,metadata)
 values(org,new.establishment_id,meter,idem,qty,cost,'operational_trigger',jsonb_build_object('source_table',tg_table_name)) on conflict(organization_id,idempotency_key) do nothing;
 get diagnostics inserted=row_count;if inserted=1 then insert into public.usage_aggregates(organization_id,meter_key,period_start,period_end,quantity,provider_cost_micros,last_event_at)
 values(org,meter,period,(period+interval '1 month')::date,qty,cost,now()) on conflict(organization_id,meter_key,period_start) do update set quantity=public.usage_aggregates.quantity+excluded.quantity,provider_cost_micros=public.usage_aggregates.provider_cost_micros+excluded.provider_cost_micros,last_event_at=now(),updated_at=now();end if;return new;
end$$;
drop trigger if exists orders_saas_usage on public.orders;create trigger orders_saas_usage after insert on public.orders for each row execute function private.capture_saas_usage_event();
drop trigger if exists whatsapp_saas_usage on public.whatsapp_messages;create trigger whatsapp_saas_usage after insert on public.whatsapp_messages for each row execute function private.capture_saas_usage_event();
drop trigger if exists ai_saas_usage on public.ai_usage_events;create trigger ai_saas_usage after insert on public.ai_usage_events for each row execute function private.capture_saas_usage_event();
drop trigger if exists voice_saas_usage on public.voice_cost_usage;create trigger voice_saas_usage after insert on public.voice_cost_usage for each row execute function private.capture_saas_usage_event();
revoke all on function private.capture_saas_usage_event() from public,anon,authenticated;
