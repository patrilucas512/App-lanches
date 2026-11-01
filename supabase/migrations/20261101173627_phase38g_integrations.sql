-- Phase 38G: the csat and nps metrics finally get a real source; registries for reports, goals, workspace, search, automation and notifications.

update public.analytics_metric_catalog set source_of_truth='fact_cx_feedback',formula='média das notas csat e star_rating de 1 a 5 / respostas no período; abaixo da amostra mínima não há número',description='Satisfação média informada pelos consumidores da loja.',updated_at=now() where metric_key='csat';
update public.analytics_metric_catalog set source_of_truth='fact_cx_feedback',formula='(promotores - detratores) / respostas NPS * 100; abaixo da amostra mínima não há número',description='Net Promoter Score dos consumidores da loja, com número de respostas.',updated_at=now() where metric_key='nps';
insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('survey_response_rate','Taxa de resposta das pesquisas','Pesquisas respondidas sobre pesquisas enviadas.','respondidas / enviadas','fact_cx_survey_responses','pesquisa','CX','hourly','percent','calculation',false,'{date,store,channel}'),
('review_response_rate','Taxa de resposta a avaliações','Avaliações públicas respondidas sobre as recebidas.','respondidas / avaliações públicas recebidas','fact_cx_review_responses','avaliação','CX','hourly','percent','calculation',false,'{date,store,channel}'),
('median_response_time','Tempo mediano de resposta','Mediana entre receber e responder uma avaliação.','mediana(primeira resposta - recebimento) entre as respondidas','crm_feedback','avaliação','CX','hourly','hours','calculation',false,'{date,store,channel}'),
('detractor_recovery_rate','Recuperação de detratores','Casos resolvidos com o cliente sobre os casos encerrados.','resolvidos com o cliente / encerrados','fact_cx_recovery_cases','caso','CX','hourly','percent','calculation',false,'{date,store}'),
('recovered_customer_repeat_rate','Recompra após recuperação','Clientes que voltaram a comprar depois do caso. Associação, não causa.','casos com recompra / casos com cliente','fact_cx_recovery_cases','caso','CX','daily','percent','calculation',false,'{date,store}'),
('risk_signal_count','Sinais de risco','Contagem de sinais de segurança em avaliações.','contagem de sinais','fact_cx_risk_signals','sinal','CX','hourly','count','fact',false,'{date,store}')
on conflict(metric_key) do update set description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,updated_at=now();

insert into public.report_dataset_registry(id,name,description,source,available_metrics,available_dimensions,available_filters,supported_time_granularity,required_permissions,realtime_or_analytical,sensitivity,column_policy) values
('customer_experience','Experiência do cliente','NPS e CSAT por unidade, com número de respostas.','warehouse','{csat,nps,survey_response_rate,review_response_rate,median_response_time,detractor_recovery_rate,recovered_customer_repeat_rate,risk_signal_count}','{date,store,channel}','{date,store,channel}','{day,week,month}','{reports:view,customers:view}','analytical','normal','{}')
on conflict(id) do update set description=excluded.description,available_metrics=excluded.available_metrics;

