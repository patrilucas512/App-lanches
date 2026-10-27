-- Fase 13: Portal de Autoatendimento e Conta do Cliente.
-- O portal usa o customer_id/organization_customer_id oficiais e nunca cria histórico paralelo.

alter table public.plans
  add column if not exists customer_portal_enabled boolean not null default false,
  add column if not exists order_tracking_enabled boolean not null default false,
  add column if not exists reorder_enabled boolean not null default false,
  add column if not exists loyalty_portal_enabled boolean not null default false,
  add column if not exists customer_coupons_enabled boolean not null default false;

alter table public.store_feature_flags
  add column if not exists customer_portal_enabled boolean not null default true,
  add column if not exists order_tracking_enabled boolean not null default true,
  add column if not exists reorder_enabled boolean not null default true,
  add column if not exists loyalty_portal_enabled boolean not null default true,
  add column if not exists customer_coupons_enabled boolean not null default true;

alter table public.customers
  add column if not exists birth_date date,
  add column if not exists email_verified_at timestamptz,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table public.customer_portal_configs (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  display_name text,
  logo_url text,
  welcome_message text not null default 'Acompanhe seus pedidos e benefícios em um só lugar.',
  accent_color text not null default '#ff2b2b' check(accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  show_loyalty boolean not null default true,
  show_coupons boolean not null default true,
  show_favorites boolean not null default true,
  support_whatsapp boolean not null default true,
  support_web_chat boolean not null default true,
  support_voice boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.customer_portal_configs(establishment_id,organization_id,display_name,logo_url,accent_color)
select e.id,coalesce(e.organization_id,e.id),e.name,e.logo_url,coalesce(e.accent_color,'#ff2b2b')
from public.establishments e on conflict(establishment_id) do nothing;

create table public.customer_portal_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  organization_customer_id uuid references public.organization_customers(id) on delete set null,
  normalized_destination text not null,
  destination_type text not null default 'phone' check(destination_type in ('phone','email')),
  purpose text not null default 'login' check(purpose in ('login','change_phone','change_email')),
  otp_hash text not null,
  requester_hash text not null,
  attempts smallint not null default 0 check(attempts between 0 and 6),
  max_attempts smallint not null default 5 check(max_attempts between 3 and 6),
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed_at timestamptz,
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);
create index customer_portal_otp_rate_idx on public.customer_portal_otp_challenges(organization_id,normalized_destination,created_at desc);
create index customer_portal_otp_requester_idx on public.customer_portal_otp_challenges(requester_hash,created_at desc);

create table public.customer_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  organization_customer_id uuid references public.organization_customers(id) on delete cascade,
  token_hash text not null unique,
  user_agent_hash text,
  requester_hash text,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now()
);
create index customer_portal_sessions_active_idx on public.customer_portal_sessions(token_hash,expires_at) where revoked_at is null;
create index customer_portal_sessions_customer_idx on public.customer_portal_sessions(organization_id,organization_customer_id,created_at desc);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  organization_customer_id uuid references public.organization_customers(id) on delete cascade,
  label text not null,
  postal_code text,
  street text not null,
  number text not null,
  complement text,
  neighborhood text not null,
  reference text,
  is_primary boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_addresses_owner_idx on public.customer_addresses(organization_id,organization_customer_id,updated_at desc) where deleted_at is null;
create unique index customer_addresses_one_primary_idx on public.customer_addresses(organization_id,organization_customer_id) where is_primary and deleted_at is null;

create table public.customer_favorites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  organization_customer_id uuid references public.organization_customers(id) on delete cascade,
  favorite_type text not null check(favorite_type in ('order','product')),
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  check((favorite_type='order' and order_id is not null and product_id is null) or (favorite_type='product' and product_id is not null and order_id is null))
);
create unique index customer_favorite_order_key on public.customer_favorites(organization_id,organization_customer_id,order_id) where favorite_type='order';
create unique index customer_favorite_product_key on public.customer_favorites(organization_id,organization_customer_id,product_id) where favorite_type='product';

create table public.customer_notification_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  organization_customer_id uuid references public.organization_customers(id) on delete cascade,
  transactional_enabled boolean not null default true,
  whatsapp_marketing boolean not null default false,
  email_marketing boolean not null default false,
  preferred_channel text check(preferred_channel in ('whatsapp','email','web_chat')),
  updated_at timestamptz not null default now(),
  primary key(organization_id,customer_id)
);

create table public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_notifications_feed_idx on public.customer_notifications(organization_id,customer_id,created_at desc);

