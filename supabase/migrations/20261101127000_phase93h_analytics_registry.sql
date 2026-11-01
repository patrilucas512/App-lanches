-- Phase 93H: analytics views, feature flags, workspace widgets, search and SOC source ownership.

create view public.fact_access_grants with(security_invoker=true) as select g.organization_id,e.key entitlement_key,e.criticality,e.privileged,g.source_type,g.status,i.identity_type,g.valid_until is null permanent,count(*) grant_count from public.access_grants g join public.access_entitlements e on e.id=g.entitlement_id join public.governed_identities i on i.id=g.identity_id group by g.organization_id,e.key,e.criticality,e.privileged,g.source_type,g.status,i.identity_type,g.valid_until is null;
create view public.fact_access_requests with(security_invoker=true) as select organization_id,date_trunc('day',created_at) bucket_at,request_type,status,sod_result,count(*) request_count from public.access_requests group by organization_id,date_trunc('day',created_at),request_type,status,sod_result;
create view public.fact_jit_sessions with(security_invoker=true) as select organization_id,date_trunc('day',created_at) bucket_at,status,pre_approved,count(*) session_count from public.jit_sessions group by organization_id,date_trunc('day',created_at),status,pre_approved;
create view public.fact_break_glass with(security_invoker=true) as select organization_id,date_trunc('day',created_at) bucket_at,status,review_outcome,count(*) event_count,count(*) filter(where status not in('reviewed','requested') and review_due_at<now()) review_overdue from public.break_glass_events group by organization_id,date_trunc('day',created_at),status,review_outcome;
create view public.fact_sod_conflicts with(security_invoker=true) as select organization_id,date_trunc('day',detected_at) bucket_at,detection,result,severity,status,count(*) conflict_count from public.sod_conflicts group by organization_id,date_trunc('day',detected_at),detection,result,severity,status;
create view public.fact_access_reviews with(security_invoker=true) as select i.organization_id,c.review_type,c.status campaign_status,i.decision,i.execution_status,count(*) item_count from public.access_review_items i join public.access_review_campaigns c on c.id=i.campaign_id group by i.organization_id,c.review_type,c.status,i.decision,i.execution_status;
create view public.fact_access_findings with(security_invoker=true) as select organization_id,finding_type,severity,state,count(*) finding_count from public.access_findings group by organization_id,finding_type,severity,state;

do $$declare v text;begin foreach v in array array['fact_access_grants','fact_access_requests','fact_jit_sessions','fact_break_glass','fact_sod_conflicts','fact_access_reviews','fact_access_findings'] loop execute format('revoke all on public.%I from public,anon,authenticated',v);execute format('grant select on public.%I to service_role',v);end loop;end$$;

insert into public.feature_definitions(feature_key,name,description,category,value_type,default_value,safe_default,client_safe,owner_label,lifecycle_status,created_at,updated_at) values
('identity_governance_enabled','Identity Governance','Ativa a governança de identidades, catálogo e concessões.','security','boolean','false','false',false,'Identity Governance','active',now(),now()),
('identity_jit_enabled','Just-in-Time Access','Ativa janelas curtas de acesso com expiração automática.','security','boolean','false','false',false,'Identity Governance','active',now(),now()),
('identity_break_glass_enabled','Break-Glass Governance','Ativa o acesso emergencial com revisão obrigatória.','security','boolean','false','false',false,'Identity Governance','active',now(),now()),
('identity_sod_enabled','Segregation of Duties','Ativa as regras e a checagem de segregação de funções.','security','boolean','false','false',false,'Identity Governance','active',now(),now()),
('identity_access_reviews_enabled','Access Reviews','Ativa campanhas de revisão e certificação de acessos.','security','boolean','false','false',false,'Identity Governance','active',now(),now()),
('identity_reconciliation_enabled','Access Reconciliation','Ativa a comparação entre acesso efetivo e concessões.','security','boolean','false','false',false,'Identity Governance','active',now(),now()),
('identity_ai_assistance_enabled','Identity Assistant','Ativa a assistência de IA, que apenas explica e sugere.','security','boolean','false','false',false,'Identity Governance','active',now(),now())
on conflict(feature_key) do update set name=excluded.name,description=excluded.description,updated_at=now();

