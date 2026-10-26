-- MasterApp WhatsApp Phase 7: organizations, multi-unit operation and centralized management.
-- Existing establishments remain the operational store boundary and keep every historical id.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active','inactive')),
  timezone text not null default 'America/Sao_Paulo',
  loyalty_mode text not null default 'local' check (loyalty_mode in ('local','network')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.establishments
  add column organization_id uuid,
  add column branch_code text,
  add column unit_status text not null default 'active' check (unit_status in ('active','inactive','temporarily_closed')),
  add column timezone text not null default 'America/Sao_Paulo',
  add column latitude numeric(10,7),
  add column longitude numeric(10,7),
  add column capacity_level text not null default 'normal' check (capacity_level in ('normal','high','paused'));

-- One safe organization per legacy store. IDs are reused intentionally to preserve compatibility.
insert into public.organizations(id,name,slug,created_by)
select e.id,e.name,e.slug,(select m.user_id from public.establishment_members m where m.establishment_id=e.id and m.role='owner' order by m.created_at limit 1)
from public.establishments e on conflict(id) do nothing;

update public.establishments set organization_id=id where organization_id is null;
alter table public.establishments alter column organization_id set not null;
alter table public.establishments add constraint establishments_organization_id_fkey foreign key(organization_id) references public.organizations(id) on delete restrict;
create index establishments_organization_status_idx on public.establishments(organization_id,unit_status,active);

alter table public.organizations add column billing_establishment_id uuid references public.establishments(id) on delete set null;
update public.organizations o set billing_establishment_id=(select e.id from public.establishments e where e.organization_id=o.id order by e.created_at limit 1) where billing_establishment_id is null;

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','admin','supervisor','analyst','member')),
  all_stores boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,user_id)
);

create table public.organization_member_store_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(organization_id,establishment_id,user_id)
);

insert into public.organization_members(organization_id,user_id,role,all_stores)
select e.organization_id,m.user_id,
  case when bool_or(m.role='owner') then 'owner' when bool_or(m.role='manager') then 'supervisor' else 'member' end,
  bool_or(m.role='owner')
from public.establishment_members m join public.establishments e on e.id=m.establishment_id
where m.status='active' group by e.organization_id,m.user_id
on conflict(organization_id,user_id) do nothing;

insert into public.organization_member_store_access(organization_id,establishment_id,user_id)
select e.organization_id,e.id,m.user_id from public.establishment_members m join public.establishments e on e.id=m.establishment_id
where m.status='active' on conflict do nothing;