create table public.customer_privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  request_type text not null check(request_type in ('access','correction','deletion','consent_review')),
  details text,
  status text not null default 'open' check(status in ('open','reviewing','completed','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  category text not null check(category in ('missing_item','wrong_item','delay','payment','quality','cancellation','other')),
  channel text not null default 'portal' check(channel in ('portal','whatsapp','web_chat','voice')),
  details text,
  status text not null default 'open' check(status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_magic_order_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.customer_portal_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  session_id uuid references public.customer_portal_sessions(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index customer_portal_events_analytics_idx on public.customer_portal_events(organization_id,event_type,created_at desc);

create or replace function public.request_customer_portal_otp(requested_slug text,requested_destination text,requested_otp_hash text,requested_requester_hash text,requested_purpose text default 'login')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.customer_portal_configs%rowtype; e public.establishments%rowtype; normalized text; target public.customers%rowtype; org_customer uuid; challenge uuid; recent_count integer; requester_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  normalized:=public.normalize_customer_phone(requested_destination);
  if normalized is null or char_length(normalized)<10 or requested_purpose not in('login','change_phone','change_email') then raise exception 'Dados inválidos.'; end if;
  select * into e from public.establishments where slug=requested_slug and active;
  select * into cfg from public.customer_portal_configs where establishment_id=e.id and enabled;
  if e.id is null or cfg.establishment_id is null then raise exception 'Portal indisponível.'; end if;
  select count(*) into recent_count from public.customer_portal_otp_challenges where organization_id=coalesce(e.organization_id,e.id) and normalized_destination=normalized and created_at>now()-interval '1 hour';
  select count(*) into requester_count from public.customer_portal_otp_challenges where requester_hash=requested_requester_hash and created_at>now()-interval '15 minutes';
  if recent_count>=5 or requester_count>=12 then raise exception 'Muitas tentativas. Aguarde antes de tentar novamente.'; end if;
  select c.* into target from public.customer_identities i join public.customers c on c.id=i.customer_id
    where i.organization_id=coalesce(e.organization_id,e.id) and i.identity_type in('phone','whatsapp') and i.value_normalized=normalized and i.verified
    order by i.is_primary desc,i.updated_at desc limit 1;
  if target.id is null then select * into target from public.customers where establishment_id=e.id and public.normalize_customer_phone(phone)=normalized order by created_at limit 1; end if;
  org_customer:=target.organization_customer_id;
  insert into public.customer_portal_otp_challenges(organization_id,establishment_id,customer_id,organization_customer_id,normalized_destination,purpose,otp_hash,requester_hash)
  values(coalesce(e.organization_id,e.id),e.id,target.id,org_customer,normalized,requested_purpose,requested_otp_hash,requested_requester_hash) returning id into challenge;
  return jsonb_build_object('challenge_id',challenge,'establishment_id',e.id,'organization_id',coalesce(e.organization_id,e.id),'destination',normalized,'expires_in',600);
end $$;

create or replace function public.verify_customer_portal_otp(requested_challenge_id uuid,requested_otp_hash text,requested_session_hash text,requested_user_agent_hash text,requested_requester_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ch public.customer_portal_otp_challenges%rowtype; c public.customers%rowtype; orgc uuid; sid uuid; est public.establishments%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into ch from public.customer_portal_otp_challenges where id=requested_challenge_id for update;
  if ch.id is null or ch.consumed_at is not null or ch.expires_at<=now() or ch.attempts>=ch.max_attempts or ch.blocked_until>now() then raise exception 'Código inválido ou expirado.'; end if;
  if ch.otp_hash<>requested_otp_hash then
    update public.customer_portal_otp_challenges set attempts=attempts+1,blocked_until=case when attempts+1>=max_attempts then now()+interval '30 minutes' else blocked_until end where id=ch.id;
    raise exception 'Código inválido ou expirado.';
  end if;
  select * into est from public.establishments where id=ch.establishment_id;
  if ch.customer_id is null then
    insert into public.organization_customers(organization_id,name,normalized_phone)
    values(ch.organization_id,'Cliente',ch.normalized_destination)
    on conflict(organization_id,normalized_phone) do update set updated_at=now() returning id into orgc;
    insert into public.customers(establishment_id,name,phone,organization_customer_id,phone_verified_at)
    values(ch.establishment_id,'Cliente',ch.normalized_destination,orgc,now()) returning * into c;
  else
    select * into c from public.customers where id=ch.customer_id;
    orgc:=coalesce(ch.organization_customer_id,c.organization_customer_id);
    update public.customers set phone_verified_at=coalesce(phone_verified_at,now()),updated_at=now() where id=c.id;
  end if;
  insert into public.customer_identities(customer_id,organization_id,establishment_id,identity_type,value_normalized,verified,is_primary,verification_source)
  values(c.id,ch.organization_id,ch.establishment_id,'phone',ch.normalized_destination,true,true,'customer_portal_otp')
  on conflict(organization_id,identity_type,value_normalized) do update set verified=true,updated_at=now();
  update public.customer_portal_otp_challenges set consumed_at=now(),attempts=attempts+1,customer_id=c.id,organization_customer_id=orgc where id=ch.id;
  insert into public.customer_portal_sessions(organization_id,establishment_id,customer_id,organization_customer_id,token_hash,user_agent_hash,requester_hash,expires_at)
  values(ch.organization_id,ch.establishment_id,c.id,orgc,requested_session_hash,requested_user_agent_hash,requested_requester_hash,now()+interval '30 days') returning id into sid;
  insert into public.customer_notification_preferences(organization_id,customer_id,organization_customer_id) values(ch.organization_id,c.id,orgc) on conflict do nothing;
  insert into public.customer_portal_events(organization_id,establishment_id,customer_id,session_id,event_type) values(ch.organization_id,ch.establishment_id,c.id,sid,'login_succeeded');
  return jsonb_build_object('session_id',sid,'customer_id',c.id,'organization_customer_id',orgc,'expires_at',now()+interval '30 days');
end $$;

create or replace function public.get_customer_portal_context(requested_session_hash text,requested_slug text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype; e public.establishments%rowtype; ids uuid[]; c public.customers%rowtype; cfg public.customer_portal_configs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now() for update;
  select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
  if s.id is null or e.id is null then raise exception 'Sessão expirada.'; end if;
  update public.customer_portal_sessions set last_seen_at=now() where id=s.id;
  select array_agg(id) into ids from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id;
  select * into c from public.customers where id=s.customer_id;
  select * into cfg from public.customer_portal_configs where establishment_id=e.id;
  return jsonb_build_object(
    'session',jsonb_build_object('id',s.id,'expires_at',s.expires_at),
    'config',to_jsonb(cfg)-'organization_id',
    'customer',jsonb_build_object('id',c.id,'name',c.name,'phone_masked','••••'||right(regexp_replace(c.phone,'\D','','g'),4),'email',c.email,'birth_date',c.birth_date),
    'stores',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'slug',x.slug,'logo_url',x.logo_url)),'[]') from public.establishments x where coalesce(x.organization_id,x.id)=s.organization_id and x.active),
    'orders',(select coalesce(jsonb_agg(row_to_json(o2)),'[]') from (select o.id,o.order_number,o.establishment_id,st.name store_name,st.slug store_slug,o.status,o.fulfillment_type,o.total_cents,o.payment_method,o.online_payment_status,o.delivery_address,o.tracking_token,o.source,o.created_at,o.updated_at,(select coalesce(jsonb_agg(jsonb_build_object('id',oi.id,'product_id',oi.product_id,'name',oi.product_name,'quantity',oi.quantity,'unit_price_cents',oi.unit_price_cents,'total_cents',oi.total_cents,'addons',oi.addons)),'[]') from public.order_items oi where oi.order_id=o.id) items from public.orders o join public.establishments st on st.id=o.establishment_id where o.customer_id=any(ids) and coalesce(st.organization_id,st.id)=s.organization_id order by o.created_at desc limit 100)o2),
    'addresses',(select coalesce(jsonb_agg(row_to_json(a) order by a.is_primary desc,a.updated_at desc),'[]') from public.customer_addresses a where a.organization_id=s.organization_id and (a.organization_customer_id=s.organization_customer_id or a.customer_id=s.customer_id) and a.deleted_at is null),
    'coupons',(select coalesce(jsonb_agg(jsonb_build_object('id',cp.id,'code',cp.code,'discount_type',cp.discount_type,'discount_value',cp.discount_value,'minimum_order_cents',cp.minimum_order_cents,'ends_at',cp.ends_at,'eligible',cp.active and (cp.starts_at is null or cp.starts_at<=now()) and (cp.ends_at is null or cp.ends_at>now()) and (cp.usage_limit is null or cp.uses_count<cp.usage_limit)) order by cp.ends_at nulls last),'[]') from public.coupons cp join public.establishments st on st.id=cp.establishment_id where coalesce(st.organization_id,st.id)=s.organization_id),
    'loyalty',jsonb_build_object('balance',coalesce((select sum(balance) from public.loyalty_accounts la where la.customer_id=any(ids)),0),'ledger',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'event_type',l.event_type,'points',l.points,'order_id',l.order_id,'created_at',l.created_at) order by l.created_at desc),'[]') from public.loyalty_ledger l where l.customer_id=any(ids)),'rewards',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'points_cost',r.points_cost,'minimum_order_cents',r.minimum_order_cents)),'[]') from public.loyalty_rewards r join public.establishments st on st.id=r.establishment_id where coalesce(st.organization_id,st.id)=s.organization_id and r.active and (r.starts_at is null or r.starts_at<=now()) and (r.ends_at is null or r.ends_at>now()))),
    'favorites',(select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]') from public.customer_favorites f where f.organization_id=s.organization_id and (f.organization_customer_id=s.organization_customer_id or f.customer_id=s.customer_id)),
    'notifications',(select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]') from (select * from public.customer_notifications n0 where n0.organization_id=s.organization_id and n0.customer_id=any(ids) order by n0.created_at desc limit 50)n),
    'preferences',(select to_jsonb(p) from public.customer_notification_preferences p where p.organization_id=s.organization_id and p.customer_id=s.customer_id)
  );