insert into public.workspace_widget_registry(id,title,description,category,widget_type,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('my_access_approvals','Minhas aprovações de acesso','Pedidos de acesso aguardando sua decisão.','security','status_list','{idgov:approve_access}','{organization}','idgov:my_approvals','5m','{}','{}','/painel/seguranca/acessos?tab=Solicitações',false,true),
('my_access_reviews','Minhas revisões pendentes','Itens de revisão de acesso atribuídos a você.','security','status_list','{idgov:review_access}','{organization}','idgov:my_reviews','5m','{}','{}','/painel/seguranca/acessos?tab=Revisões de Acesso',false,true),
('expiring_privileged_access','Privilegiados expirando','Acessos privilegiados perto do fim da validade.','security','status_list','{idgov:view}','{organization}','idgov:expiring_privileged','5m','{}','{}','/painel/seguranca/acessos?tab=Privilegiados',false,true),
('break_glass_to_review','Break-glass para revisar','Usos emergenciais aguardando revisão.','security','status_list','{idgov:review_break_glass}','{organization}','idgov:break_glass_review','5m','{}','{}','/painel/seguranca/acessos?tab=Break-Glass',false,true),
('open_sod_conflicts','Conflitos SoD','Conflitos de segregação de funções em aberto.','security','status_list','{idgov:manage_sod}','{organization}','idgov:sod_conflicts','5m','{}','{}','/painel/seguranca/acessos?tab=SoD',false,true),
('critical_access_findings','Achados críticos','Achados de acesso críticos em aberto.','security','status_list','{idgov:view}','{organization}','idgov:critical_findings','5m','{}','{}','/painel/seguranca/acessos?tab=Achados',false,true)
on conflict(id) do update set title=excluded.title,description=excluded.description,data_source=excluded.data_source,route=excluded.route,active=true,updated_at=now();

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values('identity-governance','Governança de Acessos','/painel/seguranca/acessos',array['identidade','acesso','concessao','entitlement','privilegiado','jit','break-glass','sod','revisao','achado','service account'],'identity_governance','idgov:view','◆',128) on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,icon=excluded.icon,position=excluded.position;
insert into public.search_command_registry(id,title,description,keywords,command_type,route,action_type,required_permission,risk_level,scope,position) values
('request-access','Pedir acesso','Abrir o pedido de acesso',array['acesso','pedido','solicitar'],'navigation','/painel/seguranca/acessos?tab=Solicitações',null,'idgov:request_access','low','organization',141),
('request-jit','Pedir JIT','Abrir o pedido de acesso temporário',array['jit','temporario','elevacao'],'navigation','/painel/seguranca/acessos?tab=Acessos Temporários / JIT',null,'idgov:request_access','low','organization',142),
('my-access-reviews','Minhas revisões','Abrir suas revisões de acesso',array['revisao','certificacao'],'navigation','/painel/seguranca/acessos?tab=Revisões de Acesso',null,'idgov:review_access','low','organization',143),
('view-active-privileged','Ver privilegiados ativos','Abrir acessos privilegiados ativos',array['privilegiado','admin','producao'],'navigation','/painel/seguranca/acessos?tab=Privilegiados',null,'idgov:view','low','organization',144),
('search-governed-identity','Buscar identidade','Abrir as identidades governadas',array['identidade','usuario','service account'],'navigation','/painel/seguranca/acessos?tab=Identidades',null,'idgov:view','low','organization',145)
on conflict(id) do update set title=excluded.title,description=excluded.description,keywords=excluded.keywords,route=excluded.route,required_permission=excluded.required_permission,position=excluded.position;

-- Phase 94 seeded this source without a producer; Phase 93 is now its producer and canonical owner.
update public.security_event_sources set schema_ref='security_events source_domain=identity (lib/identity-governance/soc-events.ts)',updated_at=now() where context='platform_soc' and organization_id is null and source_key='masterapp_identity_governance';

insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity) values
('identity.leaver_detected',1,'identity_governance','Desligamento informado pela fonte oficial','{"type":"object"}','{identity.id,organization.id}','sensitive'),
('access.expiring',1,'identity_governance','Acesso perto de expirar','{"type":"object"}','{grant.id,organization.id}','normal'),
('access.revocation_failed',1,'identity_governance','Revogação não confirmada na fonte','{"type":"object"}','{grant.id,organization.id}','sensitive'),
('break_glass.activated',1,'identity_governance','Break-glass ativado','{"type":"object"}','{event.id,organization.id}','sensitive'),
('break_glass.review_overdue',1,'identity_governance','Revisão de break-glass atrasada','{"type":"object"}','{event.id,organization.id}','sensitive'),
('sod.conflict_detected',1,'identity_governance','Conflito de segregação de funções detectado','{"type":"object"}','{conflict.id,organization.id}','sensitive'),
('review.overdue',1,'identity_governance','Revisão de acesso atrasada','{"type":"object"}','{campaign.id,organization.id}','normal'),
('access.drift_detected',1,'identity_governance','Diferença entre acesso efetivo e concessões','{"type":"object"}','{run.id,organization.id}','sensitive')
on conflict do nothing;

insert into public.notification_source_registry(id,event_type,category,source_type,title_template,summary_template,priority_rules,allowed_actions,default_recipient_rules,dedup_strategy,grouping_strategy,expiration_strategy,sensitivity) values
('identity-access-expiring','access.expiring','security','access_grant','Acesso perto de expirar','{{summary}}','{"default":"normal"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":720}','{"key":"access.expiring"}','{"requires_source_resolution":true}','sensitive'),
('identity-break-glass-activated','break_glass.activated','security','break_glass_event','Break-glass ativado','{{summary}}','{"default":"critical"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":60}','{"key":"break_glass.activated","critical_individual":true}','{"requires_source_resolution":true}','sensitive'),
('identity-review-overdue','review.overdue','security','access_review','Revisões de acesso pendentes','{{summary}}','{"default":"normal"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"review.overdue"}','{"requires_source_resolution":true}','sensitive')
on conflict(id) do nothing;

-- Identity actions share the ActionEngine ledger, but only Phase 93 confirms them: the Copilot's confirm, cancel and undo must refuse these types.
create or replace function private.copilot_action_allowed(requested_establishment_id uuid,requested_action_type text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare role_name text; plan_enabled boolean;
begin
  if requested_action_type like 'IDGOV\_%' then return false; end if;
  if (select auth.uid()) is null then return false; end if;
  role_name:=private.copilot_action_role(requested_establishment_id);
  select coalesce(p.copilot_actions_enabled,false) into plan_enabled
    from public.subscriptions s join public.plans p on p.id=s.plan_id
    where s.establishment_id=requested_establishment_id and s.status in ('trialing','active') limit 1;
  if not coalesce(plan_enabled,false) then return false; end if;
  if requested_action_type='PRODUCT_SET_AVAILABILITY' then return role_name in ('owner','manager','admin','catalog_editor'); end if;
  if requested_action_type in ('CHANGE_CONVERSATION_PRIORITY','ASSIGN_CONVERSATION','QUEUE_ADJUST_CAPACITY') then
    return role_name in ('owner','manager','admin') or private.has_support_permission(requested_establishment_id,'transfer');
  end if;
  return role_name in ('owner','manager','admin');
end $$;
