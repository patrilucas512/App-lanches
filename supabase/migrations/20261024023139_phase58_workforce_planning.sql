-- Phase 58: advanced workforce planning.
-- quality: allow-nonconcurrent-index reason=new-empty-phase58-tables
-- Extends Phase 18 canonical people, shifts, time clock and approvals. No duplicate employee or payroll domain.
-- Runtime coverage reads public.custom_staff_members, public.work_shifts and public.time_clock_entries as canonical sources.

alter table public.plans add column if not exists advanced_workforce_planning_enabled boolean not null default true;
alter table public.plans add column if not exists staffing_forecast_enabled boolean not null default true;
alter table public.plans add column if not exists schedule_builder_enabled boolean not null default true;
alter table public.plans add column if not exists open_shifts_enabled boolean not null default true;
alter table public.plans add column if not exists labor_planning_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists advanced_workforce_planning_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists staffing_forecast_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists schedule_builder_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists open_shifts_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists labor_planning_enabled boolean not null default true;

alter table public.workforce_settings add column if not exists staffing_bucket_minutes integer not null default 30 check(staffing_bucket_minutes in(15,30,60));
alter table public.workforce_settings add column if not exists max_scheduled_hours_week numeric(6,2) check(max_scheduled_hours_week is null or max_scheduled_hours_week>0);
alter table public.workforce_settings add column if not exists minimum_rest_hours numeric(6,2) check(minimum_rest_hours is null or minimum_rest_hours>=0);
alter table public.workforce_settings add column if not exists schedule_approval_required boolean not null default false;
alter table public.workforce_settings add column if not exists schedule_lock_hours_before_start integer not null default 0 check(schedule_lock_hours_before_start between 0 and 720);
alter table public.workforce_settings add column if not exists no_show_confirmation_minutes integer not null default 30 check(no_show_confirmation_minutes between 0 and 1440);
alter table public.workforce_settings add column if not exists skill_policy text not null default 'warn' check(skill_policy in('warn','supervisor_override','block'));

alter table public.employee_availability drop constraint if exists employee_availability_availability_check;
alter table public.employee_availability alter column available_on drop not null;
alter table public.employee_availability add column if not exists day_of_week smallint check(day_of_week between 0 and 6);
alter table public.employee_availability add column if not exists source text not null default 'employee' check(source in('employee','manager','import','system'));
alter table public.employee_availability add constraint employee_availability_type_check check(availability in('available','unavailable','preferred','limited'));
alter table public.employee_availability add constraint employee_availability_date_or_weekday_check check(available_on is not null or day_of_week is not null);

create table public.workforce_planning_member_permissions(
 organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 can_view boolean not null default false,can_create boolean not null default false,can_edit boolean not null default false,can_publish boolean not null default false,
 can_approve boolean not null default false,can_view_cost boolean not null default false,can_manage_rules boolean not null default false,
 can_manage_open_shifts boolean not null default false,can_approve_swaps boolean not null default false,can_view_network boolean not null default false,
 updated_at timestamptz not null default now(),primary key(organization_id,user_id)
);

