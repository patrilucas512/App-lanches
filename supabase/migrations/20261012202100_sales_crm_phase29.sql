-- Phase 29: internal Sales CRM for selling MasterApp.
-- This domain is intentionally separate from restaurant customers.

create table public.sales_permissions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default array['sales:view'],
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function private.sales_allowed(requested_permission text) returns boolean
language sql stable security definer set search_path=''
as $$ select private.is_superadmin() or exists(
  select 1 from public.sales_permissions p
  where p.user_id=(select auth.uid()) and p.active
    and (requested_permission=any(p.permissions) or 'sales:admin'=any(p.permissions))
) $$;
revoke all on function private.sales_allowed(text) from public,anon,authenticated;
grant execute on function private.sales_allowed(text) to authenticated;

create table public.sales_pipelines(
  id uuid primary key default gen_random_uuid(), name text not null, description text,
  is_default boolean not null default false, active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index sales_one_default_pipeline_idx on public.sales_pipelines(is_default) where is_default;

create table public.sales_stages(
  id uuid primary key default gen_random_uuid(), pipeline_id uuid not null references public.sales_pipelines(id) on delete cascade,
  name text not null, stage_key text not null, position integer not null,
  default_probability numeric(5,2) not null default 0 check(default_probability between 0 and 100),
  stage_type text not null default 'open' check(stage_type in('open','won','lost')), stale_after_days integer check(stale_after_days>0),
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(pipeline_id,stage_key), unique(pipeline_id,position)
);

create table public.sales_accounts(
  id uuid primary key default gen_random_uuid(), company_name text not null, business_type text,
  estimated_units integer check(estimated_units is null or estimated_units>=0), estimated_monthly_volume integer check(estimated_monthly_volume is null or estimated_monthly_volume>=0),
  current_system text, current_pain_points text, website text, city text, state text,
  owner_user_id uuid references auth.users(id) on delete set null, status text not null default 'prospect' check(status in('prospect','qualified','customer','lost','archived')),
  converted_organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);

create table public.sales_contacts(
  id uuid primary key default gen_random_uuid(), sales_account_id uuid not null references public.sales_accounts(id) on delete cascade,
  name text not null, role text, email text, phone text, preferred_channel text check(preferred_channel is null or preferred_channel in('email','phone','whatsapp','meeting')),
  decision_role text not null default 'unknown' check(decision_role in('decision_maker','influencer','user','financial','technical','unknown')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);

create table public.sales_leads(
  id uuid primary key default gen_random_uuid(), source text not null default 'other' check(source in('landing_page','paid_ads','organic','referral','partner','outbound','event','direct','support_referral','other')),
  status text not null default 'new' check(status in('new','contacted','qualified','unqualified','converted','lost','archived')),
  company_name text not null, contact_name text not null, email text, phone text, business_type text, city text, state text,
  estimated_units integer check(estimated_units is null or estimated_units>=0), estimated_team_size integer check(estimated_team_size is null or estimated_team_size>=0),
  current_solution text, pain_points text, notes text, owner_user_id uuid references auth.users(id) on delete set null,
  qualification jsonb not null default '{}', score integer not null default 0 check(score between 0 and 100), score_components jsonb not null default '{}',
  first_touch jsonb not null default '{}', last_touch jsonb not null default '{}', consent_basis text, consent_recorded_at timestamptz,
  duplicate_status text not null default 'none' check(duplicate_status in('none','possible','reviewed','merged')), duplicate_of_lead_id uuid references public.sales_leads(id) on delete set null,
  sales_account_id uuid references public.sales_accounts(id) on delete set null, converted_organization_id uuid references public.organizations(id) on delete set null,
  first_contacted_at timestamptz, qualified_at timestamptz, converted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);

create table public.sales_opportunities(
  id uuid primary key default gen_random_uuid(), sales_account_id uuid not null references public.sales_accounts(id) on delete restrict,
  lead_id uuid references public.sales_leads(id) on delete set null, primary_contact_id uuid references public.sales_contacts(id) on delete set null,
  pipeline_id uuid not null references public.sales_pipelines(id) on delete restrict, stage_id uuid not null references public.sales_stages(id) on delete restrict,
  owner_user_id uuid references auth.users(id) on delete set null, expected_plan_id uuid references public.plans(id) on delete set null,
  expected_addons jsonb not null default '[]', estimated_mrr integer not null default 0 check(estimated_mrr>=0), probability numeric(5,2) not null default 0 check(probability between 0 and 100),
  forecast_category text not null default 'pipeline' check(forecast_category in('pipeline','best_case','committed','closed')),
  expected_close_date date, status text not null default 'open' check(status in('open','won','lost','archived')),
  lost_reason text check(lost_reason is null or lost_reason in('price','competitor','no_budget','no_urgency','missing_feature','no_response','business_closed','other')),
  competitor_name text, commitments text, unavailable_feature_review boolean not null default false,
  won_at timestamptz, lost_at timestamptz, converted_organization_id uuid references public.organizations(id) on delete set null,
  conversion_key uuid not null default gen_random_uuid() unique, last_activity_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  check(status<>'lost' or lost_reason is not null)
);

create table public.opportunity_stage_history(
  id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.sales_opportunities(id) on delete cascade,
  from_stage uuid references public.sales_stages(id) on delete set null, to_stage uuid not null references public.sales_stages(id) on delete restrict,
  changed_by uuid references auth.users(id) on delete set null, changed_at timestamptz not null default now()
);
create table public.sales_activities(
  id uuid primary key default gen_random_uuid(), opportunity_id uuid references public.sales_opportunities(id) on delete cascade,
  contact_id uuid references public.sales_contacts(id) on delete set null, type text not null check(type in('call','whatsapp','email','meeting','demo','note','proposal_sent','follow_up')),
  summary text not null, occurred_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create table public.sales_tasks(
  id uuid primary key default gen_random_uuid(), opportunity_id uuid references public.sales_opportunities(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null, task_type text not null default 'follow_up' check(task_type in('call','proposal','demo','follow_up','contract_review','return')),
  title text not null, due_at timestamptz, priority text not null default 'normal' check(priority in('low','normal','high','urgent')),
  status text not null default 'open' check(status in('open','in_progress','completed','cancelled')),
  automation_source text, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sales_demos(
  id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.sales_opportunities(id) on delete cascade,
  scheduled_at timestamptz not null, duration integer not null default 45 check(duration between 10 and 240), meeting_link text,
  status text not null default 'scheduled' check(status in('scheduled','completed','no_show','cancelled')),
  attendees jsonb not null default '[]', checklist jsonb not null default '{}', notes text, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sales_proposals(
  id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.sales_opportunities(id) on delete cascade,
  version integer not null, plan_id uuid not null references public.plans(id) on delete restrict, addons jsonb not null default '[]',
  custom_price integer check(custom_price is null or custom_price>=0), discount numeric(5,2) not null default 0 check(discount between 0 and 100),
  discount_status text not null default 'not_required' check(discount_status in('not_required','pending','approved','rejected')),
  discount_approved_by uuid references auth.users(id) on delete set null, validity_date date not null,
  status text not null default 'draft' check(status in('draft','sent','viewed','accepted','rejected','expired')),
  notes text, secure_token_hash text unique, token_expires_at timestamptz, created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz, viewed_at timestamptz, accepted_at timestamptz, acceptance_ip inet, acceptance_user_agent text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(opportunity_id,version)
);
create table public.sales_referrals(
  id uuid primary key default gen_random_uuid(), referrer_type text not null check(referrer_type in('partner','customer','employee','other')),
  partner_id uuid references public.partner_accounts(id) on delete set null, referrer_customer_id uuid references public.organizations(id) on delete set null,
  lead_id uuid not null references public.sales_leads(id) on delete cascade, status text not null default 'submitted' check(status in('submitted','qualified','won','lost')),
  reward_status text not null default 'not_eligible' check(reward_status in('not_eligible','pending','approved','paid','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sales_targets(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, period date not null,
  target_mrr integer not null default 0 check(target_mrr>=0), target_deals integer not null default 0 check(target_deals>=0), created_at timestamptz not null default now(), unique(user_id,period)
);
create table public.sales_templates(
  id uuid primary key default gen_random_uuid(), template_type text not null check(template_type in('first_contact','follow_up','demo','proposal','trial_ending')),
  name text not null, subject text, body text not null, active boolean not null default true, requires_consent boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sales_automation_rules(
  id uuid primary key default gen_random_uuid(), name text not null, trigger_type text not null,
  action_type text not null check(action_type in('create_task','alert_owner','suggest_follow_up','move_stage')),
  config jsonb not null default '{}', active boolean not null default false, requires_confirmation boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sales_conversion_handoffs(
  id uuid primary key default gen_random_uuid(), opportunity_id uuid not null unique references public.sales_opportunities(id) on delete restrict,
  organization_id uuid not null unique references public.organizations(id) on delete restrict, plan_id uuid references public.plans(id) on delete set null,
  sales_summary jsonb not null default '{}', billing_status text not null default 'pending' check(billing_status in('pending','checkout_started','active','failed')),
  onboarding_status text not null default 'pending' check(onboarding_status in('pending','invited','started','completed')),
  customer_success_owner_id uuid references auth.users(id) on delete set null, idempotency_key uuid not null unique,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sales_lead_capture_limits(
  fingerprint_hash text primary key, window_started_at timestamptz not null default now(), request_count integer not null default 1, last_request_at timestamptz not null default now()
);

create index sales_leads_status_owner_idx on public.sales_leads(status,owner_user_id,created_at desc);
create index sales_leads_email_idx on public.sales_leads(lower(email)) where email is not null;
create index sales_leads_phone_idx on public.sales_leads(phone) where phone is not null;
create index sales_accounts_owner_idx on public.sales_accounts(owner_user_id,status);
create index sales_contacts_account_idx on public.sales_contacts(sales_account_id);
create index sales_opportunities_pipeline_idx on public.sales_opportunities(pipeline_id,stage_id,status,updated_at desc);
create index sales_opportunities_owner_close_idx on public.sales_opportunities(owner_user_id,expected_close_date) where status='open';
create index sales_stage_history_opportunity_idx on public.opportunity_stage_history(opportunity_id,changed_at desc);
create index sales_tasks_assignee_due_idx on public.sales_tasks(assigned_to,status,due_at);
create index sales_activities_opportunity_idx on public.sales_activities(opportunity_id,occurred_at desc);
create index sales_proposals_expiry_idx on public.sales_proposals(status,validity_date);
create index sales_handoffs_status_idx on public.sales_conversion_handoffs(billing_status,onboarding_status);

create or replace function private.sales_touch_opportunity() returns trigger language plpgsql security invoker set search_path='' as $$
begin update public.sales_opportunities set last_activity_at=coalesce(new.occurred_at,now()),updated_at=now() where id=new.opportunity_id;return new;end$$;
create trigger sales_activity_touch after insert on public.sales_activities for each row when(new.opportunity_id is not null) execute function private.sales_touch_opportunity();

create or replace function private.sales_stage_audit() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.stage_id is distinct from new.stage_id then
  insert into public.opportunity_stage_history(opportunity_id,from_stage,to_stage,changed_by) values(new.id,old.stage_id,new.stage_id,(select auth.uid()));
 end if;
 return new;
end$$;
create trigger sales_opportunity_stage_history after update of stage_id on public.sales_opportunities for each row execute function private.sales_stage_audit();

create or replace function private.sales_audit_event() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; row_id uuid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());
begin
 insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,old_value,new_value,reason)
 values((select auth.uid()),'sales.'||lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,row_id,case when tg_op in('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in('INSERT','UPDATE') then to_jsonb(new) end,'sales_crm');
 return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function private.sales_audit_event() from public,anon,authenticated;

do $$declare t text;begin foreach t in array array['sales_leads','sales_accounts','sales_contacts','sales_opportunities','sales_tasks','sales_activities','sales_demos','sales_proposals','sales_referrals'] loop execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.sales_audit_event()',t||'_audit',t);end loop;end$$;

insert into public.sales_pipelines(name,description,is_default,created_by) values('Pipeline Comercial MasterApp','Aquisição comercial do SaaS MasterApp.',true,(select id from public.profiles where is_superadmin order by created_at limit 1));
insert into public.sales_stages(pipeline_id,name,stage_key,position,default_probability,stage_type,stale_after_days)
select p.id,v.name,v.key,v.pos,v.prob,v.kind,v.stale from public.sales_pipelines p cross join(values
('Novo Lead','new',1,5,'open',1),('Primeiro Contato','first_contact',2,15,'open',3),('Qualificação','qualification',3,30,'open',5),('Demonstração','demo',4,45,'open',5),('Proposta','proposal',5,65,'open',7),('Negociação','negotiation',6,80,'open',7),('Fechado — Ganho','won',7,100,'won',null),('Fechado — Perdido','lost',8,0,'lost',null)
)v(name,key,pos,prob,kind,stale) where p.is_default;

insert into public.sales_templates(template_type,name,subject,body) values
('first_contact','Primeiro contato consultivo','Conheça o MasterApp','Olá! Recebemos seu interesse no MasterApp. Posso entender sua operação antes de sugerir o melhor caminho?'),
('follow_up','Follow-up após demonstração','Próximos passos MasterApp','Obrigado pela conversa. Revisei as necessidades registradas e deixei os próximos passos preparados para sua confirmação.'),
('demo','Confirmação de demonstração','Demonstração MasterApp','Sua demonstração está agendada. Mostraremos apenas os recursos mais relevantes para sua operação.'),
('proposal','Envio de proposta','Proposta MasterApp','Sua proposta está disponível em um link seguro e possui validade indicada no documento.'),
('trial_ending','Teste próximo do fim','Seu período de teste','Seu teste está próximo do fim. Podemos revisar os resultados antes de qualquer decisão.');

do $$declare t text;begin foreach t in array array['sales_permissions','sales_pipelines','sales_stages','sales_accounts','sales_contacts','sales_leads','sales_opportunities','opportunity_stage_history','sales_activities','sales_tasks','sales_demos','sales_proposals','sales_referrals','sales_targets','sales_templates','sales_automation_rules','sales_conversion_handoffs','sales_lead_capture_limits'] loop execute format('alter table public.%I enable row level security',t);execute format('create policy %I on public.%I for select to authenticated using((select private.sales_allowed(''sales:view'')))',t||'_read',t);execute format('create policy %I on public.%I for all to authenticated using((select private.sales_allowed(''sales:manage''))) with check((select private.sales_allowed(''sales:manage'')))',t||'_manage',t);end loop;end$$;

revoke all on public.sales_permissions,public.sales_pipelines,public.sales_stages,public.sales_accounts,public.sales_contacts,public.sales_leads,public.sales_opportunities,public.opportunity_stage_history,public.sales_activities,public.sales_tasks,public.sales_demos,public.sales_proposals,public.sales_referrals,public.sales_targets,public.sales_templates,public.sales_automation_rules,public.sales_conversion_handoffs,public.sales_lead_capture_limits from public,anon;
grant select,insert,update,delete on public.sales_permissions,public.sales_pipelines,public.sales_stages,public.sales_accounts,public.sales_contacts,public.sales_leads,public.sales_opportunities,public.opportunity_stage_history,public.sales_activities,public.sales_tasks,public.sales_demos,public.sales_proposals,public.sales_referrals,public.sales_targets,public.sales_templates,public.sales_automation_rules,public.sales_conversion_handoffs to authenticated;
grant all on public.sales_permissions,public.sales_pipelines,public.sales_stages,public.sales_accounts,public.sales_contacts,public.sales_leads,public.sales_opportunities,public.opportunity_stage_history,public.sales_activities,public.sales_tasks,public.sales_demos,public.sales_proposals,public.sales_referrals,public.sales_targets,public.sales_templates,public.sales_automation_rules,public.sales_conversion_handoffs,public.sales_lead_capture_limits to service_role;

insert into public.quality_feature_flags(flag_key,description,enabled,kill_switch,rollout_percent,internal_only) values
('sales_crm_enabled','CRM comercial interno do MasterApp',true,false,100,true),
('sales_copilot_enabled','Copiloto comercial com confirmação humana',true,false,100,true),
('sales_forecasting_enabled','Forecast ponderado comercial',true,false,100,true),
('partner_referrals_enabled','Indicações comerciais por parceiros',true,false,100,true),
('sales_proposals_enabled','Propostas comerciais controladas',true,false,100,true)
on conflict(flag_key) do update set description=excluded.description,internal_only=true;
