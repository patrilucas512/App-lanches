-- Phase 56: Learning Center / internal corporate university.
-- custom_staff_members remains the employee source of truth. Documents, tasks and notifications remain owned by their source modules.
alter table public.plans
 add column if not exists learning_center_enabled boolean not null default true,
 add column if not exists learning_paths_enabled boolean not null default true,
 add column if not exists assessments_enabled boolean not null default true,
 add column if not exists internal_certifications_enabled boolean not null default true,
 add column if not exists learning_ai_assistant_enabled boolean not null default false;
alter table public.store_feature_flags
 add column if not exists learning_center_enabled boolean not null default true,
 add column if not exists learning_paths_enabled boolean not null default true,
 add column if not exists assessments_enabled boolean not null default true,
 add column if not exists internal_certifications_enabled boolean not null default true,
 add column if not exists learning_ai_assistant_enabled boolean not null default false;

create table public.learning_member_permissions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 permissions text[] not null default '{learning:view_own}',scope_type text not null default 'organization' check(scope_type in('organization','region','brand','store','team')),
 scope_id uuid,active boolean not null default true,updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),
 unique(id,organization_id)
);
create unique index learning_member_permission_scope_uq on public.learning_member_permissions(organization_id,user_id,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table public.learning_courses(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 title text not null check(length(btrim(title)) between 2 and 160),slug text not null,summary text not null default '',description text,
 category text not null default 'operational',difficulty text not null default 'basic' check(difficulty in('basic','intermediate','advanced')),
 status text not null default 'draft' check(status in('draft','review','published','archived')),estimated_minutes integer not null default 0 check(estimated_minutes between 0 and 100000),
 owner_user_id uuid references auth.users(id),current_version_id uuid,thumbnail_url text,language text not null default 'pt-BR',
 created_by uuid not null references auth.users(id),published_by uuid references auth.users(id),published_at timestamptz,archived_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,slug)
);
create table public.learning_course_versions(
 id uuid primary key default gen_random_uuid(),course_id uuid not null references public.learning_courses(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,version integer not null check(version>0),
 status text not null default 'draft' check(status in('draft','published','superseded','archived')),title text not null,summary text not null default '',
 description text,estimated_minutes integer not null default 0,content_hash text not null,change_summary text not null default 'Versão inicial',
 immutable boolean not null default false,created_by uuid not null references auth.users(id),published_by uuid references auth.users(id),
 published_at timestamptz,created_at timestamptz not null default now(),unique(course_id,version),unique(course_id,content_hash)
);
alter table public.learning_courses add constraint learning_courses_current_version_fk foreign key(current_version_id) references public.learning_course_versions(id) on delete set null;
create table public.learning_modules(
 id uuid primary key default gen_random_uuid(),course_version_id uuid not null references public.learning_course_versions(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,title text not null,description text,position integer not null check(position>=0),
 estimated_minutes integer not null default 0,created_at timestamptz not null default now(),unique(course_version_id,position)
);
create table public.learning_lessons(
 id uuid primary key default gen_random_uuid(),module_id uuid not null references public.learning_modules(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,title text not null,position integer not null check(position>=0),
 lesson_type text not null check(lesson_type in('text','video','document','checklist','interactive','live','external_link')),
 content_json jsonb not null default '{}',document_id uuid references public.compliance_documents(id) on delete set null,
 safe_external_url text check(safe_external_url is null or safe_external_url ~ '^https://'),estimated_minutes integer not null default 0,
 completion_rule text not null default 'opened' check(completion_rule in('opened','viewed_90_percent','checklist_complete','manual_confirmation','assessment_passed','practical_validated')),
 offline_allowed boolean not null default false,confidential boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(module_id,position),check(not(content_json ? 'html'))
);
create table public.learning_paths(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,description text,
 status text not null default 'draft' check(status in('draft','published','archived')),scope_type text not null default 'organization' check(scope_type in('organization','brand','region','store')),
 scope_id uuid,locked boolean not null default false,estimated_minutes integer not null default 0,created_by uuid not null references auth.users(id),published_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,name)
);
create table public.learning_path_items(
 path_id uuid not null references public.learning_paths(id) on delete cascade,course_id uuid not null references public.learning_courses(id) on delete restrict,
 position integer not null check(position>=0),required boolean not null default true,unlock_rule jsonb not null default '{}',primary key(path_id,course_id),unique(path_id,position)
);
create table public.learning_requirements(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 course_id uuid references public.learning_courses(id) on delete cascade,path_id uuid references public.learning_paths(id) on delete cascade,
 requirement_type text not null default 'mandatory' check(requirement_type in('mandatory','recommended','optional')),
 target_type text not null check(target_type in('organization','brand','region','store','team','role','employee')),target_id text,
 source_scope_type text not null default 'organization' check(source_scope_type in('organization','brand','region','store')),source_scope_id uuid,
 inherited boolean not null default false,locked boolean not null default false,due_days integer check(due_days is null or due_days>=0),
 recurrence_months integer check(recurrence_months is null or recurrence_months>0),active boolean not null default true,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((course_id is not null)::integer+(path_id is not null)::integer=1)
);
create table public.learning_enrollments(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid references public.establishments(id) on delete set null,employee_id uuid not null references public.custom_staff_members(id) on delete cascade,
 user_id uuid references auth.users(id) on delete set null,course_id uuid not null references public.learning_courses(id) on delete restrict,
 course_version_id uuid not null references public.learning_course_versions(id) on delete restrict,requirement_id uuid references public.learning_requirements(id) on delete set null,
 source text not null default 'manual' check(source in('manual','requirement','path','onboarding','recertification','automation')),
 cycle_key text not null default 'initial',status text not null default 'assigned' check(status in('assigned','in_progress','completed','expired','exempted','cancelled')),
 assigned_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,due_at timestamptz,expires_at timestamptz,
 progress_percent numeric(5,2) not null default 0 check(progress_percent between 0 and 100),exemption_reason text,exempted_by uuid references auth.users(id),
 last_activity_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(employee_id,course_id,cycle_key)
);
create table public.learning_lesson_progress(
 enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,lesson_id uuid not null references public.learning_lessons(id) on delete restrict,
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,status text not null default 'not_started' check(status in('not_started','in_progress','completed')),
 progress_percent numeric(5,2) not null default 0 check(progress_percent between 0 and 100),last_position_seconds integer not null default 0,
 completion_evidence jsonb not null default '{}',device_event_id text,started_at timestamptz,completed_at timestamptz,updated_at timestamptz not null default now(),
 primary key(enrollment_id,lesson_id),unique(employee_id,device_event_id)
);
create table public.employee_learning_onboarding(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,path_id uuid not null references public.learning_paths(id) on delete restrict,
 store_id uuid references public.establishments(id) on delete set null,status text not null default 'pending' check(status in('pending','in_progress','completed','cancelled')),
 target_date date,completed_at timestamptz,source text not null default 'learning_path',created_at timestamptz not null default now(),unique(employee_id,path_id)
);
create table public.learning_assessments(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 course_version_id uuid not null references public.learning_course_versions(id) on delete cascade,title text not null,assessment_type text not null default 'quiz' check(assessment_type in('quiz','exam','practical','survey')),
 passing_score numeric(5,2) check(passing_score between 0 and 100),max_attempts integer not null default 3 check(max_attempts between 1 and 20),
 time_limit_minutes integer,randomize_questions boolean not null default false,show_feedback_after_submission boolean not null default true,
 active boolean not null default true,created_at timestamptz not null default now()
);
create table public.learning_assessment_questions(
 id uuid primary key default gen_random_uuid(),assessment_id uuid not null references public.learning_assessments(id) on delete cascade,
 prompt text not null,question_type text not null check(question_type in('single_choice','multiple_choice','true_false','short_answer','practical')),
 position integer not null,points numeric(8,2) not null default 1 check(points>0),explanation text,manual_review_required boolean not null default false,
 created_at timestamptz not null default now(),unique(assessment_id,position)
);
create table public.learning_assessment_options(
 id uuid primary key default gen_random_uuid(),question_id uuid not null references public.learning_assessment_questions(id) on delete cascade,
 label text not null,position integer not null,is_correct boolean not null default false,created_at timestamptz not null default now(),unique(question_id,position)
);
create table public.learning_assessment_attempts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 assessment_id uuid not null references public.learning_assessments(id) on delete restrict,enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,attempt_number integer not null,status text not null default 'in_progress' check(status in('in_progress','submitted','under_review','passed','failed','invalidated')),
 score numeric(5,2),passed boolean,started_at timestamptz not null default now(),submitted_at timestamptz,graded_at timestamptz,graded_by uuid references auth.users(id),
 integrity_snapshot jsonb not null default '{}',unique(enrollment_id,assessment_id,attempt_number)
);
create table public.learning_assessment_answers(
 attempt_id uuid not null references public.learning_assessment_attempts(id) on delete cascade,question_id uuid not null references public.learning_assessment_questions(id) on delete restrict,
 selected_option_ids uuid[] not null default '{}',free_text text,awarded_points numeric(8,2),correct boolean,review_notes text,
 answered_at timestamptz not null default now(),primary key(attempt_id,question_id)
);
create table public.learning_practical_validations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,assessment_id uuid references public.learning_assessments(id) on delete set null,
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,validator_user_id uuid not null references auth.users(id),
 result text not null check(result in('approved','needs_practice','rejected')),checklist_result jsonb not null default '{}',notes text,validated_at timestamptz not null default now()
);
create table public.learning_internal_certifications(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,course_id uuid not null references public.learning_courses(id) on delete restrict,
 enrollment_id uuid not null references public.learning_enrollments(id) on delete restrict,title text not null,certificate_kind text not null default 'internal' check(certificate_kind='internal'),
 public_token_hash text not null unique,issued_at timestamptz not null default now(),expires_at timestamptz,revoked_at timestamptz,revoked_by uuid references auth.users(id),
 revocation_reason text,metadata jsonb not null default '{}',unique(enrollment_id)
);
comment on table public.learning_internal_certifications is 'Certificação interna do MasterApp; não representa habilitação legal ou profissional externa.';
create table public.learning_external_certifications(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,name text not null,provider text not null,credential_number text,
 issued_on date,expires_on date,document_id uuid references public.compliance_documents(id) on delete set null,
 review_status text not null default 'pending' check(review_status in('pending','verified_document','rejected','expired')),reviewed_by uuid references auth.users(id),reviewed_at timestamptz,notes text,
 created_at timestamptz not null default now()
);
create table public.learning_skills(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,category text not null default 'operational',
 description text,active boolean not null default true,created_at timestamptz not null default now(),unique(organization_id,name)
);
create table public.learning_course_skills(course_id uuid not null references public.learning_courses(id) on delete cascade,skill_id uuid not null references public.learning_skills(id) on delete cascade,level text not null default 'awareness' check(level in('awareness','working','proficient','expert')),primary key(course_id,skill_id));
create table public.employee_learning_skills(
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,skill_id uuid not null references public.learning_skills(id) on delete cascade,
 level text not null check(level in('awareness','working','proficient','expert')),source_type text not null check(source_type in('course','practical_validation','manager_review','external_certification')),
 source_id uuid,acquired_at timestamptz not null default now(),expires_at timestamptz,last_reviewed_at timestamptz,primary key(employee_id,skill_id)
);
create table public.learning_policies(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,description text,
 policy_type text not null check(policy_type in('assignment','completion','assessment','certification','recertification','retention')),
 scope_type text not null default 'organization' check(scope_type in('organization','brand','region','store')),scope_id uuid,configuration jsonb not null default '{}',
 locked boolean not null default false,active boolean not null default true,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.learning_course_feedback(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,enrollment_id uuid not null unique references public.learning_enrollments(id) on delete cascade,
 employee_id uuid not null references public.custom_staff_members(id) on delete cascade,rating integer not null check(rating between 1 and 5),comment text,created_at timestamptz not null default now()
);
create table public.learning_ai_drafts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,created_by uuid not null references auth.users(id),
 draft_type text not null check(draft_type in('course_outline','lesson','question_bank','summary','tutor_response')),
 prompt_redacted text not null,grounding_references jsonb not null default '[]',draft_content jsonb not null,status text not null default 'draft' check(status in('draft','accepted','discarded')),
 exam_mode boolean not null default false,created_at timestamptz not null default now(),check(not(exam_mode and draft_type='tutor_response'))
);
create table public.learning_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 job_type text not null check(job_type in('assign_requirements','recalculate_progress','recertification_due','compliance_snapshot','notification_dispatch')),
 entity_id uuid,payload jsonb not null default '{}',status text not null default 'pending' check(status in('pending','leased','completed','failed','dead_lettered','cancelled')),
 priority smallint not null default 50,available_at timestamptz not null default now(),leased_until timestamptz,attempts integer not null default 0,max_attempts integer not null default 3,
 idempotency_key text not null,last_error text,created_at timestamptz not null default now(),completed_at timestamptz,unique(organization_id,idempotency_key)
);
create table public.learning_compliance_snapshots(
 organization_id uuid not null references public.organizations(id) on delete cascade,snapshot_date date not null,scope_type text not null,scope_id text not null default '',
 assigned_count integer not null default 0,completed_count integer not null default 0,overdue_count integer not null default 0,expiring_certifications integer not null default 0,
 completion_rate numeric(5,2) not null default 0,data_as_of timestamptz not null default now(),primary key(organization_id,snapshot_date,scope_type,scope_id)
);
create table public.learning_audit_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,actor_user_id uuid references auth.users(id),
 employee_id uuid references public.custom_staff_members(id) on delete set null,entity_type text not null,entity_id uuid,action text not null,reason text,before_state jsonb,after_state jsonb,
 correlation_id uuid not null default gen_random_uuid(),created_at timestamptz not null default now()
);

