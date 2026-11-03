-- Phase 95G (part 2): governed access to the privacy module (Phase 93) and the registries of reports, workspace, search,
-- automation and notifications.

-- privacy joins the modules Identity Governance can read and provision.
create or replace function public.rbac_read_effective_access(requested_organization_id uuid, requested_user_id uuid default null::uuid) returns jsonb language sql stable security definer set search_path to '' as $function$
 select jsonb_build_object(
  'organization_members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'all_stores',m.all_stores,'active',m.active)) from public.organization_members m where m.organization_id=requested_organization_id and(requested_user_id is null or m.user_id=requested_user_id)),'[]'),
  'establishment_members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'establishment_id',m.establishment_id,'role',m.role,'status',m.status)) from public.establishment_members m join public.establishments e on e.id=m.establishment_id where e.organization_id=requested_organization_id and(requested_user_id is null or m.user_id=requested_user_id)),'[]'),
  'store_access',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'establishment_id',a.establishment_id)) from public.organization_member_store_access a where a.organization_id=requested_organization_id and(requested_user_id is null or a.user_id=requested_user_id)),'[]'),
  'module_permissions',coalesce((select jsonb_agg(x) from(
    select jsonb_build_object('user_id',p.user_id,'module','soc','permission_key',p.permission_key) x from public.security_soc_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','vendor','permission_key',p.permission_key) from public.vendor_member_permissions p where p.organization_id=requested_organization_id and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','idgov','permission_key',p.permission_key) from public.identity_governance_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','comms','permission_key',p.permission_key) from public.comms_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id)
    union all select jsonb_build_object('user_id',p.user_id,'module','privacy','permission_key',p.permission_key) from public.privacy_member_permissions p where p.organization_id=requested_organization_id and p.active and(requested_user_id is null or p.user_id=requested_user_id))s),'[]'))
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
 elsif requested_module='privacy' and requested_permission_key like 'privacy:%' then
  insert into public.privacy_member_permissions(organization_id,user_id,permission_key,active) values(requested_organization_id,requested_user_id,requested_permission_key,requested_active) on conflict(organization_id,user_id,permission_key) do update set active=excluded.active;
 else raise exception 'RBAC_MODULE_NOT_PROVISIONABLE'; end if;
 return jsonb_build_object('module',requested_module,'permission_key',requested_permission_key,'active',requested_active);
end$function$;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('privacy_dsr_on_time_rate','DSR On-Time Rate','Solicitações de titulares concluídas no prazo sobre as concluídas com prazo.','concluídas no prazo / concluídas com prazo','fact_privacy_requests','dia por tipo','Privacidade & LGPD','hourly','percent','calculation',false,'{date,request_type}'),
('privacy_dsr_median_resolution_hours','Median DSR Resolution Time','Mediana do tempo entre o recebimento e a conclusão.','mediana(conclusão - recebimento) entre as concluídas','customer_privacy_requests','solicitação','Privacidade & LGPD','hourly','hours','calculation',false,'{date,request_type}'),
('privacy_consent_revocation_rate','Consent Revocation Rate','Registros de revogação sobre todos os registros de consentimento.','revogações / registros de consentimento','consent_records','finalidade','Privacidade & LGPD','hourly','percent','calculation',false,'{date,purpose}'),
('privacy_unmapped_field_count','Unmapped Personal Field Count','Campos com cara de dado pessoal sem entrada no mapa.','contagem de achados abertos','privacy_inventory_findings','campo','Privacidade & LGPD','daily','count','fact',false,'{}'),
('privacy_overdue_retention_count','Overdue Retention Count','Registros vencidos pela última simulação de cada política.','soma de due_count das últimas simulações','retention_runs','política','Privacidade & LGPD','daily','count','fact',false,'{}'),
('privacy_open_incident_count','Open Privacy Incident Count','Incidentes de privacidade ainda não encerrados.','contagem de avaliações não encerradas','privacy_incident_assessments','incidente','Privacidade & LGPD','hourly','count','fact',false,'{}')
on conflict(metric_key) do update set description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,updated_at=now();

