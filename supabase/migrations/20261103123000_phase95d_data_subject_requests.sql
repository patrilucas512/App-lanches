-- Phase 95D: data subject requests. customer_privacy_requests (Phase 13) becomes the canonical request; no second table.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

-- A request may come from someone who is not a customer of the store (an employee, a driver, a SaaS customer), so the
-- customer link becomes optional. The subject is then identified by subject_ref inside its context.
alter table public.customer_privacy_requests alter column customer_id drop not null;
alter table public.customer_privacy_requests alter column establishment_id drop not null;
alter table public.customer_privacy_requests alter column organization_id drop not null;
alter table public.customer_privacy_requests drop constraint customer_privacy_requests_request_type_check;
alter table public.customer_privacy_requests drop constraint customer_privacy_requests_status_check;
alter table public.customer_privacy_requests
 add column context_id uuid references public.privacy_contexts(id) on delete cascade,
 add column subject_category text not null default 'end_customer' check(subject_category in('end_customer','lead','employee','driver','supplier_contact','saas_customer','saas_user')),
 add column subject_ref text,
 add column organization_customer_id uuid references public.organization_customers(id) on delete set null,
 add column channel text not null default 'customer_portal' check(channel in('customer_portal','whatsapp','email','manual')),
 add column verification_method text,
 add column verification_status text not null default 'pending' check(verification_status in('pending','verified','failed','not_required')),
 add column verified_at timestamptz,
 add column received_at timestamptz not null default now(),
 add column due_at timestamptz,
 add column assignee_id uuid references auth.users(id) on delete set null,
 add column affected_domains text[] not null default '{}',
 add column outcome jsonb not null default '{}',
 add column rejection_reason text,
 add column response_draft text,
 add column response_draft_by_ai boolean not null default false,
 add column response_approved_by uuid references auth.users(id) on delete set null,
 add column response_sent_at timestamptz,
 add column approval_id uuid references public.internal_approvals(id) on delete set null,
 add column completed_at timestamptz,
 add column last_alert_level text,
 add column idempotency_key text;
-- Phase 13 rows keep their meaning: open stays received, reviewing is in progress, completed is fulfilled.
update public.customer_privacy_requests set status=case status when 'open' then 'received' when 'reviewing' then 'in_progress' when 'completed' then 'fulfilled' when 'rejected' then 'rejected_with_reason' else status end,
 request_type=case request_type when 'consent_review' then 'consent_revocation' else request_type end,received_at=created_at,
 rejection_reason=case when status='rejected' then 'Recusada antes da Fase 95; motivo não registrado.' end;
alter table public.customer_privacy_requests alter column status set default 'received';
alter table public.customer_privacy_requests add constraint customer_privacy_requests_request_type_check check(request_type in('confirmation','access','correction','anonymization','blocking','deletion','portability','sharing_info','consent_revocation','automated_decision_review','opposition'));
alter table public.customer_privacy_requests add constraint customer_privacy_requests_status_check check(status in('received','verifying','in_progress','awaiting_approval','fulfilled','partially_fulfilled','rejected_with_reason','closed'));
-- A rejection or a partial answer always says why.
alter table public.customer_privacy_requests add constraint customer_privacy_requests_reason_check check(status not in('rejected_with_reason','partially_fulfilled') or rejection_reason is not null or outcome<>'{}'::jsonb);
create index customer_privacy_requests_context_idx on public.customer_privacy_requests(context_id,status,due_at);
create index customer_privacy_requests_customer_idx on public.customer_privacy_requests(customer_id) where customer_id is not null;
create index customer_privacy_requests_org_customer_idx on public.customer_privacy_requests(organization_customer_id) where organization_customer_id is not null;
create index customer_privacy_requests_establishment_idx on public.customer_privacy_requests(establishment_id) where establishment_id is not null;
create index customer_privacy_requests_assignee_idx on public.customer_privacy_requests(assignee_id) where assignee_id is not null;
create index customer_privacy_requests_approved_by_idx on public.customer_privacy_requests(response_approved_by) where response_approved_by is not null;
create index customer_privacy_requests_approval_idx on public.customer_privacy_requests(approval_id) where approval_id is not null;
create unique index customer_privacy_requests_idempotency_idx on public.customer_privacy_requests(context_id,idempotency_key) where idempotency_key is not null;
-- Requests from Phase 13 join their store's tenant context.
insert into public.privacy_contexts(organization_id,kind,name) select distinct organization_id,'tenant_controller','Controlador (estabelecimento)' from public.customer_privacy_requests where organization_id is not null on conflict(organization_id,kind) do nothing;
update public.customer_privacy_requests r set context_id=c.id from public.privacy_contexts c where c.organization_id=r.organization_id and c.kind='tenant_controller' and r.context_id is null;