end $$;

create or replace function public.customer_portal_action(requested_session_hash text,requested_slug text,requested_action text,requested_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype; e public.establishments%rowtype; target_order public.orders%rowtype; reward public.loyalty_rewards%rowtype; aid uuid; fav uuid; support_id uuid; request_id uuid; normalized_email text; previous_email text; current_status text; reward_customer uuid; reward_balance integer; redemption_code text; affected integer;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now() for update;
  select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
  if s.id is null or e.id is null then raise exception 'Sessão expirada.'; end if;
  if requested_action='save_address' then
    if nullif(btrim(requested_payload->>'street'),'') is null or nullif(btrim(requested_payload->>'number'),'') is null or nullif(btrim(requested_payload->>'neighborhood'),'') is null then raise exception 'Endereço incompleto.'; end if;
    aid:=nullif(requested_payload->>'id','')::uuid;
    if coalesce((requested_payload->>'is_primary')::boolean,false) then update public.customer_addresses set is_primary=false,updated_at=now() where organization_id=s.organization_id and organization_customer_id is not distinct from s.organization_customer_id; end if;
    if aid is null then insert into public.customer_addresses(organization_id,customer_id,organization_customer_id,label,postal_code,street,number,complement,neighborhood,reference,is_primary) values(s.organization_id,s.customer_id,s.organization_customer_id,left(coalesce(nullif(btrim(requested_payload->>'label'),''),'Endereço'),60),left(coalesce(requested_payload->>'postal_code',''),10),left(btrim(requested_payload->>'street'),160),left(btrim(requested_payload->>'number'),30),left(coalesce(requested_payload->>'complement',''),100),left(btrim(requested_payload->>'neighborhood'),100),left(coalesce(requested_payload->>'reference',''),160),coalesce((requested_payload->>'is_primary')::boolean,false)) returning id into aid;
    else update public.customer_addresses set label=left(coalesce(nullif(btrim(requested_payload->>'label'),''),'Endereço'),60),postal_code=left(coalesce(requested_payload->>'postal_code',''),10),street=left(btrim(requested_payload->>'street'),160),number=left(btrim(requested_payload->>'number'),30),complement=left(coalesce(requested_payload->>'complement',''),100),neighborhood=left(btrim(requested_payload->>'neighborhood'),100),reference=left(coalesce(requested_payload->>'reference',''),160),is_primary=coalesce((requested_payload->>'is_primary')::boolean,false),updated_at=now() where id=aid and organization_id=s.organization_id and (organization_customer_id=s.organization_customer_id or customer_id=s.customer_id) and deleted_at is null returning id into aid; end if;
    return jsonb_build_object('ok',aid is not null,'id',aid);
  elsif requested_action='delete_address' then
    aid:=(requested_payload->>'id')::uuid; update public.customer_addresses set deleted_at=now(),is_primary=false,updated_at=now() where id=aid and organization_id=s.organization_id and (organization_customer_id=s.organization_customer_id or customer_id=s.customer_id); get diagnostics affected=row_count;
    if affected>0 then insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(e.id,'customer_portal.address_deleted','customer_address',aid,jsonb_build_object('customer_id',s.customer_id)); end if; return jsonb_build_object('ok',affected>0);
  elsif requested_action='update_profile' then
    normalized_email:=lower(nullif(btrim(requested_payload->>'email'),'')); if normalized_email is not null and normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
    select email into previous_email from public.customers where id=s.customer_id;
    update public.customers set name=left(coalesce(nullif(btrim(requested_payload->>'name'),''),name),120),email=normalized_email,birth_date=nullif(requested_payload->>'birth_date','')::date,updated_at=now() where id=s.customer_id;
    insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(e.id,'customer_portal.profile_updated','customer',s.customer_id,jsonb_build_object('email_changed',normalized_email is distinct from previous_email)); return jsonb_build_object('ok',true);
  elsif requested_action='set_preferences' then
    insert into public.customer_notification_preferences(organization_id,customer_id,organization_customer_id,transactional_enabled,whatsapp_marketing,email_marketing,preferred_channel) values(s.organization_id,s.customer_id,s.organization_customer_id,coalesce((requested_payload->>'transactional_enabled')::boolean,true),coalesce((requested_payload->>'whatsapp_marketing')::boolean,false),coalesce((requested_payload->>'email_marketing')::boolean,false),nullif(requested_payload->>'preferred_channel','')) on conflict(organization_id,customer_id) do update set transactional_enabled=excluded.transactional_enabled,whatsapp_marketing=excluded.whatsapp_marketing,email_marketing=excluded.email_marketing,preferred_channel=excluded.preferred_channel,updated_at=now();
    update public.customers set marketing_status=case when coalesce((requested_payload->>'whatsapp_marketing')::boolean,false) or coalesce((requested_payload->>'email_marketing')::boolean,false) then 'opted_in' else 'opted_out' end,marketing_consent_at=now() where id=s.customer_id;
    insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(e.id,'customer_portal.consent_changed','customer',s.customer_id,jsonb_build_object('whatsapp_marketing',requested_payload->>'whatsapp_marketing','email_marketing',requested_payload->>'email_marketing')); return jsonb_build_object('ok',true);
  elsif requested_action='favorite_order' then
    select * into target_order from public.orders where id=(requested_payload->>'order_id')::uuid and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id) and establishment_id in(select id from public.establishments where coalesce(organization_id,id)=s.organization_id);
    if target_order.id is null then raise exception 'Pedido não encontrado.'; end if;
    insert into public.customer_favorites(organization_id,customer_id,organization_customer_id,favorite_type,order_id,label) values(s.organization_id,s.customer_id,s.organization_customer_id,'order',target_order.id,left(coalesce(requested_payload->>'label','Pedido favorito'),80)) on conflict do nothing returning id into fav; return jsonb_build_object('ok',true,'id',fav);
  elsif requested_action='redeem_reward' then
    select r.* into reward from public.loyalty_rewards r join public.establishments st on st.id=r.establishment_id where r.id=(requested_payload->>'reward_id')::uuid and coalesce(st.organization_id,st.id)=s.organization_id and r.active and (r.starts_at is null or r.starts_at<=now()) and (r.ends_at is null or r.ends_at>now());
    if reward.id is null then raise exception 'Benefício indisponível.'; end if;
    select c.id into reward_customer from public.customers c where c.establishment_id=reward.establishment_id and (c.organization_customer_id=s.organization_customer_id or c.id=s.customer_id) order by (c.id=s.customer_id) desc limit 1;
    select balance into reward_balance from public.loyalty_accounts where establishment_id=reward.establishment_id and customer_id=reward_customer for update;
    if reward_balance is null or reward_balance<reward.points_cost then raise exception 'Saldo de pontos insuficiente.'; end if;
    redemption_code:='FID-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    update public.loyalty_accounts set balance=balance-reward.points_cost,updated_at=now() where establishment_id=reward.establishment_id and customer_id=reward_customer;
    insert into public.loyalty_ledger(establishment_id,customer_id,event_type,points,idempotency_key,metadata) values(reward.establishment_id,reward_customer,'redeem',-reward.points_cost,'portal-reward-'||s.id||'-'||reward.id||'-'||extract(epoch from now())::bigint,jsonb_build_object('reward_id',reward.id,'display_code',redemption_code));
    insert into public.crm_coupon_tokens(establishment_id,coupon_id,customer_id,token_hash,display_code) values(reward.establishment_id,reward.coupon_id,reward_customer,encode(extensions.digest(redemption_code,'sha256'),'hex'),redemption_code);
    insert into public.customer_notifications(organization_id,establishment_id,customer_id,notification_type,title,body) values(s.organization_id,reward.establishment_id,reward_customer,'loyalty_reward','Benefício resgatado','Use o código '||redemption_code||' no seu próximo pedido.');
    insert into public.customer_portal_events(organization_id,establishment_id,customer_id,session_id,event_type,entity_type,entity_id,metadata) values(s.organization_id,reward.establishment_id,reward_customer,s.id,'reward_redeemed','loyalty_reward',reward.id,jsonb_build_object('points',reward.points_cost));
    return jsonb_build_object('ok',true,'message','Benefício resgatado. Código: '||redemption_code,'code',redemption_code);
  elsif requested_action='rate_order' then
    select * into target_order from public.orders where id=(requested_payload->>'order_id')::uuid and status='completed' and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id) and establishment_id in(select id from public.establishments where coalesce(organization_id,id)=s.organization_id);
    if target_order.id is null then raise exception 'Pedido entregue não encontrado.'; end if;
    if coalesce((requested_payload->>'rating')::integer,0) not between 1 and 5 then raise exception 'Avaliação inválida.'; end if;
    insert into public.crm_feedback(establishment_id,customer_id,order_id,rating,comment,answered_at,needs_human_attention) values(target_order.establishment_id,target_order.customer_id,target_order.id,(requested_payload->>'rating')::integer,left(coalesce(requested_payload->>'comment',''),600),now(),(requested_payload->>'rating')::integer<=2) on conflict(order_id) do update set rating=excluded.rating,comment=excluded.comment,answered_at=now(),needs_human_attention=excluded.needs_human_attention;
    insert into public.customer_portal_events(organization_id,establishment_id,customer_id,session_id,event_type,entity_type,entity_id,metadata) values(s.organization_id,target_order.establishment_id,s.customer_id,s.id,'order_rated','order',target_order.id,jsonb_build_object('rating',requested_payload->>'rating')); return jsonb_build_object('ok',true,'message','Obrigado pela avaliação.');
  elsif requested_action='support' then
    if requested_payload?'order_id' and requested_payload->>'order_id'<>'' then select * into target_order from public.orders where id=(requested_payload->>'order_id')::uuid and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id); if target_order.id is null then raise exception 'Pedido não autorizado.'; end if; end if;
    insert into public.customer_support_requests(organization_id,establishment_id,customer_id,order_id,category,channel,details) values(s.organization_id,e.id,s.customer_id,target_order.id,coalesce(nullif(requested_payload->>'category',''),'other'),coalesce(nullif(requested_payload->>'channel',''),'portal'),left(coalesce(requested_payload->>'details',''),1000)) returning id into support_id;
    insert into public.customer_portal_events(organization_id,establishment_id,customer_id,session_id,event_type,entity_type,entity_id) values(s.organization_id,e.id,s.customer_id,s.id,'support_started','support_request',support_id); return jsonb_build_object('ok',true,'id',support_id);
  elsif requested_action='privacy_request' then
    insert into public.customer_privacy_requests(organization_id,establishment_id,customer_id,request_type,details) values(s.organization_id,e.id,s.customer_id,requested_payload->>'request_type',left(coalesce(requested_payload->>'details',''),1000)) returning id into request_id;
    insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(e.id,'customer_portal.privacy_requested','privacy_request',request_id,jsonb_build_object('customer_id',s.customer_id,'type',requested_payload->>'request_type')); return jsonb_build_object('ok',true,'id',request_id);
  elsif requested_action='request_cancellation' then
    select * into target_order from public.orders where id=(requested_payload->>'order_id')::uuid and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id) and establishment_id in(select id from public.establishments where coalesce(organization_id,id)=s.organization_id) for update;
    if target_order.id is null then raise exception 'Pedido não autorizado.'; end if;
    current_status:=target_order.status::text;
    if current_status in('new','confirmed') then update public.orders set status='canceled',updated_at=now() where id=target_order.id; insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(target_order.establishment_id,'customer_portal.order_cancelled','order',target_order.id,jsonb_build_object('customer_id',s.customer_id,'previous_status',current_status)); return jsonb_build_object('ok',true,'cancelled',true); end if;
    insert into public.customer_support_requests(organization_id,establishment_id,customer_id,order_id,category,details) values(s.organization_id,target_order.establishment_id,s.customer_id,target_order.id,'cancellation','Cancelamento solicitado após início do preparo.') returning id into support_id; return jsonb_build_object('ok',true,'cancelled',false,'support_id',support_id,'message','Este pedido já está em preparo. Nossa equipe verificará a solicitação.');
  elsif requested_action='mark_notifications_read' then update public.customer_notifications set read_at=coalesce(read_at,now()) where organization_id=s.organization_id and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id); return jsonb_build_object('ok',true);
  elsif requested_action='logout_all' then update public.customer_portal_sessions set revoked_at=now(),revoke_reason='customer_logout_all' where organization_id=s.organization_id and (organization_customer_id=s.organization_customer_id or customer_id=s.customer_id) and revoked_at is null; return jsonb_build_object('ok',true);
  else raise exception 'Ação não permitida.'; end if;
