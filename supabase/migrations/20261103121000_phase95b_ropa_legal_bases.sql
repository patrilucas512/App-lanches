-- Phase 95B: record of processing activities (ROPA) and a configurable catalogue of legal bases.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

-- The catalogue lists keys and labels. What each basis allows is for the tenant's legal team, not for this table.
create table public.privacy_legal_bases(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 basis_key text not null check(basis_key in('consent','contract','legal_obligation','legitimate_interest','exercise_of_rights','credit_protection','health_protection','other')),
 label text not null,description text,requires_assessment boolean not null default false,active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(context_id,basis_key));

create table public.processing_activities(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 name text not null check(length(btrim(name)) between 3 and 160),purpose text not null,
 legal_basis_key text,lia_reference text,
 data_categories text[] not null default '{}',subject_categories text[] not null default '{}',systems text[] not null default '{}',
 sharing jsonb not null default '[]',subprocessor_vendor_ids uuid[] not null default '{}',international_transfer boolean not null default false,transfer_mechanism text,
 retention_summary text,security_measures text,owner_user_id uuid references auth.users(id) on delete set null,
 uses_ai boolean not null default false,profiling boolean not null default false,location_monitoring boolean not null default false,
 status text not null default 'draft' check(status in('draft','active','under_review','retired')),version integer not null default 1 check(version>0),
 created_by uuid references auth.users(id) on delete set null,updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index processing_activities_context_idx on public.processing_activities(context_id,status);
create index processing_activities_owner_idx on public.processing_activities(owner_user_id) where owner_user_id is not null;
create index processing_activities_created_by_idx on public.processing_activities(created_by) where created_by is not null;
create index processing_activities_updated_by_idx on public.processing_activities(updated_by) where updated_by is not null;

-- Each change to an activity is kept as a version, so the ROPA of any past date can be shown.
create table public.processing_activity_versions(
 id uuid primary key default gen_random_uuid(),activity_id uuid not null references public.processing_activities(id) on delete cascade,
 context_id uuid not null references public.privacy_contexts(id) on delete cascade,version integer not null,snapshot jsonb not null,change_note text,
 edited_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),unique(activity_id,version));
create index processing_activity_versions_context_idx on public.processing_activity_versions(context_id);
create index processing_activity_versions_editor_idx on public.processing_activity_versions(edited_by) where edited_by is not null;
create trigger processing_activity_versions_immutable before update or delete on public.processing_activity_versions for each row execute function public.prevent_privacy_history_rewrite();

do $$declare t text;begin foreach t in array array['privacy_legal_bases','processing_activities','processing_activity_versions'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