create table public.store_feature_flags (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  whatsapp_enabled boolean not null default true,
  ai_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  campaigns_enabled boolean not null default true,
  loyalty_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.store_feature_flags(establishment_id) select id from public.establishments on conflict do nothing;

create table public.store_service_areas (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  cep_prefixes text[] not null default '{}',
  neighborhoods text[] not null default '{}',
  fee_cents integer not null default 0 check(fee_cents>=0),
  estimated_min_minutes integer check(estimated_min_minutes is null or estimated_min_minutes>=0),
  estimated_max_minutes integer check(estimated_max_minutes is null or estimated_max_minutes>=0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index store_service_areas_lookup_idx on public.store_service_areas(establishment_id,active);

create table public.organization_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_phone text not null,
  name text not null default 'Cliente',
  email text,
  first_order_at timestamptz,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,normalized_phone)
);
alter table public.customers add column organization_customer_id uuid references public.organization_customers(id) on delete set null;
insert into public.organization_customers(organization_id,normalized_phone,name,email,first_order_at,last_order_at)
select e.organization_id,coalesce(nullif(c.normalized_phone,''),regexp_replace(c.phone,'\D','','g')),max(c.name),max(c.email),min(c.created_at),max(c.last_order_at)
from public.customers c join public.establishments e on e.id=c.establishment_id
group by e.organization_id,coalesce(nullif(c.normalized_phone,''),regexp_replace(c.phone,'\D','','g'))
on conflict(organization_id,normalized_phone) do update set last_order_at=greatest(public.organization_customers.last_order_at,excluded.last_order_at);
update public.customers c set organization_customer_id=oc.id
from public.establishments e,public.organization_customers oc
where e.id=c.establishment_id and oc.organization_id=e.organization_id and oc.normalized_phone=coalesce(nullif(c.normalized_phone,''),regexp_replace(c.phone,'\D','','g'));
create index customers_organization_customer_idx on public.customers(organization_customer_id,establishment_id);

create table public.organization_ai_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_config_version_id uuid references public.ai_config_versions(id) on delete set null,
  allow_store_override boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.organization_ai_settings(organization_id,default_config_version_id)
select o.id,(select v.id from public.ai_config_versions v join public.establishments e on e.id=v.establishment_id where e.organization_id=o.id and v.status='published' order by v.published_at desc nulls last limit 1)
from public.organizations o on conflict do nothing;

alter table public.ai_config_versions add column inherit_organization_defaults boolean not null default false;
alter table public.ai_knowledge_items add column organization_id uuid references public.organizations(id) on delete cascade, add column scope text not null default 'store' check(scope in ('organization','store'));
alter table public.ai_faqs add column organization_id uuid references public.organizations(id) on delete cascade, add column scope text not null default 'store' check(scope in ('organization','store'));
update public.ai_knowledge_items k set organization_id=e.organization_id from public.establishments e where e.id=k.establishment_id;
update public.ai_faqs f set organization_id=e.organization_id from public.establishments e where e.id=f.establishment_id;
create index ai_knowledge_org_scope_idx on public.ai_knowledge_items(organization_id,scope,status);
create index ai_faq_org_scope_idx on public.ai_faqs(organization_id,scope,status);

alter table public.crm_campaigns
  add column organization_id uuid references public.organizations(id) on delete cascade,
  add column campaign_scope text not null default 'store' check(campaign_scope in ('store','multi_store','organization')),
  add column target_establishment_ids uuid[] not null default '{}';
update public.crm_campaigns c set organization_id=e.organization_id,target_establishment_ids=array[c.establishment_id] from public.establishments e where e.id=c.establishment_id;
create index crm_campaigns_org_scope_idx on public.crm_campaigns(organization_id,campaign_scope,status,created_at desc);

create table public.organization_loyalty_accounts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organization_customer_id uuid not null references public.organization_customers(id) on delete cascade,
  balance integer not null default 0 check(balance>=0),
  lifetime_earned integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(organization_id,organization_customer_id)
);

alter table public.orders add column organization_id uuid references public.organizations(id) on delete restrict, add column store_id uuid references public.establishments(id) on delete restrict;
update public.orders o set organization_id=e.organization_id,store_id=o.establishment_id from public.establishments e where e.id=o.establishment_id;
alter table public.orders alter column organization_id set not null, alter column store_id set not null;
create index orders_organization_store_created_idx on public.orders(organization_id,store_id,created_at desc);

create or replace function private.sync_order_unit_scope() returns trigger language plpgsql set search_path='' as $$
declare org_id uuid;
begin
  select organization_id into org_id from public.establishments where id=new.establishment_id;
  if org_id is null then raise exception 'Unidade inválida.'; end if;
  if new.store_id is not null and new.store_id<>new.establishment_id then raise exception 'O pedido não pode misturar unidades.'; end if;
  if new.organization_id is not null and new.organization_id<>org_id then raise exception 'Organização incompatível com a unidade.'; end if;
  new.store_id:=new.establishment_id; new.organization_id:=org_id; return new;
end $$;
create trigger orders_sync_unit_scope before insert or update of establishment_id,store_id,organization_id on public.orders for each row execute function private.sync_order_unit_scope();

alter table public.whatsapp_connections
  add column organization_id uuid references public.organizations(id) on delete cascade,
  add column label text,
  add column is_primary boolean not null default true,
  add column routing_mode text not null default 'store' check(routing_mode in ('store','organization_selector'));
update public.whatsapp_connections c set organization_id=e.organization_id from public.establishments e where e.id=c.establishment_id;
alter table public.whatsapp_connections alter column organization_id set not null;
alter table public.whatsapp_connections drop constraint if exists whatsapp_connections_establishment_id_key;
create unique index whatsapp_one_primary_per_store_idx on public.whatsapp_connections(establishment_id) where is_primary;
create index whatsapp_connections_org_status_idx on public.whatsapp_connections(organization_id,status);

alter table public.whatsapp_conversations
  add column connection_id uuid references public.whatsapp_connections(id) on delete restrict,
  add column selected_store_id uuid references public.establishments(id) on delete restrict,
  add column routing_state jsonb not null default '{}';