-- The Phase 13 portal keeps inserting requests the way it always did. This fills the new fields for those rows and
-- for any other writer: the tenant context, the legacy names and the due date from the context's configured deadlines.
create function public.privacy_dsr_defaults() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx uuid; days numeric; deadlines jsonb;
begin
 if new.request_type='consent_review' then new.request_type:='consent_revocation'; end if;
 if new.status='open' then new.status:='received'; end if;
 if new.context_id is null and new.organization_id is not null then
  insert into public.privacy_contexts(organization_id,kind,name) values(new.organization_id,'tenant_controller','Controlador (estabelecimento)') on conflict(organization_id,kind) do nothing;
  select id into ctx from public.privacy_contexts where organization_id=new.organization_id and kind='tenant_controller';
  new.context_id:=ctx;
 end if;
 if new.context_id is null then raise exception 'PRIVACY_CONTEXT_REQUIRED'; end if;
 if new.due_at is null then
  select dsr_deadline_days into deadlines from public.privacy_settings where context_id=new.context_id;
  deadlines:=coalesce(deadlines,'{"default":15}'::jsonb);
  days:=coalesce((deadlines->>new.request_type)::numeric,(deadlines->>'default')::numeric);
  if days>0 then new.due_at:=coalesce(new.received_at,now())+make_interval(secs=>(days*86400)::double precision); end if;
 end if;
 return new;
end $$;
revoke all on function public.privacy_dsr_defaults() from public,anon,authenticated;
create trigger customer_privacy_requests_defaults before insert on public.customer_privacy_requests for each row execute function public.privacy_dsr_defaults();

-- Identity check: a code sent to a contact already on file. Only its hash is stored; documents are never collected here.
create table public.privacy_dsr_verifications(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.customer_privacy_requests(id) on delete cascade,context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 method text not null check(method in('otp_registered_contact','portal_session','manual_review')),code_hash text,destination_masked text,attempts integer not null default 0,max_attempts integer not null default 5,
 expires_at timestamptz,verified_at timestamptz,decided_by uuid references auth.users(id) on delete set null,notes text,created_at timestamptz not null default now());
create index privacy_dsr_verifications_request_idx on public.privacy_dsr_verifications(request_id,created_at desc);
create index privacy_dsr_verifications_context_idx on public.privacy_dsr_verifications(context_id);
create index privacy_dsr_verifications_decided_by_idx on public.privacy_dsr_verifications(decided_by) where decided_by is not null;

-- Timeline and evidence of each request. What was done and by whom; never the data that was removed.
create table public.privacy_dsr_events(
 id bigint generated always as identity primary key,request_id uuid not null references public.customer_privacy_requests(id) on delete cascade,context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 event_type text not null,from_status text,to_status text,actor_id uuid references auth.users(id) on delete set null,actor_type text not null default 'user',note text,evidence jsonb not null default '{}',created_at timestamptz not null default now());
create index privacy_dsr_events_request_idx on public.privacy_dsr_events(request_id,created_at);
create index privacy_dsr_events_context_idx on public.privacy_dsr_events(context_id);
create index privacy_dsr_events_actor_idx on public.privacy_dsr_events(actor_id) where actor_id is not null;
create trigger privacy_dsr_events_immutable before update or delete on public.privacy_dsr_events for each row execute function public.prevent_privacy_history_rewrite();

-- Access and portability packages. The file lives in a private bucket and the link expires; the row records its hash and size.
create table public.privacy_export_packages(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.customer_privacy_requests(id) on delete cascade,context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 storage_path text not null,format text not null default 'json' check(format in('json')),sha256 text not null,size_bytes integer not null,domains text[] not null default '{}',missing_domains text[] not null default '{}',
 expires_at timestamptz not null,downloaded_at timestamptz,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create index privacy_export_packages_request_idx on public.privacy_export_packages(request_id);
create index privacy_export_packages_context_idx on public.privacy_export_packages(context_id);
create index privacy_export_packages_created_by_idx on public.privacy_export_packages(created_by) where created_by is not null;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('privacy-exports','privacy-exports',false,10485760,array['application/json']) on conflict(id) do nothing;

do $$declare t text;begin foreach t in array array['privacy_dsr_verifications','privacy_dsr_events','privacy_export_packages'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