end $$;

create or replace function public.prepare_customer_reorder(requested_session_hash text,requested_slug text,requested_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype; e public.establishments%rowtype; o public.orders%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();
  select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
  select * into o from public.orders where id=requested_order_id and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id) and establishment_id in(select id from public.establishments where coalesce(organization_id,id)=s.organization_id);
  if s.id is null or e.id is null or o.id is null then raise exception 'Pedido não autorizado.'; end if;
  insert into public.customer_portal_events(organization_id,establishment_id,customer_id,session_id,event_type,entity_type,entity_id) values(s.organization_id,e.id,s.customer_id,s.id,'reorder_prepared','order',o.id);
  return jsonb_build_object('store_slug',e.slug,'source_store_id',o.establishment_id,'target_store_id',e.id,'price_changed',exists(select 1 from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=o.id and p.price_cents<>oi.unit_price_cents),'unavailable_count',(select count(*) from public.order_items oi left join public.products p on p.id=oi.product_id and p.establishment_id=e.id and p.active where oi.order_id=o.id and p.id is null),'items',(select coalesce(jsonb_agg(jsonb_build_object('productId',p.id,'productName',oi.product_name,'quantity',oi.quantity,'currentPriceCents',p.price_cents,'oldPriceCents',oi.unit_price_cents,'available',p.id is not null,'addons',coalesce(oi.addons,'[]'::jsonb),'removedIngredients','[]'::jsonb)),'[]') from public.order_items oi left join public.products p on p.id=oi.product_id and p.establishment_id=e.id and p.active where oi.order_id=o.id));