create table public.staffing_rules(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid references public.establishments(id) on delete cascade,role_id uuid not null references public.staff_roles(id) on delete cascade,
 demand_driver text not null check(demand_driver in('orders','revenue','tables','reservations','service_requests','kitchen_load','delivery_volume','historical_staffing','business_hours','custom')),
 min_staff integer not null default 0 check(min_staff>=0),max_staff integer check(max_staff is null or max_staff>=min_staff),productivity_ratio numeric(12,4) check(productivity_ratio is null or productivity_ratio>0),
 driver_weight numeric(8,4) not null default 1 check(driver_weight>=0),coverage_window jsonb not null default '{}',active boolean not null default true,
 created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.staffing_coverage_requirements(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid not null references public.establishments(id) on delete cascade,day_of_week smallint not null check(day_of_week between 0 and 6),
 start_time time not null,end_time time not null,role_id uuid not null references public.staff_roles(id) on delete cascade,
 minimum_headcount integer not null check(minimum_headcount>=0),preferred_headcount integer not null check(preferred_headcount>=minimum_headcount),
 override_reason text,source text not null default 'local' check(source in('corporate','regional','local')),active boolean not null default true,
 created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_time>start_time)
);
create table public.staffing_role_skill_requirements(
 organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,
 role_id uuid not null references public.staff_roles(id) on delete cascade,skill_id uuid not null references public.learning_skills(id) on delete cascade,
 minimum_level text not null default 'working' check(minimum_level in('awareness','working','proficient','expert')),
 policy text not null default 'warn' check(policy in('warn','supervisor_override','block')),active boolean not null default true,
 primary key(organization_id,role_id,skill_id)
);
create table public.staffing_scenarios(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid references public.establishments(id) on delete cascade,name text not null,scenario_type text not null check(scenario_type in('conservative','base','peak','event','rain','promotion','custom')),
 assumptions jsonb not null default '{}',forecast_adjustment_percent numeric(8,2) not null default 0,version integer not null default 1,status text not null default 'draft' check(status in('draft','active','archived')),
 created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,store_id,name,version)
);
create table public.required_headcount_forecast(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid not null references public.establishments(id) on delete cascade,role_id uuid not null references public.staff_roles(id) on delete cascade,
 scenario_id uuid references public.staffing_scenarios(id) on delete set null,bucket_start timestamptz not null,bucket_end timestamptz not null,
 recommended_headcount integer not null check(recommended_headcount>=0),minimum_headcount integer not null default 0 check(minimum_headcount>=0),demand_level text not null check(demand_level in('baseline','normal','peak')),
 confidence text not null check(confidence in('high','medium','low')),reason text,source_inputs jsonb not null default '{}',
 forecast_model text not null,forecast_version text not null,forecast_generated_at timestamptz not null,created_at timestamptz not null default now(),check(bucket_end>bucket_start),
 unique(store_id,role_id,scenario_id,bucket_start)
);

create table public.work_schedules(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid not null references public.establishments(id) on delete cascade,period_start date not null,period_end date not null,
 period_type text not null default 'week' check(period_type in('week','fortnight','month','custom')),version integer not null default 1,
 status text not null default 'draft' check(status in('draft','review','approved','published','locked','archived')),
 scenario_id uuid references public.staffing_scenarios(id) on delete set null,timezone text not null default 'America/Sao_Paulo',
 publication_snapshot jsonb,validation_snapshot jsonb,created_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),published_by uuid references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),approved_at timestamptz,published_at timestamptz,locked_at timestamptz,
 check(period_end>=period_start),unique(store_id,period_start,period_end,version)
);
alter table public.work_shifts add column if not exists schedule_id uuid references public.work_schedules(id) on delete set null;
alter table public.work_shifts add column if not exists role_id uuid references public.staff_roles(id) on delete set null;
alter table public.work_shifts add column if not exists station_id uuid references public.kitchen_stations(id) on delete set null;
alter table public.work_shifts add column if not exists break_plan jsonb not null default '[]';
alter table public.work_shifts add column if not exists source text not null default 'manual' check(source in('manual','assisted_suggestion','copied','swap','adjustment'));
alter table public.work_shifts add column if not exists notes text;
alter table public.work_shifts add column if not exists acknowledged_at timestamptz;
alter table public.work_shifts add column if not exists acknowledgement_note text;
alter table public.work_shift_templates add column if not exists name text;
alter table public.work_shift_templates add column if not exists coverage_template jsonb not null default '{}';
alter table public.work_shift_templates add column if not exists template_kind text not null default 'employee' check(template_kind in('employee','store','coverage'));
create or replace view public.schedule_templates with (security_invoker=true) as select id,organization_id,store_id,name,weekdays,start_time,end_time,break_minutes,role_context,coverage_template,template_kind,active,created_by,created_at,updated_at from public.work_shift_templates;
revoke all on public.schedule_templates from public,anon;grant select on public.schedule_templates to authenticated,service_role;

