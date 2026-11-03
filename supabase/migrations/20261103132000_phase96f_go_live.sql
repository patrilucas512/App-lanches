-- Phase 96F: go-live per store. privacy_setup_enabled opens the configuration screens only; privacy_operations_enabled,
-- which reaches customers, can only be switched on after an approved checklist recorded for that store.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

alter table public.plans add column if not exists privacy_setup_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists privacy_setup_enabled boolean not null default false;

create table public.privacy_go_live_records(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 store_id uuid not null references public.establishments(id) on delete cascade,checklist jsonb not null,critical_pending text[] not null default '{}',
 override boolean not null default false,override_reason text,decided_by uuid references auth.users(id) on delete set null,
 consumed_at timestamptz,created_at timestamptz not null default now(),
 -- A store goes live with something critical pending only on an override that says why.
 check(cardinality(critical_pending)=0 or (override and length(btrim(coalesce(override_reason,'')))>=20)));
create index privacy_go_live_records_store_idx on public.privacy_go_live_records(store_id,created_at desc);
create index privacy_go_live_records_context_idx on public.privacy_go_live_records(context_id);
create index privacy_go_live_records_decided_by_idx on public.privacy_go_live_records(decided_by) where decided_by is not null;
create trigger privacy_go_live_records_immutable before delete on public.privacy_go_live_records for each row execute function public.prevent_privacy_history_rewrite();

-- Any path that turns the flag on (this module, the superadmin screen, SQL) needs a fresh, unused go-live record.
create function public.privacy_require_go_live() returns trigger language plpgsql security definer set search_path='' as $$
declare rec uuid;
begin
 if new.privacy_operations_enabled is distinct from true or old.privacy_operations_enabled is not distinct from true then return new; end if;
 select id into rec from public.privacy_go_live_records where store_id=new.establishment_id and consumed_at is null and created_at>now()-interval '1 hour' order by created_at desc limit 1;
 if rec is null then raise exception 'PRIVACY_GO_LIVE_REQUIRED'; end if;
 update public.privacy_go_live_records set consumed_at=now() where id=rec;
 return new;
end $$;
revoke all on function public.privacy_require_go_live() from public,anon,authenticated;
create trigger store_feature_flags_privacy_go_live before update of privacy_operations_enabled on public.store_feature_flags for each row execute function public.privacy_require_go_live();

alter table public.privacy_go_live_records enable row level security;
revoke all on public.privacy_go_live_records from public,anon,authenticated;
grant all on public.privacy_go_live_records to service_role;
