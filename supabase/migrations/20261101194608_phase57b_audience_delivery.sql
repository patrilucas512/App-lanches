-- Phase 57B: who should receive it (snapshot at publication), and how delivery went. Delivery itself is Phase 52.
-- quality: allow-nonconcurrent-index reason=new-empty-comms-tables

alter table public.profiles add column if not exists preferred_language text check(preferred_language is null or preferred_language in('pt-BR','en','es'));

create table public.network_announcement_recipients(
 announcement_id uuid not null references public.network_announcements(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,store_id uuid references public.establishments(id) on delete set null,
 source text not null default 'snapshot' check(source in('snapshot','late_joiner')),required_version integer not null default 1,
 state text not null default 'pending' check(state in('pending','delivered','opened','acknowledged','overdue')),
 delivery_status text not null default 'pending' check(delivery_status in('pending','deferred','sent','failed')),attempt_count integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text,inbox_item_id uuid references public.notification_inbox_items(id) on delete set null,
 ack_due_at timestamptz,delivered_at timestamptz,opened_at timestamptz,acknowledged_at timestamptz,reminder_count integer not null default 0,last_reminder_at timestamptz,created_at timestamptz not null default now(),
 primary key(announcement_id,user_id));
create index network_announcement_recipients_feed_idx on public.network_announcement_recipients(organization_id,user_id,created_at desc);
create index network_announcement_recipients_user_idx on public.network_announcement_recipients(user_id);
create index network_announcement_recipients_store_idx on public.network_announcement_recipients(store_id,state) where store_id is not null;
create index network_announcement_recipients_due_idx on public.network_announcement_recipients(announcement_id,delivery_status,next_attempt_at) where delivery_status in('pending','deferred');
create index network_announcement_recipients_inbox_idx on public.network_announcement_recipients(inbox_item_id) where inbox_item_id is not null;

alter table public.network_announcement_recipients enable row level security;
revoke all on public.network_announcement_recipients from public,anon,authenticated;
grant all on public.network_announcement_recipients to service_role;