create table public.open_shifts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 schedule_id uuid references public.work_schedules(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
 role_id uuid not null references public.staff_roles(id) on delete restrict,station_id uuid references public.kitchen_stations(id) on delete set null,
 start_at timestamptz not null,end_at timestamptz not null,required_skill_ids uuid[] not null default '{}',status text not null default 'open' check(status in('open','assigned','cancelled','filled')),
 notes text,assigned_employee_id uuid references public.custom_staff_members(id) on delete set null,decided_by uuid references auth.users(id),
 created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_at>start_at)
);
create table public.open_shift_interests(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 open_shift_id uuid not null references public.open_shifts(id) on delete cascade,employee_id uuid not null references public.custom_staff_members(id) on delete cascade,
 note text,status text not null default 'interested' check(status in('interested','selected','not_selected','withdrawn')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(open_shift_id,employee_id)
);
alter table public.shift_exchange_requests add column if not exists preferred_replacement_id uuid references public.custom_staff_members(id) on delete set null;
alter table public.shift_exchange_requests add column if not exists validation_snapshot jsonb;
alter table public.shift_exchange_requests add column if not exists schedule_version integer;

create table public.staffing_exceptions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid not null references public.establishments(id) on delete cascade,employee_id uuid references public.custom_staff_members(id) on delete set null,
 shift_id uuid references public.work_shifts(id) on delete set null,exception_type text not null check(exception_type in('absence','late','no_show','early_leave','emergency_coverage','schedule_conflict')),
 status text not null default 'observed' check(status in('observed','confirmed','resolved','dismissed')),privacy_summary text not null default 'indisponível',details_private text,
 confirmed_by uuid references auth.users(id),confirmed_at timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),resolved_at timestamptz
);
create table public.live_staffing_coverage(
 organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
 bucket_start timestamptz not null,role_id uuid not null references public.staff_roles(id) on delete cascade,planned integer not null default 0,present integer not null default 0,
 coverage_status text not null check(coverage_status in('covered','attention','critical_gap')),uncertain_count integer not null default 0,data_as_of timestamptz not null default now(),
 primary key(store_id,bucket_start,role_id)
);
create table public.workforce_planning_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,
 job_type text not null check(job_type in('staffing_forecast','schedule_suggestions','coverage_snapshot','labor_variance','notification_dispatch')),
 payload jsonb not null default '{}',status text not null default 'pending' check(status in('pending','leased','completed','failed','dead_lettered','cancelled')),
 priority smallint not null default 50,available_at timestamptz not null default now(),leased_until timestamptz,attempts integer not null default 0,max_attempts integer not null default 3,
 idempotency_key text not null,last_error text,created_at timestamptz not null default now(),completed_at timestamptz,unique(organization_id,idempotency_key)
);
create table public.workforce_planning_audit_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete set null,
 actor_user_id uuid references auth.users(id),employee_id uuid references public.custom_staff_members(id) on delete set null,action text not null,entity_type text not null,entity_id uuid,
 reason text,before_state jsonb,after_state jsonb,correlation_id uuid not null default gen_random_uuid(),created_at timestamptz not null default now()
);

create table public.fact_staffing_demand_forecast(organization_id uuid not null,store_id uuid not null,role_id uuid not null,bucket_start timestamptz not null,required_headcount integer not null,confidence text not null,model_version text not null,data_as_of timestamptz not null,primary key(store_id,role_id,bucket_start));
create table public.fact_scheduled_shifts(organization_id uuid not null,store_id uuid not null,schedule_id uuid not null,shift_id uuid not null,role_id uuid,employee_id uuid,shift_date date not null,planned_minutes integer not null,source text not null,data_as_of timestamptz not null,primary key(shift_id));
create table public.fact_schedule_coverage(organization_id uuid not null,store_id uuid not null,role_id uuid not null,bucket_start timestamptz not null,required_headcount integer not null,scheduled_headcount integer not null,gap integer not null,status text not null,data_as_of timestamptz not null,primary key(store_id,role_id,bucket_start));
create table public.fact_open_shifts(organization_id uuid not null,store_id uuid not null,open_shift_id uuid not null,status text not null,planned_minutes integer not null,data_as_of timestamptz not null,primary key(open_shift_id));
create table public.fact_shift_swaps(organization_id uuid not null,store_id uuid,swap_id uuid not null,status text not null,requested_at timestamptz not null,decided_at timestamptz,data_as_of timestamptz not null,primary key(swap_id));
create table public.fact_labor_plan_variance(organization_id uuid not null,store_id uuid not null,period_date date not null,budgeted_cents bigint,planned_cents bigint,forecast_cents bigint,actual_cents bigint,planned_minutes integer,actual_minutes integer,data_as_of timestamptz not null,primary key(store_id,period_date));

