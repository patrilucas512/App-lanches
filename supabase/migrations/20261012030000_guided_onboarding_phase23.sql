-- MasterApp Phase 23: guided onboarding, assisted migration and activation.
-- This layer only orchestrates existing organization/store modules; it never
-- creates a parallel company or duplicates operational configuration.

alter table public.organizations
  add column if not exists business_type text,
  add column if not exists operating_profile jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_feature_flags jsonb not null default '{"guided_onboarding_enabled":true,"data_import_enabled":true,"migration_assistant_enabled":true,"test_mode_enabled":true}'::jsonb,
  add column if not exists activated_at timestamptz,
  add column if not exists first_successful_order_at timestamptz;

alter table public.establishments
  add column if not exists onboarding_activated_at timestamptz;

alter table public.products add column if not exists migration_job_id uuid;
alter table public.customers add column if not exists migration_job_id uuid;
alter table public.inventory_items add column if not exists migration_job_id uuid;

create table public.onboarding_step_catalog(
  step_key text primary key,
  title text not null,
  description text not null,
  sort_order integer not null,
  required boolean not null default false,
  skippable boolean not null default true,
  entitlement_key text,
  dependency_keys text[] not null default '{}',
  route text,
  active boolean not null default true
);

insert into public.onboarding_step_catalog(step_key,title,description,sort_order,required,skippable,entitlement_key,dependency_keys,route) values
 ('business_profile','Perfil do negócio','Tipo de operação e necessidades principais.',10,true,false,null,'{}','/onboarding'),
 ('store_setup','Dados da loja','Nome, contato, endereço, fuso e moeda.',20,true,false,'stores','{}','/painel/configuracoes'),
 ('operating_hours','Horários','Funcionamento semanal da unidade.',30,true,false,null,array['store_setup'],'/painel/configuracoes'),
 ('menu','Cardápio','Produtos, categorias, modelo ou importação.',40,true,false,'products',array['store_setup'],'/painel/cardapio'),
 ('payments','Pagamentos','Formas aceitas e gateway opcional.',50,true,false,null,array['store_setup'],'/painel/configuracoes'),
 ('delivery','Delivery e retirada','Área, taxa, prazo e modalidades.',60,false,true,'delivery',array['store_setup'],'/painel/configuracoes'),
 ('team','Primeira equipe','Convites e perfis ligados ao RBAC real.',70,false,true,'team_members',array['store_setup'],'/painel/equipe'),
 ('whatsapp','WhatsApp','Conexão e teste de webhook.',80,false,true,'whatsapp_messages',array['store_setup'],'/painel/configuracoes#whatsapp'),
 ('ai_attendant','Atendente IA','Nome, estilo, saudação e simulador.',90,false,true,'ai_tokens',array['whatsapp'],'/painel/atendente-ia'),
 ('billing','Plano e cobrança','Plano, trial, contato e forma de pagamento.',100,true,false,null,'{}','/painel/assinatura'),
 ('fiscal','Fiscal','Perfil fiscal e emissão quando necessária.',110,false,true,null,array['store_setup'],'/painel/fiscal'),
 ('inventory','Estoque','Ingredientes, saldo e custo inicial.',120,false,true,'inventory',array['menu'],'/painel/estoque'),
 ('test_order','Primeiro pedido de teste','Simulação isolada sem cobrança, fiscal ou estoque.',130,true,false,null,array['menu','payments'],'/onboarding'),
 ('launch','Ativar loja','Check de saúde e abertura da operação.',140,true,false,null,array['store_setup','operating_hours','menu','payments','test_order'],'/onboarding')
on conflict(step_key) do update set title=excluded.title,description=excluded.description,sort_order=excluded.sort_order,required=excluded.required,skippable=excluded.skippable,entitlement_key=excluded.entitlement_key,dependency_keys=excluded.dependency_keys,route=excluded.route,active=true;

create table public.onboarding_sessions(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'in_progress' check(status in('not_started','in_progress','completed','skipped')),
  current_step text,
  progress_percent numeric(5,2) not null default 0 check(progress_percent between 0 and 100),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  skipped_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,establishment_id)
);

create table public.onboarding_steps(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.onboarding_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  step_key text not null references public.onboarding_step_catalog(step_key),
  status text not null default 'pending' check(status in('pending','in_progress','completed','skipped','blocked','not_applicable')),
  applicable boolean not null default true,
  required boolean not null default false,
  blocked_reason text,
  assigned_to uuid references auth.users(id) on delete set null,
  configured_by uuid references auth.users(id) on delete set null,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(session_id,step_key)
);