insert into public.performance_goal_templates(id,name,description,metric_id,target_direction,default_scope) values('improve-nps','Melhorar NPS','Aumentar o NPS medido com respostas reais.','nps','increase','store') on conflict(id) do update set name=excluded.name,description=excluded.description;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('cx_store_nps','NPS da loja','NPS com número de respostas.','customers','metric_card','{cx:view}','{store,organization}','cx:store_nps','5m','{}','{}','/painel/clientes/experiencia',true,false),
('cx_unanswered_reviews','Avaliações sem resposta','Avaliações públicas aguardando resposta.','customers','status_list','{cx:respond}','{store,organization}','cx:unanswered','5m','{}','{}','/painel/clientes/experiencia?tab=Caixa de Avaliações',false,true),
('cx_detractors_waiting','Detratores sem retorno','Clientes insatisfeitos ainda sem retorno.','customers','status_list','{cx:manage_recovery}','{store,organization}','cx:detractors_waiting','5m','{}','{}','/painel/clientes/experiencia?tab=Recuperação de Clientes',false,true),
('cx_open_risk_signals','Sinais de risco abertos','Sinais de segurança aguardando revisão humana.','customers','alert_list','{cx:view_sensitive}','{store,organization}','cx:open_risks','1m','{}','{}','/painel/clientes/experiencia?tab=Caixa de Avaliações',false,true)
on conflict(id) do update set title=excluded.title,description=excluded.description,data_source=excluded.data_source,route=excluded.route,active=true,updated_at=now();

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values('customer-experience','Experiência & Reputação','/painel/clientes/experiencia',array['avaliacao','reputacao','nps','csat','pesquisa','reclamacao','recuperacao','detrator'],'customer_experience','cx:view','★',129) on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,icon=excluded.icon,position=excluded.position;
insert into public.search_command_registry(id,title,description,keywords,command_type,route,action_type,required_permission,risk_level,scope,position) values
('cx-review-inbox','Abrir caixa de avaliações','Ver as avaliações sem resposta',array['avaliacao','resposta','reclamacao'],'navigation','/painel/clientes/experiencia?tab=Caixa de Avaliações',null,'cx:view','low','store',151),
('cx-recovery-cases','Ver recuperação de clientes','Abrir os casos de clientes insatisfeitos',array['recuperacao','detrator','cliente'],'navigation','/painel/clientes/experiencia?tab=Recuperação de Clientes',null,'cx:manage_recovery','low','store',152)
on conflict(id) do update set title=excluded.title,description=excluded.description,keywords=excluded.keywords,route=excluded.route,required_permission=excluded.required_permission,position=excluded.position;

-- cx.feedback_received carries no score, so a journey built on it invites promoters and detractors alike.
insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity) values
('cx.feedback_received',1,'customer_experience','Cliente identificado respondeu, seja qual for a nota','{"type":"object"}','{feedback.id,store.id,customer.id}','normal'),
('cx.detractor_received',1,'customer_experience','Avaliação de cliente insatisfeito recebida','{"type":"object"}','{feedback.id,store.id,customer.id}','sensitive'),
('cx.risk_signal_detected',1,'customer_experience','Sinal de risco detectado em avaliação','{"type":"object"}','{signal.id,signal.type,store.id}','sensitive'),
('cx.public_review_unanswered',1,'customer_experience','Avaliação pública com prazo de resposta vencido','{"type":"object"}','{feedback.id,store.id,critical}','normal'),
('cx.nps_drop',1,'customer_experience','Queda de NPS entre períodos com amostra suficiente','{"type":"object"}','{store.id,change}','normal'),
('cx.recovery_overdue',1,'customer_experience','Caso de recuperação com prazo vencido','{"type":"object"}','{case.id,store.id}','normal')
on conflict do nothing;

insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,idempotency_supported,action_engine_required) values
('cx_create_recovery_case','customer_experience','Abrir caso de recuperação','{}','cx:manage_recovery','low',true,false),
('cx_create_occurrence','customer_experience','Abrir ocorrência a partir de sinal de risco','{}','cx:manage_recovery','medium',true,false),
('cx_create_response_draft','customer_experience','Criar rascunho de resposta para aprovação humana','{}','cx:respond','low',true,false)
on conflict do nothing;

insert into public.notification_source_registry(id,event_type,category,source_type,title_template,summary_template,priority_rules,allowed_actions,default_recipient_rules,dedup_strategy,grouping_strategy,expiration_strategy,sensitivity) values
('cx-risk-signal','cx.risk_signal_detected','operations','cx_risk_signal','Sinal de risco em avaliação','{{summary}}','{"default":"critical"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":60}','{"key":"cx.risk_signal_detected","critical_individual":true}','{"requires_source_resolution":true}','sensitive'),
('cx-detractor','cx.detractor_received','operations','crm_feedback','Cliente insatisfeito','{{summary}}','{"default":"high"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":720}','{"key":"cx.detractor_received"}','{"requires_source_resolution":true}','sensitive'),
('cx-public-review-unanswered','cx.public_review_unanswered','operations','crm_feedback','Avaliação pública sem resposta','{{summary}}','{"default":"high"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"cx.public_review_unanswered"}','{"requires_source_resolution":true}','normal'),
('cx-recovery-overdue','cx.recovery_overdue','operations','service_recovery_case','Recuperação atrasada','{{summary}}','{"default":"high"}','["open","acknowledge"]','[]','{"key":"event:source:recipient","window_minutes":1440}','{"key":"cx.recovery_overdue"}','{"requires_source_resolution":true}','normal')
on conflict(id) do nothing;
