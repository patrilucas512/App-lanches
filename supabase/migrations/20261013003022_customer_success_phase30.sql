-- Fase 30 - Customer Success, retencao, adocao, renovacao e expansao.
-- Reutiliza customer_health_scores, growth_opportunities, customer_success_tasks,
-- onboarding, suporte, billing e CRM comercial. Nenhuma decisao comercial e automatizada.

create table public.customer_success_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default array['customer_success:view'],
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function private.customer_success_allowed(requested_permission text) returns boolean
language sql stable security definer set search_path=''
as $$ select (select private.is_superadmin()) or exists(
  select 1 from public.customer_success_permissions p
  where p.user_id=(select auth.uid()) and p.active
    and (requested_permission=any(p.permissions) or 'customer_success:manage'=any(p.permissions))
) $$;
revoke all on function private.customer_success_allowed(text) from public,anon;
grant execute on function private.customer_success_allowed(text) to authenticated;

create table public.customer_success_profiles(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  segment text not null default 'standard' check(segment in('self_service','standard','high_touch','enterprise')),
  lifecycle_stage text not null default 'onboarding' check(lifecycle_stage in('onboarding','activated','adopting','mature','renewal','at_risk','churned')),
  strategic boolean not null default false,
  onboarding_status text not null default 'not_started' check(onboarding_status in('not_started','in_progress','delayed','completed','skipped')),
  renewal_date date,
  contract_value_cents integer not null default 0 check(contract_value_cents>=0),
  last_contact_at timestamptz,
  next_contact_at timestamptz,
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.customer_risk_events(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  risk_type text not null check(risk_type in('low_adoption','onboarding_delay','payment_failure','support_escalation','nps_detractor','usage_drop','renewal','cancellation','other')),
  severity text not null default 'medium' check(severity in('low','medium','high','critical')),
  title text not null, source text not null default 'manual', details jsonb not null default '{}',
  status text not null default 'open' check(status in('open','monitoring','resolved','dismissed')),
  detected_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references auth.users(id) on delete set null,
  resolution_reason text, created_by uuid references auth.users(id) on delete set null
);

create table public.cs_playbooks(
  id uuid primary key default gen_random_uuid(), name text not null, playbook_key text not null unique,
  trigger_type text not null check(trigger_type in('new_customer','onboarding_delayed','churn_risk','renewal','expansion','enterprise','nps_detractor')),
  description text, active boolean not null default true, steps jsonb not null default '[]',
  creates_internal_tasks_only boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.cs_playbook_runs(
  id uuid primary key default gen_random_uuid(), playbook_id uuid not null references public.cs_playbooks(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'active' check(status in('active','completed','cancelled')),
  trigger_source text not null default 'manual', context jsonb not null default '{}',
  started_by uuid references auth.users(id) on delete set null, started_at timestamptz not null default now(), completed_at timestamptz
);

alter table public.customer_success_tasks
  add column if not exists playbook_run_id uuid references public.cs_playbook_runs(id) on delete set null,
  add column if not exists task_type text not null default 'follow_up',
  add column if not exists priority text not null default 'normal' check(priority in('low','normal','high','urgent')),
  add column if not exists updated_at timestamptz not null default now();

create table public.customer_success_plans(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null, status text not null default 'active' check(status in('draft','active','completed','cancelled')),
  executive_summary text, success_definition text, owner_user_id uuid references auth.users(id) on delete set null,
  starts_at date not null default current_date, target_date date, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.customer_success_goals(
  id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.customer_success_plans(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null, metric_key text, unit text, baseline numeric, current_value numeric, target_value numeric,
  is_estimated boolean not null default false, status text not null default 'in_progress' check(status in('not_started','in_progress','achieved','at_risk','cancelled')),
  due_date date, evidence jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.cs_meetings(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_type text not null check(meeting_type in('kickoff','review','training','renewal','escalation','qbr','other')),
  title text not null, scheduled_at timestamptz not null, duration_minutes integer not null default 45 check(duration_minutes between 5 and 480),
  attendees jsonb not null default '[]', agenda text, notes text, outcomes text, next_steps jsonb not null default '[]',
  status text not null default 'scheduled' check(status in('scheduled','completed','cancelled','no_show')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.cs_internal_notes(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  body text not null, visibility text not null default 'customer_success' check(visibility in('customer_success','leadership')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.customer_renewals(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null, renewal_date date not null,
  status text not null default 'upcoming' check(status in('upcoming','in_review','renewed','churned','pending')),
  renewal_value_cents integer not null default 0 check(renewal_value_cents>=0), confidence smallint check(confidence between 0 and 100),
  alert_days integer[] not null default array[90,60,30], owner_user_id uuid references auth.users(id) on delete set null,
  notes text, renewed_at timestamptz, churned_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,renewal_date)
);

create table public.customer_expansion_opportunities(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  growth_opportunity_id uuid references public.growth_opportunities(id) on delete set null,
  opportunity_type text not null check(opportunity_type in('upgrade','addon','additional_unit','training','services','other')),
  title text not null, reason text not null, evidence jsonb not null default '{}', estimated_mrr_cents integer not null default 0 check(estimated_mrr_cents>=0),
  status text not null default 'identified' check(status in('identified','validating','qualified','handed_to_sales','won','lost','dismissed')),
  owner_user_id uuid references auth.users(id) on delete set null, sales_opportunity_id uuid references public.sales_opportunities(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), handed_to_sales_at timestamptz
);

create table public.customer_feedback(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  feedback_type text not null check(feedback_type in('nps','feature','support','interview','other')),
  score smallint check(score between 0 and 10), category text, feedback text, source text not null default 'manual',
  advocacy_consent boolean not null default false, consent_recorded_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

create table public.customer_success_audit_events(
  id bigint generated always as identity primary key, organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null, event_type text not null,
  entity_type text not null, entity_id text, reason text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);

create table public.customer_success_feature_flags(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  customer_success_enabled boolean not null default true, success_plans_enabled boolean not null default true,
  renewal_management_enabled boolean not null default true, cs_copilot_enabled boolean not null default true,
  expansion_management_enabled boolean not null default true, updated_at timestamptz not null default now()
);

insert into public.cs_playbooks(name,playbook_key,trigger_type,description,steps) values
 ('Novo cliente','new_customer','new_customer','Acompanha ativacao e primeiro valor','[{"title":"Revisar handoff comercial"},{"title":"Agendar kickoff"},{"title":"Confirmar primeiro valor"}]'),
 ('Onboarding atrasado','onboarding_delayed','onboarding_delayed','Remove bloqueios sem contato automatico','[{"title":"Identificar etapa bloqueada"},{"title":"Definir responsavel"},{"title":"Revisar em 3 dias"}]'),
 ('Risco de churn','churn_risk','churn_risk','Plano interno de retencao','[{"title":"Revisar sinais de risco"},{"title":"Preparar plano de recuperacao"},{"title":"Solicitar aprovacao comercial se necessario"}]'),
 ('Renovacao','renewal','renewal','Preparacao 90/60/30 dias','[{"title":"Revisar valor realizado"},{"title":"Preparar reuniao de renovacao"},{"title":"Registrar decisao"}]'),
 ('Expansao','expansion','expansion','Valida valor e necessidade antes do handoff','[{"title":"Confirmar adocao atual"},{"title":"Validar necessidade"},{"title":"Encaminhar ao comercial"}]'),
 ('Cliente enterprise','enterprise','enterprise','Governanca de conta estrategica','[{"title":"Definir mapa de stakeholders"},{"title":"Planejar QBR"},{"title":"Revisar metas"}]'),
 ('Detrator NPS','nps_detractor','nps_detractor','Trata detrator como risco interno','[{"title":"Revisar feedback"},{"title":"Criar plano de recuperacao"},{"title":"Acompanhar resolucao"}]')
on conflict(playbook_key) do nothing;

create index cs_profiles_owner_idx on public.customer_success_profiles(owner_user_id,lifecycle_stage);
create index cs_profiles_renewal_idx on public.customer_success_profiles(renewal_date) where renewal_date is not null;
create index cs_risks_org_status_idx on public.customer_risk_events(organization_id,status,severity,detected_at desc);
create index cs_playbook_runs_org_idx on public.cs_playbook_runs(organization_id,status,started_at desc);
create index cs_tasks_playbook_idx on public.customer_success_tasks(playbook_run_id) where playbook_run_id is not null;
create index cs_plans_org_idx on public.customer_success_plans(organization_id,status);
create index cs_goals_plan_idx on public.customer_success_goals(plan_id,status);
create index cs_meetings_org_idx on public.cs_meetings(organization_id,scheduled_at desc);
create index cs_notes_org_idx on public.cs_internal_notes(organization_id,created_at desc);
create index cs_renewals_due_idx on public.customer_renewals(status,renewal_date);
create index cs_expansion_org_idx on public.customer_expansion_opportunities(organization_id,status,updated_at desc);
create index cs_feedback_org_idx on public.customer_feedback(organization_id,feedback_type,created_at desc);
create index cs_audit_org_idx on public.customer_success_audit_events(organization_id,created_at desc);

do $$ declare t text; begin foreach t in array array[
 'customer_success_permissions','customer_success_profiles','customer_risk_events','cs_playbooks','cs_playbook_runs',
 'customer_success_plans','customer_success_goals','cs_meetings','cs_internal_notes','customer_renewals',
 'customer_expansion_opportunities','customer_feedback','customer_success_audit_events','customer_success_feature_flags'
] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy cs_permissions_select on public.customer_success_permissions for select to authenticated using((select private.customer_success_allowed('customer_success:manage')));
create policy cs_permissions_insert on public.customer_success_permissions for insert to authenticated with check((select private.customer_success_allowed('customer_success:manage')));
create policy cs_permissions_update on public.customer_success_permissions for update to authenticated using((select private.customer_success_allowed('customer_success:manage'))) with check((select private.customer_success_allowed('customer_success:manage')));
create policy cs_permissions_delete on public.customer_success_permissions for delete to authenticated using((select private.customer_success_allowed('customer_success:manage')));

do $$ declare t text; begin foreach t in array array[
 'customer_success_profiles','customer_risk_events','cs_playbooks','cs_playbook_runs','customer_success_plans',
 'customer_success_goals','cs_meetings','cs_internal_notes','customer_renewals','customer_expansion_opportunities',
 'customer_feedback','customer_success_audit_events','customer_success_feature_flags'
] loop
 execute format('create policy %I on public.%I for select to authenticated using((select private.customer_success_allowed(''customer_success:view'')))','cs_select_'||t,t);
 execute format('create policy %I on public.%I for insert to authenticated with check((select private.customer_success_allowed(''customer_success:manage'')))','cs_insert_'||t,t);
 execute format('create policy %I on public.%I for update to authenticated using((select private.customer_success_allowed(''customer_success:manage''))) with check((select private.customer_success_allowed(''customer_success:manage'')))','cs_update_'||t,t);
 execute format('create policy %I on public.%I for delete to authenticated using((select private.customer_success_allowed(''customer_success:manage'')))','cs_delete_'||t,t);
 end loop; end $$;

revoke all on public.customer_success_permissions,public.customer_success_profiles,public.customer_risk_events,public.cs_playbooks,public.cs_playbook_runs,public.customer_success_plans,public.customer_success_goals,public.cs_meetings,public.cs_internal_notes,public.customer_renewals,public.customer_expansion_opportunities,public.customer_feedback,public.customer_success_audit_events,public.customer_success_feature_flags from anon;
grant select,insert,update,delete on public.customer_success_permissions,public.customer_success_profiles,public.customer_risk_events,public.cs_playbooks,public.cs_playbook_runs,public.customer_success_plans,public.customer_success_goals,public.cs_meetings,public.cs_internal_notes,public.customer_renewals,public.customer_expansion_opportunities,public.customer_feedback,public.customer_success_audit_events,public.customer_success_feature_flags to authenticated;
grant all on public.customer_success_permissions,public.customer_success_profiles,public.customer_risk_events,public.cs_playbooks,public.cs_playbook_runs,public.customer_success_plans,public.customer_success_goals,public.cs_meetings,public.cs_internal_notes,public.customer_renewals,public.customer_expansion_opportunities,public.customer_feedback,public.customer_success_audit_events,public.customer_success_feature_flags to service_role;
grant usage,select on sequence public.customer_success_audit_events_id_seq to authenticated,service_role;