create index staffing_rules_scope_idx on public.staffing_rules(organization_id,store_id,role_id,active);
create index staffing_coverage_scope_idx on public.staffing_coverage_requirements(store_id,day_of_week,start_time,role_id);
create index staffing_forecast_bucket_idx on public.required_headcount_forecast(store_id,bucket_start,role_id);
create index work_schedules_scope_idx on public.work_schedules(store_id,period_start,period_end,status,version desc);
create index work_shifts_schedule_idx on public.work_shifts(schedule_id,starts_at,role_id);
create index open_shifts_scope_idx on public.open_shifts(store_id,status,start_at);
create index open_shift_interests_employee_idx on public.open_shift_interests(employee_id,status,created_at desc);
create index staffing_exceptions_scope_idx on public.staffing_exceptions(store_id,status,created_at desc);
create index workforce_planning_jobs_due_idx on public.workforce_planning_jobs(status,priority desc,available_at) where status='pending';
create index workforce_planning_audit_idx on public.workforce_planning_audit_events(organization_id,created_at desc);

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('schedule_coverage_rate','Cobertura da escala','Posições escaladas sobre necessidade prevista.','semantic:schedule_coverage_rate','fact_schedule_coverage','função/faixa','Pessoas','hourly','percent','calculation',false,array['date','store','role','region']),
('coverage_gap_hours','Horas com gap de cobertura','Soma das posições ausentes multiplicada pela duração.','semantic:coverage_gap_hours','fact_schedule_coverage','função/faixa','Pessoas','hourly','hours','calculation',false,array['date','store','role','region']),
('open_shift_count','Turnos abertos','Turnos ainda sem responsável.','semantic:open_shift_count','fact_open_shifts','turno','Pessoas','realtime','count','fact',false,array['date','store','role']),
('planned_labor_hours','Horas planejadas','Minutos planejados divididos por 60.','semantic:planned_labor_hours','fact_scheduled_shifts','turno','Pessoas','hourly','hours','calculation',false,array['date','store','role']),
('labor_plan_variance','Variação do plano de mão de obra','Real menos planejado.','semantic:labor_plan_variance','fact_labor_plan_variance','unidade/dia','Financeiro','daily','currency','calculation',true,array['date','store','region']),
('staffing_forecast_accuracy','Acurácia da previsão de equipe','Erro de demanda avaliado com fila, tempo de serviço e pedidos.','semantic:staffing_forecast_accuracy','fact_staffing_demand_forecast','unidade/faixa','Operações','daily','percent','estimate',false,array['date','store','role'])
on conflict(metric_key) do nothing;

