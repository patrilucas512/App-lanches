-- Phase 57G: governed access (Phase 93), aggregated reach, and the registries of reports, workspace, search, automation and notifications.

-- comms joins the modules Identity Governance can read and provision.
create or replace function public.rbac_read_effective_access(requested_organization_id uuid, requested_user_id uuid default null::uuid) returns jsonb language sql stable security definer set search_path to '' as $function$
 select jsonb_build_object(
  'organization_members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'all_stores',m.all_stores,'active',m.active)) from public.organization_members m where m.organization_id=requested_organization_id and(requested_user_id is null or m.user_id=requested_user_id)),'[]'),
  'establishment_members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'establishment_id',m.establishment_id,'role',m.role,'status',m.status)) from public.establishment_members m join public.establishments e on e.id=m.establishment_id where e.organization_id=requested_organization_id and(requested_user_id is null or m.user_id=requested_user_id)),'[]'),
  'store_access',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'establishment_id',a.establishment_id)) from public.organization_member_store_access a where a.organization_id=requested_organization_id and(requested_user_id is null or a.user_id=requested_user_id)),'[]'),
  'module_permissions',coalesce((select jsonb_agg(x) from(
    select jsonb_build_object('user_id',p.user_id,'module','soc','permission_key',p.permission_key) x from public.security_soc_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','vendor','permission_key',p.permission_key) from public.vendor_member_permissions p where p.organization_id=requested_organization_id and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','idgov','permission_key',p.permission_key) from public.identity_governance_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','comms','permission_key',p.permission_key) from public.comms_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id))s),'[]'))
$function$;

create or replace function public.rbac_set_module_permission(requested_organization_id uuid, requested_user_id uuid, requested_module text, requested_permission_key text, requested_active boolean) returns jsonb language plpgsql security definer set search_path to '' as $function$
begin
 if requested_module='soc' and requested_permission_key like 'soc:%' then
  insert into public.security_soc_member_permissions(organization_id,user_id,context,permission_key,active) values(requested_organization_id,requested_user_id,'tenant_soc',requested_permission_key,requested_active) on conflict(organization_id,user_id,context,permission_key) do update set active=excluded.active;
 elsif requested_module='vendor' and requested_permission_key like 'vendor:%' then
  if requested_active then insert into public.vendor_member_permissions(organization_id,user_id,permission_key) values(requested_organization_id,requested_user_id,requested_permission_key) on conflict(organization_id,user_id,permission_key) do nothing;
  else delete from public.vendor_member_permissions where organization_id=requested_organization_id and user_id=requested_user_id and permission_key=requested_permission_key; end if;
 elsif requested_module='idgov' and requested_permission_key like 'idgov:%' then
  insert into public.identity_governance_member_permissions(organization_id,user_id,permission_key,active) values(requested_organization_id,requested_user_id,requested_permission_key,requested_active) on conflict(organization_id,user_id,permission_key) do update set active=excluded.active;
 elsif requested_module='comms' and requested_permission_key like 'comms:%' then
  insert into public.comms_member_permissions(organization_id,user_id,permission_key,active) values(requested_organization_id,requested_user_id,requested_permission_key,requested_active) on conflict(organization_id,user_id,permission_key) do update set active=excluded.active;
 else raise exception 'RBAC_MODULE_NOT_PROVISIONABLE'; end if;
 return jsonb_build_object('module',requested_module,'permission_key',requested_permission_key,'active',requested_active);
end$function$;

-- Reach per announcement and unit. It has no user column on purpose: this view cannot answer "who".
create view public.fact_comms_reach with(security_invoker=true) as
select a.organization_id,r.store_id,a.id as announcement_id,a.announcement_type,a.priority,a.acknowledgement_required,a.published_at::date as metric_date,
 count(*)::integer as recipients,count(*) filter(where r.delivered_at is not null)::integer as delivered,count(*) filter(where r.opened_at is not null)::integer as opened,
 count(*) filter(where r.state='acknowledged')::integer as acknowledged,count(*) filter(where r.state='overdue')::integer as overdue,
 percentile_cont(0.5) within group(order by extract(epoch from r.acknowledged_at-r.delivered_at)/3600) filter(where r.state='acknowledged' and r.delivered_at is not null) as median_hours_to_ack
from public.network_announcements a join public.network_announcement_recipients r on r.announcement_id=a.id
where a.published_at is not null
group by a.organization_id,r.store_id,a.id,a.announcement_type,a.priority,a.acknowledgement_required,a.published_at::date;
revoke all on public.fact_comms_reach from public,anon,authenticated;
grant select on public.fact_comms_reach to service_role;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('comms_delivery_rate','Taxa de entrega de comunicados','Destinatários com o comunicado entregue sobre os destinatários.','entregues / destinatários','fact_comms_reach','comunicado por unidade','Comunicação Interna','hourly','percent','calculation',false,'{date,store}'),
('comms_open_rate','Taxa de abertura de comunicados','Comunicados abertos sobre os entregues, sempre agregado.','abertos / entregues','fact_comms_reach','comunicado por unidade','Comunicação Interna','hourly','percent','calculation',false,'{date,store}'),
('comms_ack_rate','Taxa de confirmação de leitura','Confirmações sobre os destinatários de comunicados obrigatórios.','confirmados / destinatários de comunicados obrigatórios','fact_comms_reach','comunicado por unidade','Comunicação Interna','hourly','percent','calculation',false,'{date,store}'),
('comms_overdue_ack_count','Confirmações em atraso','Contagem de confirmações com prazo vencido.','contagem de destinatários em atraso','fact_comms_reach','comunicado por unidade','Comunicação Interna','hourly','count','fact',false,'{date,store}'),
('comms_time_to_ack','Tempo até a confirmação','Mediana entre a entrega e a confirmação.','mediana(confirmação - entrega) entre os confirmados','fact_comms_reach','comunicado por unidade','Comunicação Interna','hourly','hours','calculation',false,'{date,store}'),
('comms_poll_responses','Respostas de enquetes','Respostas recebidas por enquete.','contagem de respostas','comms_poll_responses','enquete','Comunicação Interna','hourly','count','fact',false,'{date}')
on conflict(metric_key) do update set description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,updated_at=now();

insert into public.report_dataset_registry(id,name,description,source,available_metrics,available_dimensions,available_filters,supported_time_granularity,required_permissions,realtime_or_analytical,sensitivity,column_policy) values
('internal_announcements','Comunicados internos','Comunicados publicados, por tipo e unidade.','warehouse','{comms_delivery_rate,comms_open_rate,comms_ack_rate}','{date,store}','{date,store}','{day,week,month}','{reports:view}','analytical','normal','{}'),
('announcement_deliveries','Entrega de comunicados','Alcance agregado dos comunicados.','warehouse','{comms_delivery_rate,comms_open_rate}','{date,store}','{date,store}','{day,week,month}','{reports:view}','analytical','normal','{}'),
('announcement_acknowledgements','Confirmações de leitura','Confirmações e atrasos de comunicados obrigatórios, sem nomes.','warehouse','{comms_ack_rate,comms_overdue_ack_count,comms_time_to_ack}','{date,store}','{date,store}','{day,week,month}','{reports:view}','analytical','normal','{}'),
('internal_polls','Enquetes internas','Respostas agregadas por enquete.','warehouse','{comms_poll_responses}','{date}','{date}','{day,week,month}','{reports:view}','analytical','normal','{}')
on conflict(id) do update set description=excluded.description,available_metrics=excluded.available_metrics;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('comms_my_mandatory','Comunicados para confirmar','Comunicados obrigatórios que esperam a sua confirmação.','operations','status_list','{}','{store,network}','comms:my_mandatory','1m','{}','{}','/painel/comunicados',false,false)
on conflict(id) do update set title=excluded.title,description=excluded.description,data_source=excluded.data_source,route=excluded.route,active=true,updated_at=now();

-- Each role opens its workspace already seeing what it must confirm.
update public.workspace_templates set layout_schema=jsonb_build_array(jsonb_build_object('id','comms_my_mandatory','w',2,'mandatory',true))||layout_schema where organization_id is null and not layout_schema @> '[{"id":"comms_my_mandatory"}]';

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values
('internal-communications','Comunicação Interna','/painel/operacoes/comunicacao-interna',array['comunicado','comunicacao','mural','enquete','aviso','recall','crise'],'internal_communications',null,'megaphone',160),
('my-announcements','Meus comunicados','/painel/comunicados',array['comunicado','leitura','confirmar','mural'],'internal_communications',null,'megaphone',161)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,position=excluded.position;
insert into public.search_command_registry(id,title,description,keywords,command_type,route,action_type,required_permission,risk_level,scope,position) values
('comms-new-announcement','Novo comunicado','Criar um comunicado interno',array['novo','comunicado','aviso'],'navigation','/painel/operacoes/comunicacao-interna?tab=Novo Comunicado',null,'commands:quick_create','low','store',161),
('comms-pending-reads','Ver pendências de leitura','Abrir as confirmações de leitura em aberto',array['leitura','confirmacao','pendencia'],'navigation','/painel/operacoes/comunicacao-interna?tab=Pendências de Leitura',null,'commands:quick_create','low','store',162)
on conflict(id) do update set title=excluded.title,description=excluded.description,keywords=excluded.keywords,route=excluded.route,required_permission=excluded.required_permission,position=excluded.position;

insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity) values
('comms.published',1,'internal_communications','Comunicado publicado','{"type":"object"}','{announcement.id,announcement.type,announcement.priority}','normal'),
('comms.ack_overdue',1,'internal_communications','Confirmação de leitura em atraso em ao menos uma unidade','{"type":"object"}','{announcement.id,overdue.units}','normal'),
('comms.crisis_published',1,'internal_communications','Comunicado de crise ou recall publicado','{"type":"object"}','{announcement.id,announcement.type,announcement.priority}','normal'),
('incident.declared',1,'incident_management','Incidente aberto; pode propor um comunicado','{"type":"object"}','{incident.id,incident.severity,incident.category,store.id}','normal'),
('continuity.plan_activated',1,'business_continuity','Plano de continuidade ativado; pode propor um comunicado','{"type":"object"}','{activation.id,plan.id,incident.id}','normal')
on conflict do nothing;

insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,idempotency_supported,action_engine_required) values
('comms_create_draft','internal_communications','Criar rascunho de comunicado; nunca publica','{"type":"object"}','comms:create','medium',true,false),
('comms_notify_pending','internal_communications','Lembrar quem ainda não confirmou','{"type":"object"}','comms:view_ack_status','low',true,false),
('comms_escalate_manager','internal_communications','Avisar o gestor com o total em atraso da unidade','{"type":"object"}','comms:view_ack_status','low',true,false)
on conflict do nothing;

