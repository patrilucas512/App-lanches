-- Phase 33: executive command center. Existing domain tables remain sources of truth.

create table public.executive_command_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default array['executive_command_center:view'], department_scope text[] not null default '{}',
  active boolean not null default true, updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create or replace function private.executive_command_allowed(requested_permission text) returns boolean
language sql stable security definer set search_path=''
as $$ select private.is_superadmin() or exists(select 1 from public.executive_command_permissions p where p.user_id=(select auth.uid()) and p.active and (requested_permission=any(p.permissions) or 'executive_command_center:manage'=any(p.permissions))) $$;
revoke all on function private.executive_command_allowed(text) from public,anon,authenticated;
grant execute on function private.executive_command_allowed(text) to authenticated;

create table public.executive_attention_items(
  id uuid primary key default gen_random_uuid(), category text not null check(category in('revenue','sales','churn','customer','product','support','operations','infrastructure','security','billing','strategy')),
  severity text not null check(severity in('info','warning','high','critical')), title text not null, summary text not null,
  source_type text not null, source_id text not null, root_issue_type text, root_issue_id text, detected_at timestamptz not null default now(),
  status text not null default 'open' check(status in('open','acknowledged','suppressed','resolved','archived')), confidence text not null check(confidence in('low','medium','high')),
  impact_score numeric(6,2) not null check(impact_score between 0 and 100), urgency_score numeric(6,2) not null check(urgency_score between 0 and 100),
  priority_score numeric(7,2) generated always as (round((impact_score*0.6+urgency_score*0.4)::numeric,2)) stored,
  score_factors jsonb not null default '[]', recommended_action text, manual_priority numeric(7,2) check(manual_priority is null or manual_priority between 0 and 100),
  manual_override_reason text, overridden_by uuid references auth.users(id) on delete set null, cooldown_until timestamptz,
  dedupe_key text not null, occurrence_count integer not null default 1, affected_customer_count integer not null default 0,
  affected_mrr_cents bigint not null default 0, last_detected_at timestamptz not null default now(), resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(dedupe_key), check(manual_priority is null or nullif(trim(manual_override_reason),'') is not null)
);
create table public.executive_decisions(
  id uuid primary key default gen_random_uuid(), title text not null, context text not null, decision_type text not null,
  source_type text not null, source_id text not null, owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check(status in('pending','approved','rejected','deferred','resolved')),
  due_at timestamptz, risk_if_delayed text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_type,source_id)
);
create table public.executive_recommendations(
  id uuid primary key default gen_random_uuid(), attention_item_id uuid references public.executive_attention_items(id) on delete set null,
  recommendation_type text not null, rationale text not null, expected_impact text, confidence text not null check(confidence in('low','medium','high')),
  source_metrics jsonb not null default '[]', owner_suggestion text, status text not null default 'proposed' check(status in('proposed','accepted','dismissed','converted_to_task','completed','archived')),
  internal_task_id uuid references public.internal_tasks(id) on delete set null, outcome_summary text, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.executive_watchlist_items(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check(entity_type in('organization','metric','project','opportunity','incident','release')),
  entity_id text not null, label text not null, baseline jsonb not null default '{}', last_snapshot jsonb not null default '{}',
  notification_level text not null default 'critical' check(notification_level in('all','important','critical','none')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,entity_type,entity_id)
);
create table public.executive_risks(
  id uuid primary key default gen_random_uuid(), title text not null,
  category text not null check(category in('financial','operational','technical','security','market','customer','compliance')),
  likelihood text not null check(likelihood in('low','medium','high')), impact text not null check(impact in('low','medium','high','critical')),
  owner_user_id uuid references auth.users(id) on delete set null, mitigation text, status text not null default 'open' check(status in('open','mitigating','accepted','resolved','archived')),
  source_type text, source_id text, review_date date, classification text not null default 'risk' check(classification in('risk','hypothesis')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.executive_briefs(
  id uuid primary key default gen_random_uuid(), brief_type text not null check(brief_type in('daily','weekly','monthly','board')),
  period_start date not null, period_end date not null, status text not null default 'draft' check(status in('draft','approved','archived')),
  content jsonb not null, source_freshness jsonb not null default '{}', generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(), approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
  unique(brief_type,period_start,period_end), check(period_end>=period_start)
);
create table public.executive_insight_snapshots(
  id uuid primary key default gen_random_uuid(), attention_item_id uuid references public.executive_attention_items(id) on delete set null,
  insight_type text not null, title text not null, summary text not null, facts jsonb not null default '[]', hypotheses jsonb not null default '[]', recommendations jsonb not null default '[]',
  source_references jsonb not null default '[]', confidence text not null check(confidence in('low','medium','high')), status text not null default 'detected' check(status in('detected','acknowledged','resolved','archived')),
  outcome text, created_by uuid references auth.users(id) on delete set null, detected_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.executive_scorecard_thresholds(
  metric_key text primary key, domain text not null, label text not null, direction text not null check(direction in('higher_is_better','lower_is_better')),
  watch_threshold numeric not null, off_track_threshold numeric not null, unit text not null, source_of_truth text not null,
  minimum_sample integer not null default 1 check(minimum_sample>=1), updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table public.executive_playbooks(
  id uuid primary key default gen_random_uuid(), playbook_key text not null unique, title text not null, category text not null,
  trigger_description text not null, steps jsonb not null, active boolean not null default true, guidance_only boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.executive_preferences(
  user_id uuid primary key references auth.users(id) on delete cascade, default_section text not null default 'Hoje',
  board_mode boolean not null default false, digest_frequency text not null default 'disabled' check(digest_frequency in('daily','weekly','disabled')),
  email_enabled boolean not null default false, dashboard_layout jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table public.executive_command_cache(
  cache_key text primary key, payload jsonb not null, source_freshness jsonb not null default '{}', expires_at timestamptz not null,
  invalidated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.executive_command_feature_flags(
  singleton boolean primary key default true check(singleton), executive_command_center_enabled boolean not null default true,
  executive_copilot_enabled boolean not null default true, attention_engine_enabled boolean not null default true,
  risk_register_enabled boolean not null default true, executive_digest_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.executive_command_feature_flags(singleton) values(true) on conflict(singleton) do nothing;

insert into public.executive_scorecard_thresholds(metric_key,domain,label,direction,watch_threshold,off_track_threshold,unit,source_of_truth,minimum_sample) values
('mrr_attainment','revenue','MRR / meta','higher_is_better',90,75,'percent','revenue_snapshots + revenue_targets',1),
('pipeline_coverage','sales','Cobertura de pipeline','higher_is_better',3,1.5,'ratio','sales_opportunities + revenue_targets',1),
('nrr','customer','NRR','higher_is_better',100,90,'percent','revenue_snapshots + mrr_movements',1),
('activation','product','Ativação','higher_is_better',65,45,'percent','product_organization_daily_metrics',20),
('support_sla','support','SLA de suporte','higher_is_better',90,75,'percent','support_tickets',20),
('availability','technology','Disponibilidade','higher_is_better',99.9,99.5,'percent','performance_baselines',100),
('critical_security','security','Incidentes críticos abertos','lower_is_better',1,3,'count','security_incidents',1)
on conflict(metric_key) do nothing;
insert into public.executive_playbooks(playbook_key,title,category,trigger_description,steps) values
('churn_spike','Resposta a pico de churn','churn','Churn acima do limite configurado.', '["Identificar segmento e MRR afetado","Revisar tickets e adoção","Comparar eventos próximos sem afirmar causalidade","Criar plano de ação com owner"]'),
('pipeline_gap','Resposta a gap de pipeline','sales','Cobertura abaixo do limite configurado.', '["Revisar oportunidades paradas","Validar fluxo de leads","Revisar forecast","Criar tarefa comercial"]'),
('critical_incident','Resposta a incidente crítico','infrastructure','Incidente ativo com impacto em clientes.', '["Confirmar impacto e clientes afetados","Agrupar tickets relacionados","Acompanhar mitigação","Criar retrospectiva após resolução"]')
on conflict(playbook_key) do nothing;

create index executive_attention_open_idx on public.executive_attention_items(status,severity,detected_at desc);
create index executive_attention_source_idx on public.executive_attention_items(source_type,source_id);
create index executive_decisions_pending_idx on public.executive_decisions(status,due_at);
create index executive_recommendations_status_idx on public.executive_recommendations(status,created_at desc);
create index executive_watchlist_user_idx on public.executive_watchlist_items(user_id,updated_at desc);
create index executive_risks_matrix_idx on public.executive_risks(status,impact,likelihood,review_date);
create index executive_briefs_period_idx on public.executive_briefs(brief_type,period_start desc);
create index executive_insights_status_idx on public.executive_insight_snapshots(status,detected_at desc);
create index executive_cache_expiry_idx on public.executive_command_cache(expires_at) where invalidated_at is null;

do $$ declare t text; begin foreach t in array array['executive_command_permissions','executive_attention_items','executive_decisions','executive_recommendations','executive_watchlist_items','executive_risks','executive_briefs','executive_insight_snapshots','executive_scorecard_thresholds','executive_playbooks','executive_preferences','executive_command_cache','executive_command_feature_flags'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select to authenticated using((select private.executive_command_allowed(''executive_command_center:view'')))','exec_select_'||t,t);
  execute format('create policy %I on public.%I for insert to authenticated with check((select private.executive_command_allowed(''executive_command_center:manage'')))','exec_insert_'||t,t);
  execute format('create policy %I on public.%I for update to authenticated using((select private.executive_command_allowed(''executive_command_center:manage''))) with check((select private.executive_command_allowed(''executive_command_center:manage'')))','exec_update_'||t,t);
  execute format('create policy %I on public.%I for delete to authenticated using((select private.executive_command_allowed(''executive_command_center:manage'')))','exec_delete_'||t,t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
end loop; end $$;