update public.whatsapp_conversations c set connection_id=(select w.id from public.whatsapp_connections w where w.establishment_id=c.establishment_id order by w.is_primary desc,w.created_at limit 1),selected_store_id=c.establishment_id;
alter table public.whatsapp_conversations drop constraint if exists whatsapp_conversations_establishment_id_contact_id_key;
create unique index whatsapp_conversation_connection_contact_idx on public.whatsapp_conversations(establishment_id,connection_id,contact_id) where connection_id is not null;

create table public.whatsapp_store_selections (
  conversation_id uuid primary key references public.whatsapp_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete restrict,
  selection_source text check(selection_source in ('number','manual','cep','neighborhood','address','location')),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.organization_alerts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete cascade,
  alert_type text not null,
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  title text not null,
  detail text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index organization_alerts_open_idx on public.organization_alerts(organization_id,created_at desc) where resolved_at is null;

create or replace function private.has_organization_role(target_organization uuid,allowed_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organization_members m where m.organization_id=target_organization and m.user_id=(select auth.uid()) and m.active and (allowed_roles is null or m.role=any(allowed_roles)))
$$;
revoke all on function private.has_organization_role(uuid,text[]) from public,anon,authenticated;

create or replace function private.has_store_access(target_establishment uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.establishments e join public.organization_members m on m.organization_id=e.organization_id and m.user_id=(select auth.uid()) and m.active
    where e.id=target_establishment and (m.all_stores or exists(select 1 from public.organization_member_store_access a where a.organization_id=e.organization_id and a.establishment_id=e.id and a.user_id=m.user_id))
  ) or private.has_role(target_establishment,null)
$$;
revoke all on function private.has_store_access(uuid) from public,anon,authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_member_store_access enable row level security;
alter table public.store_feature_flags enable row level security;
alter table public.store_service_areas enable row level security;
alter table public.organization_customers enable row level security;
alter table public.organization_ai_settings enable row level security;
alter table public.organization_loyalty_accounts enable row level security;
alter table public.whatsapp_store_selections enable row level security;
alter table public.organization_alerts enable row level security;

create policy organizations_member_read on public.organizations for select to authenticated using(private.has_organization_role(id,null));
create policy organizations_admin_update on public.organizations for update to authenticated using(private.has_organization_role(id,array['owner','admin'])) with check(private.has_organization_role(id,array['owner','admin']));
create policy organization_members_read on public.organization_members for select to authenticated using(user_id=(select auth.uid()) or private.has_organization_role(organization_id,array['owner','admin','supervisor']));
create policy organization_members_admin on public.organization_members for all to authenticated using(private.has_organization_role(organization_id,array['owner','admin'])) with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_store_access_read on public.organization_member_store_access for select to authenticated using(user_id=(select auth.uid()) or private.has_organization_role(organization_id,array['owner','admin','supervisor']));
create policy organization_store_access_admin on public.organization_member_store_access for all to authenticated using(private.has_organization_role(organization_id,array['owner','admin'])) with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy store_flags_read on public.store_feature_flags for select to authenticated using(private.has_store_access(establishment_id));
create policy store_flags_admin on public.store_feature_flags for all to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy store_areas_read on public.store_service_areas for select to authenticated using(private.has_store_access(establishment_id));
create policy store_areas_admin on public.store_service_areas for all to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy organization_customers_read on public.organization_customers for select to authenticated using(private.has_organization_role(organization_id,array['owner','admin','supervisor','analyst']));
create policy organization_ai_read on public.organization_ai_settings for select to authenticated using(private.has_organization_role(organization_id,null));
create policy organization_ai_admin on public.organization_ai_settings for all to authenticated using(private.has_organization_role(organization_id,array['owner','admin'])) with check(private.has_organization_role(organization_id,array['owner','admin']));
create policy organization_loyalty_read on public.organization_loyalty_accounts for select to authenticated using(private.has_organization_role(organization_id,array['owner','admin','supervisor','analyst']));
create policy whatsapp_store_selection_read on public.whatsapp_store_selections for select to authenticated using(private.has_organization_role(organization_id,null));
create policy organization_alerts_read on public.organization_alerts for select to authenticated using(private.has_organization_role(organization_id,array['owner','admin','supervisor']));
create policy organization_alerts_update on public.organization_alerts for update to authenticated using(private.has_organization_role(organization_id,array['owner','admin','supervisor'])) with check(private.has_organization_role(organization_id,array['owner','admin','supervisor']));

revoke all on public.organizations,public.organization_members,public.organization_member_store_access,public.store_feature_flags,public.store_service_areas,public.organization_customers,public.organization_ai_settings,public.organization_loyalty_accounts,public.whatsapp_store_selections,public.organization_alerts from public,anon;
grant select on public.organizations,public.organization_members,public.organization_member_store_access,public.store_feature_flags,public.store_service_areas,public.organization_customers,public.organization_ai_settings,public.organization_loyalty_accounts,public.whatsapp_store_selections,public.organization_alerts to authenticated;
grant update on public.organizations,public.organization_ai_settings,public.organization_alerts to authenticated;
grant insert,update,delete on public.organization_members,public.organization_member_store_access,public.store_feature_flags,public.store_service_areas to authenticated;

create or replace function public.get_organization_unit_dashboard(requested_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_organization_role(requested_organization_id,array['owner','admin','supervisor','analyst']) then raise exception 'Sem permissão para a visão consolidada.'; end if;
  select jsonb_build_object(
    'organization',jsonb_build_object('id',o.id,'name',o.name,'loyalty_mode',o.loyalty_mode),
    'units',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'name',e.name,'slug',e.slug,'status',e.unit_status,'capacity',e.capacity_level,
      'open',coalesce(sm.store_open,false),'whatsapp_connected',exists(select 1 from public.whatsapp_connections wc where wc.establishment_id=e.id and wc.status='connected'),
      'active_orders',(select count(*) from public.orders x where x.establishment_id=e.id and x.status not in ('completed','canceled')),
      'waiting_conversations',(select count(*) from public.whatsapp_conversations c where c.establishment_id=e.id and c.status='waiting'),
      'sales_today_cents',(select coalesce(sum(x.total_cents),0) from public.orders x where x.establishment_id=e.id and x.status='completed' and x.created_at>=date_trunc('day',now() at time zone e.timezone) at time zone e.timezone)
    ) order by e.name) from public.establishments e left join public.service_modes sm on sm.establishment_id=e.id where e.organization_id=o.id and private.has_store_access(e.id)),'[]'::jsonb),
    'totals',jsonb_build_object(
      'orders_today',(select count(*) from public.orders x join public.establishments e on e.id=x.establishment_id where e.organization_id=o.id and private.has_store_access(e.id) and x.created_at>=current_date),
      'revenue_today_cents',(select coalesce(sum(x.total_cents),0) from public.orders x join public.establishments e on e.id=x.establishment_id where e.organization_id=o.id and private.has_store_access(e.id) and x.status='completed' and x.created_at>=current_date),
      'whatsapp_sales_today',(select count(*) from public.orders x join public.establishments e on e.id=x.establishment_id where e.organization_id=o.id and private.has_store_access(e.id) and x.source='whatsapp' and x.created_at>=current_date),
      'customers',(select count(*) from public.organization_customers oc where oc.organization_id=o.id)
    )
  ) into result from public.organizations o where o.id=requested_organization_id;
  return coalesce(result,'{}'::jsonb);
