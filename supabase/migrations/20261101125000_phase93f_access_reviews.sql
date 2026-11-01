-- Phase 93F: access review campaigns and certifications. Each campaign also records a Phase 25 access_review_runs row, the existing register.
-- quality: allow-nonconcurrent-index reason=new-empty-identity-governance-tables

create table public.access_review_campaigns(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,review_type text not null check(review_type in('manager_review','entitlement_owner_review','privileged_review','service_account_review','vendor_review','dormant_access_review','sod_review')),status text not null default 'draft' check(status in('draft','active','completed','cancelled')),due_at timestamptz not null,filters jsonb not null default '{}',review_run_id uuid references public.access_review_runs(id) on delete set null,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),completed_at timestamptz);

create table public.access_review_items(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,campaign_id uuid not null references public.access_review_campaigns(id) on delete cascade,grant_id uuid references public.access_grants(id) on delete set null,identity_id uuid not null references public.governed_identities(id) on delete restrict,entitlement_id uuid not null references public.access_entitlements(id) on delete restrict,reviewer_id uuid references auth.users(id) on delete set null,critical boolean not null default false,decision text check(decision in('keep','revoke','reduce_scope','change_duration','delegate','needs_info')),reason text,decided_by uuid references auth.users(id) on delete set null,decided_at timestamptz,execution_status text not null default 'pending' check(execution_status in('pending','not_required','revoked','failed')),execution_detail text,context jsonb not null default '{}',created_at timestamptz not null default now(),unique(campaign_id,grant_id));

create table public.access_certifications(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,campaign_id uuid not null unique references public.access_review_campaigns(id) on delete restrict,certified_by uuid references auth.users(id) on delete set null,certified_at timestamptz not null default now(),summary jsonb not null,evidence_hash text not null);

-- A reviewer can never decide on their own access, whichever path writes the row.
create function private.identity_governance_block_self_review() returns trigger language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 select user_id into subject from public.governed_identities where id=new.identity_id;
 if subject is not null and(subject=new.reviewer_id or subject=new.decided_by) then raise exception 'REVIEWER_CANNOT_REVIEW_OWN_ACCESS'; end if;
 return new;
end$$;
create trigger access_review_items_no_self_review before insert or update of reviewer_id,decided_by on public.access_review_items for each row execute function private.identity_governance_block_self_review();
revoke all on function private.identity_governance_block_self_review() from public,anon,authenticated;
create trigger access_certifications_immutable before update or delete on public.access_certifications for each row execute function public.prevent_identity_governance_history_rewrite();

create index access_review_campaigns_board_idx on public.access_review_campaigns(organization_id,status,due_at);
create index access_review_campaigns_run_idx on public.access_review_campaigns(review_run_id) where review_run_id is not null;
create index access_review_items_campaign_idx on public.access_review_items(campaign_id,decision);
create index access_review_items_reviewer_idx on public.access_review_items(reviewer_id,decision) where reviewer_id is not null;
create index access_review_items_org_idx on public.access_review_items(organization_id);
create index access_review_items_grant_idx on public.access_review_items(grant_id) where grant_id is not null;
create index access_review_items_identity_idx on public.access_review_items(identity_id);
create index access_review_items_entitlement_idx on public.access_review_items(entitlement_id);
create index access_certifications_org_idx on public.access_certifications(organization_id,certified_at desc);

do $$declare t text;begin foreach t in array array['access_review_campaigns','access_review_items','access_certifications'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
