-- Phase 44 · controlled offline continuity. Online remains the source of truth.
alter table public.plans add column if not exists offline_operations_enabled boolean not null default false;
alter table public.plans add column if not exists offline_orders_enabled boolean not null default false;
alter table public.plans add column if not exists offline_kds_enabled boolean not null default false;
alter table public.plans add column if not exists offline_cash_enabled boolean not null default false;
alter table public.plans add column if not exists offline_delivery_updates_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists offline_operations_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists offline_orders_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists offline_kds_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists offline_cash_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists offline_delivery_updates_enabled boolean not null default true;

create table public.offline_devices(
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade,
 device_name text not null check(char_length(btrim(device_name)) between 2 and 120), device_type text not null default 'browser', app_version text, local_schema_version integer not null default 1,
 connectivity text not null default 'online' check(connectivity in('online','degraded','offline','reconnecting')), readiness text not null default 'partial' check(readiness in('ready','partial','not_ready')),
 storage_usage_bytes bigint not null default 0, storage_quota_bytes bigint not null default 0, pending_count integer not null default 0, conflict_count integer not null default 0,
 last_online_at timestamptz, last_seen_at timestamptz not null default now(), oldest_pending_at timestamptz, auth_valid_until timestamptz, trusted_at timestamptz not null default now(),
 offline_disabled_at timestamptz, remote_wipe_requested_at timestamptz, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(store_id,id)
);
create table public.offline_server_mutations(
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, device_id uuid not null references public.offline_devices(id) on delete restrict,
 user_id uuid references auth.users(id) on delete set null, entity_id uuid not null, entity_type text not null, operation text not null, payload jsonb not null default '{}'::jsonb,
 client_created_at timestamptz not null, server_received_at timestamptz not null default now(), idempotency_key text not null, expected_version bigint, dependency_ids uuid[] not null default '{}',
 status text not null default 'accepted' check(status in('accepted','duplicate','conflict','rejected','retryable_error','applied')), result jsonb not null default '{}'::jsonb, last_error text, retry_count integer not null default 0, applied_at timestamptz,
 unique(store_id,idempotency_key)
);
create table public.offline_sync_conflicts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade,
 device_id uuid not null references public.offline_devices(id) on delete restrict, mutation_id uuid not null references public.offline_server_mutations(id) on delete cascade, entity_type text not null, entity_id uuid not null,
 conflict_type text not null, local_summary jsonb not null default '{}', server_summary jsonb not null default '{}', suggested_strategy text not null check(suggested_strategy in('server_wins','client_wins','merge','manual_review','reject_mutation')),
 status text not null default 'open' check(status in('open','resolved','discarded')), resolved_by uuid references auth.users(id) on delete set null, resolution text, decision_reason text, resolved_at timestamptz, created_at timestamptz not null default now()
);
create table public.offline_cash_declarations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade,
 mutation_id uuid not null unique references public.offline_server_mutations(id) on delete restrict, cash_shift_id uuid references public.cash_shifts(id) on delete restrict, table_session_id uuid references public.table_sessions(id) on delete restrict,
 payment_kind text not null check(payment_kind in('cash','unverified_external_payment')), amount_cents integer not null check(amount_cents>0), received_cents integer, change_cents integer, status text not null default 'pending_reconciliation' check(status in('pending_reconciliation','verified','rejected')),
 declared_by uuid references auth.users(id) on delete set null, client_created_at timestamptz not null, reconciled_by uuid references auth.users(id) on delete set null, reconciled_at timestamptz, created_at timestamptz not null default now()
);
create table public.offline_attachments(
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, mutation_id uuid references public.offline_server_mutations(id) on delete cascade,
 attachment_type text not null, mime_type text not null, size_bytes integer not null check(size_bytes>0 and size_bytes<=5242880), content_hash text not null, storage_path text, status text not null default 'pending' check(status in('pending','uploaded','failed','cancelled')), created_at timestamptz not null default now(), uploaded_at timestamptz
);
create table public.offline_connectivity_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, device_id uuid not null references public.offline_devices(id) on delete cascade,
 state text not null check(state in('online','degraded','offline','reconnecting')), client_created_at timestamptz not null, server_received_at timestamptz not null default now(), latency_ms integer, clock_skew_ms bigint, metadata jsonb not null default '{}'
);
create table public.offline_audit_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, device_id uuid references public.offline_devices(id) on delete set null,
 actor_id uuid references auth.users(id) on delete set null, event_type text not null, entity_type text, entity_id text, mutation_id uuid, client_created_at timestamptz, server_received_at timestamptz not null default now(), safe_metadata jsonb not null default '{}'
);