end $$;

create or replace function public.set_active_unit(requested_establishment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.establishments%rowtype;
begin
  if not private.has_store_access(requested_establishment_id) then raise exception 'Unidade não autorizada.'; end if;
  select * into e from public.establishments where id=requested_establishment_id;
  return jsonb_build_object('id',e.id,'name',e.name,'slug',e.slug,'organization_id',e.organization_id);
end $$;

create or replace function public.create_organization_store(requested_organization_id uuid,requested_name text,requested_slug text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare org public.organizations%rowtype; billing uuid; plan_limit integer; current_count integer; new_id uuid; final_slug text; source_sub public.subscriptions%rowtype;
begin
  if not private.has_organization_role(requested_organization_id,array['owner','admin']) then raise exception 'Sem permissão para criar unidade.'; end if;
  select * into org from public.organizations where id=requested_organization_id for update;
  billing:=org.billing_establishment_id;
  select p.max_establishments into plan_limit from public.subscriptions s join public.plans p on p.id=s.plan_id where s.establishment_id=billing;
  select count(*) into current_count from public.establishments where organization_id=requested_organization_id and unit_status<>'inactive';
  if plan_limit is not null and current_count>=plan_limit then raise exception 'Limite de unidades do plano atingido.'; end if;
  if nullif(btrim(requested_name),'') is null then raise exception 'Informe o nome da unidade.'; end if;
  final_slug:=coalesce(nullif(lower(regexp_replace(btrim(requested_slug),'[^a-z0-9]+','-','g')),''),lower(regexp_replace(btrim(requested_name),'[^a-z0-9]+','-','g')))||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6);
  insert into public.establishments(name,slug,organization_id,branch_code,onboarding_completed,active,unit_status)
  values(btrim(requested_name),final_slug,requested_organization_id,upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),false,true,'active') returning id into new_id;
  insert into public.establishment_members(establishment_id,user_id,role,status) values(new_id,(select auth.uid()),'owner','active');
  insert into public.organization_member_store_access(organization_id,establishment_id,user_id) values(requested_organization_id,new_id,(select auth.uid())) on conflict do nothing;
  insert into public.establishment_settings(establishment_id) values(new_id);
  insert into public.business_hours(establishment_id,weekday,opens_at,closes_at,closed) select new_id,d,'09:00','22:00',false from generate_series(0,6)d;
  insert into public.service_modes(establishment_id) values(new_id);
  insert into public.store_feature_flags(establishment_id) values(new_id);
  insert into public.ai_retention_settings(establishment_id) values(new_id) on conflict do nothing;
  select * into source_sub from public.subscriptions where establishment_id=billing;
  if source_sub.id is not null then insert into public.subscriptions(establishment_id,plan_id,status,billing_cycle,trial_ends_at,current_period_start,current_period_end) values(new_id,source_sub.plan_id,source_sub.status,source_sub.billing_cycle,source_sub.trial_ends_at,source_sub.current_period_start,source_sub.current_period_end); end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(new_id,(select auth.uid()),'organization.store_created','establishment',new_id,jsonb_build_object('organization_id',requested_organization_id));
  return new_id;
