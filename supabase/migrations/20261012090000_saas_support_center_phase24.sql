-- MasterApp Phase 24: SaaS support center.
-- This extends the existing platform support_tickets table and never reuses
-- restaurant/customer WhatsApp support conversations.

alter table public.organizations add column if not exists support_feature_flags jsonb not null default '{"support_center_enabled":true,"knowledge_base_enabled":true,"system_status_enabled":true,"automatic_diagnostics_enabled":true}'::jsonb;

alter table public.support_tickets drop constraint if exists support_tickets_status_check;
alter table public.support_tickets drop constraint if exists support_tickets_priority_check;
update public.support_tickets set status='in_progress' where status='analyzing';
update public.support_tickets set priority='normal' where priority='medium';
alter table public.support_tickets
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_to_user_id uuid references auth.users(id) on delete set null,
  add column if not exists queue_id uuid,
  add column if not exists subject text,
  add column if not exists category text not null default 'other',
  add column if not exists source text not null default 'panel',
  add column if not exists sla_due_at timestamptz,
  add column if not exists resolution_target_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists sla_paused_at timestamptz,
  add column if not exists sla_paused_seconds integer not null default 0,
  add column if not exists escalation_level text not null default 'n1',
  add column if not exists context_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists reopen_until timestamptz,
  add column if not exists last_customer_message_at timestamptz,
  add column if not exists last_support_message_at timestamptz;
update public.support_tickets t set organization_id=e.organization_id from public.establishments e where t.establishment_id=e.id and t.organization_id is null;
update public.support_tickets set created_by_user_id=created_by where created_by_user_id is null;
update public.support_tickets set assigned_to_user_id=assigned_to where assigned_to_user_id is null;
update public.support_tickets set subject=title where subject is null;
alter table public.support_tickets alter column subject set not null;
alter table public.support_tickets add constraint support_tickets_status_check check(status in('open','waiting_support','waiting_customer','in_progress','resolved','closed'));
alter table public.support_tickets add constraint support_tickets_priority_check check(priority in('low','normal','high','urgent'));
alter table public.support_tickets add constraint support_tickets_category_check check(category in('account','billing','whatsapp','ai','orders','delivery','payments','fiscal','inventory','integrations','technical','question','security','other'));
alter table public.support_tickets add constraint support_tickets_escalation_check check(escalation_level in('n1','n2','engineering','finance','specialist'));