end $$;

create or replace function public.logout_customer_portal(requested_session_hash text,requested_all boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into s from public.customer_portal_sessions where token_hash=requested_session_hash;
  if requested_all then update public.customer_portal_sessions set revoked_at=now(),revoke_reason='customer_logout_all' where organization_id=s.organization_id and (organization_customer_id=s.organization_customer_id or customer_id=s.customer_id) and revoked_at is null;
  else update public.customer_portal_sessions set revoked_at=now(),revoke_reason='customer_logout' where id=s.id and revoked_at is null; end if;
end $$;

create or replace function public.create_customer_magic_order_link(requested_session_hash text,requested_slug text,requested_order_id uuid,requested_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype; e public.establishments%rowtype; o public.orders%rowtype; link_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();
  select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
  select * into o from public.orders where id=requested_order_id and customer_id in(select id from public.customers where organization_customer_id=s.organization_customer_id or id=s.customer_id) and establishment_id in(select id from public.establishments where coalesce(organization_id,id)=s.organization_id);
  if s.id is null or e.id is null or o.id is null or char_length(requested_token_hash)<32 then raise exception 'Pedido não autorizado.'; end if;
  insert into public.customer_magic_order_links(organization_id,establishment_id,customer_id,order_id,token_hash,expires_at) values(s.organization_id,o.establishment_id,o.customer_id,o.id,requested_token_hash,now()+interval '24 hours') returning id into link_id;
  insert into public.customer_portal_events(organization_id,establishment_id,customer_id,session_id,event_type,entity_type,entity_id) values(s.organization_id,o.establishment_id,s.customer_id,s.id,'magic_link_created','order',o.id);
  return jsonb_build_object('ok',true,'id',link_id,'expires_in',86400);
end $$;

create or replace function public.request_customer_phone_change(requested_session_hash text,requested_slug text,requested_destination text,requested_otp_hash text,requested_requester_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype; e public.establishments%rowtype; normalized text; challenge uuid; recent_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();
  select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
  normalized:=public.normalize_customer_phone(requested_destination);
  if s.id is null or e.id is null or normalized is null or char_length(normalized)<10 then raise exception 'Telefone inválido.'; end if;
  if exists(select 1 from public.customer_identities where organization_id=s.organization_id and identity_type in('phone','whatsapp') and value_normalized=normalized and customer_id<>s.customer_id and verified) then raise exception 'Este telefone já está associado a outra conta.'; end if;
  select count(*) into recent_count from public.customer_portal_otp_challenges where requester_hash=requested_requester_hash and created_at>now()-interval '15 minutes';
  if recent_count>=8 then raise exception 'Muitas tentativas. Aguarde antes de tentar novamente.'; end if;
  insert into public.customer_portal_otp_challenges(organization_id,establishment_id,customer_id,organization_customer_id,normalized_destination,purpose,otp_hash,requester_hash) values(s.organization_id,e.id,s.customer_id,s.organization_customer_id,normalized,'change_phone',requested_otp_hash,requested_requester_hash) returning id into challenge;
  return jsonb_build_object('challenge_id',challenge,'establishment_id',e.id,'destination',normalized,'expires_in',600);
end $$;

create or replace function public.verify_customer_phone_change(requested_session_hash text,requested_slug text,requested_challenge_id uuid,requested_otp_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.customer_portal_sessions%rowtype; e public.establishments%rowtype; ch public.customer_portal_otp_challenges%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into s from public.customer_portal_sessions where token_hash=requested_session_hash and revoked_at is null and expires_at>now();
  select * into e from public.establishments where slug=requested_slug and coalesce(organization_id,id)=s.organization_id and active;
  select * into ch from public.customer_portal_otp_challenges where id=requested_challenge_id and customer_id=s.customer_id and purpose='change_phone' for update;
  if s.id is null or e.id is null or ch.id is null or ch.consumed_at is not null or ch.expires_at<=now() or ch.attempts>=ch.max_attempts then raise exception 'Código inválido ou expirado.'; end if;
  if ch.otp_hash<>requested_otp_hash then update public.customer_portal_otp_challenges set attempts=attempts+1,blocked_until=case when attempts+1>=max_attempts then now()+interval '30 minutes' else blocked_until end where id=ch.id; raise exception 'Código inválido ou expirado.'; end if;
  update public.customer_identities set is_primary=false,updated_at=now() where customer_id=s.customer_id and identity_type in('phone','whatsapp');
  insert into public.customer_identities(customer_id,organization_id,establishment_id,identity_type,value_normalized,verified,is_primary,verification_source) values(s.customer_id,s.organization_id,e.id,'phone',ch.normalized_destination,true,true,'customer_portal_phone_change') on conflict(organization_id,identity_type,value_normalized) do update set customer_id=excluded.customer_id,verified=true,is_primary=true,updated_at=now();
  update public.customers set phone=ch.normalized_destination,phone_verified_at=now(),updated_at=now() where id=s.customer_id;
  update public.organization_customers set normalized_phone=ch.normalized_destination,updated_at=now() where id=s.organization_customer_id;
  update public.customer_portal_otp_challenges set consumed_at=now(),attempts=attempts+1 where id=ch.id;
  insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata) values(e.id,'customer_portal.phone_changed','customer',s.customer_id,jsonb_build_object('verified',true));
  return jsonb_build_object('ok',true,'message','Telefone alterado e verificado com segurança.');
end $$;

create or replace function public.get_customer_magic_order(requested_slug text,requested_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.customer_magic_order_links%rowtype; e public.establishments%rowtype; result jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
  select * into e from public.establishments where slug=requested_slug and active;
  select * into l from public.customer_magic_order_links where token_hash=requested_token_hash and organization_id=coalesce(e.organization_id,e.id) and revoked_at is null and expires_at>now() for update;
  if e.id is null or l.id is null then raise exception 'Link inválido ou expirado.'; end if;
  update public.customer_magic_order_links set last_used_at=now() where id=l.id;
  select jsonb_build_object('store_name',e.name,'accent_color',coalesce((select accent_color from public.customer_portal_configs where establishment_id=e.id),'#ff2b2b'),'order',jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,'total_cents',o.total_cents,'created_at',o.created_at,'items',(select coalesce(jsonb_agg(jsonb_build_object('name',oi.product_name,'quantity',oi.quantity,'total_cents',oi.total_cents)),'[]') from public.order_items oi where oi.order_id=o.id))) into result from public.orders o where o.id=l.order_id and o.customer_id=l.customer_id;
  return result;
end $$;

create or replace function private.customer_portal_order_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid; title text; body text;
begin
  if new.customer_id is null or old.status is not distinct from new.status then return new; end if;
  select coalesce(organization_id,id) into org from public.establishments where id=new.establishment_id;
  title:=case new.status when 'confirmed' then 'Pedido confirmado' when 'preparing' then 'Pedido em preparo' when 'ready' then 'Pedido pronto' when 'out_for_delivery' then 'Saiu para entrega' when 'completed' then 'Pedido entregue' when 'canceled' then 'Pedido cancelado' else 'Pedido atualizado' end;
  body:='Pedido #'||new.order_number||': '||title||'.';
  insert into public.customer_notifications(organization_id,establishment_id,customer_id,order_id,notification_type,title,body) values(org,new.establishment_id,new.customer_id,new.id,'order_status',title,body);
  return new;
end $$;
drop trigger if exists orders_customer_portal_notification on public.orders;
create trigger orders_customer_portal_notification after update of status on public.orders for each row execute function private.customer_portal_order_notification();

do $$ declare t text; begin
  foreach t in array array['customer_portal_configs','customer_portal_otp_challenges','customer_portal_sessions','customer_addresses','customer_favorites','customer_notification_preferences','customer_notifications','customer_privacy_requests','customer_support_requests','customer_magic_order_links','customer_portal_events'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create policy customer_portal_configs_admin on public.customer_portal_configs for all to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy customer_support_admin on public.customer_support_requests for select to authenticated using(private.has_role(establishment_id,array['owner','manager','attendant']::public.member_role[]));
create policy customer_privacy_admin on public.customer_privacy_requests for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));

revoke all on public.customer_portal_configs,public.customer_portal_otp_challenges,public.customer_portal_sessions,public.customer_addresses,public.customer_favorites,public.customer_notification_preferences,public.customer_notifications,public.customer_privacy_requests,public.customer_support_requests,public.customer_magic_order_links,public.customer_portal_events from public,anon,authenticated;
grant select,insert,update,delete on public.customer_portal_configs to authenticated;
grant select on public.customer_support_requests,public.customer_privacy_requests to authenticated;
grant select,insert,update,delete on public.customer_portal_configs,public.customer_portal_otp_challenges,public.customer_portal_sessions,public.customer_addresses,public.customer_favorites,public.customer_notification_preferences,public.customer_notifications,public.customer_privacy_requests,public.customer_support_requests,public.customer_magic_order_links,public.customer_portal_events to service_role;
grant usage,select on sequence public.customer_portal_events_id_seq to service_role;

revoke all on function public.request_customer_portal_otp(text,text,text,text,text),public.verify_customer_portal_otp(uuid,text,text,text,text),public.get_customer_portal_context(text,text),public.customer_portal_action(text,text,text,jsonb),public.prepare_customer_reorder(text,text,uuid),public.logout_customer_portal(text,boolean),public.create_customer_magic_order_link(text,text,uuid,text),public.get_customer_magic_order(text,text),public.request_customer_phone_change(text,text,text,text,text),public.verify_customer_phone_change(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.request_customer_portal_otp(text,text,text,text,text),public.verify_customer_portal_otp(uuid,text,text,text,text),public.get_customer_portal_context(text,text),public.customer_portal_action(text,text,text,jsonb),public.prepare_customer_reorder(text,text,uuid),public.logout_customer_portal(text,boolean),public.create_customer_magic_order_link(text,text,uuid,text),public.get_customer_magic_order(text,text),public.request_customer_phone_change(text,text,text,text,text),public.verify_customer_phone_change(text,text,uuid,text) to service_role;

-- Preserve access for existing subscribers; new plans remain configurable by Super Admin.
update public.plans set customer_portal_enabled=true,order_tracking_enabled=true,reorder_enabled=true,loyalty_portal_enabled=true,customer_coupons_enabled=true,updated_at=now() where active;