end $$;

create or replace function public.set_organization_store_status(requested_establishment_id uuid,requested_status text)
returns void language plpgsql security definer set search_path='' as $$
declare org_id uuid;
begin
  select organization_id into org_id from public.establishments where id=requested_establishment_id;
  if not private.has_organization_role(org_id,array['owner','admin']) or requested_status not in ('active','inactive','temporarily_closed') then raise exception 'Operação não autorizada.'; end if;
  update public.establishments set unit_status=requested_status,active=(requested_status='active'),updated_at=now() where id=requested_establishment_id;
  update public.service_modes set store_open=(requested_status='active') where establishment_id=requested_establishment_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'organization.store_status_changed','establishment',requested_establishment_id,jsonb_build_object('status',requested_status));
end $$;

create or replace function public.switch_whatsapp_cart_store(requested_cart_id uuid,requested_store_id uuid,confirmed_reset boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cart public.whatsapp_carts%rowtype; item_count integer; org_id uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into cart from public.whatsapp_carts where id=requested_cart_id for update;
  select organization_id into org_id from public.establishments where id=requested_store_id and unit_status='active';
  if cart.id is null or org_id<>(select organization_id from public.establishments where id=cart.establishment_id) then raise exception 'Unidade inválida para este carrinho.'; end if;
  select count(*) into item_count from public.whatsapp_cart_items where cart_id=cart.id;
  if item_count>0 and not confirmed_reset then return jsonb_build_object('confirmation_required',true,'current_store_id',cart.establishment_id,'requested_store_id',requested_store_id); end if;
  if item_count>0 then delete from public.whatsapp_cart_items where cart_id=cart.id; end if;
  update public.whatsapp_carts set establishment_id=requested_store_id,subtotal_cents=0,discount_cents=0,delivery_fee_cents=0,total_cents=0,state='browsing',context=context||jsonb_build_object('store_switched_at',now()) where id=cart.id;
  update public.whatsapp_conversations set selected_store_id=requested_store_id where id=cart.conversation_id;
  return jsonb_build_object('confirmation_required',false,'store_id',requested_store_id,'cart_reset',item_count>0);
end $$;

create or replace function public.list_eligible_organization_stores(requested_organization_id uuid,requested_cep text default null,requested_neighborhood text default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'slug',e.slug,'fee_cents',a.fee_cents,'estimated_min_minutes',a.estimated_min_minutes,'estimated_max_minutes',a.estimated_max_minutes,'capacity',e.capacity_level) order by a.estimated_max_minutes nulls last,a.fee_cents), '[]'::jsonb)
  from public.establishments e join public.store_feature_flags f on f.establishment_id=e.id and f.delivery_enabled
  join public.store_service_areas a on a.establishment_id=e.id and a.active
  left join public.service_modes sm on sm.establishment_id=e.id
  where e.organization_id=requested_organization_id and e.unit_status='active' and e.active and coalesce(sm.store_open,true)
    and (requested_cep is null or exists(select 1 from unnest(a.cep_prefixes)p where regexp_replace(requested_cep,'\D','','g') like regexp_replace(p,'\D','','g')||'%'))
    and (requested_neighborhood is null or exists(select 1 from unnest(a.neighborhoods)n where lower(n)=lower(btrim(requested_neighborhood))));