create index learning_course_org_status_idx on public.learning_courses(organization_id,status,updated_at desc);
create index learning_modules_version_idx on public.learning_modules(course_version_id,position);
create index learning_lessons_module_idx on public.learning_lessons(module_id,position);
create index learning_requirements_target_idx on public.learning_requirements(organization_id,target_type,target_id,active);
create index learning_enrollments_employee_idx on public.learning_enrollments(employee_id,status,due_at);
create index learning_enrollments_org_store_idx on public.learning_enrollments(organization_id,store_id,status,due_at);
create index learning_progress_employee_idx on public.learning_lesson_progress(employee_id,status,updated_at desc);
create index learning_attempts_enrollment_idx on public.learning_assessment_attempts(enrollment_id,assessment_id,attempt_number desc);
create index learning_cert_expiry_idx on public.learning_internal_certifications(organization_id,expires_at) where revoked_at is null;
create index learning_external_cert_expiry_idx on public.learning_external_certifications(organization_id,expires_on);
create index learning_jobs_due_idx on public.learning_jobs(status,priority desc,available_at) where status='pending';
create index learning_audit_org_idx on public.learning_audit_events(organization_id,created_at desc);

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('learning_completion_rate','Conclusão de treinamentos','Matrículas concluídas sobre matrículas atribuídas.','semantic:learning_completion_rate','learning_compliance_snapshots','unidade/dia','Pessoas','daily','percent','calculation',false,array['date','store','region','brand']),
('learning_overdue_count','Treinamentos vencidos','Matrículas obrigatórias vencidas e não concluídas.','semantic:learning_overdue_count','learning_enrollments','matrícula','Pessoas','hourly','count','calculation',false,array['date','store','region','brand'])
on conflict(metric_key) do nothing;
insert into public.report_dataset_registry(id,name,description,source,available_metrics,available_dimensions,available_filters,supported_time_granularity,required_permissions,realtime_or_analytical,sensitivity,column_policy) values
('learning','Aprendizado e conformidade','Conclusão, vencimentos e certificações internas sem expor respostas individuais.','hybrid','{learning_completion_rate,learning_overdue_count}','{date,store,region,brand}','{date,store,region,brand}','{day,week,month}','{learning:view_reports}','hybrid','normal','{"assessment_answers":{"viewable":false,"exportable":false,"sensitive":true}}')
on conflict(id) do update set name=excluded.name,description=excluded.description,available_metrics=excluded.available_metrics,required_permissions=excluded.required_permissions,column_policy=excluded.column_policy,updated_at=now();
insert into public.report_templates(name,description,category,dataset_id,definition_json,system_template,read_only,required_permissions,widget_compatible) values
('Conformidade de Treinamentos','Conclusão e pendências por unidade, sem ranking punitivo individual.','Pessoas','learning','{"metrics":["learning_completion_rate","learning_overdue_count"],"dimensions":["store"],"period":{"preset":"30d","relative":true},"visualization":"table"}',true,true,'{learning:view_reports}',true)
on conflict do nothing;
insert into public.workspace_widget_registry(id,title,description,category,widget_type,size_options,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('my_learning','Meu aprendizado','Treinamentos pendentes, progresso e certificações internas.','people','progress','["medium","large"]','{learning:view_own}','{store,network}','learning:mine','event-driven','{}','{}','/painel/aprendizado',true,false),
('learning_compliance','Conformidade de treinamento','Conclusão e pendências agregadas por escopo.','people','status_list','["medium","large"]','{learning:view_reports}','{store,network}','learning:compliance','5m','{}','{}','/painel/treinamentos',false,false)
on conflict(id) do update set title=excluded.title,description=excluded.description,required_permissions=excluded.required_permissions,data_source=excluded.data_source,route=excluded.route;
insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values
('my-learning','Meu aprendizado','/painel/aprendizado',array['curso','treinamento','certificado','aprender'],'learning','learning:view_own','◫',66),
('learning-admin','Centro de Aprendizado','/painel/treinamentos',array['universidade','curso','onboarding','conformidade'],'learning','learning:manage','▤',67)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,required_permission=excluded.required_permission,position=excluded.position;
insert into public.notification_source_registry(id,event_type,category,source_type,title_template,summary_template,priority_rules,allowed_actions,default_recipient_rules,dedup_strategy,grouping_strategy,expiration_strategy) values
('learning-assigned','learning.assigned','learning','learning_enrollment','Novo treinamento atribuído','Um treinamento foi adicionado ao seu aprendizado.','{"default":"info"}','["open","acknowledge"]','["employee_user"]','{"key":"enrollment:recipient"}','{}','{"expires_hours":720}'),
('learning-due','learning.due_soon','learning','learning_enrollment','Treinamento próximo do vencimento','Há um treinamento obrigatório próximo do prazo.','{"default":"high"}','["open","acknowledge"]','["employee_user","manager"]','{"key":"enrollment:due"}','{}','{"expires_hours":168}'),
('learning-cert-expiring','learning.certification_expiring','learning','learning_internal_certification','Certificação interna próxima do vencimento','A recertificação interna precisa ser concluída.','{"default":"high"}','["open","acknowledge"]','["employee_user","manager"]','{"key":"certificate:expiry"}','{}','{"expires_hours":720}')
on conflict(event_type) do update set title_template=excluded.title_template,summary_template=excluded.summary_template,allowed_actions=excluded.allowed_actions;
insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity) values
('learning.assigned',1,'learning','Treinamento atribuído','{"type":"object"}','{enrollment.id,course.id,employee.id,store.id}','sensitive'),
('learning.completed',1,'learning','Treinamento concluído','{"type":"object"}','{enrollment.id,course.id,employee.id,store.id}','sensitive'),
('learning.overdue',1,'learning','Treinamento obrigatório vencido','{"type":"object"}','{enrollment.id,course.id,employee.id,store.id,due_at}','sensitive'),
('learning.certification_expiring',1,'learning','Certificação interna próxima do vencimento','{"type":"object"}','{certification.id,course.id,employee.id,expires_at}','sensitive')
on conflict(event_name,schema_version) do nothing;
insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,action_engine_required,registered_destination_only) values
('assign_learning','learning','Atribuir treinamento publicado','{"type":"object","required":["course_id","employee_id"]}','learning:assign','medium',false,false),
('send_learning_reminder','learning','Enviar lembrete de treinamento','{"type":"object","required":["enrollment_id"]}','learning:assign','low',false,true),
('create_learning_task','learning','Criar tarefa ligada a uma pendência de aprendizado','{"type":"object","required":["enrollment_id"]}','learning:manage','medium',false,false)
on conflict(action_type) do nothing;

