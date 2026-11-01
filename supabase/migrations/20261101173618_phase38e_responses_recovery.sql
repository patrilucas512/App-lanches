-- Phase 38E: responses with human approval and service recovery with limits. The constraints are the last line of defense if a route has a bug.
-- quality: allow-nonconcurrent-index reason=new-empty-customer-experience-tables

create table public.review_response_templates(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,key text not null,situation text not null check(situation in('compliment','neutral','complaint','delivery_issue','food_quality','service_issue','risk_signal')),body text not null check(length(btrim(body)) between 10 and 1500),status text not null default 'active' check(status in('active','retired')),created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,key));
create index review_response_templates_created_by_idx on public.review_response_templates(created_by) where created_by is not null;

create table public.review_responses(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,feedback_id uuid not null references public.crm_feedback(id) on delete cascade,template_id uuid references public.review_response_templates(id) on delete set null,draft text not null check(length(btrim(draft)) between 2 and 1500),author_type text not null check(author_type in('human','ai','template')),author_id uuid references auth.users(id) on delete set null,channel text not null check(channel in('external_api','whatsapp','internal_note')),status text not null default 'draft' check(status in('draft','pending_approval','approved','published','rejected','failed')),approved_by uuid references auth.users(id) on delete set null,approved_at timestamptz,auto_policy boolean not null default false,rejection_reason text,failure_reason text,published_at timestamptz,external_ref text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(status<>'published' or published_at is not null),
 check(status<>'published' or approved_by is not null or auto_policy),
 check(not(auto_policy and author_type='ai')),
 check(not auto_policy or status in('draft','approved','published','failed')));
create index review_responses_board_idx on public.review_responses(organization_id,store_id,status,created_at desc);
create index review_responses_store_fk_idx on public.review_responses(store_id);
create index review_responses_feedback_idx on public.review_responses(feedback_id,created_at desc);
create index review_responses_template_idx on public.review_responses(template_id) where template_id is not null;
create index review_responses_author_idx on public.review_responses(author_id) where author_id is not null;
create index review_responses_approved_by_idx on public.review_responses(approved_by) where approved_by is not null;

create table public.service_recovery_cases(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,feedback_id uuid not null references public.crm_feedback(id) on delete cascade,customer_id uuid references public.customers(id) on delete set null,reason text not null,status text not null default 'open' check(status in('open','contacted','in_progress','resolved','closed','cancelled')),owner_user_id uuid references auth.users(id) on delete set null,due_at timestamptz not null,resolved_at timestamptz,outcome text check(outcome is null or outcome in('resolved_with_customer','no_response','declined','not_applicable')),customer_responded_at timestamptz,repurchased_order_id uuid references public.orders(id) on delete set null,repurchased_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index service_recovery_one_live_idx on public.service_recovery_cases(feedback_id) where status not in('closed','cancelled');
create index service_recovery_board_idx on public.service_recovery_cases(organization_id,store_id,status,due_at);
create index service_recovery_store_fk_idx on public.service_recovery_cases(store_id);
create index service_recovery_feedback_idx on public.service_recovery_cases(feedback_id);
create index service_recovery_customer_idx on public.service_recovery_cases(customer_id,status) where customer_id is not null;
create index service_recovery_owner_idx on public.service_recovery_cases(owner_user_id) where owner_user_id is not null;
create index service_recovery_order_idx on public.service_recovery_cases(repurchased_order_id) where repurchased_order_id is not null;

create table public.service_recovery_actions(id uuid primary key default gen_random_uuid(),case_id uuid not null references public.service_recovery_cases(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,action_type text not null check(action_type in('human_contact','apology','refund_partial','refund_full','coupon','reship_item','schedule_follow_up')),notes text,amount_cents integer check(amount_cents is null or amount_cents>=0),coupon_id uuid references public.coupons(id) on delete set null,status text not null default 'recorded' check(status in('recorded','requested','approved','rejected','awaiting_official_flow','executed','failed')),requested_by uuid references auth.users(id) on delete set null,decided_by uuid references auth.users(id) on delete set null,decided_at timestamptz,decision_reason text,failure_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(action_type not in('refund_partial','refund_full','coupon') or status in('requested','approved','rejected','awaiting_official_flow','failed','executed')),
 check(status not in('approved','rejected','awaiting_official_flow') or decided_at is not null),
 check(decided_by is null or requested_by is null or decided_by<>requested_by));
create index service_recovery_actions_case_idx on public.service_recovery_actions(case_id,created_at desc);
create index service_recovery_actions_pending_idx on public.service_recovery_actions(organization_id,status) where status='requested';
create index service_recovery_actions_coupon_idx on public.service_recovery_actions(coupon_id) where coupon_id is not null;
create index service_recovery_actions_requested_by_idx on public.service_recovery_actions(requested_by) where requested_by is not null;
create index service_recovery_actions_decided_by_idx on public.service_recovery_actions(decided_by) where decided_by is not null;

do $$declare t text;begin foreach t in array array['review_response_templates','review_responses','service_recovery_cases','service_recovery_actions'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