create index offline_devices_store_health_idx on public.offline_devices(store_id,connectivity,last_seen_at desc);
create index offline_devices_org_health_idx on public.offline_devices(organization_id,connectivity,last_seen_at desc);
create index offline_devices_created_by_idx on public.offline_devices(created_by) where created_by is not null;
create index offline_mutations_store_status_idx on public.offline_server_mutations(store_id,status,client_created_at);
create index offline_mutations_device_status_idx on public.offline_server_mutations(device_id,status,client_created_at);
create index offline_mutations_user_idx on public.offline_server_mutations(user_id) where user_id is not null;
create index offline_conflicts_store_status_idx on public.offline_sync_conflicts(store_id,status,created_at);
create index offline_conflicts_device_idx on public.offline_sync_conflicts(device_id);
create index offline_conflicts_resolved_by_idx on public.offline_sync_conflicts(resolved_by) where resolved_by is not null;
create index offline_cash_store_status_idx on public.offline_cash_declarations(store_id,status,created_at);
create index offline_cash_shift_idx on public.offline_cash_declarations(cash_shift_id) where cash_shift_id is not null;
create index offline_cash_table_session_idx on public.offline_cash_declarations(table_session_id) where table_session_id is not null;
create index offline_cash_declared_by_idx on public.offline_cash_declarations(declared_by) where declared_by is not null;
create index offline_cash_reconciled_by_idx on public.offline_cash_declarations(reconciled_by) where reconciled_by is not null;
create index offline_attachments_store_status_idx on public.offline_attachments(store_id,status,created_at);
create index offline_attachments_mutation_idx on public.offline_attachments(mutation_id) where mutation_id is not null;
create index offline_connectivity_store_time_idx on public.offline_connectivity_events(store_id,server_received_at desc);
create index offline_connectivity_device_time_idx on public.offline_connectivity_events(device_id,server_received_at desc);
create index offline_audit_store_time_idx on public.offline_audit_events(store_id,server_received_at desc);
create index offline_audit_device_idx on public.offline_audit_events(device_id) where device_id is not null;
create index offline_audit_actor_idx on public.offline_audit_events(actor_id) where actor_id is not null;
create index offline_audit_mutation_idx on public.offline_audit_events(mutation_id) where mutation_id is not null;

do $$ declare t text; begin foreach t in array array['offline_devices','offline_server_mutations','offline_sync_conflicts','offline_cash_declarations','offline_attachments','offline_connectivity_events','offline_audit_events'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy %I on public.%I for all to service_role using (true) with check (true)',t||'_service_only',t); execute format('revoke all on public.%I from anon, authenticated',t); execute format('grant all on public.%I to service_role',t); end loop; end $$;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,certified,sensitive,allowed_dimensions)
values
('offline_duration','Offline Duration','Tempo total em estado offline.','sum(connectivity interval)','offline_connectivity_events','device/day','Operações','near_realtime','seconds','fact',true,false,array['organization_id','store_id','device_id']),
('pending_sync_count','Pending Sync Count','Operações ainda não aplicadas.','count(status pending/conflict/error)','offline_server_mutations','store/current','Operações','near_realtime','count','fact',true,false,array['organization_id','store_id','device_id']),
('sync_success_rate','Sync Success Rate','Percentual aplicado sem erro.','applied / received','offline_server_mutations','store/day','Operações','hourly','percent','calculation',true,false,array['organization_id','store_id']),
('average_sync_delay','Average Sync Delay','Atraso médio entre criação e recebimento.','avg(server_received_at-client_created_at)','offline_server_mutations','store/day','Operações','hourly','seconds','calculation',true,false,array['organization_id','store_id','device_id']),
('offline_conflict_rate','Conflict Rate','Percentual de conflitos no sync.','conflicts / received','offline_server_mutations','store/day','Operações','hourly','percent','calculation',true,false,array['organization_id','store_id']),
('device_availability','Device Availability','Disponibilidade observada por dispositivo.','online time / observed time','offline_connectivity_events','device/day','Operações','hourly','percent','calculation',true,false,array['organization_id','store_id','device_id'])
on conflict(metric_key) do update set name=excluded.name,description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,updated_at=now();
