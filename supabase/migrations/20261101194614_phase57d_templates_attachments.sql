-- Phase 57D: versioned templates with an owner, and attachments that follow the audience. Approval itself stays in Phase 32.
-- quality: allow-nonconcurrent-index reason=new-empty-comms-tables

create table public.comms_templates(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,template_key text not null check(template_key ~ '^[a-z0-9_]{2,50}$'),version integer not null default 1 check(version>0),
 name text not null,announcement_type text not null check(announcement_type in('general','procedure_change','menu_change','recall_food_safety','maintenance','store_opening','policy','training','crisis','celebration')),priority text not null default 'info' check(priority in('info','important','mandatory','urgent')),
 requires_ack boolean not null default false,ack_hours integer check(ack_hours is null or ack_hours between 1 and 720),title_template text not null,body_template text not null,variables text[] not null default '{}',
 status text not null default 'active' check(status in('active','retired')),system_default boolean not null default false,owner_user_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),
 unique(organization_id,template_key,version));
create index comms_templates_owner_idx on public.comms_templates(owner_user_id) where owner_user_id is not null;
alter table public.network_announcements add constraint network_announcements_template_fk foreign key(template_id) references public.comms_templates(id) on delete set null;
create index network_announcements_template_idx on public.network_announcements(template_id) where template_id is not null;

create table public.comms_attachments(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,announcement_id uuid not null references public.network_announcements(id) on delete cascade,
 storage_path text not null unique,file_name text not null check(char_length(file_name) between 1 and 200),mime_type text not null,size_bytes bigint not null check(size_bytes between 1 and 20971520),uploaded_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create index comms_attachments_announcement_idx on public.comms_attachments(announcement_id);
create index comms_attachments_org_idx on public.comms_attachments(organization_id);
create index comms_attachments_uploaded_by_idx on public.comms_attachments(uploaded_by) where uploaded_by is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('internal-communications','internal-communications',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp']) on conflict(id) do nothing;

do $$declare t text;begin foreach t in array array['comms_templates','comms_attachments'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