do $$ declare t text; begin foreach t in array array[
 'learning_member_permissions','learning_courses','learning_course_versions','learning_modules','learning_lessons','learning_paths','learning_path_items','learning_requirements','learning_enrollments','learning_lesson_progress','employee_learning_onboarding','learning_assessments','learning_assessment_questions','learning_assessment_options','learning_assessment_attempts','learning_assessment_answers','learning_practical_validations','learning_internal_certifications','learning_external_certifications','learning_skills','learning_course_skills','employee_learning_skills','learning_policies','learning_course_feedback','learning_ai_drafts','learning_jobs','learning_compliance_snapshots','learning_audit_events'
 ] loop execute format('alter table public.%I enable row level security',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',t||'_service_only',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
grant select on public.learning_courses,public.learning_course_versions,public.learning_modules,public.learning_lessons,public.learning_paths,public.learning_path_items to authenticated;
create policy learning_courses_tenant_read on public.learning_courses for select to authenticated using(status='published' and organization_id in(select organization_id from public.organization_members where user_id=(select auth.uid()) and active));
create policy learning_versions_tenant_read on public.learning_course_versions for select to authenticated using(status='published' and organization_id in(select organization_id from public.organization_members where user_id=(select auth.uid()) and active));
create policy learning_modules_tenant_read on public.learning_modules for select to authenticated using(organization_id in(select organization_id from public.organization_members where user_id=(select auth.uid()) and active) and exists(select 1 from public.learning_course_versions v where v.id=learning_modules.course_version_id and v.status='published'));
create policy learning_lessons_tenant_read on public.learning_lessons for select to authenticated using(organization_id in(select organization_id from public.organization_members where user_id=(select auth.uid()) and active) and exists(select 1 from public.learning_modules m join public.learning_course_versions v on v.id=m.course_version_id where m.id=learning_lessons.module_id and v.status='published'));
create policy learning_paths_tenant_read on public.learning_paths for select to authenticated using(status='published' and organization_id in(select organization_id from public.organization_members where user_id=(select auth.uid()) and active));
create policy learning_path_items_tenant_read on public.learning_path_items for select to authenticated using(exists(select 1 from public.learning_paths p join public.organization_members om on om.organization_id=p.organization_id and om.user_id=(select auth.uid()) and om.active where p.id=learning_path_items.path_id and p.status='published'));

comment on table public.learning_assessment_options is 'Answer keys are service-role only and never returned during an active attempt.';
comment on table public.learning_ai_drafts is 'AI content is a draft requiring human review; AI never publishes, certifies or grades assessments.';
