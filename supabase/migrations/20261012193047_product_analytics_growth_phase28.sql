-- Fase 28: product analytics do SaaS, separado dos analytics operacionais.
-- quality: allow-nonconcurrent-index reason=new-empty-quality-tables
alter table public.organizations add column if not exists analytics_enabled boolean not null default true;
alter table public.organizations add column if not exists acquisition_attribution jsonb not null default '{}'::jsonb;

alter table public.plans add column if not exists product_analytics_enabled boolean not null default false;
alter table public.plans add column if not exists growth_engine_enabled boolean not null default false;
alter table public.plans add column if not exists experiments_enabled boolean not null default false;
alter table public.plans add column if not exists lifecycle_messaging_enabled boolean not null default false;
alter table public.plans add column if not exists customer_health_enabled boolean not null default false;

create table if not exists public.product_event_registry (
  event_name text primary key,
  schema_version integer not null default 1 check(schema_version>0),
  category text not null check(category in('acquisition','activation','adoption','engagement','billing','support','lifecycle','experiment')),
  description text not null,
  allowed_properties text[] not null default '{}',
  essential boolean not null default false,
  active boolean not null default true,
  retention_days integer not null default 365 check(retention_days between 30 and 2555),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.product_event_ingestion_queue (
  id uuid primary key default gen_random_uuid(), event_id uuid not null unique,
  event_name text not null references public.product_event_registry(event_name),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  store_id uuid references public.establishments(id) on delete set null,
  occurred_at timestamptz not null default now(), properties jsonb not null default '{}',
  source text not null default 'application', release_version text,
  schema_version integer not null default 1, correlation_id text,
  status text not null default 'pending' check(status in('pending','processing','processed','rejected','failed')),
  attempts integer not null default 0, last_error text, processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(), event_id uuid not null unique,
  event_name text not null references public.product_event_registry(event_name),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  store_id uuid references public.establishments(id) on delete set null,
  occurred_at timestamptz not null, properties jsonb not null default '{}',
  source text not null, release_version text, schema_version integer not null,
  correlation_id text, created_at timestamptz not null default now()
);

create table if not exists public.product_funnel_definitions (
 id uuid primary key default gen_random_uuid(), funnel_key text not null unique, name text not null,
 description text, steps jsonb not null check(jsonb_typeof(steps)='array'), activation_window_days integer not null default 30,
 active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.product_activation_definitions (
 id uuid primary key default gen_random_uuid(), definition_key text not null unique, name text not null,
 criteria jsonb not null, weights jsonb not null default '{}', threshold numeric(5,2) not null default 70,
 active boolean not null default true, valid_from timestamptz not null default now(), valid_to timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.product_feature_catalog (
 feature_key text primary key, name text not null, discovery_event text references public.product_event_registry(event_name),
 configured_event text references public.product_event_registry(event_name), first_use_event text references public.product_event_registry(event_name),
 recurring_event text references public.product_event_registry(event_name), active boolean not null default true
);
create table if not exists public.product_organization_daily_metrics (
 organization_id uuid not null references public.organizations(id) on delete cascade, metric_date date not null,
 meaningful_actions integer not null default 0, active_users integer not null default 0, active_stores integer not null default 0,
 orders_processed integer not null default 0, support_tickets integer not null default 0, failed_payments integer not null default 0,
 features_used text[] not null default '{}', revenue_cents bigint not null default 0, updated_at timestamptz not null default now(),
 primary key(organization_id,metric_date)
);
create table if not exists public.product_cohort_metrics (
 cohort_month date not null, dimension_key text not null default 'all', dimension_value text not null default 'all',
 age_days integer not null check(age_days in(1,7,30,60,90)), cohort_size integer not null default 0,
 retained_organizations integer not null default 0, retention_percent numeric(7,2) not null default 0,
 calculated_at timestamptz not null default now(), primary key(cohort_month,dimension_key,dimension_value,age_days)
);
create table if not exists public.customer_health_scores (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 total_score numeric(5,2) not null default 0, risk_level text not null default 'unknown' check(risk_level in('healthy','attention','at_risk','critical','unknown')),
 activation_score numeric(5,2) not null default 0, adoption_score numeric(5,2) not null default 0,
 usage_score numeric(5,2) not null default 0, support_score numeric(5,2) not null default 0,
 billing_score numeric(5,2) not null default 0, onboarding_score numeric(5,2) not null default 0,
 explanation jsonb not null default '{}', estimated boolean not null default true,
 last_meaningful_activity_at timestamptz, calculated_at timestamptz not null default now()
);
create table if not exists public.growth_opportunities (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 opportunity_type text not null check(opportunity_type in('activation','retention','upgrade','addon','success_outreach','trial_risk')),
 title text not null, reason text not null, evidence jsonb not null default '{}', priority integer not null default 50,
 status text not null default 'open' check(status in('open','snoozed','accepted','dismissed','completed')),
 suggested_action text, cooldown_until timestamptz, assigned_to uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists growth_open_unique on public.growth_opportunities(organization_id,opportunity_type) where status='open';

create table if not exists public.saas_lifecycle_campaigns (
 id uuid primary key default gen_random_uuid(), name text not null, lifecycle_stage text not null,
 channel text not null check(channel in('in_app','email','internal_notification')),
 message_type text not null check(message_type in('tooltip','banner','modal','checklist','notification','email')),
 targeting_rules jsonb not null default '{}', content jsonb not null default '{}', frequency_cap integer not null default 1,
 frequency_window_days integer not null default 30, status text not null default 'draft' check(status in('draft','active','paused','archived')),
 requires_consent boolean not null default false, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.saas_lifecycle_deliveries (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.saas_lifecycle_campaigns(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid references auth.users(id) on delete set null,
 status text not null default 'eligible' check(status in('eligible','shown','clicked','dismissed','converted','suppressed')),
 assigned_at timestamptz not null default now(), shown_at timestamptz, dismissed_at timestamptz, converted_at timestamptz,
 metadata jsonb not null default '{}'
);
create index if not exists lifecycle_delivery_frequency_idx on public.saas_lifecycle_deliveries(campaign_id,organization_id,assigned_at desc);

create table if not exists public.product_experiments (
 id uuid primary key default gen_random_uuid(), experiment_key text not null unique, name text not null, hypothesis text not null,
 audience jsonb not null default '{}', primary_metric text not null, guardrail_metrics text[] not null default '{}',
 assignment_level text not null default 'organization' check(assignment_level in('organization','user')),
 start_at timestamptz, end_at timestamptz, status text not null default 'draft' check(status in('draft','scheduled','running','paused','completed','cancelled')),
 feature_flag_key text, minimum_sample_size integer not null default 100, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.product_experiment_variants (
 id uuid primary key default gen_random_uuid(), experiment_id uuid not null references public.product_experiments(id) on delete cascade,
 variant_key text not null, name text not null, weight integer not null check(weight between 1 and 100), configuration jsonb not null default '{}',
 unique(experiment_id,variant_key)
);
create table if not exists public.product_experiment_assignments (
 id uuid primary key default gen_random_uuid(), experiment_id uuid not null references public.product_experiments(id) on delete cascade,
 variant_id uuid not null references public.product_experiment_variants(id) on delete cascade,
 organization_id uuid references public.organizations(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade,
 assignment_key text not null, assigned_at timestamptz not null default now(), unique(experiment_id,assignment_key)
);
create table if not exists public.product_experiment_metrics (
 experiment_id uuid not null references public.product_experiments(id) on delete cascade,
 variant_id uuid not null references public.product_experiment_variants(id) on delete cascade,
 metric_key text not null, sample_size integer not null default 0, conversions integer not null default 0,
 metric_value numeric not null default 0, uncertainty numeric, calculated_at timestamptz not null default now(),
 primary key(experiment_id,variant_id,metric_key)
);
create table if not exists public.customer_success_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 opportunity_id uuid references public.growth_opportunities(id) on delete set null, title text not null, reason text not null,
 status text not null default 'open' check(status in('open','in_progress','completed','cancelled')),
 owner_user_id uuid references auth.users(id) on delete set null, due_at timestamptz, created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.product_data_quality_alerts (
 id uuid primary key default gen_random_uuid(), alert_type text not null check(alert_type in('event_stopped','volume_drop','invalid_schema','high_duplication','processing_backlog')),
 event_name text, severity text not null default 'warning' check(severity in('info','warning','critical')),
 title text not null, details jsonb not null default '{}', status text not null default 'open' check(status in('open','acknowledged','resolved')),
 detected_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.product_analytics_permissions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 product_analytics_view boolean not null default false, growth_view boolean not null default false, growth_manage boolean not null default false,
 experiments_view boolean not null default false, experiments_manage boolean not null default false, customer_success_view boolean not null default false,
 updated_at timestamptz not null default now()
);

do $$ declare t text; begin foreach t in array array['product_event_registry','product_event_ingestion_queue','product_events','product_funnel_definitions','product_activation_definitions','product_feature_catalog','product_organization_daily_metrics','product_cohort_metrics','customer_health_scores','growth_opportunities','saas_lifecycle_campaigns','saas_lifecycle_deliveries','product_experiments','product_experiment_variants','product_experiment_assignments','product_experiment_metrics','customer_success_tasks','product_data_quality_alerts','product_analytics_permissions'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['product_event_registry','product_event_ingestion_queue','product_events','product_funnel_definitions','product_activation_definitions','product_feature_catalog','product_organization_daily_metrics','product_cohort_metrics','customer_health_scores','growth_opportunities','saas_lifecycle_campaigns','saas_lifecycle_deliveries','product_experiments','product_experiment_variants','product_experiment_assignments','product_experiment_metrics','customer_success_tasks','product_data_quality_alerts','product_analytics_permissions'] loop execute format('create policy %I on public.%I for all to authenticated using((select private.is_superadmin())) with check((select private.is_superadmin()))','product_analytics_superadmin_'||t,t); end loop; end $$;

create index if not exists product_events_org_time_idx on public.product_events(organization_id,occurred_at desc);
create index if not exists product_events_name_time_idx on public.product_events(event_name,occurred_at desc);
create index if not exists product_events_release_idx on public.product_events(release_version,occurred_at desc) where release_version is not null;
create index if not exists product_event_queue_status_idx on public.product_event_ingestion_queue(status,created_at);
create index if not exists product_events_store_idx on public.product_events(store_id) where store_id is not null;
create index if not exists product_events_user_idx on public.product_events(user_id) where user_id is not null;
create index if not exists health_risk_idx on public.customer_health_scores(risk_level,total_score);
create index if not exists growth_org_idx on public.growth_opportunities(organization_id,status,priority desc);
create index if not exists cs_tasks_org_idx on public.customer_success_tasks(organization_id,status);
create index if not exists experiment_assignment_org_idx on public.product_experiment_assignments(organization_id) where organization_id is not null;

insert into public.product_event_registry(event_name,category,description,allowed_properties,essential) values
('account_created','acquisition','Conta SaaS criada',array['channel','business_type','utm_source','utm_medium','utm_campaign'],true),
('onboarding_started','activation','Onboarding iniciado',array['version'],false),
('onboarding_step_completed','activation','Etapa do onboarding concluída',array['step_key','progress_percent'],false),
('store_created','activation','Unidade criada',array['business_type'],true),
('product_created','activation','Primeiro produto criado',array['first'],false),
('menu_published','activation','Cardápio publicado',array['first'],false),
('first_order_received','activation','Primeiro pedido válido recebido',array['source','fulfillment_type'],true),
('core_action_performed','engagement','Ação significativa executada',array['action','feature'],false),
('whatsapp_connected','adoption','WhatsApp conectado',array['provider'],false),
('ai_enabled','adoption','IA ativada',array['mode'],false),
('first_ai_order','adoption','Primeiro pedido por IA',array['channel'],false),
('first_campaign_created','adoption','Primeira campanha criada',array['channel'],false),
('feature_discovered','adoption','Recurso descoberto',array['feature_key'],false),
('feature_configured','adoption','Recurso configurado',array['feature_key'],false),
('feature_used','adoption','Recurso utilizado',array['feature_key','action'],false),
('first_invoice_paid','billing','Primeira fatura SaaS paga',array['plan_code','billing_cycle','amount_cents'],true),
('addon_activated','billing','Add-on ativado',array['addon_key'],true),
('plan_upgraded','billing','Plano superior contratado',array['from_plan','to_plan'],true),
('plan_downgraded','billing','Plano reduzido',array['from_plan','to_plan'],true),
('subscription_cancelled','billing','Assinatura cancelada',array['reason_category','voluntary'],true),
('payment_failed','billing','Falha de pagamento SaaS',array['provider','attempt'],true),
('support_ticket_created','support','Chamado SaaS criado',array['category','priority'],true),
('upgrade_viewed','lifecycle','Recomendação de upgrade visualizada',array['reason','recommended_plan'],false),
('upgrade_checkout_started','billing','Checkout de upgrade iniciado',array['from_plan','to_plan'],true),
('upgrade_completed','billing','Upgrade concluído',array['from_plan','to_plan'],true),
('experiment_exposure','experiment','Exposição a variante',array['experiment_key','variant_key'],false)
on conflict(event_name) do update set description=excluded.description,allowed_properties=excluded.allowed_properties,essential=excluded.essential,active=true;

insert into public.product_funnel_definitions(funnel_key,name,description,steps) values
('saas_activation','Ativação do MasterApp','Do cadastro ao primeiro valor','["account_created","onboarding_started","store_created","menu_published","first_order_received","first_invoice_paid"]'::jsonb),
('upgrade','Conversão de upgrade','Da descoberta à conclusão','["upgrade_viewed","upgrade_checkout_started","upgrade_completed"]'::jsonb)
on conflict(funnel_key) do nothing;
insert into public.product_activation_definitions(definition_key,name,criteria,weights,threshold) values
('default_v1','Ativação padrão v1','{"required":["store_created","menu_published","first_order_received"]}'::jsonb,'{"store_created":20,"product_created":15,"menu_published":25,"first_order_received":40}'::jsonb,70)
on conflict(definition_key) do nothing;
insert into public.product_feature_catalog(feature_key,name,discovery_event,configured_event,first_use_event,recurring_event) values
('whatsapp','WhatsApp','feature_discovered','whatsapp_connected','feature_used','core_action_performed'),('ai','Atendimento por IA','feature_discovered','ai_enabled','first_ai_order','core_action_performed'),
('inventory','Estoque','feature_discovered','feature_configured','feature_used','core_action_performed'),('finance','Financeiro','feature_discovered','feature_configured','feature_used','core_action_performed'),
('reservations','Reservas','feature_discovered','feature_configured','feature_used','core_action_performed'),('crm','CRM','feature_discovered','feature_configured','first_campaign_created','core_action_performed'),
('voice','Voz','feature_discovered','feature_configured','feature_used','core_action_performed'),('api','API','feature_discovered','feature_configured','feature_used','core_action_performed'),
('fiscal','Fiscal','feature_discovered','feature_configured','feature_used','core_action_performed') on conflict(feature_key) do nothing;

create or replace function private.enqueue_product_analytics_event(p_event text,p_org uuid,p_user uuid,p_store uuid,p_properties jsonb,p_source text,p_release text,p_correlation text,p_event_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path='' as $$declare allowed text[];clean jsonb:='{}'::jsonb;k text;begin
 select allowed_properties into allowed from public.product_event_registry where event_name=p_event and active;
 if allowed is null then return null; end if;
 for k in select jsonb_object_keys(coalesce(p_properties,'{}'::jsonb)) loop if k=any(allowed) and k not in('name','full_name','phone','email','document','address') then clean:=clean||jsonb_build_object(k,p_properties->k); end if; end loop;
 insert into public.product_event_ingestion_queue(event_id,event_name,organization_id,user_id,store_id,occurred_at,properties,source,release_version,schema_version,correlation_id)
 select p_event_id,p_event,p_org,p_user,p_store,now(),clean,left(coalesce(p_source,'application'),40),left(p_release,40),r.schema_version,left(p_correlation,120) from public.product_event_registry r where r.event_name=p_event
 on conflict(event_id) do nothing; return p_event_id; exception when others then return null; end$$;

create or replace function public.enqueue_product_event(requested_event_id uuid,requested_event_name text,requested_organization_id uuid,requested_store_id uuid default null,requested_properties jsonb default '{}'::jsonb,requested_source text default 'application',requested_release_version text default null,requested_correlation_id text default null) returns uuid
language plpgsql security definer set search_path='' as $$begin
 if (select auth.uid()) is null or not exists(select 1 from public.organization_members m where m.organization_id=requested_organization_id and m.user_id=(select auth.uid()) and m.active) then raise exception 'access denied'; end if;
 if requested_store_id is not null and not exists(select 1 from public.establishments e where e.id=requested_store_id and e.organization_id=requested_organization_id) then raise exception 'invalid store'; end if;
 return private.enqueue_product_analytics_event(requested_event_name,requested_organization_id,(select auth.uid()),requested_store_id,requested_properties,requested_source,requested_release_version,requested_correlation_id,coalesce(requested_event_id,gen_random_uuid())); end$$;
revoke all on function public.enqueue_product_event(uuid,text,uuid,uuid,jsonb,text,text,text) from public,anon;
grant execute on function public.enqueue_product_event(uuid,text,uuid,uuid,jsonb,text,text,text) to authenticated;

create or replace function public.process_product_event_queue(requested_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$declare moved integer:=0;failed integer:=0;begin
 if current_user not in('service_role','postgres') and not private.is_superadmin() then raise exception 'access denied'; end if;
 with claimed as (select id from public.product_event_ingestion_queue where status='pending' order by created_at for update skip locked limit least(greatest(requested_limit,1),500)),
 updated as (update public.product_event_ingestion_queue q set status='processing',attempts=attempts+1 from claimed c where q.id=c.id returning q.*),
 inserted as (insert into public.product_events(event_id,event_name,organization_id,user_id,store_id,occurred_at,properties,source,release_version,schema_version,correlation_id) select event_id,event_name,organization_id,user_id,store_id,occurred_at,properties,source,release_version,schema_version,correlation_id from updated on conflict(event_id) do nothing returning event_id)
 update public.product_event_ingestion_queue q set status='processed',processed_at=now() where q.status='processing' and exists(select 1 from public.product_events e where e.event_id=q.event_id);
 get diagnostics moved=row_count; return jsonb_build_object('processed',moved,'failed',failed); end$$;
revoke all on function public.process_product_event_queue(integer) from public,anon,authenticated;
grant execute on function public.process_product_event_queue(integer) to service_role;

create or replace function public.get_product_growth_summary(requested_days integer default 30) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not private.is_superadmin() then raise exception 'access denied'; end if;
 select jsonb_build_object(
 'period_days',requested_days,'freshness',now(),
 'organizations',jsonb_build_object('total',(select count(*) from public.organizations where status<>'deleted'),'active',(select count(distinct organization_id) from public.product_events where occurred_at>=now()-make_interval(days=>requested_days))),
 'events',jsonb_build_object('total',(select count(*) from public.product_events where occurred_at>=now()-make_interval(days=>requested_days)),'backlog',(select count(*) from public.product_event_ingestion_queue where status='pending')),
 'activation',jsonb_build_object('accounts',(select count(distinct organization_id) from public.product_events where event_name='account_created' and occurred_at>=now()-make_interval(days=>requested_days)),'activated',(select count(distinct organization_id) from public.product_events where event_name='first_order_received' and occurred_at>=now()-make_interval(days=>requested_days))),
 'health',jsonb_build_object('at_risk',(select count(*) from public.customer_health_scores where risk_level in('at_risk','critical')),'healthy',(select count(*) from public.customer_health_scores where risk_level='healthy')),
 'opportunities',jsonb_build_object('open',(select count(*) from public.growth_opportunities where status='open')),
 'experiments',jsonb_build_object('running',(select count(*) from public.product_experiments where status='running')),
 'revenue',jsonb_build_object('mrr_cents',(select coalesce(sum(p.monthly_price_cents),0) from public.subscriptions s join public.plans p on p.id=s.plan_id where s.status in('active','trialing')),'paid_organizations',(select count(distinct organization_id) from public.subscriptions where status='active')),
 'data_quality',jsonb_build_object('open_alerts',(select count(*) from public.product_data_quality_alerts where status='open'))
 ) into result; return result; end$$;
revoke all on function public.get_product_growth_summary(integer) from public,anon;
grant execute on function public.get_product_growth_summary(integer) to authenticated;

create or replace function private.track_product_signal() returns trigger language plpgsql security definer set search_path='' as $$declare org uuid;store uuid;ev text;props jsonb:='{}'::jsonb;begin
 if tg_table_name='organizations' then org:=new.id;ev:='account_created';props:=jsonb_build_object('business_type',new.business_type);
 elsif tg_table_name='establishments' then org:=new.organization_id;store:=new.id;if tg_op='INSERT' then ev:='store_created'; elsif new.public_menu_active and not coalesce(old.public_menu_active,false) then ev:='menu_published'; end if;
 elsif tg_table_name='products' then select organization_id into org from public.establishments where id=new.establishment_id;store:=new.establishment_id;ev:='product_created';
 elsif tg_table_name='orders' then org:=new.organization_id;store:=new.establishment_id;ev:='first_order_received';props:=jsonb_build_object('source',new.source,'fulfillment_type',new.fulfillment_type);
 elsif tg_table_name='onboarding_sessions' then org:=new.organization_id;store:=new.establishment_id;if tg_op='INSERT' then ev:='onboarding_started';end if;
 elsif tg_table_name='onboarding_steps' and new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then org:=new.organization_id;store:=new.establishment_id;ev:='onboarding_step_completed';props:=jsonb_build_object('step_key',new.step_key);
 elsif tg_table_name='support_tickets' then org:=new.organization_id;store:=new.establishment_id;ev:='support_ticket_created';props:=jsonb_build_object('category',new.category,'priority',new.priority);
 elsif tg_table_name='subscriptions' and tg_op='UPDATE' and new.status='canceled' and old.status is distinct from new.status then org:=new.organization_id;store:=new.establishment_id;ev:='subscription_cancelled';props:=jsonb_build_object('reason_category',coalesce(new.cancellation_reason,'not_informed'),'voluntary',new.payment_failed_at is null);
 end if;
 if ev is not null and org is not null and (select analytics_enabled from public.organizations where id=org) then perform private.enqueue_product_analytics_event(ev,org,null,store,props,'database_trigger',current_setting('app.release_version',true),null,gen_random_uuid());end if;return new;exception when others then return new;end$$;
drop trigger if exists product_signal_organizations on public.organizations;create trigger product_signal_organizations after insert on public.organizations for each row execute function private.track_product_signal();
drop trigger if exists product_signal_establishments on public.establishments;create trigger product_signal_establishments after insert or update on public.establishments for each row execute function private.track_product_signal();
drop trigger if exists product_signal_products on public.products;create trigger product_signal_products after insert on public.products for each row execute function private.track_product_signal();
drop trigger if exists product_signal_orders on public.orders;create trigger product_signal_orders after insert on public.orders for each row execute function private.track_product_signal();
drop trigger if exists product_signal_onboarding_sessions on public.onboarding_sessions;create trigger product_signal_onboarding_sessions after insert on public.onboarding_sessions for each row execute function private.track_product_signal();
drop trigger if exists product_signal_onboarding_steps on public.onboarding_steps;create trigger product_signal_onboarding_steps after insert or update on public.onboarding_steps for each row execute function private.track_product_signal();
drop trigger if exists product_signal_support_tickets on public.support_tickets;create trigger product_signal_support_tickets after insert on public.support_tickets for each row execute function private.track_product_signal();
drop trigger if exists product_signal_subscriptions on public.subscriptions;create trigger product_signal_subscriptions after update of status on public.subscriptions for each row execute function private.track_product_signal();

insert into public.quality_feature_flags(flag_key,description,enabled,kill_switch,rollout_percent,internal_only) values
('product_analytics_enabled','Product analytics interno do SaaS',true,false,100,true),
('growth_engine_enabled','Motor de oportunidades de crescimento',false,false,0,true),
('experiments_enabled','Experimentos B2B controlados',false,false,0,true),
('lifecycle_messaging_enabled','Mensagens contextuais com frequency cap',false,false,0,true),
('customer_health_enabled','Health score transparente de clientes SaaS',true,false,100,true)
on conflict(flag_key) do nothing;

revoke all on public.product_event_registry,public.product_event_ingestion_queue,public.product_events,public.product_funnel_definitions,public.product_activation_definitions,public.product_feature_catalog,public.product_organization_daily_metrics,public.product_cohort_metrics,public.customer_health_scores,public.growth_opportunities,public.saas_lifecycle_campaigns,public.saas_lifecycle_deliveries,public.product_experiments,public.product_experiment_variants,public.product_experiment_assignments,public.product_experiment_metrics,public.customer_success_tasks,public.product_data_quality_alerts,public.product_analytics_permissions from anon;
grant select,insert,update,delete on public.product_event_registry,public.product_event_ingestion_queue,public.product_events,public.product_funnel_definitions,public.product_activation_definitions,public.product_feature_catalog,public.product_organization_daily_metrics,public.product_cohort_metrics,public.customer_health_scores,public.growth_opportunities,public.saas_lifecycle_campaigns,public.saas_lifecycle_deliveries,public.product_experiments,public.product_experiment_variants,public.product_experiment_assignments,public.product_experiment_metrics,public.customer_success_tasks,public.product_data_quality_alerts,public.product_analytics_permissions to authenticated;
grant all on public.product_event_registry,public.product_event_ingestion_queue,public.product_events,public.product_funnel_definitions,public.product_activation_definitions,public.product_feature_catalog,public.product_organization_daily_metrics,public.product_cohort_metrics,public.customer_health_scores,public.growth_opportunities,public.saas_lifecycle_campaigns,public.saas_lifecycle_deliveries,public.product_experiments,public.product_experiment_variants,public.product_experiment_assignments,public.product_experiment_metrics,public.customer_success_tasks,public.product_data_quality_alerts,public.product_analytics_permissions to service_role;