insert into public.notification_source_registry(id,event_type,category,source_type,title_template,summary_template,priority_rules,allowed_actions,default_recipient_rules,dedup_strategy,grouping_strategy,expiration_strategy,sensitivity) values
('comms-published','comms.published','operations','network_announcement','Novo comunicado','{{summary}}','{"default":"medium"}','["open"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"comms.published"}','{"requires_source_resolution":true}','normal'),
('comms-version','comms.version_changed','operations','network_announcement','Comunicado atualizado','{{summary}}','{"default":"medium"}','["open"]','[]','{"key":"event:source:recipient","window_minutes":60}','{"key":"comms.version_changed"}','{"requires_source_resolution":true}','normal'),
('comms-retracted','comms.retracted','operations','network_announcement','Comunicado retirado','{{summary}}','{"default":"high"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"comms.retracted"}','{"requires_source_resolution":true}','normal'),
('comms-ack-reminder','comms.ack_reminder','operations','network_announcement','Confirme a leitura','{{summary}}','{"default":"high"}','["open"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"comms.ack_reminder"}','{"requires_source_resolution":true}','normal'),
('comms-ack-overdue','comms.ack_overdue','operations','network_announcement','Leitura pendente na unidade','{{summary}}','{"default":"high"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"comms.ack_overdue"}','{"requires_source_resolution":true}','normal'),
('comms-approval','comms.approval_requested','approvals','network_announcement','Comunicado aguardando aprovação','{{summary}}','{"default":"high"}','["open"]','[]','{"key":"event:source:recipient","window_minutes":60}','{"key":"comms.approval_requested"}','{"requires_source_resolution":true}','normal'),
('comms-emergency-review','comms.emergency_review_overdue','operations','network_announcement','Revisão de emergência pendente','{{summary}}','{"default":"high"}','["open"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"comms.emergency_review_overdue"}','{"requires_source_resolution":true}','normal')
on conflict(id) do nothing;