$$;

create or replace function public.configure_whatsapp_connection(
  requested_establishment_id uuid, requested_phone_number_id text, requested_waba_id text,
  requested_display_phone text, requested_verified_name text, requested_access_token text default null,
  requested_app_secret text default null, requested_verify_token text default null,
  requested_graph_api_version text default 'v23.0'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.whatsapp_connections%rowtype; access_id uuid; app_id uuid; verify_id uuid; org_id uuid;
begin
  if not private.has_whatsapp_permission(requested_establishment_id,'configure') then raise exception 'Sem permissão para configurar o WhatsApp.'; end if;
  if nullif(btrim(requested_phone_number_id),'') is null or nullif(btrim(requested_waba_id),'') is null then raise exception 'Informe o Phone Number ID e o WhatsApp Business Account ID.'; end if;
  select organization_id into org_id from public.establishments where id=requested_establishment_id;
  select * into saved from public.whatsapp_connections where establishment_id=requested_establishment_id and is_primary order by created_at limit 1 for update;
  access_id:=saved.access_token_secret_id; app_id:=saved.app_secret_id; verify_id:=saved.verify_token_secret_id;
  if nullif(btrim(requested_access_token),'') is not null then if access_id is null then select vault.create_secret(requested_access_token,'masterapp-whatsapp-'||requested_establishment_id||'-access') into access_id; else perform vault.update_secret(access_id,requested_access_token); end if; end if;
  if nullif(btrim(requested_app_secret),'') is not null then if app_id is null then select vault.create_secret(requested_app_secret,'masterapp-whatsapp-'||requested_establishment_id||'-app') into app_id; else perform vault.update_secret(app_id,requested_app_secret); end if; end if;
  if nullif(btrim(requested_verify_token),'') is not null then if verify_id is null then select vault.create_secret(requested_verify_token,'masterapp-whatsapp-'||requested_establishment_id||'-verify') into verify_id; else perform vault.update_secret(verify_id,requested_verify_token); end if; end if;
  if access_id is null or app_id is null or verify_id is null then raise exception 'Informe Access Token, App Secret e Verify Token.'; end if;
  if saved.id is null then
    insert into public.whatsapp_connections(establishment_id,organization_id,phone_number_id,whatsapp_business_account_id,display_phone_number,verified_name,status,webhook_status,access_token_secret_id,app_secret_id,verify_token_secret_id,graph_api_version,connected_at,is_primary,routing_mode)
    values(requested_establishment_id,org_id,btrim(requested_phone_number_id),btrim(requested_waba_id),nullif(btrim(requested_display_phone),''),nullif(btrim(requested_verified_name),''),'connected','pending',access_id,app_id,verify_id,coalesce(nullif(btrim(requested_graph_api_version),''),'v23.0'),now(),true,'store') returning * into saved;
  else
    update public.whatsapp_connections set phone_number_id=btrim(requested_phone_number_id),whatsapp_business_account_id=btrim(requested_waba_id),display_phone_number=nullif(btrim(requested_display_phone),''),verified_name=nullif(btrim(requested_verified_name),''),status='connected',access_token_secret_id=access_id,app_secret_id=app_id,verify_token_secret_id=verify_id,graph_api_version=coalesce(nullif(btrim(requested_graph_api_version),''),'v23.0'),connected_at=coalesce(connected_at,now()),disconnected_at=null,last_error=null where id=saved.id returning * into saved;
  end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'whatsapp.connection_configured','whatsapp_connection',saved.id,jsonb_build_object('phone_number_id',saved.phone_number_id,'organization_id',org_id));
  return jsonb_build_object('id',saved.id,'status',saved.status,'webhook_status',saved.webhook_status,'phone_number_id',saved.phone_number_id,'whatsapp_business_account_id',saved.whatsapp_business_account_id,'display_phone_number',saved.display_phone_number,'verified_name',saved.verified_name,'connected_at',saved.connected_at,'configured',true);