insert into public.report_dataset_registry(id,name,description,source,available_metrics,available_dimensions,available_filters,supported_time_granularity,required_permissions,realtime_or_analytical,sensitivity,column_policy) values
('workforce_planning','Planejamento de equipe','Escalas, cobertura e demanda sem decisões automáticas de emprego.','hybrid','{schedule_coverage_rate,coverage_gap_hours,open_shift_count,planned_labor_hours,staffing_forecast_accuracy}','{date,store,role,region}','{date,store,role,status}','{hour,day,week,month}','{workforce_planning:view}','hybrid','restricted','{"individual_compensation":{"viewable":false,"exportable":false,"permission":"workforce_planning:view_cost"}}'),
('labor_variance','Variação de mão de obra','Budget, planejado, forecast e realizado em visão agregada.','warehouse','{labor_plan_variance,planned_labor_hours}','{date,store,region}','{date,store,region}','{day,week,month}','{workforce_planning:view_cost}','analytical','financial','{"employee_rate":{"viewable":false,"exportable":false}}')
on conflict(id) do update set name=excluded.name,description=excluded.description,available_metrics=excluded.available_metrics,required_permissions=excluded.required_permissions,column_policy=excluded.column_policy,updated_at=now();
insert into public.report_templates(name,description,category,dataset_id,definition_json,system_template,read_only,required_permissions,widget_compatible) values
('Escala Planejada','Turnos por unidade, função e período.','Pessoas','workforce_planning','{"metrics":["planned_labor_hours"],"dimensions":["date","store","role"],"visualization":"table"}',true,true,'{workforce_planning:view}',true),
('Cobertura por Hora','Necessário, escalado e gap por faixa.','Pessoas','workforce_planning','{"metrics":["schedule_coverage_rate","coverage_gap_hours"],"dimensions":["date","store","role"],"visualization":"heatmap"}',true,true,'{workforce_planning:view}',true),
('Horas Planejadas x Realizadas','Comparação agregada entre escala e ponto.','Pessoas','labor_variance','{"metrics":["planned_labor_hours","labor_plan_variance"],"dimensions":["date","store"],"visualization":"line"}',true,true,'{workforce_planning:view_cost}',true),
('Custo de Mão de Obra','Budget, planejado, forecast e realizado.','Financeiro','labor_variance','{"metrics":["labor_plan_variance"],"dimensions":["date","store"],"visualization":"table"}',true,true,'{workforce_planning:view_cost}',true),
('Gaps de Cobertura','Períodos com cobertura abaixo da recomendação.','Pessoas','workforce_planning','{"metrics":["coverage_gap_hours"],"dimensions":["date","store","role"],"visualization":"table"}',true,true,'{workforce_planning:view}',true),
('Turnos Abertos','Turnos abertos por unidade e função.','Pessoas','workforce_planning','{"metrics":["open_shift_count"],"dimensions":["date","store","role"],"visualization":"table"}',true,true,'{workforce_planning:manage_open_shifts}',true)
on conflict do nothing;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,size_options,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('today_coverage','Cobertura de hoje','Planejado, presente e gap atual por área.','people','status_list','["medium","large"]','{workforce_planning:view}','{store,network}','workforce_planning:live_coverage','1m','{}','{}','/painel/escalas',true,false),
('open_shifts','Turnos abertos','Turnos ainda sem responsável.','people','status_list','["small","medium"]','{workforce_planning:manage_open_shifts}','{store,network}','workforce_planning:open_shifts','event-driven','{}','{}','/painel/escalas',true,false),
('schedule_warnings','Alertas da escala','Conflitos, skills e períodos descobertos.','people','alert_list','["medium","large"]','{workforce_planning:view}','{store,network}','workforce_planning:warnings','5m','{}','{}','/painel/escalas',false,false),
('labor_cost_budget','Custo de equipe x budget','Comparação financeira agregada.','finance','metric_card','["medium","large"]','{workforce_planning:view_cost}','{store,network}','workforce_planning:labor','5m','{}','{}','/painel/escalas?tab=analytics',false,true),
('tomorrow_peak','Pico de amanhã','Maior faixa prevista e cobertura planejada.','operations','metric_card','["small","medium"]','{workforce_planning:view}','{store,network}','workforce_planning:peak','5m','{}','{}','/painel/escalas',true,false)
on conflict(id) do update set title=excluded.title,description=excluded.description,required_permissions=excluded.required_permissions,data_source=excluded.data_source,route=excluded.route;

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values
('workforce-planning','Planejador de Escalas','/painel/escalas',array['escala','cobertura','turno','equipe','pico'],'workforce_planning','workforce_planning:view','◫',68),
('my-schedule','Minha Escala','/equipe/escala',array['meus turnos','horário','escala'],'workforce_planning','workforce_planning:view','◷',69)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,position=excluded.position;

