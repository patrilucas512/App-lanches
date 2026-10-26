-- Phase 50: safe, tenant-scoped workflow orchestration. Core operational invariants remain in their source modules.
alter table public.plans
  add column if not exists automation_center_enabled boolean not null default true,
  add column if not exists workflow_builder_enabled boolean not null default true,
  add column if not exists workflow_simulation_enabled boolean not null default true,
  add column if not exists workflow_ai_builder_enabled boolean not null default true,
  add column if not exists network_workflows_enabled boolean not null default true;
alter table public.store_feature_flags
  add column if not exists automation_center_enabled boolean not null default true,
  add column if not exists workflow_builder_enabled boolean not null default true,
  add column if not exists workflow_simulation_enabled boolean not null default true,
  add column if not exists workflow_ai_builder_enabled boolean not null default true,
  add column if not exists network_workflows_enabled boolean not null default true;

create table public.automation_event_registry(
  event_name text not null, schema_version integer not null default 1, module text not null, description text not null,
  payload_schema jsonb not null, allowed_fields text[] not null default '{}', sensitivity text not null default 'normal' check(sensitivity in('normal','sensitive','restricted')),
  deprecated_at timestamptz, replacement_event_name text, active boolean not null default true, created_at timestamptz not null default now(),
  primary key(event_name,schema_version), check(event_name ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);
create table public.automation_action_registry(
  action_type text primary key, module text not null, description text not null, input_schema jsonb not null,
  required_permission text not null, risk_level text not null check(risk_level in('low','medium','high','critical')),
  idempotency_supported boolean not null default true, action_engine_required boolean not null default false,
  retry_policy jsonb not null default '{"max_attempts":3,"backoff_seconds":60}', registered_destination_only boolean not null default false,
  active boolean not null default true, created_at timestamptz not null default now(), check(action_type ~ '^[a-z][a-z0-9_]*$')
);
create table public.automation_organization_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  engine_enabled boolean not null default true, global_kill_switch boolean not null default false,
  default_timezone text not null default 'America/Sao_Paulo', max_chain_depth integer not null default 5 check(max_chain_depth between 1 and 10),
  storm_runs_per_hour integer not null default 1000 check(storm_runs_per_hour between 50 and 100000),
  retention_days integer not null default 180 check(retention_days between 30 and 2555), updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
create table public.automation_member_permissions(
  organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  permissions text[] not null default array['automation:view'], scope_type text not null default 'organization' check(scope_type in('organization','brand','region','store')),
  scope_id uuid, active boolean not null default true, updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  primary key(organization_id,user_id,scope_type,scope_id)
);
create table public.automation_workflows(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(length(btrim(name)) between 2 and 160), description text, status text not null default 'draft' check(status in('draft','active','paused','archived','error')),
  trigger_type text not null default 'event' check(trigger_type in('event','schedule','manual','webhook')),
  scope_type text not null default 'organization' check(scope_type in('organization','brand','region','store')), scope_id uuid,
  inheritance_mode text not null default 'editable' check(inheritance_mode in('locked','inherited','editable','disable_allowed')),
  owner_user_id uuid references auth.users(id), team_id uuid references public.internal_teams(id),
  active_version integer, active_version_id uuid, draft_version_id uuid, execution_mode text not null default 'live' check(execution_mode in('live','dry_run')),
  health_status text not null default 'healthy' check(health_status in('healthy','warning','failing','paused_by_system')),
  max_runs_per_hour integer not null default 100 check(max_runs_per_hour between 1 and 10000), max_runs_per_day integer not null default 1000 check(max_runs_per_day between 1 and 100000),
  cooldown_seconds integer not null default 0 check(cooldown_seconds between 0 and 2592000), cooldown_scope text not null default 'entity' check(cooldown_scope in('customer','order','store','entity','workflow')),
  publish_approval_required boolean not null default false, created_by uuid not null references auth.users(id), published_by uuid references auth.users(id), published_at timestamptz,
  paused_at timestamptz, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name)
);
create table public.automation_workflow_versions(
  id uuid primary key default gen_random_uuid(), workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, version integer not null check(version>0), status text not null default 'draft' check(status in('draft','validated','pending_approval','published','superseded','rejected')),
  event_schema_version integer, definition_hash text not null, change_summary text not null default 'Versão inicial', validation_result jsonb not null default '{}',
  created_by uuid not null references auth.users(id), validated_at timestamptz, published_at timestamptz, created_at timestamptz not null default now(), unique(workflow_id,version), unique(workflow_id,definition_hash)
);
alter table public.automation_workflows add constraint automation_workflows_active_version_fk foreign key(active_version_id) references public.automation_workflow_versions(id) on delete set null;
alter table public.automation_workflows add constraint automation_workflows_draft_version_fk foreign key(draft_version_id) references public.automation_workflow_versions(id) on delete set null;
create table public.automation_nodes(
  id uuid primary key default gen_random_uuid(), workflow_version_id uuid not null references public.automation_workflow_versions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, node_key text not null, node_type text not null check(node_type in('trigger','condition','action','delay','approval','branch','stop')),
  config jsonb not null default '{}', position jsonb not null default '{"x":0,"y":0}', created_at timestamptz not null default now(), unique(workflow_version_id,node_key),
  check(not(config ? 'javascript')), check(not(config ? 'sql')), check(not(config ? 'url'))
);
create table public.automation_edges(
  id uuid primary key default gen_random_uuid(), workflow_version_id uuid not null references public.automation_workflow_versions(id) on delete cascade,
  source_node_id uuid not null references public.automation_nodes(id) on delete cascade, target_node_id uuid not null references public.automation_nodes(id) on delete cascade,
  branch_key text, created_at timestamptz not null default now(), unique(workflow_version_id,source_node_id,target_node_id,branch_key), check(source_node_id<>target_node_id)
);
create table public.automation_schedules(
  id uuid primary key default gen_random_uuid(), workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete cascade,
  schedule_type text not null check(schedule_type in('daily','weekly','monthly','specific_datetime')), schedule_config jsonb not null,
  timezone text not null default 'America/Sao_Paulo', missed_policy text not null default 'run_once' check(missed_policy in('run_once','skip','catch_up_limited')),
  max_catch_up integer not null default 1 check(max_catch_up between 0 and 10), next_run_at timestamptz, last_run_at timestamptz, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.automation_webhook_triggers(
  id uuid primary key default gen_random_uuid(), workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, integration_id uuid not null references public.integrations(id) on delete restrict,
  secret_vault_id uuid, signature_algorithm text not null default 'hmac-sha256' check(signature_algorithm='hmac-sha256'), rate_limit_per_minute integer not null default 60 check(rate_limit_per_minute between 1 and 600),
  replay_window_seconds integer not null default 300 check(replay_window_seconds between 60 and 900), active boolean not null default false, created_at timestamptz not null default now(), unique(workflow_id)
);
create table public.automation_event_inbox(
  id text primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete cascade,
  event_name text not null, schema_version integer not null default 1, aggregate_type text, aggregate_id text, payload jsonb not null default '{}',
  origin_workflow_id uuid references public.automation_workflows(id) on delete set null, origin_execution_id uuid, chain_depth integer not null default 0 check(chain_depth between 0 and 10),
  correlation_id text not null, received_at timestamptz not null default now(), processed_at timestamptz, status text not null default 'pending' check(status in('pending','processing','processed','rejected','failed')),
  error_code text, foreign key(event_name,schema_version) references public.automation_event_registry(event_name,schema_version)
);
create table public.automation_executions(
  id uuid primary key default gen_random_uuid(), workflow_id uuid not null references public.automation_workflows(id) on delete restrict,
  workflow_version_id uuid not null references public.automation_workflow_versions(id) on delete restrict, workflow_version integer not null,
  organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete set null,
  trigger_event_id text, trigger_type text not null, trigger_entity_type text, trigger_entity_id text,
  status text not null default 'pending' check(status in('pending','running','waiting','waiting_approval','completed','partially_completed','failed','cancelled','skipped')),
  execution_mode text not null default 'live' check(execution_mode in('live','dry_run','simulation')), current_node_id uuid,
  context_snapshot jsonb not null default '{}', error_summary text, execution_key text not null, dedup_key text, chain_depth integer not null default 0,
  started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, created_at timestamptz not null default now(), unique(organization_id,execution_key)
);
alter table public.automation_event_inbox add constraint automation_event_origin_execution_fk foreign key(origin_execution_id) references public.automation_executions(id) on delete set null;
alter table public.automation_executions add constraint automation_execution_current_node_fk foreign key(current_node_id) references public.automation_nodes(id) on delete set null;
create table public.automation_execution_steps(
  id uuid primary key default gen_random_uuid(), execution_id uuid not null references public.automation_executions(id) on delete cascade,
  node_id uuid not null references public.automation_nodes(id) on delete restrict, status text not null default 'pending' check(status in('pending','running','waiting','waiting_approval','completed','failed','skipped','cancelled')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 10), input_redacted jsonb not null default '{}', output_redacted jsonb,
  action_idempotency_key text, error_code text, error_message text, retryable boolean not null default false, next_retry_at timestamptz,
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), unique(execution_id,node_id,action_idempotency_key)
);
create table public.automation_delays(
  id uuid primary key default gen_random_uuid(), execution_id uuid not null references public.automation_executions(id) on delete cascade,
  step_id uuid not null unique references public.automation_execution_steps(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
  resume_at timestamptz not null, recheck_condition jsonb, status text not null default 'waiting' check(status in('waiting','ready','resumed','cancelled')), created_at timestamptz not null default now()
);
create table public.automation_approval_waits(
  id uuid primary key default gen_random_uuid(), execution_id uuid not null references public.automation_executions(id) on delete cascade,
  step_id uuid not null unique references public.automation_execution_steps(id) on delete cascade, approval_id uuid not null references public.internal_approvals(id) on delete restrict,
  approved_target_node_id uuid references public.automation_nodes(id) on delete set null, rejected_target_node_id uuid references public.automation_nodes(id) on delete set null,
  expires_at timestamptz, escalation_config jsonb not null default '{}', status text not null default 'waiting' check(status in('waiting','approved','rejected','expired','cancelled')), created_at timestamptz not null default now()
);
create table public.automation_jobs(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  execution_id uuid references public.automation_executions(id) on delete cascade, step_id uuid references public.automation_execution_steps(id) on delete cascade,
  job_type text not null check(job_type in('start_execution','run_step','resume_delay','check_approval','retry_step','scheduled_trigger')),
  priority smallint not null default 50 check(priority between 1 and 100), payload_redacted jsonb not null default '{}', status text not null default 'pending' check(status in('pending','leased','completed','failed','dead_lettered','cancelled')),
  available_at timestamptz not null default now(), leased_until timestamptz, worker_id text, attempts integer not null default 0, max_attempts integer not null default 3 check(max_attempts between 1 and 10),
  last_error text, idempotency_key text not null, created_at timestamptz not null default now(), completed_at timestamptz, unique(organization_id,idempotency_key)
);
create table public.automation_dead_letters(
  id uuid primary key default gen_random_uuid(), job_id uuid not null unique references public.automation_jobs(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade, execution_id uuid references public.automation_executions(id) on delete set null,
  error_code text not null, error_summary text not null, payload_redacted jsonb not null default '{}', resolution_status text not null default 'open' check(resolution_status in('open','retry_scheduled','resolved','ignored')),
  resolved_by uuid references auth.users(id), resolved_at timestamptz, resolution_notes text, created_at timestamptz not null default now()
);
create table public.automation_cooldowns(
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
  dedup_key text not null, last_execution_id uuid references public.automation_executions(id) on delete set null, blocked_until timestamptz not null, created_at timestamptz not null default now(),
  primary key(workflow_id,dedup_key)
);
create table public.automation_templates(
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  name text not null, description text not null, category text not null check(category in('operations','sales','marketing','customer_experience','inventory','maintenance','finance','compliance')),
  definition jsonb not null, required_features text[] not null default '{}', active boolean not null default true, system_template boolean not null default false,
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.automation_simulations(
  id uuid primary key default gen_random_uuid(), workflow_version_id uuid not null references public.automation_workflow_versions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete set null,
  mode text not null check(mode in('single_event','historical')), source_event_id text, period_start timestamptz, period_end timestamptz,
  input_redacted jsonb not null default '{}', result jsonb not null default '{}', estimated_matches integer, cost_preview jsonb not null default '{"status":"unavailable"}', impact_preview jsonb not null default '{}',
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.automation_network_rollouts(
  id uuid primary key default gen_random_uuid(), workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, target_scope jsonb not null, status text not null default 'draft' check(status in('draft','pilot','region','network','paused','completed','failed')),
  impact_preview jsonb not null default '{}', pilot_store_ids uuid[] not null default '{}', approval_id uuid references public.internal_approvals(id) on delete set null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), activated_at timestamptz
);
create table public.automation_ai_drafts(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id), prompt_redacted text not null, proposed_definition jsonb not null,
  validation_result jsonb not null default '{}', status text not null default 'proposed' check(status in('proposed','accepted_as_draft','rejected')),
  model_provenance jsonb not null default '{}', created_at timestamptz not null default now(), reviewed_at timestamptz, check(not(proposed_definition ? 'javascript')), check(not(proposed_definition ? 'sql'))
);
create table public.automation_audit_events(
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete set null, actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null, entity_type text not null, entity_id text, reason text not null, before_state jsonb, after_state jsonb, metadata_redacted jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.automation_metrics_hourly(
  organization_id uuid not null references public.organizations(id) on delete cascade, workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  bucket_at timestamptz not null, executions bigint not null default 0, completed bigint not null default 0, failed bigint not null default 0,
  partially_completed bigint not null default 0, notifications bigint not null default 0, tasks_created bigint not null default 0, approvals bigint not null default 0,
  duration_ms_sum bigint not null default 0, messaging_cost_cents bigint, ai_cost_cents bigint, integration_cost_cents bigint,
  primary key(organization_id,workflow_id,bucket_at)
);

create index automation_workflows_org_status_idx on public.automation_workflows(organization_id,status,updated_at desc);
create index automation_workflows_scope_idx on public.automation_workflows(organization_id,scope_type,scope_id,status);
create index automation_versions_workflow_idx on public.automation_workflow_versions(workflow_id,version desc);
create index automation_nodes_version_idx on public.automation_nodes(workflow_version_id,node_type);
create index automation_edges_source_idx on public.automation_edges(source_node_id);
create index automation_edges_target_idx on public.automation_edges(target_node_id);
create index automation_schedules_due_idx on public.automation_schedules(next_run_at) where active;
create index automation_event_inbox_pending_idx on public.automation_event_inbox(status,received_at) where status='pending';
create index automation_event_scope_idx on public.automation_event_inbox(organization_id,event_name,received_at desc);
create index automation_executions_workflow_idx on public.automation_executions(workflow_id,created_at desc);
create index automation_executions_org_status_idx on public.automation_executions(organization_id,status,created_at desc);
create index automation_steps_execution_idx on public.automation_execution_steps(execution_id,created_at);
create index automation_delays_due_idx on public.automation_delays(resume_at) where status='waiting';
create index automation_jobs_due_idx on public.automation_jobs(status,priority desc,available_at) where status='pending';
create index automation_dlq_org_idx on public.automation_dead_letters(organization_id,resolution_status,created_at desc);
create index automation_audit_entity_idx on public.automation_audit_events(organization_id,entity_type,entity_id,created_at desc);

insert into public.automation_event_registry(event_name,module,description,payload_schema,allowed_fields,sensitivity) values
('order.created','orders','Novo pedido criado','{"type":"object"}',array['order.id','order.number','order.total','order.channel','store.id'],'normal'),
('order.delayed','orders','Pedido acima do tempo esperado','{"type":"object"}',array['order.id','order.number','order.delay_minutes','store.id'],'normal'),
('order.completed','orders','Pedido concluído','{"type":"object"}',array['order.id','customer.id','store.id'],'normal'),
('inventory.low','inventory','Estoque abaixo do mínimo','{"type":"object"}',array['item.id','item.name','item.category','item.stock','item.minimum','store.id'],'normal'),
('inventory.stockout_risk','inventory','Risco de ruptura','{"type":"object"}',array['item.id','item.stock','item.risk','store.id'],'normal'),
('payment.failed','payments','Pagamento falhou','{"type":"object"}',array['payment.id','payment.amount','order.id','store.id'],'sensitive'),
('payment.completed','payments','Pagamento confirmado','{"type":"object"}',array['payment.id','payment.amount','order.id','store.id'],'sensitive'),
('customer.inactive','crm','Cliente inativo','{"type":"object"}',array['customer.id','customer.days_inactive','customer.segment','store.id'],'sensitive'),
('customer.risk_changed','customer_success','Risco do cliente alterado','{"type":"object"}',array['customer.id','customer.health','store.id'],'sensitive'),
('support.ticket_created','support','Chamado criado','{"type":"object"}',array['ticket.id','ticket.priority','store.id'],'normal'),
('support.sla_breached','support','SLA de suporte vencido','{"type":"object"}',array['ticket.id','ticket.minutes_overdue','store.id'],'normal'),
('quality.nonconformity_created','quality','Não conformidade criada','{"type":"object"}',array['nonconformity.id','nonconformity.severity','store.id'],'normal'),
('quality.lot_blocked','quality','Lote bloqueado','{"type":"object"}',array['lot.id','item.id','store.id'],'normal'),
('maintenance.asset_failed','assets','Ativo falhou','{"type":"object"}',array['asset.id','asset.criticality','store.id'],'normal'),
('maintenance.work_order_overdue','assets','OS atrasada','{"type":"object"}',array['work_order.id','work_order.priority','store.id'],'normal'),
('document.expiring','documents','Documento vencendo','{"type":"object"}',array['document.id','document.expires_at','store.id'],'normal'),
('document.expired','documents','Documento vencido','{"type":"object"}',array['document.id','document.expires_at','store.id'],'normal'),
('sales.opportunity_stalled','sales','Oportunidade parada','{"type":"object"}',array['opportunity.id','opportunity.days_stalled','store.id'],'normal'),
('cs.health_changed','customer_success','Health score alterado','{"type":"object"}',array['customer.id','customer.health','store.id'],'normal'),
('security.incident_created','security','Incidente de segurança criado','{"type":"object"}',array['incident.id','incident.severity','store.id'],'restricted'),
('release.failed','operations','Release falhou','{"type":"object"}',array['release.id','release.environment'],'normal'),
('delivery.delayed','delivery','Entrega atrasada','{"type":"object"}',array['delivery.id','delivery.delay_minutes','store.id'],'normal'),
('kitchen.overload','kitchen','Cozinha sobrecarregada','{"type":"object"}',array['kitchen.active_orders','kitchen.capacity','store.id'],'normal'),
('reservation.no_show','dining','Reserva não compareceu','{"type":"object"}',array['reservation.id','customer.id','store.id'],'sensitive') on conflict do nothing;

insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,action_engine_required,registered_destination_only) values
('send_notification','notifications','Enviar notificação pelos canais elegíveis','{"type":"object"}','automation:edit','low',false,false),
('create_internal_task','internal_work','Criar tarefa interna','{"type":"object"}','automation:edit','low',false,false),
('create_support_ticket','support','Criar chamado de suporte','{"type":"object"}','automation:edit','low',false,false),
('create_recovery_case','customer_success','Criar caso de recuperação','{"type":"object"}','automation:edit','medium',false,false),
('create_purchase_order_draft','procurement','Criar rascunho de compra','{"type":"object"}','automation:edit','medium',false,false),
('create_campaign_draft','marketing','Criar campanha em rascunho','{"type":"object"}','automation:edit','medium',false,false),
('assign_owner','operations','Atribuir responsável elegível','{"type":"object"}','automation:edit','medium',false,false),
('update_tag','crm','Atualizar tag','{"type":"object"}','automation:edit','low',false,false),
('create_attention_item','executive','Criar item de atenção','{"type":"object"}','automation:edit','low',false,false),
('request_approval','approvals','Solicitar aprovação','{"type":"object"}','automation:edit','medium',false,false),
('send_email','notifications','Enviar e-mail elegível','{"type":"object"}','automation:edit','medium',false,false),
('send_whatsapp_template','whatsapp','Enviar template aprovado','{"type":"object"}','automation:edit','medium',false,false),
('create_document_renewal','documents','Criar renovação documental','{"type":"object"}','automation:edit','medium',false,false),
('create_maintenance_work_order','assets','Criar ordem de serviço','{"type":"object"}','automation:edit','medium',false,false),
('create_quality_nonconformity','quality','Criar não conformidade','{"type":"object"}','automation:edit','medium',false,false),
('pause_campaign','marketing','Pausar campanha via ActionEngine','{"type":"object"}','automation:manage_critical_actions','high',true,false),
('pause_channel','operations','Pausar canal via ActionEngine','{"type":"object"}','automation:manage_critical_actions','high',true,false),
('assign_driver','delivery','Atribuir entregador via ActionEngine','{"type":"object"}','automation:manage_critical_actions','high',true,false),
('reprioritize_order','orders','Repriorizar pedido via ActionEngine','{"type":"object"}','automation:manage_critical_actions','high',true,false),
('send_registered_webhook','integrations','Enviar para destino registrado','{"type":"object"}','automation:manage_critical_actions','high',true,true) on conflict do nothing;

insert into public.automation_templates(name,description,category,definition,system_template) values
('Pedido atrasado','Alerta o gerente e cria acompanhamento sem bloquear pedidos.','operations','{"trigger":"order.delayed","actions":["send_notification","create_internal_task"]}',true),
('Cliente inativo','Cria campanha em rascunho para revisão humana.','marketing','{"trigger":"customer.inactive","actions":["create_campaign_draft"]}',true),
('Estoque crítico','Cria tarefa e rascunho de compra.','inventory','{"trigger":"inventory.low","actions":["create_internal_task","create_purchase_order_draft"]}',true),
('Documento vencendo','Cria renovação documental e notifica responsável.','compliance','{"trigger":"document.expiring","actions":["create_document_renewal","send_notification"]}',true),
('Manutenção vencida','Cria ordem de serviço em rascunho.','maintenance','{"trigger":"maintenance.work_order_overdue","actions":["create_maintenance_work_order"]}',true),
('Cliente em risco','Cria caso de recuperação e item de atenção.','customer_experience','{"trigger":"cs.health_changed","actions":["create_recovery_case","create_attention_item"]}',true),
('SLA de suporte','Escala chamado com tarefa interna.','customer_experience','{"trigger":"support.sla_breached","actions":["create_internal_task","send_notification"]}',true),
('Equipamento crítico offline','Cria OS e alerta a operação.','maintenance','{"trigger":"maintenance.asset_failed","actions":["create_maintenance_work_order","send_notification"]}',true),
('Campanha pós-compra','Cria campanha em rascunho após pedido concluído.','marketing','{"trigger":"order.completed","actions":["create_campaign_draft"]}',true),
('Aprovação pendente','Cria tarefa de acompanhamento de aprovação.','operations','{"trigger":"support.sla_breached","actions":["create_internal_task","request_approval"]}',true) on conflict do nothing;

do $$ declare t text; begin foreach t in array array[
  'automation_event_registry','automation_action_registry','automation_organization_settings','automation_member_permissions','automation_workflows','automation_workflow_versions','automation_nodes','automation_edges','automation_schedules','automation_webhook_triggers','automation_event_inbox','automation_executions','automation_execution_steps','automation_delays','automation_approval_waits','automation_jobs','automation_dead_letters','automation_cooldowns','automation_templates','automation_simulations','automation_network_rollouts','automation_ai_drafts','automation_audit_events','automation_metrics_hourly'
] loop execute format('alter table public.%I enable row level security',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',t||'_service_only',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