create table public.onboarding_events(
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete cascade,
  session_id uuid references public.onboarding_sessions(id) on delete cascade,
  event_type text not null check(event_type in('onboarding_started','onboarding_step_completed','onboarding_step_skipped','migration_started','migration_completed','test_order_completed','store_activated','recommendation_shown')),
  step_key text,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.onboarding_member_permissions(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_manage boolean not null default false,
  can_import boolean not null default false,
  can_activate boolean not null default false,
  can_manage_billing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,user_id)
);

create table public.onboarding_recommendations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete cascade,
  recommendation_key text not null,
  title text not null,
  body text not null,
  priority smallint not null default 50 check(priority between 1 and 100),
  route text,
  status text not null default 'active' check(status in('active','dismissed','completed')),
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,establishment_id,recommendation_key)
);

create table public.migration_jobs(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  migration_type text not null check(migration_type in('menu','customers','products','inventory','orders_history','suppliers','opening_balances')),
  source_type text not null check(source_type in('csv','xlsx','connector','store_clone','manual')),
  status text not null default 'preview' check(status in('uploaded','mapping','preview','validated','queued','processing','completed','partial','failed','cancelled','rolled_back')),
  source_name text not null,
  source_checksum text not null,
  source_metadata jsonb not null default '{}'::jsonb,
  column_mapping jsonb not null default '{}'::jsonb,
  preview_rows jsonb not null default '[]'::jsonb,
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  imported_rows integer not null default 0,
  ignored_rows integer not null default 0,
  failed_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  progress_percent numeric(5,2) not null default 0 check(progress_percent between 0 and 100),
  migration_cutoff_date date,
  can_rollback boolean not null default false,
  rollback_blocked_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,establishment_id,migration_type,source_checksum)
);

create table public.migration_rows(
  id bigint generated always as identity primary key,
  job_id uuid not null references public.migration_jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  row_number integer not null,
  fingerprint text not null,
  source_data jsonb not null,
  mapped_data jsonb not null default '{}'::jsonb,
  validation_errors text[] not null default '{}',
  status text not null default 'pending' check(status in('pending','valid','invalid','imported','ignored','duplicate','failed')),
  target_table text,
  target_id uuid,
  created_at timestamptz not null default now(),
  unique(job_id,fingerprint)
);