insert into public.notification_source_registry(id,event_type,category,source_type,title_template,summary_template,priority_rules,allowed_actions,default_recipient_rules,dedup_strategy,grouping_strategy,expiration_strategy) values
('staffing-gap','staffing.coverage_gap','workforce','schedule','Cobertura abaixo da recomendação','Há uma faixa crítica sem cobertura suficiente.','{"default":"high"}','["open","acknowledge","create_task"]','["manager"]','{"key":"store:role:bucket"}','{}','{"expires_hours":24}'),
('schedule-published','staffing.schedule_published','workforce','schedule','Nova escala publicada','Consulte seus próximos turnos e alterações.','{"default":"info"}','["open","acknowledge"]','["affected_employees"]','{"key":"schedule:version:recipient"}','{}','{"expires_hours":720}'),
('open-shift','staffing.open_shift','workforce','open_shift','Turno aberto','Existe um turno aberto elegível para manifestação de interesse.','{"default":"medium"}','["open","acknowledge"]','["eligible_employees"]','{"key":"open_shift:recipient"}','{}','{"expires_hours":72}'),
('staffing-no-show','staffing.no_show_confirmed','workforce','staffing_exception','Ausência confirmada','Uma ausência foi confirmada e pode exigir cobertura.','{"default":"critical"}','["open","acknowledge","create_task"]','["manager"]','{"key":"exception:store"}','{}','{"expires_hours":24}'),
('staffing-forecast-change','staffing.forecast_changed','workforce','staffing_forecast','Demanda prevista mudou','A previsão mudou; nenhuma escala foi alterada automaticamente.','{"default":"high"}','["open","acknowledge"]','["manager"]','{"key":"store:forecast_window"}','{}','{"expires_hours":48}')
on conflict(event_type) do update set title_template=excluded.title_template,summary_template=excluded.summary_template,allowed_actions=excluded.allowed_actions,dedup_strategy=excluded.dedup_strategy;

insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity) values
('staffing.coverage_gap',1,'workforce_planning','Gap de cobertura','{"type":"object"}','{store.id,role.id,bucket.start,gap}','sensitive'),
('staffing.schedule_published',1,'workforce_planning','Escala publicada por gestor','{"type":"object"}','{schedule.id,schedule.version,store.id}','sensitive'),
('staffing.open_shift',1,'workforce_planning','Turno aberto','{"type":"object"}','{open_shift.id,store.id,role.id,start_at,end_at}','sensitive'),
('staffing.no_show_confirmed',1,'workforce_planning','Ausência confirmada por pessoa autorizada','{"type":"object"}','{exception.id,store.id,shift.id}','sensitive'),
('staffing.forecast_changed',1,'workforce_planning','Mudança material na previsão','{"type":"object"}','{store.id,window.start,change_percent}','normal')
on conflict(event_name,schema_version) do nothing;
insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,action_engine_required,registered_destination_only) values
('notify_staffing_manager','workforce_planning','Notificar gestor sobre cobertura','{"type":"object","required":["store_id"]}','workforce_planning:view','low',false,true),
('create_staffing_task','workforce_planning','Criar tarefa de atenção','{"type":"object","required":["store_id"]}','workforce_planning:view','medium',false,false),
('create_open_shift','workforce_planning','Criar turno aberto sem designar funcionário','{"type":"object","required":["store_id","role_id","start_at","end_at"]}','workforce_planning:manage_open_shifts','medium',true,false)
on conflict(action_type) do nothing;

do $$ declare t text; begin foreach t in array array[
 'workforce_planning_member_permissions','staffing_rules','staffing_coverage_requirements','staffing_role_skill_requirements','staffing_scenarios','required_headcount_forecast','work_schedules','open_shifts','open_shift_interests','staffing_exceptions','live_staffing_coverage','workforce_planning_jobs','workforce_planning_audit_events','fact_staffing_demand_forecast','fact_scheduled_shifts','fact_schedule_coverage','fact_open_shifts','fact_shift_swaps','fact_labor_plan_variance'
] loop execute format('alter table public.%I enable row level security',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',t||'_service_only',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;

comment on table public.work_schedules is 'Human-published, versioned workforce plans. Suggestions never publish automatically.';
comment on table public.staffing_exceptions is 'Operational exceptions only; never an automatic disciplinary decision.';
comment on table public.fact_labor_plan_variance is 'Aggregated managerial estimate; not payroll or universal legal overtime calculation.';
