-- Phase 88 production verification follow-up: complete the seven requested
-- Change Management workspace widgets without modifying the applied baseline.
insert into public.workspace_widget_registry(
  id,title,description,category,widget_type,required_permissions,supported_scopes,
  data_source,refresh_strategy,configuration_schema,default_settings,route,
  display_safe,sensitive
) values
('change_high_risk','Mudanças de alto risco','Mudanças high/critical que exigem atenção de governança.','change_management','alert_list','{change:view}','{store,network}','change_management:risk','5m','{}','{}','/painel/governanca/mudancas?tab=Visão%20Geral',false,true),
('change_emergency','Mudanças emergenciais','Fast paths emergenciais com auditoria e review obrigatório.','change_management','alert_list','{change:view}','{store,network}','change_management:emergency','5m','{}','{}','/painel/governanca/mudancas?tab=Emergenciais',false,true),
('change_recent_rollbacks','Rollbacks recentes','Mudanças revertidas recentemente e seu estado de validação.','change_management','status_list','{change:view}','{store,network}','change_management:rollbacks','5m','{}','{}','/painel/governanca/mudancas?tab=Rollbacks',false,true)
on conflict(id) do update set
  title=excluded.title,
  description=excluded.description,
  required_permissions=excluded.required_permissions,
  supported_scopes=excluded.supported_scopes,
  data_source=excluded.data_source,
  refresh_strategy=excluded.refresh_strategy,
  route=excluded.route,
  display_safe=excluded.display_safe,
  sensitive=excluded.sensitive,
  active=true,
  updated_at=now();