create table public.migration_logs(
  id bigint generated always as identity primary key,
  job_id uuid not null references public.migration_jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  level text not null default 'info' check(level in('info','warning','error')),
  event_type text not null,
  message text not null,
  row_number integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.historical_order_imports(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  migration_job_id uuid not null references public.migration_jobs(id) on delete restrict,
  external_order_id text,
  customer_name text,
  total_cents integer not null default 0,
  occurred_at timestamptz not null,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(migration_job_id,external_order_id)
);

create table public.migration_opening_balances(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  migration_job_id uuid references public.migration_jobs(id) on delete restrict,
  balance_type text not null check(balance_type in('cash','accounts_payable','accounts_receivable','inventory')),
  description text not null,
  amount_cents bigint not null,
  cutoff_date date not null,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.onboarding_test_orders(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  session_id uuid not null references public.onboarding_sessions(id) on delete cascade,
  status text not null default 'created' check(status in('created','kitchen','ready','delivered','cancelled')),
  fulfillment_type text not null default 'pickup' check(fulfillment_type in('pickup','delivery')),
  product_snapshot jsonb not null,
  timeline jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index onboarding_sessions_org_status_idx on public.onboarding_sessions(organization_id,status,last_activity_at desc);
create index onboarding_steps_session_status_idx on public.onboarding_steps(session_id,status);
create index onboarding_events_org_created_idx on public.onboarding_events(organization_id,created_at desc);
create index onboarding_recommendations_org_idx on public.onboarding_recommendations(organization_id,status,priority desc);
create index migration_jobs_org_status_idx on public.migration_jobs(organization_id,status,created_at desc);
create index migration_rows_job_status_idx on public.migration_rows(job_id,status,row_number);
create index migration_logs_job_idx on public.migration_logs(job_id,created_at);
create index historical_orders_org_date_idx on public.historical_order_imports(organization_id,occurred_at desc);

alter table public.products add constraint products_migration_job_fkey foreign key(migration_job_id) references public.migration_jobs(id) on delete set null;
alter table public.customers add constraint customers_migration_job_fkey foreign key(migration_job_id) references public.migration_jobs(id) on delete set null;
alter table public.inventory_items add constraint inventory_items_migration_job_fkey foreign key(migration_job_id) references public.migration_jobs(id) on delete set null;

create or replace function private.onboarding_can(target_org uuid,permission_key text default 'view') returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_superadmin() or exists(
   select 1 from public.organization_members m left join public.onboarding_member_permissions p on p.organization_id=m.organization_id and p.user_id=m.user_id
   where m.organization_id=target_org and m.user_id=(select auth.uid()) and m.active and (
     m.role in('owner','admin') or case permission_key when 'manage' then coalesce(p.can_manage,false) when 'import' then coalesce(p.can_import,false) when 'activate' then coalesce(p.can_activate,false) when 'billing' then coalesce(p.can_manage_billing,false) else true end
   )
 )
$$;

create or replace function public.start_or_resume_onboarding(requested_organization_id uuid,requested_establishment_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved public.onboarding_sessions%rowtype; entitlement jsonb; applicable boolean; rec record;
begin
 if not private.onboarding_can(requested_organization_id,'view') or not exists(select 1 from public.establishments where id=requested_establishment_id and organization_id=requested_organization_id) then raise exception 'Acesso negado ao onboarding'; end if;
 select * into saved from public.onboarding_sessions where organization_id=requested_organization_id and establishment_id=requested_establishment_id;
 if saved.id is null then
   insert into public.onboarding_sessions(organization_id,establishment_id,user_id,current_step) values(requested_organization_id,requested_establishment_id,(select auth.uid()),'business_profile') returning * into saved;
   insert into public.onboarding_events(organization_id,establishment_id,session_id,event_type,actor_user_id) values(requested_organization_id,requested_establishment_id,saved.id,'onboarding_started',(select auth.uid()));
 end if;
 for rec in select * from public.onboarding_step_catalog where active order by sort_order loop
   applicable:=true;
   if rec.entitlement_key is not null then
     entitlement:=public.saas_effective_entitlement(requested_organization_id,rec.entitlement_key);
     applicable:=coalesce((entitlement->>'enabled')::boolean,false);
   end if;
   if rec.step_key='delivery' then applicable:=applicable and coalesce((select (operating_profile->>'delivery')::boolean from public.organizations where id=requested_organization_id),true); end if;
   if rec.step_key='fiscal' then applicable:=coalesce((select p.fiscal_module_enabled from public.subscriptions s join public.plans p on p.id=s.plan_id where s.organization_id=requested_organization_id and s.status in('trialing','active','past_due') order by s.created_at desc limit 1),false); end if;
   insert into public.onboarding_steps(session_id,organization_id,establishment_id,step_key,status,applicable,required)
   values(saved.id,requested_organization_id,requested_establishment_id,rec.step_key,case when applicable then 'pending' else 'not_applicable' end,applicable,rec.required)
   on conflict(session_id,step_key) do update set applicable=excluded.applicable,required=excluded.required,status=case when excluded.applicable=false then 'not_applicable' when public.onboarding_steps.status='not_applicable' then 'pending' else public.onboarding_steps.status end,updated_at=now();
 end loop;
 update public.onboarding_sessions set status=case when status='not_started' then 'in_progress' else status end,last_activity_at=now(),updated_at=now() where id=saved.id;
 return saved.id;
end$$;

create or replace function public.refresh_onboarding_progress(requested_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype; total_count integer; done_count integer; next_step text;
begin
 select * into s from public.onboarding_sessions where id=requested_session_id;
 if s.id is null or not private.onboarding_can(s.organization_id,'view') then raise exception 'Sessão não encontrada'; end if;
 update public.onboarding_steps st set status='completed',completed_at=coalesce(completed_at,now()),configured_by=coalesce(configured_by,(select auth.uid())),updated_at=now()
 where st.session_id=s.id and st.status not in('completed','skipped','not_applicable') and (
   (st.step_key='business_profile' and exists(select 1 from public.organizations o where o.id=s.organization_id and o.business_type is not null)) or
   (st.step_key='store_setup' and exists(select 1 from public.establishment_settings es where es.establishment_id=s.establishment_id and jsonb_object_length(es.address)>0)) or
   (st.step_key='operating_hours' and exists(select 1 from public.business_hours h where h.establishment_id=s.establishment_id)) or
   (st.step_key='menu' and exists(select 1 from public.products p where p.establishment_id=s.establishment_id and p.active)) or
   (st.step_key='payments' and exists(select 1 from public.establishment_settings es where es.establishment_id=s.establishment_id and jsonb_array_length(es.payment_methods)>0)) or
   (st.step_key='delivery' and exists(select 1 from public.delivery_zones z where z.establishment_id=s.establishment_id and z.active)) or
   (st.step_key='team' and exists(select 1 from public.custom_staff_members m where m.establishment_id=s.establishment_id and m.status='active')) or
   (st.step_key='whatsapp' and exists(select 1 from public.whatsapp_connections w where w.establishment_id=s.establishment_id and w.status='connected')) or
   (st.step_key='ai_attendant' and exists(select 1 from public.ai_config_versions a where a.establishment_id=s.establishment_id and a.status='published')) or
   (st.step_key='billing' and exists(select 1 from public.subscriptions sub where sub.organization_id=s.organization_id and sub.status in('trialing','active','past_due'))) or
   (st.step_key='fiscal' and exists(select 1 from public.fiscal_profiles f where f.organization_id=s.organization_id and f.establishment_id=s.establishment_id)) or
   (st.step_key='inventory' and exists(select 1 from public.inventory_items i where i.establishment_id=s.establishment_id and i.active)) or
   (st.step_key='test_order' and exists(select 1 from public.onboarding_test_orders t where t.session_id=s.id and t.status='delivered')) or
   (st.step_key='launch' and exists(select 1 from public.establishments e where e.id=s.establishment_id and e.onboarding_completed))
 );
 update public.onboarding_steps st set status='blocked',blocked_reason='Conclua primeiro: '||array_to_string(c.dependency_keys,', '),updated_at=now()
 from public.onboarding_step_catalog c where st.session_id=s.id and st.step_key=c.step_key and st.applicable and st.status in('pending','in_progress','blocked') and exists(select 1 from unnest(c.dependency_keys) d where not exists(select 1 from public.onboarding_steps dep where dep.session_id=s.id and dep.step_key=d and dep.status in('completed','skipped','not_applicable')));
 update public.onboarding_steps st set status='pending',blocked_reason=null,updated_at=now() from public.onboarding_step_catalog c where st.session_id=s.id and st.step_key=c.step_key and st.status='blocked' and not exists(select 1 from unnest(c.dependency_keys) d where not exists(select 1 from public.onboarding_steps dep where dep.session_id=s.id and dep.step_key=d and dep.status in('completed','skipped','not_applicable')));
 select count(*),count(*) filter(where status in('completed','skipped')) into total_count,done_count from public.onboarding_steps where session_id=s.id and applicable;
 select step_key into next_step from public.onboarding_steps st join public.onboarding_step_catalog c using(step_key) where st.session_id=s.id and st.applicable and st.status in('pending','in_progress') order by c.sort_order limit 1;
 update public.onboarding_sessions set progress_percent=case when total_count=0 then 100 else round(done_count*100.0/total_count,2) end,current_step=next_step,last_activity_at=now(),updated_at=now() where id=s.id;
 update public.onboarding_recommendations r set status='completed',updated_at=now() from public.onboarding_steps st
 where r.organization_id=s.organization_id and r.establishment_id=s.establishment_id and r.recommendation_key=st.step_key and st.session_id=s.id and st.status in('completed','not_applicable');
 insert into public.onboarding_recommendations(organization_id,establishment_id,recommendation_key,title,body,priority,route)
 select s.organization_id,s.establishment_id,st.step_key,c.title,'Este recurso combina com o perfil da sua operação e pode ser configurado quando você quiser.',100-c.sort_order/2,c.route
 from public.onboarding_steps st join public.onboarding_step_catalog c using(step_key)
 where st.session_id=s.id and st.applicable and not st.required and st.status in('pending','in_progress','skipped')
 on conflict(organization_id,establishment_id,recommendation_key) do update set title=excluded.title,body=excluded.body,priority=excluded.priority,route=excluded.route,status=case when public.onboarding_recommendations.status='dismissed' then 'dismissed' else 'active' end,updated_at=now();
 return jsonb_build_object('session_id',s.id,'progress',case when total_count=0 then 100 else round(done_count*100.0/total_count,2) end,'current_step',next_step);
end$$;

create or replace function public.set_onboarding_step_status(requested_session_id uuid,requested_step text,requested_status text,requested_snapshot jsonb default '{}',requested_assignee uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype; catalog public.onboarding_step_catalog%rowtype;
begin
 select * into s from public.onboarding_sessions where id=requested_session_id; select * into catalog from public.onboarding_step_catalog where step_key=requested_step;
 if s.id is null or catalog.step_key is null or not private.onboarding_can(s.organization_id,'manage') then raise exception 'Acesso negado'; end if;
 if requested_status not in('pending','in_progress','completed','skipped') then raise exception 'Status inválido'; end if;
 if requested_status='skipped' and (catalog.required or not catalog.skippable) then raise exception 'Esta etapa é obrigatória'; end if;
 if requested_step='billing' and not private.onboarding_can(s.organization_id,'billing') then raise exception 'Sem permissão de cobrança'; end if;
 update public.onboarding_steps set status=requested_status,assigned_to=coalesce(requested_assignee,assigned_to),configured_by=case when requested_status='completed' then (select auth.uid()) else configured_by end,configuration_snapshot=configuration_snapshot||coalesce(requested_snapshot,'{}'),started_at=case when requested_status='in_progress' then coalesce(started_at,now()) else started_at end,completed_at=case when requested_status='completed' then now() else completed_at end,skipped_at=case when requested_status='skipped' then now() else skipped_at end,updated_at=now() where session_id=s.id and step_key=requested_step;
 if requested_status in('completed','skipped') then insert into public.onboarding_events(organization_id,establishment_id,session_id,event_type,step_key,actor_user_id,metadata) values(s.organization_id,s.establishment_id,s.id,case when requested_status='completed' then 'onboarding_step_completed' else 'onboarding_step_skipped' end,requested_step,(select auth.uid()),coalesce(requested_snapshot,'{}')); end if;
 perform public.refresh_onboarding_progress(s.id);
end$$;

create or replace function public.apply_onboarding_menu_template(requested_session_id uuid,requested_template text)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype; names text[]; item text; added integer:=0;
begin
 select * into s from public.onboarding_sessions where id=requested_session_id;
 if s.id is null or not private.onboarding_can(s.organization_id,'manage') then raise exception 'Acesso negado'; end if;
 names:=case requested_template when 'hamburgueria' then array['Hambúrgueres','Combos','Bebidas','Porções'] when 'pizzaria' then array['Pizzas','Bordas','Bebidas','Sobremesas'] when 'cafeteria' then array['Cafés','Lanches','Doces','Bebidas'] when 'acaiteria' then array['Açaís','Complementos','Combos','Bebidas'] else array['Destaques','Pratos','Bebidas','Sobremesas'] end;
 foreach item in array names loop if not exists(select 1 from public.categories where establishment_id=s.establishment_id and lower(name)=lower(item)) then insert into public.categories(establishment_id,name,active,sort_order) values(s.establishment_id,item,true,added*10); added:=added+1; end if; end loop;
 update public.onboarding_steps set status='in_progress',configuration_snapshot=configuration_snapshot||jsonb_build_object('template',requested_template,'categories_created',added),configured_by=(select auth.uid()),updated_at=now() where session_id=s.id and step_key='menu';
 return added;
end$$;

create or replace function public.create_onboarding_test_order(requested_session_id uuid,requested_fulfillment text default 'pickup')
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype; product_row public.products%rowtype; saved_id uuid;
begin
 select * into s from public.onboarding_sessions where id=requested_session_id;
 if s.id is null or not private.onboarding_can(s.organization_id,'manage') then raise exception 'Acesso negado'; end if;
 select * into product_row from public.products where establishment_id=s.establishment_id and active order by created_at limit 1;
 if product_row.id is null then raise exception 'Cadastre ao menos um produto ativo'; end if;
 insert into public.onboarding_test_orders(organization_id,establishment_id,session_id,status,fulfillment_type,product_snapshot,timeline,created_by,completed_at)
 values(s.organization_id,s.establishment_id,s.id,'delivered',case when requested_fulfillment='delivery' then 'delivery' else 'pickup' end,jsonb_build_object('id',product_row.id,'name',product_row.name,'price_cents',product_row.price_cents),jsonb_build_array(jsonb_build_object('status','created','at',now()),jsonb_build_object('status','kitchen','at',now()),jsonb_build_object('status','ready','at',now()),jsonb_build_object('status','delivered','at',now())),(select auth.uid()),now()) returning id into saved_id;
 insert into public.onboarding_events(organization_id,establishment_id,session_id,event_type,step_key,actor_user_id,metadata) values(s.organization_id,s.establishment_id,s.id,'test_order_completed','test_order',(select auth.uid()),jsonb_build_object('test_order_id',saved_id,'sandbox',true));
 perform public.refresh_onboarding_progress(s.id); return saved_id;
end$$;

create or replace function public.activate_store_from_onboarding(requested_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype; missing text[]:='{}';
begin
 select * into s from public.onboarding_sessions where id=requested_session_id;
 if s.id is null or not private.onboarding_can(s.organization_id,'activate') then raise exception 'Sem permissão para ativar'; end if;
 if not exists(select 1 from public.establishments where id=s.establishment_id and active) then missing:=array_append(missing,'unidade ativa'); end if;
 if not exists(select 1 from public.business_hours where establishment_id=s.establishment_id) then missing:=array_append(missing,'horários'); end if;
 if not exists(select 1 from public.products where establishment_id=s.establishment_id and active) then missing:=array_append(missing,'produto ativo'); end if;
 if not exists(select 1 from public.establishment_settings where establishment_id=s.establishment_id and jsonb_array_length(payment_methods)>0) then missing:=array_append(missing,'pagamento'); end if;
 if array_length(missing,1)>0 then return jsonb_build_object('ready',false,'missing',missing); end if;
 update public.establishments set onboarding_completed=true,public_menu_active=true,onboarding_activated_at=coalesce(onboarding_activated_at,now()),updated_at=now() where id=s.establishment_id;
 update public.organizations set activated_at=coalesce(activated_at,now()),updated_at=now() where id=s.organization_id;
 update public.onboarding_steps set status='completed',completed_at=now(),configured_by=(select auth.uid()),updated_at=now() where session_id=s.id and step_key='launch';
 update public.onboarding_sessions set status='completed',progress_percent=100,completed_at=now(),current_step=null,last_activity_at=now(),updated_at=now() where id=s.id;
 insert into public.onboarding_events(organization_id,establishment_id,session_id,event_type,step_key,actor_user_id) values(s.organization_id,s.establishment_id,s.id,'store_activated','launch',(select auth.uid()));
 return jsonb_build_object('ready',true,'store_id',s.establishment_id);
end$$;

create or replace function public.apply_migration_job(requested_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.migration_jobs%rowtype; r public.migration_rows%rowtype; category_id uuid; target uuid; imported integer:=0; duplicates integer:=0; failed integer:=0;
begin
 select * into j from public.migration_jobs where id=requested_job_id for update;
 if j.id is null or not private.onboarding_can(j.organization_id,'import') then raise exception 'Acesso negado à importação'; end if;
 if j.status not in('preview','validated','queued','partial','failed') then raise exception 'Job não pode ser processado neste estado'; end if;
 update public.migration_jobs set status='processing',started_at=coalesce(started_at,now()),progress_percent=1,updated_at=now() where id=j.id;
 for r in select * from public.migration_rows where job_id=j.id and status='valid' order by row_number loop
   begin target:=null;
     if j.migration_type in('menu','products') then
       select id into category_id from public.categories where establishment_id=j.establishment_id and lower(name)=lower(coalesce(nullif(r.mapped_data->>'category',''),'Importados')) limit 1;
       if category_id is null then insert into public.categories(establishment_id,name,active) values(j.establishment_id,coalesce(nullif(r.mapped_data->>'category',''),'Importados'),true) returning id into category_id; end if;
       select id into target from public.products where establishment_id=j.establishment_id and lower(name)=lower(r.mapped_data->>'product_name') and category_id=category_id limit 1;
       if target is null then insert into public.products(establishment_id,category_id,name,description,price_cents,active,migration_job_id) values(j.establishment_id,category_id,r.mapped_data->>'product_name',r.mapped_data->>'description',greatest(0,coalesce((r.mapped_data->>'price_cents')::integer,0)),false,j.id) returning id into target; else duplicates:=duplicates+1; end if;
     elsif j.migration_type='customers' then
       select id into target from public.customers where establishment_id=j.establishment_id and regexp_replace(phone,'\D','','g')=regexp_replace(r.mapped_data->>'phone','\D','','g') limit 1;
       if target is null then insert into public.customers(establishment_id,name,phone,email,marketing_status,migration_job_id) values(j.establishment_id,coalesce(nullif(r.mapped_data->>'name',''),'Cliente'),r.mapped_data->>'phone',nullif(r.mapped_data->>'email',''),'unknown',j.id) returning id into target; else duplicates:=duplicates+1; end if;
     elsif j.migration_type='inventory' then
       select id into target from public.inventory_items where establishment_id=j.establishment_id and lower(name)=lower(r.mapped_data->>'name') limit 1;
       if target is null then insert into public.inventory_items(establishment_id,organization_id,name,unit,balance,average_cost_cents,active,migration_job_id) values(j.establishment_id,j.organization_id,r.mapped_data->>'name',coalesce(nullif(r.mapped_data->>'unit',''),'un'),coalesce((r.mapped_data->>'quantity')::numeric,0),coalesce((r.mapped_data->>'cost_cents')::numeric,0),true,j.id) returning id into target; else duplicates:=duplicates+1; end if;
     elsif j.migration_type='orders_history' then
       insert into public.historical_order_imports(organization_id,establishment_id,migration_job_id,external_order_id,customer_name,total_cents,occurred_at,source_data) values(j.organization_id,j.establishment_id,j.id,coalesce(nullif(r.mapped_data->>'external_id',''),r.row_number::text),r.mapped_data->>'customer_name',coalesce((r.mapped_data->>'total_cents')::integer,0),coalesce((r.mapped_data->>'occurred_at')::timestamptz,now()),r.source_data) on conflict do nothing returning id into target;
       if target is null then duplicates:=duplicates+1; end if;
     else
       update public.migration_rows set status='ignored' where id=r.id; continue;
     end if;
     update public.migration_rows set status=case when target is null then 'duplicate' else 'imported' end,target_id=target,target_table=j.migration_type where id=r.id;
     if target is not null then imported:=imported+1; end if;
   exception when others then failed:=failed+1; update public.migration_rows set status='failed',validation_errors=array[sqlerrm] where id=r.id; insert into public.migration_logs(job_id,organization_id,level,event_type,message,row_number) values(j.id,j.organization_id,'error','row_failed',sqlerrm,r.row_number); end;
 end loop;
 update public.migration_jobs set status=case when failed>0 then 'partial' else 'completed' end,processed_rows=total_rows,imported_rows=imported,duplicate_rows=duplicates,failed_rows=failed,progress_percent=100,can_rollback=(imported>0),completed_at=now(),updated_at=now() where id=j.id;
 insert into public.migration_logs(job_id,organization_id,event_type,message,metadata) values(j.id,j.organization_id,'migration_completed','Importação concluída',jsonb_build_object('imported',imported,'duplicates',duplicates,'failed',failed));
 insert into public.onboarding_events(organization_id,establishment_id,event_type,actor_user_id,metadata) values(j.organization_id,j.establishment_id,'migration_completed',(select auth.uid()),jsonb_build_object('job_id',j.id,'type',j.migration_type));
 return jsonb_build_object('imported',imported,'duplicates',duplicates,'failed',failed);
end$$;

create or replace function public.rollback_migration_job(requested_job_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.migration_jobs%rowtype; changed boolean:=false;
begin
 select * into j from public.migration_jobs where id=requested_job_id for update;
 if j.id is null or not private.onboarding_can(j.organization_id,'import') then raise exception 'Acesso negado'; end if;
 if not j.can_rollback or j.status not in('completed','partial') then raise exception 'Rollback indisponível'; end if;
 if exists(select 1 from public.products where migration_job_id=j.id and updated_at>j.completed_at) or exists(select 1 from public.customers where migration_job_id=j.id and updated_at>j.completed_at) or exists(select 1 from public.inventory_items where migration_job_id=j.id and updated_at>j.completed_at) then update public.migration_jobs set can_rollback=false,rollback_blocked_reason='Dados importados já foram modificados',updated_at=now() where id=j.id; return false; end if;
 delete from public.products where migration_job_id=j.id; changed:=changed or found;
 delete from public.customers where migration_job_id=j.id; changed:=changed or found;
 delete from public.inventory_items where migration_job_id=j.id; changed:=changed or found;
 delete from public.historical_order_imports where migration_job_id=j.id; changed:=changed or found;
 update public.migration_jobs set status='rolled_back',can_rollback=false,rolled_back_at=now(),updated_at=now() where id=j.id;
 insert into public.migration_logs(job_id,organization_id,event_type,message) values(j.id,j.organization_id,'rollback_completed','Lote desfeito com segurança.'); return changed;
end$$;

do $$declare t text;begin foreach t in array array['onboarding_step_catalog','onboarding_sessions','onboarding_steps','onboarding_events','onboarding_member_permissions','onboarding_recommendations','migration_jobs','migration_rows','migration_logs','historical_order_imports','migration_opening_balances','onboarding_test_orders'] loop execute format('alter table public.%I enable row level security',t);end loop;end$$;

create policy onboarding_catalog_read on public.onboarding_step_catalog for select to authenticated using(true);
create policy onboarding_sessions_read on public.onboarding_sessions for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy onboarding_steps_read on public.onboarding_steps for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy onboarding_events_read on public.onboarding_events for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy onboarding_permissions_manage on public.onboarding_member_permissions for all to authenticated using(private.onboarding_can(organization_id,'manage')) with check(private.onboarding_can(organization_id,'manage'));
create policy onboarding_recommendations_read on public.onboarding_recommendations for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy migration_jobs_read on public.migration_jobs for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy migration_rows_read on public.migration_rows for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy migration_logs_read on public.migration_logs for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy historical_orders_read on public.historical_order_imports for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy opening_balances_read on public.migration_opening_balances for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy test_orders_read on public.onboarding_test_orders for select to authenticated using(private.onboarding_can(organization_id,'view'));
create policy onboarding_superadmin_catalog on public.onboarding_step_catalog for all to authenticated using(private.is_superadmin()) with check(private.is_superadmin());
create policy onboarding_superadmin_sessions on public.onboarding_sessions for select to authenticated using(private.is_superadmin());

grant select on public.onboarding_step_catalog,public.onboarding_sessions,public.onboarding_steps,public.onboarding_events,public.onboarding_member_permissions,public.onboarding_recommendations,public.migration_jobs,public.migration_rows,public.migration_logs,public.historical_order_imports,public.migration_opening_balances,public.onboarding_test_orders to authenticated;
grant all on public.onboarding_step_catalog,public.onboarding_sessions,public.onboarding_steps,public.onboarding_events,public.onboarding_member_permissions,public.onboarding_recommendations,public.migration_jobs,public.migration_rows,public.migration_logs,public.historical_order_imports,public.migration_opening_balances,public.onboarding_test_orders to service_role;
grant usage,select on all sequences in schema public to service_role;

revoke all on function private.onboarding_can(uuid,text) from public,anon,authenticated;
grant execute on function private.onboarding_can(uuid,text) to authenticated,service_role;
revoke all on function public.start_or_resume_onboarding(uuid,uuid),public.refresh_onboarding_progress(uuid),public.set_onboarding_step_status(uuid,text,text,jsonb,uuid),public.apply_onboarding_menu_template(uuid,text),public.create_onboarding_test_order(uuid,text),public.activate_store_from_onboarding(uuid),public.apply_migration_job(uuid),public.rollback_migration_job(uuid) from public,anon;
grant execute on function public.start_or_resume_onboarding(uuid,uuid),public.refresh_onboarding_progress(uuid),public.set_onboarding_step_status(uuid,text,text,jsonb,uuid),public.apply_onboarding_menu_template(uuid,text),public.create_onboarding_test_order(uuid,text),public.activate_store_from_onboarding(uuid),public.apply_migration_job(uuid),public.rollback_migration_job(uuid) to authenticated,service_role;

create or replace function private.capture_first_successful_order() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.status='completed' and old.status is distinct from new.status then update public.organizations set first_successful_order_at=coalesce(first_successful_order_at,now()),updated_at=now() where id=new.organization_id; end if; return new; end$$;
drop trigger if exists orders_first_successful_activation on public.orders;
create trigger orders_first_successful_activation after update of status on public.orders for each row execute function private.capture_first_successful_order();
revoke all on function private.capture_first_successful_order() from public,anon,authenticated;