create table public.saas_support_queues(
 id uuid primary key default gen_random_uuid(),name text not null unique,description text not null default '',active boolean not null default true,
 assignment_strategy text not null default 'least_load' check(assignment_strategy in('manual','round_robin','least_load','specialty')),
 restricted boolean not null default false,sort_order integer not null default 100,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
insert into public.saas_support_queues(name,sort_order,restricted) values ('Suporte Geral',10,false),('Financeiro',20,false),('Técnico',30,false),('Integrações',40,false),('Fiscal',50,false),('Billing',60,false),('Enterprise',70,true),('Segurança',80,true) on conflict(name) do nothing;
alter table public.support_tickets add constraint support_tickets_queue_fkey foreign key(queue_id) references public.saas_support_queues(id) on delete set null;

create table public.saas_support_sla_policies(
 id uuid primary key default gen_random_uuid(),plan_id uuid references public.plans(id) on delete cascade,queue_id uuid references public.saas_support_queues(id) on delete cascade,
 priority text not null check(priority in('low','normal','high','urgent')),first_response_target_minutes integer check(first_response_target_minutes>0),resolution_target_minutes integer check(resolution_target_minutes>0),pause_waiting_customer boolean not null default true,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(plan_id,queue_id,priority));

create table public.saas_support_agents(
 user_id uuid primary key references auth.users(id) on delete cascade,display_name text not null,skills text[] not null default '{}',max_tickets integer not null default 10 check(max_tickets>0),availability text not null default 'offline' check(availability in('available','busy','paused','offline')),active boolean not null default true,last_seen_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.saas_support_agent_queues(agent_user_id uuid references public.saas_support_agents(user_id) on delete cascade,queue_id uuid references public.saas_support_queues(id) on delete cascade,created_at timestamptz not null default now(),primary key(agent_user_id,queue_id));

create table public.support_ticket_messages(
 id uuid primary key default gen_random_uuid(),ticket_id uuid not null references public.support_tickets(id) on delete cascade,sender_type text not null check(sender_type in('customer','support','system')),sender_user_id uuid references auth.users(id) on delete set null,message text not null check(length(btrim(message)) between 1 and 20000),internal_note boolean not null default false,created_at timestamptz not null default now());
create table public.support_ticket_attachments(
 id uuid primary key default gen_random_uuid(),ticket_id uuid not null references public.support_tickets(id) on delete cascade,message_id uuid references public.support_ticket_messages(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,storage_path text not null unique,file_name text not null,mime_type text not null,size_bytes bigint not null check(size_bytes between 1 and 10485760),scan_status text not null default 'pending' check(scan_status in('pending','clean','blocked','failed')),uploaded_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());

create table public.support_articles(
 id uuid primary key default gen_random_uuid(),title text not null,slug text not null unique,category text not null,content text not null,status text not null default 'draft' check(status in('draft','published','archived')),audience text not null default 'customer' check(audience in('customer','internal','both')),plan_visibility uuid[] not null default '{}',created_by uuid references auth.users(id) on delete set null,updated_by uuid references auth.users(id) on delete set null,published_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index support_articles_search_idx on public.support_articles using gin(to_tsvector('portuguese',coalesce(title,'')||' '||coalesce(content,'')||' '||coalesce(category,'')));
insert into public.support_articles(title,slug,category,content,status,audience,published_at) values
('Como conectar o WhatsApp','conectar-whatsapp','WhatsApp','Abra Configurações, acesse WhatsApp e siga a conexão guiada. Valide o webhook antes de enviar mensagens.','published','customer',now()),
('Como configurar o cardápio','configurar-cardapio','Cardápio','Acesse Cardápio para criar categorias, produtos, preços e disponibilidade. Também é possível usar a importação assistida.','published','customer',now()),
('Como adicionar funcionário','adicionar-funcionario','Equipe','Acesse Equipe, escolha a função e use Cadastrar. O acesso pode ser reenviado sem recriar o funcionário.','published','customer',now()),
('Como funciona a cobrança','como-funciona-cobranca','Billing','Consulte Plano e cobrança para ver assinatura, consumo, faturas e formas de pagamento do SaaS.','published','customer',now()),
('Como emitir documento fiscal','emitir-documento-fiscal','Fiscal','Configure o perfil fiscal e o provedor antes de emitir. Utilize o ambiente de teste sempre que estiver disponível.','published','customer',now()),
('Como corrigir uma integração','corrigir-integracao','Integrações','Abra Integrações, consulte saúde e logs, teste a conexão e reprocessse somente eventos seguros.','published','both',now()) on conflict(slug) do nothing;

create table public.saas_support_components(
 id uuid primary key default gen_random_uuid(),component_key text not null unique,name text not null,status text not null default 'operational' check(status in('operational','degraded','partial_outage','major_outage','maintenance')),public_message text,internal_details text,checked_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
insert into public.saas_support_components(component_key,name) values ('api','API'),('whatsapp','WhatsApp'),('ai','IA'),('payments','Pagamentos'),('webhooks','Webhooks'),('login','Login'),('dashboard','Painel'),('storage','Arquivos') on conflict(component_key) do nothing;
create table public.support_incidents(
 id uuid primary key default gen_random_uuid(),title text not null,description text not null,status text not null default 'investigating' check(status in('investigating','identified','monitoring','resolved','maintenance')),severity text not null check(severity in('minor','major','critical')),affected_components text[] not null default '{}',is_public boolean not null default true,public_summary text not null,internal_details text,started_at timestamptz not null default now(),resolved_at timestamptz,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.support_incident_updates(id uuid primary key default gen_random_uuid(),incident_id uuid not null references public.support_incidents(id) on delete cascade,status text not null check(status in('investigating','identified','monitoring','resolved','maintenance')),public_message text not null,internal_note text,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create table public.support_incident_subscriptions(id uuid primary key default gen_random_uuid(),incident_id uuid not null references public.support_incidents(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,channel text not null default 'in_app' check(channel in('in_app','email','whatsapp')),consented_at timestamptz not null default now(),unique(incident_id,user_id,channel));
create table public.support_ticket_incidents(ticket_id uuid references public.support_tickets(id) on delete cascade,incident_id uuid references public.support_incidents(id) on delete cascade,linked_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),primary key(ticket_id,incident_id));

create table public.support_diagnostic_snapshots(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,establishment_id uuid references public.establishments(id) on delete set null,ticket_id uuid references public.support_tickets(id) on delete set null,requested_by uuid references auth.users(id) on delete set null,overall_status text not null check(overall_status in('ok','attention','incident')),customer_result jsonb not null default '{}',technical_result jsonb not null default '{}',correlation_ids text[] not null default '{}',created_at timestamptz not null default now());
create table public.support_csat(id uuid primary key default gen_random_uuid(),ticket_id uuid not null unique references public.support_tickets(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,rating smallint not null check(rating between 1 and 5),feedback text,submitted_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create table public.saas_support_notifications(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,ticket_id uuid references public.support_tickets(id) on delete cascade,incident_id uuid references public.support_incidents(id) on delete cascade,kind text not null,title text not null,body text not null,read_at timestamptz,created_at timestamptz not null default now());
create table public.saas_support_macros(id uuid primary key default gen_random_uuid(),title text not null,body text not null,category text,active boolean not null default true,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.saas_support_safe_actions(id uuid primary key default gen_random_uuid(),ticket_id uuid not null references public.support_tickets(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,action_type text not null check(action_type in('resend_webhook','reprocess_job','test_integration','invalidate_cache','reconnect_service','generate_onboarding_link','reset_nonsensitive_config')),status text not null default 'preview' check(status in('preview','confirmed','executing','completed','failed','cancelled')),preview jsonb not null default '{}',result jsonb,requested_by uuid not null references auth.users(id),confirmed_by uuid references auth.users(id),confirmation_token_hash text,expires_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.saas_support_audit_events(id bigint generated always as identity primary key,organization_id uuid references public.organizations(id) on delete set null,ticket_id uuid references public.support_tickets(id) on delete set null,actor_user_id uuid references auth.users(id) on delete set null,event_type text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create table public.saas_support_rate_limits(organization_id uuid not null references public.organizations(id) on delete cascade,window_started_at timestamptz not null,count integer not null default 0,primary key(organization_id,window_started_at));

create index support_tickets_org_status_idx on public.support_tickets(organization_id,status,updated_at desc);
create index support_tickets_queue_sla_idx on public.support_tickets(queue_id,sla_due_at) where status not in('resolved','closed');
create index support_messages_ticket_idx on public.support_ticket_messages(ticket_id,created_at);
create index support_diagnostics_org_idx on public.support_diagnostic_snapshots(organization_id,created_at desc);
create index support_incidents_status_idx on public.support_incidents(status,started_at desc);
create index support_audit_ticket_idx on public.saas_support_audit_events(ticket_id,created_at desc);
create index support_notifications_user_idx on public.saas_support_notifications(user_id,read_at,created_at desc);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('saas-support-attachments','saas-support-attachments',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv','application/json','application/zip']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.saas_support_member(target_org uuid) returns boolean language sql stable security definer set search_path='' as $$select private.is_superadmin() or exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=(select auth.uid()) and m.active)$$;
create or replace function private.saas_support_admin() returns boolean language sql stable security definer set search_path='' as $$select private.is_superadmin()$$;

create or replace function public.create_masterapp_support_ticket(requested_organization_id uuid,requested_establishment_id uuid,requested_subject text,requested_description text,requested_category text,requested_priority text default 'normal',requested_context jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare saved_id uuid; selected_queue uuid; plan_id uuid; first_minutes integer; resolution_minutes integer; bucket timestamptz:=date_trunc('hour',now()); current_count integer;
begin
 if not private.saas_support_member(requested_organization_id) then raise exception 'Acesso negado'; end if;
 if requested_establishment_id is not null and not exists(select 1 from public.establishments where id=requested_establishment_id and organization_id=requested_organization_id) then raise exception 'Unidade inválida'; end if;
 if length(btrim(requested_subject)) not between 3 and 180 or length(btrim(requested_description)) not between 10 and 20000 then raise exception 'Assunto ou descrição inválidos'; end if;
 if requested_category not in('account','billing','whatsapp','ai','orders','delivery','payments','fiscal','inventory','integrations','technical','question','security','other') or requested_priority not in('low','normal','high','urgent') then raise exception 'Classificação inválida'; end if;
 insert into public.saas_support_rate_limits(organization_id,window_started_at,count) values(requested_organization_id,bucket,1) on conflict(organization_id,window_started_at) do update set count=public.saas_support_rate_limits.count+1 returning count into current_count;
 if current_count>8 and requested_category<>'security' then raise exception 'Limite temporário de chamados atingido. Casos críticos de segurança continuam disponíveis.'; end if;
 select id into selected_queue from public.saas_support_queues where active and name=case requested_category when 'billing' then 'Billing' when 'integrations' then 'Integrações' when 'fiscal' then 'Fiscal' when 'security' then 'Segurança' when 'technical' then 'Técnico' else 'Suporte Geral' end limit 1;
 select s.plan_id into plan_id from public.subscriptions s where s.organization_id=requested_organization_id and s.status in('trialing','active','past_due') order by s.created_at desc limit 1;
 select p.first_response_target_minutes,p.resolution_target_minutes into first_minutes,resolution_minutes from public.saas_support_sla_policies p where p.active and p.plan_id is not distinct from plan_id and p.queue_id is not distinct from selected_queue and p.priority=requested_priority limit 1;
 insert into public.support_tickets(establishment_id,organization_id,created_by,created_by_user_id,title,subject,description,category,priority,status,source,queue_id,sla_due_at,resolution_target_at,context_snapshot,last_customer_message_at)
 values(requested_establishment_id,requested_organization_id,(select auth.uid()),(select auth.uid()),btrim(requested_subject),btrim(requested_subject),btrim(requested_description),requested_category,requested_priority,'open','panel',selected_queue,case when first_minutes is null then null else now()+make_interval(mins=>first_minutes) end,case when resolution_minutes is null then null else now()+make_interval(mins=>resolution_minutes) end,coalesce(requested_context,'{}'),now()) returning id into saved_id;
 insert into public.support_ticket_messages(ticket_id,sender_type,sender_user_id,message) values(saved_id,'customer',(select auth.uid()),btrim(requested_description));
 insert into public.saas_support_notifications(organization_id,user_id,ticket_id,kind,title,body) values(requested_organization_id,(select auth.uid()),saved_id,'ticket_created','Chamado recebido','Recebemos seu chamado e a equipe poderá solicitar mais informações.');
 insert into public.saas_support_audit_events(organization_id,ticket_id,actor_user_id,event_type,metadata) values(requested_organization_id,saved_id,(select auth.uid()),'ticket_created',jsonb_build_object('category',requested_category,'priority',requested_priority,'queue_id',selected_queue));
 return saved_id;
end$$;

create or replace function public.post_masterapp_support_message(requested_ticket_id uuid,requested_message text,requested_internal boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.support_tickets%rowtype; saved uuid; staff boolean;
begin
 select * into t from public.support_tickets where id=requested_ticket_id; staff:=private.saas_support_admin();
 if t.id is null or (not staff and not private.saas_support_member(t.organization_id)) then raise exception 'Chamado não encontrado'; end if;
 if requested_internal and not staff then raise exception 'Notas internas são restritas à equipe MasterApp'; end if;
 if length(btrim(requested_message)) not between 1 and 20000 then raise exception 'Mensagem inválida'; end if;
 insert into public.support_ticket_messages(ticket_id,sender_type,sender_user_id,message,internal_note) values(t.id,case when staff then 'support' else 'customer' end,(select auth.uid()),btrim(requested_message),requested_internal) returning id into saved;
 if staff then update public.support_tickets set status=case when requested_internal then status else 'waiting_customer' end,first_response_at=case when requested_internal then first_response_at else coalesce(first_response_at,now()) end,last_support_message_at=case when requested_internal then last_support_message_at else now() end,updated_at=now() where id=t.id;
 else update public.support_tickets set status='waiting_support',last_customer_message_at=now(),updated_at=now(),sla_paused_seconds=sla_paused_seconds+case when sla_paused_at is null then 0 else extract(epoch from(now()-sla_paused_at))::integer end,sla_paused_at=null where id=t.id; end if;
 insert into public.saas_support_audit_events(organization_id,ticket_id,actor_user_id,event_type,metadata) values(t.organization_id,t.id,(select auth.uid()),case when requested_internal then 'internal_note_added' else 'ticket_replied' end,jsonb_build_object('message_id',saved)); return saved;
end$$;

create or replace function public.run_masterapp_support_diagnostic(requested_organization_id uuid,requested_establishment_id uuid default null,requested_ticket_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid; customer jsonb; technical jsonb; overall text:='ok'; wa text; billing text; integration_errors integer; fiscal text;
begin
 if not private.saas_support_member(requested_organization_id) then raise exception 'Acesso negado'; end if;
 if requested_establishment_id is not null and not exists(select 1 from public.establishments where id=requested_establishment_id and organization_id=requested_organization_id) then raise exception 'Unidade inválida'; end if;
 select case when exists(select 1 from public.whatsapp_connections where organization_id=requested_organization_id and (requested_establishment_id is null or establishment_id=requested_establishment_id) and status='connected') then 'ok' else 'attention' end into wa;
 select case when exists(select 1 from public.subscriptions where organization_id=requested_organization_id and status in('trialing','active','past_due')) then 'ok' else 'attention' end into billing;
 select count(*) into integration_errors from public.integration_logs where organization_id=requested_organization_id and level='error' and created_at>now()-interval '24 hours';
 select case when requested_establishment_id is null or exists(select 1 from public.fiscal_provider_health where organization_id=requested_organization_id and store_id=requested_establishment_id and status='healthy') then 'ok' else 'attention' end into fiscal;
 if wa='attention' or billing='attention' or integration_errors>0 or fiscal='attention' then overall:='attention'; end if;
 customer:=jsonb_build_object('WhatsApp',wa,'Billing',billing,'Integrações',case when integration_errors=0 then 'ok' else 'attention' end,'Fiscal',fiscal,'API','ok','Arquivos','ok');
 technical:=jsonb_build_object('whatsapp_connection',wa,'billing_state',billing,'integration_errors_24h',integration_errors,'fiscal_provider',fiscal,'checked_at',now());
 insert into public.support_diagnostic_snapshots(organization_id,establishment_id,ticket_id,requested_by,overall_status,customer_result,technical_result) values(requested_organization_id,requested_establishment_id,requested_ticket_id,(select auth.uid()),overall,customer,technical) returning id into saved;
 insert into public.saas_support_audit_events(organization_id,ticket_id,actor_user_id,event_type,metadata) values(requested_organization_id,requested_ticket_id,(select auth.uid()),'diagnostic_executed',jsonb_build_object('snapshot_id',saved,'overall',overall)); return saved;
end$$;

create or replace function public.search_masterapp_support_articles(requested_query text) returns table(id uuid,title text,slug text,category text,excerpt text,rank real)
language sql stable security invoker set search_path='' as $$select a.id,a.title,a.slug,a.category,left(a.content,260),ts_rank(to_tsvector('portuguese',a.title||' '||a.content||' '||a.category),plainto_tsquery('portuguese',requested_query)) from public.support_articles a where a.status='published' and a.audience in('customer','both') and (to_tsvector('portuguese',a.title||' '||a.content||' '||a.category) @@ plainto_tsquery('portuguese',requested_query) or a.title ilike '%'||requested_query||'%') order by 6 desc limit 5$$;

create or replace function public.rate_masterapp_support_ticket(requested_ticket_id uuid,requested_rating integer,requested_feedback text default null) returns uuid
language plpgsql security definer set search_path='' as $$declare t public.support_tickets%rowtype;saved uuid;begin select * into t from public.support_tickets where id=requested_ticket_id;if t.id is null or not private.saas_support_member(t.organization_id) or t.status not in('resolved','closed') then raise exception 'Avaliação indisponível';end if;insert into public.support_csat(ticket_id,organization_id,rating,feedback,submitted_by) values(t.id,t.organization_id,requested_rating,nullif(btrim(requested_feedback),''),(select auth.uid())) on conflict(ticket_id) do update set rating=excluded.rating,feedback=excluded.feedback,submitted_by=excluded.submitted_by returning id into saved;insert into public.saas_support_audit_events(organization_id,ticket_id,actor_user_id,event_type,metadata) values(t.organization_id,t.id,(select auth.uid()),'csat_submitted',jsonb_build_object('rating',requested_rating));return saved;end$$;

do $$declare t text;begin foreach t in array array['saas_support_queues','saas_support_sla_policies','saas_support_agents','saas_support_agent_queues','support_ticket_messages','support_ticket_attachments','support_articles','saas_support_components','support_incidents','support_incident_updates','support_incident_subscriptions','support_ticket_incidents','support_diagnostic_snapshots','support_csat','saas_support_notifications','saas_support_macros','saas_support_safe_actions','saas_support_audit_events','saas_support_rate_limits'] loop execute format('alter table public.%I enable row level security',t);end loop;end$$;

drop policy if exists support_tickets_customer_read on public.support_tickets;
create policy support_tickets_customer_read on public.support_tickets for select to authenticated using(private.is_superadmin() or (organization_id is not null and private.saas_support_member(organization_id) and (exists(select 1 from public.organization_members m where m.organization_id=support_tickets.organization_id and m.user_id=(select auth.uid()) and m.active and m.role in('owner','admin','supervisor')) or created_by_user_id=(select auth.uid()))));
create policy support_messages_read on public.support_ticket_messages for select to authenticated using(exists(select 1 from public.support_tickets t where t.id=ticket_id and (private.is_superadmin() or (not internal_note and private.saas_support_member(t.organization_id)))));
create policy support_attachments_read on public.support_ticket_attachments for select to authenticated using(private.is_superadmin() or private.saas_support_member(organization_id));
create policy support_articles_customer_read on public.support_articles for select to authenticated using((status='published' and audience in('customer','both')) or private.is_superadmin());
create policy support_articles_public_read on public.support_articles for select to anon using(status='published' and audience in('customer','both'));
create policy support_components_superadmin_read on public.saas_support_components for select to authenticated using(private.is_superadmin());
create policy support_incidents_superadmin_read on public.support_incidents for select to authenticated using(private.is_superadmin());
create policy support_incident_updates_superadmin_read on public.support_incident_updates for select to authenticated using(private.is_superadmin());
create policy support_incident_subscriptions_read on public.support_incident_subscriptions for select to authenticated using(user_id=(select auth.uid()) or private.is_superadmin());
create policy support_ticket_incidents_read on public.support_ticket_incidents for select to authenticated using(private.is_superadmin() or exists(select 1 from public.support_tickets t where t.id=ticket_id and private.saas_support_member(t.organization_id)));
create policy support_diagnostics_read on public.support_diagnostic_snapshots for select to authenticated using(private.is_superadmin() or private.saas_support_member(organization_id));
create policy support_csat_read on public.support_csat for select to authenticated using(private.is_superadmin() or private.saas_support_member(organization_id));
create policy support_notifications_read on public.saas_support_notifications for select to authenticated using(user_id=(select auth.uid()) or private.is_superadmin());
do $$declare t text;begin foreach t in array array['saas_support_queues','saas_support_sla_policies','saas_support_agents','saas_support_agent_queues','saas_support_macros','saas_support_safe_actions','saas_support_audit_events','saas_support_rate_limits'] loop execute format('create policy support_superadmin_all on public.%I for all to authenticated using(private.is_superadmin()) with check(private.is_superadmin())',t);end loop;end$$;
create policy support_superadmin_articles on public.support_articles for all to authenticated using(private.is_superadmin()) with check(private.is_superadmin());
create policy support_superadmin_components on public.saas_support_components for all to authenticated using(private.is_superadmin()) with check(private.is_superadmin());
create policy support_superadmin_incidents on public.support_incidents for all to authenticated using(private.is_superadmin()) with check(private.is_superadmin());
create policy support_superadmin_incident_updates on public.support_incident_updates for all to authenticated using(private.is_superadmin()) with check(private.is_superadmin());

grant select on public.support_tickets,public.support_ticket_messages,public.support_ticket_attachments,public.support_articles,public.support_incident_subscriptions,public.support_ticket_incidents,public.support_csat,public.saas_support_notifications to authenticated;
grant select on public.support_articles to anon;
grant all on public.saas_support_queues,public.saas_support_sla_policies,public.saas_support_agents,public.saas_support_agent_queues,public.support_ticket_messages,public.support_ticket_attachments,public.support_articles,public.saas_support_components,public.support_incidents,public.support_incident_updates,public.support_incident_subscriptions,public.support_ticket_incidents,public.support_diagnostic_snapshots,public.support_csat,public.saas_support_notifications,public.saas_support_macros,public.saas_support_safe_actions,public.saas_support_audit_events,public.saas_support_rate_limits to service_role;
grant usage,select on all sequences in schema public to service_role;

revoke all on function private.saas_support_member(uuid),private.saas_support_admin() from public,anon,authenticated;
grant execute on function private.saas_support_member(uuid),private.saas_support_admin() to authenticated,service_role;
revoke all on function public.create_masterapp_support_ticket(uuid,uuid,text,text,text,text,jsonb),public.post_masterapp_support_message(uuid,text,boolean),public.run_masterapp_support_diagnostic(uuid,uuid,uuid),public.rate_masterapp_support_ticket(uuid,integer,text) from public,anon;
grant execute on function public.create_masterapp_support_ticket(uuid,uuid,text,text,text,text,jsonb),public.post_masterapp_support_message(uuid,text,boolean),public.run_masterapp_support_diagnostic(uuid,uuid,uuid),public.rate_masterapp_support_ticket(uuid,integer,text),public.search_masterapp_support_articles(text) to authenticated;
grant execute on function public.search_masterapp_support_articles(text) to anon;

do $$begin alter publication supabase_realtime add table public.support_tickets,public.support_ticket_messages,public.saas_support_notifications,public.support_incidents,public.support_incident_updates;exception when duplicate_object then null;end$$;
