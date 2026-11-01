-- Phase 57E: board and simple polls. No likes, no ranking, no per-person engagement anywhere in this schema.
-- quality: allow-nonconcurrent-index reason=new-empty-comms-tables

create table public.comms_board_posts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,announcement_id uuid references public.network_announcements(id) on delete set null,
 post_type text not null check(post_type in('pinned_announcement','quick_notice','important_date')),title text not null check(char_length(title) between 3 and 180),body text check(body is null or char_length(body)<=2000),event_date date,pinned boolean not null default false,
 status text not null default 'active' check(status in('active','removed')),expires_at timestamptz,comments_enabled boolean not null default false,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create index comms_board_posts_lookup_idx on public.comms_board_posts(organization_id,store_id,status,pinned desc,created_at desc);
create index comms_board_posts_store_idx on public.comms_board_posts(store_id) where store_id is not null;
create index comms_board_posts_announcement_idx on public.comms_board_posts(announcement_id) where announcement_id is not null;
create index comms_board_posts_created_by_idx on public.comms_board_posts(created_by) where created_by is not null;

create table public.comms_board_comments(
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.comms_board_posts(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,author_id uuid references auth.users(id) on delete set null,
 body text not null check(char_length(body) between 2 and 1000),status text not null default 'pending' check(status in('pending','approved','rejected')),moderated_by uuid references auth.users(id) on delete set null,moderated_at timestamptz,created_at timestamptz not null default now());
create index comms_board_comments_post_idx on public.comms_board_comments(post_id,status);
create index comms_board_comments_org_idx on public.comms_board_comments(organization_id,status);
create index comms_board_comments_author_idx on public.comms_board_comments(author_id) where author_id is not null;
create index comms_board_comments_moderator_idx on public.comms_board_comments(moderated_by) where moderated_by is not null;

create table public.comms_polls(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete set null,question text not null check(char_length(question) between 3 and 300),audience_definition jsonb not null,
 anonymous boolean not null default true,minimum_responses integer not null default 5 check(minimum_responses>=3),status text not null default 'open' check(status in('open','closed')),closes_at timestamptz,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create index comms_polls_lookup_idx on public.comms_polls(organization_id,status,created_at desc);
create index comms_polls_store_idx on public.comms_polls(store_id) where store_id is not null;
create index comms_polls_created_by_idx on public.comms_polls(created_by) where created_by is not null;
create table public.comms_poll_options(id uuid primary key default gen_random_uuid(),poll_id uuid not null references public.comms_polls(id) on delete cascade,label text not null check(char_length(label) between 1 and 120),position integer not null default 0,unique(poll_id,position));

-- These two tables never meet. Participation says who answered and not what; a response says what and, on an anonymous poll, not who. Neither has a timestamp to cross them by.
create table public.comms_poll_participation(poll_id uuid not null references public.comms_polls(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,primary key(poll_id,user_id));
create index comms_poll_participation_user_idx on public.comms_poll_participation(user_id);
create table public.comms_poll_responses(id uuid primary key default gen_random_uuid(),poll_id uuid not null references public.comms_polls(id) on delete cascade,option_id uuid not null references public.comms_poll_options(id) on delete cascade,identified_user_id uuid references auth.users(id) on delete set null);
create index comms_poll_responses_poll_idx on public.comms_poll_responses(poll_id,option_id);
create index comms_poll_responses_option_idx on public.comms_poll_responses(option_id);
create index comms_poll_responses_user_idx on public.comms_poll_responses(identified_user_id) where identified_user_id is not null;

do $$declare t text;begin foreach t in array array['comms_board_posts','comms_board_comments','comms_polls','comms_poll_options','comms_poll_participation','comms_poll_responses'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