end $$;

create or replace function public.process_whatsapp_inbound_message(requested_connection_id uuid, requested_message_id text, requested_wa_id text, requested_profile_name text, requested_content text, requested_message_type text, requested_timestamp timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_connections%rowtype; contact_id uuid; conversation_id uuid; inserted_message_id uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into c from public.whatsapp_connections where id=requested_connection_id and status='connected';
  if c.id is null then raise exception 'Conexão ativa não encontrada.'; end if;
  insert into public.whatsapp_contacts(establishment_id,wa_id,phone_number,name,profile_name,first_message_at,last_message_at)
  values(c.establishment_id,requested_wa_id,requested_wa_id,nullif(btrim(requested_profile_name),''),nullif(btrim(requested_profile_name),''),requested_timestamp,requested_timestamp)
  on conflict(establishment_id,wa_id) do update set name=coalesce(excluded.name,public.whatsapp_contacts.name),profile_name=coalesce(excluded.profile_name,public.whatsapp_contacts.profile_name),last_message_at=greatest(public.whatsapp_contacts.last_message_at,excluded.last_message_at)
  returning id into contact_id;
  insert into public.whatsapp_conversations(establishment_id,contact_id,connection_id,selected_store_id,status,last_message_at)
  values(c.establishment_id,contact_id,c.id,case when c.routing_mode='store' then c.establishment_id else null end,'open',requested_timestamp)
  on conflict(establishment_id,connection_id,contact_id) where connection_id is not null do update set status=case when public.whatsapp_conversations.status='resolved' then 'open' else public.whatsapp_conversations.status end,last_message_at=greatest(public.whatsapp_conversations.last_message_at,excluded.last_message_at)
  returning id into conversation_id;
  insert into public.whatsapp_store_selections(conversation_id,organization_id,establishment_id,selection_source,confirmed_at)
  values(conversation_id,c.organization_id,case when c.routing_mode='store' then c.establishment_id else null end,case when c.routing_mode='store' then 'number' else null end,case when c.routing_mode='store' then now() else null end)
  on conflict(conversation_id) do nothing;
  insert into public.whatsapp_messages(establishment_id,conversation_id,contact_id,whatsapp_message_id,direction,message_type,content,status,message_timestamp)
  values(c.establishment_id,conversation_id,contact_id,requested_message_id,'inbound',coalesce(nullif(requested_message_type,''),'text'),requested_content,'received',requested_timestamp)
  on conflict(establishment_id,whatsapp_message_id) do nothing returning id into inserted_message_id;
  if inserted_message_id is not null then update public.whatsapp_conversations set unread_count=unread_count+1,last_message_id=inserted_message_id,last_message_preview=left(coalesce(requested_content,'['||requested_message_type||']'),180),last_message_at=requested_timestamp where id=conversation_id; end if;
  update public.whatsapp_connections set last_webhook_at=now(),webhook_status='verified',last_error=null where id=c.id;
  return inserted_message_id;
end $$;

revoke all on function public.get_organization_unit_dashboard(uuid),public.set_active_unit(uuid),public.create_organization_store(uuid,text,text),public.set_organization_store_status(uuid,text) from public,anon;
grant execute on function public.get_organization_unit_dashboard(uuid),public.set_active_unit(uuid),public.create_organization_store(uuid,text,text),public.set_organization_store_status(uuid,text) to authenticated;
revoke all on function public.switch_whatsapp_cart_store(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.switch_whatsapp_cart_store(uuid,uuid,boolean) to service_role;
revoke all on function public.list_eligible_organization_stores(uuid,text,text) from public,anon;
revoke all on function public.list_eligible_organization_stores(uuid,text,text) from authenticated;
grant execute on function public.list_eligible_organization_stores(uuid,text,text) to service_role;

insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
select e.id,null,'organization.legacy_store_migrated','establishment',e.id,jsonb_build_object('organization_id',e.organization_id,'compatibility','establishment_id preserved') from public.establishments e;