insert into public.report_dataset_registry(id,name,description,source,available_metrics,available_dimensions,available_filters,supported_time_granularity,required_permissions,realtime_or_analytical,sensitivity,column_policy) values
('processing_activities','Atividades de tratamento (ROPA)','Atividades registradas, com finalidade, base legal e retenção.','warehouse','{}','{date}','{date}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}'),
('consent_records','Consentimentos por finalidade','Concessões e revogações por finalidade e canal, sem titulares.','warehouse','{privacy_consent_revocation_rate}','{date,purpose}','{date,purpose}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}'),
('data_subject_requests','Solicitações de titulares','Solicitações por tipo, canal, status e prazo, sem titulares.','warehouse','{privacy_dsr_on_time_rate,privacy_dsr_median_resolution_hours}','{date,request_type}','{date,request_type}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}'),
('retention_runs','Execuções de retenção','Simulações e execuções com vencidos, bloqueados e processados.','warehouse','{privacy_overdue_retention_count}','{date}','{date}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}'),
('legal_holds','Bloqueios legais','Bloqueios por motivo e status.','warehouse','{}','{date}','{date}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}'),
('privacy_incidents','Incidentes de privacidade','Incidentes com avaliação e decisão de comunicação.','warehouse','{privacy_open_incident_count}','{date}','{date}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}'),
('privacy_impact_assessments','RIPD','Relatórios de impacto por status.','warehouse','{}','{date}','{date}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}'),
('subprocessors','Suboperadores','Fornecedores que recebem dados pessoais.','warehouse','{}','{date}','{date}','{day,week,month}','{reports:view,privacy:view}','analytical','restricted','{}')
on conflict(id) do update set description=excluded.description,available_metrics=excluded.available_metrics;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('privacy_dsr_due','Solicitações de titulares perto do prazo','Solicitações abertas que vencem em breve ou já venceram.','security','status_list','{privacy:view}','{store,network}','privacy:dsr_due','5m','{}','{}','/painel/seguranca/privacidade',false,true)
on conflict(id) do update set title=excluded.title,description=excluded.description,data_source=excluded.data_source,route=excluded.route,active=true,updated_at=now();

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values
('privacy-operations','Privacidade & LGPD','/painel/seguranca/privacidade',array['privacidade','lgpd','titular','consentimento','dpo','encarregado','ripd','retencao','exclusao'],'privacy_operations',null,'shield',170)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,position=excluded.position;

insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity) values
('privacy.dsr_received',1,'privacy_operations','Solicitação de titular recebida','{"type":"object"}','{request.id,request.type,request.due_at}','restricted')
on conflict do nothing;

-- Automation may remind people about deadlines. Executing deletion, choosing a legal basis or answering a subject are not actions it has.
insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,idempotency_supported,action_engine_required) values
('privacy_remind_dsr_deadline','privacy_operations','Lembrar o responsável do prazo de uma solicitação de titular','{"type":"object"}','privacy:handle_dsr','low',true,false)
on conflict do nothing;

insert into public.notification_source_registry(id,event_type,category,source_type,title_template,summary_template,priority_rules,allowed_actions,default_recipient_rules,dedup_strategy,grouping_strategy,expiration_strategy,sensitivity) values
('privacy-dsr-due-soon','privacy.dsr_due_soon','security','data_subject_request','Solicitação de titular perto do prazo','{{summary}}','{"default":"high"}','["open"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"privacy.dsr_due_soon"}','{"requires_source_resolution":true}','confidential'),
('privacy-dsr-overdue','privacy.dsr_overdue','security','data_subject_request','Solicitação de titular vencida','{{summary}}','{"default":"critical"}','["open"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"privacy.dsr_overdue"}','{"requires_source_resolution":true}','confidential')
on conflict(id) do nothing;
