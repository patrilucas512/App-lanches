-- Phase 95G: privacy by design on Change Management (Phase 88), AI uses of personal data (Phase 80) and the reporting fact.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

-- The privacy review of a change. Its items also go to change_checklists, so the change cannot pass without them.
create table public.privacy_design_reviews(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,change_request_id uuid references public.change_requests(id) on delete cascade,
 title text not null,signals jsonb not null default '{}',checklist text[] not null default '{}',dpia_suggested boolean not null default false,dpia_id uuid references public.privacy_impact_assessments(id) on delete set null,
 status text not null default 'open' check(status in('open','passed','waived','failed')),decided_by uuid references auth.users(id) on delete set null,decision_reason text,
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index privacy_design_reviews_context_idx on public.privacy_design_reviews(context_id,status);
create index privacy_design_reviews_change_idx on public.privacy_design_reviews(change_request_id) where change_request_id is not null;
create index privacy_design_reviews_dpia_idx on public.privacy_design_reviews(dpia_id) where dpia_id is not null;
create index privacy_design_reviews_decided_by_idx on public.privacy_design_reviews(decided_by) where decided_by is not null;
create index privacy_design_reviews_created_by_idx on public.privacy_design_reviews(created_by) where created_by is not null;

-- Which agents and models touch personal data, and for what. Using customer data for AI follows purpose and consent.
create table public.ai_personal_data_uses(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 ai_agent_id uuid references public.ai_agents(id) on delete cascade,ai_model_profile_id uuid references public.ai_model_profiles(id) on delete set null,
 purpose text not null,data_categories text[] not null default '{}',activity_id uuid references public.processing_activities(id) on delete set null,
 consent_purpose_key text,automated_decision boolean not null default false,status text not null default 'active' check(status in('active','paused','retired')),
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index ai_personal_data_uses_context_idx on public.ai_personal_data_uses(context_id);
create index ai_personal_data_uses_agent_idx on public.ai_personal_data_uses(ai_agent_id) where ai_agent_id is not null;
create index ai_personal_data_uses_model_idx on public.ai_personal_data_uses(ai_model_profile_id) where ai_model_profile_id is not null;
create index ai_personal_data_uses_activity_idx on public.ai_personal_data_uses(activity_id) where activity_id is not null;
create index ai_personal_data_uses_created_by_idx on public.ai_personal_data_uses(created_by) where created_by is not null;

-- Requests by day, type and outcome, without any subject column, so a report cannot become a list of people.
create view public.fact_privacy_requests with(security_invoker=true) as
 select context_id,(received_at at time zone 'America/Sao_Paulo')::date metric_date,request_type,channel,status,
  count(*) requests,count(*) filter(where completed_at is not null) completed,
  count(*) filter(where completed_at is not null and due_at is not null and completed_at<=due_at) completed_on_time,
  count(*) filter(where completed_at is not null and due_at is not null) completed_with_due,
  count(*) filter(where completed_at is null and due_at<now()) overdue
 from public.customer_privacy_requests where context_id is not null group by 1,2,3,4,5;

do $$declare t text;begin foreach t in array array['privacy_design_reviews','ai_personal_data_uses'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
revoke all on public.fact_privacy_requests from public,anon,authenticated;grant select on public.fact_privacy_requests to service_role;
