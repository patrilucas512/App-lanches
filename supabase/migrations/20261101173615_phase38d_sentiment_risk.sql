-- Phase 38D: explainable sentiment, topics and risk signals. Risk signals open a Phase 47 nonconformity or a Phase 59 incident and always wait for human review.
-- quality: allow-nonconcurrent-index reason=new-empty-customer-experience-tables

-- A risk signal opens the incident with no human author; the actor reviews it afterwards.
alter table public.operational_incidents alter column created_by drop not null;

create table public.cx_feedback_analysis(feedback_id uuid primary key references public.crm_feedback(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,sentiment text not null check(sentiment in('positive','neutral','negative','mixed')),confidence text not null check(confidence in('low','medium','high')),evidence jsonb not null default '[]',method text not null default 'rules' check(method in('rules','rules_and_ai','human')),ai_run_ref uuid,corrected_by uuid references auth.users(id) on delete set null,analyzed_at timestamptz not null default now());
create index cx_feedback_analysis_store_idx on public.cx_feedback_analysis(organization_id,store_id,sentiment);
create index cx_feedback_analysis_store_fk_idx on public.cx_feedback_analysis(store_id);
create index cx_feedback_analysis_corrected_by_idx on public.cx_feedback_analysis(corrected_by) where corrected_by is not null;

create table public.cx_feedback_topics(id uuid primary key default gen_random_uuid(),feedback_id uuid not null references public.crm_feedback(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,topic_key text not null,polarity text not null default 'negative' check(polarity in('positive','neutral','negative')),excerpt text,confidence text not null check(confidence in('low','medium','high')),origin text not null check(origin in('rules','dimension','ai','human')),removed_at timestamptz,removed_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),unique(feedback_id,topic_key));
create index cx_feedback_topics_store_idx on public.cx_feedback_topics(organization_id,store_id,topic_key) where removed_at is null;
create index cx_feedback_topics_store_fk_idx on public.cx_feedback_topics(store_id);
create index cx_feedback_topics_removed_by_idx on public.cx_feedback_topics(removed_by) where removed_by is not null;

create table public.cx_risk_signals(id uuid primary key default gen_random_uuid(),feedback_id uuid not null references public.crm_feedback(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,signal_type text not null check(signal_type in('allergy','food_poisoning','foreign_object','contamination','accident','threat_harassment')),excerpt text,confidence text not null check(confidence in('low','medium','high')),status text not null default 'pending_review' check(status in('pending_review','confirmed','dismissed')),incident_id uuid references public.operational_incidents(id) on delete set null,nonconformity_id uuid references public.quality_nonconformities(id) on delete set null,routing_error text,reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz,review_reason text,created_at timestamptz not null default now(),unique(feedback_id,signal_type),check(status='pending_review' or(reviewed_by is not null and reviewed_at is not null and review_reason is not null)));
create index cx_risk_signals_board_idx on public.cx_risk_signals(organization_id,store_id,status,created_at desc);
create index cx_risk_signals_store_fk_idx on public.cx_risk_signals(store_id);
create index cx_risk_signals_incident_idx on public.cx_risk_signals(incident_id) where incident_id is not null;
create index cx_risk_signals_nonconformity_idx on public.cx_risk_signals(nonconformity_id) where nonconformity_id is not null;
create index cx_risk_signals_reviewed_by_idx on public.cx_risk_signals(reviewed_by) where reviewed_by is not null;

create table public.cx_analysis_corrections(id uuid primary key default gen_random_uuid(),feedback_id uuid not null references public.crm_feedback(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,correction_type text not null check(correction_type in('sentiment','topic_added','topic_removed')),before_value text,after_value text,reason text not null,corrected_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now());
create index cx_analysis_corrections_lookup_idx on public.cx_analysis_corrections(organization_id,correction_type,created_at desc);
create index cx_analysis_corrections_feedback_idx on public.cx_analysis_corrections(feedback_id);
create index cx_analysis_corrections_actor_idx on public.cx_analysis_corrections(corrected_by);

do $$declare t text;begin foreach t in array array['cx_feedback_analysis','cx_feedback_topics','cx_risk_signals','cx_analysis_corrections'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
