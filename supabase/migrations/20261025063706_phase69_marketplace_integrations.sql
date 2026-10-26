-- Phase 69: provider-neutral marketplace integration hub.
-- Reuses public.integrations + Vault, public.products/catalog governance, integration_create_order,
-- capacity management, delivery orchestration and the official finance/reconciliation ledgers.
-- quality: allow-nonconcurrent-index reason=new-empty-marketplace-tables
create schema if not exists marketplace_private;
revoke all on schema marketplace_private from public,anon,authenticated;

alter table public.plans
  add column if not exists marketplace_catalog_sync_enabled boolean not null default false,
  add column if not exists marketplace_financial_reconciliation_enabled boolean not null default false,
  add column if not exists marketplace_auto_accept_enabled boolean not null default false,
  add column if not exists marketplace_capacity_sync_enabled boolean not null default false;
alter table public.store_feature_flags
  add column if not exists marketplace_catalog_sync_enabled boolean not null default true,
  add column if not exists marketplace_financial_reconciliation_enabled boolean not null default true,
  add column if not exists marketplace_auto_accept_enabled boolean not null default false,
  add column if not exists marketplace_capacity_sync_enabled boolean not null default true;

create table public.marketplace_provider_definitions(
  id uuid primary key default gen_random_uuid(),provider_key text not null unique,display_name text not null,
  connection_mode text not null check(connection_mode in('oauth','api_key','managed','manual_contract')),
  adapter_version text not null default 'v1',official_api_only boolean not null default true,active boolean not null default true,
  documentation_url text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.marketplace_connections(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null unique references public.integrations(id) on delete cascade,provider_id uuid not null references public.marketplace_provider_definitions(id),
  account_external_id text,status text not null default 'pending' check(status in('pending','active','degraded','paused','error','disconnected')),
  environment text not null default 'production' check(environment in('production','sandbox')),settings jsonb not null default '{}',
  auto_accept_policy jsonb not null default '{"enabled":false,"grace_seconds":45}',connected_at timestamptz,last_sync_at timestamptz,
  cursor_value text,watermark_at timestamptz,circuit_open_until timestamptz,consecutive_failures integer not null default 0,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
comment on column public.marketplace_connections.integration_id is 'Credentials remain in integrations.vault_config_secret_id; never exposed by this table.';
create table public.marketplace_store_connections(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  external_store_id text not null,external_store_name text,status text not null default 'pending' check(status in('pending','active','paused','error','disconnected')),
  fulfillment_modes text[] not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(connection_id,external_store_id),unique(connection_id,store_id)
);
create table public.marketplace_capability_snapshots(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,capabilities jsonb not null,
  adapter_version text not null,discovered_at timestamptz not null default now(),expires_at timestamptz,unique(connection_id,adapter_version,discovered_at)
);
create table public.marketplace_member_permissions(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,permissions text[] not null default '{}',store_ids uuid[] not null default '{}',active boolean not null default true,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,user_id)
);
alter table public.marketplace_member_permissions add constraint marketplace_permissions_known check(permissions <@ array[
  'marketplaces:view','marketplaces:connect','marketplaces:disconnect','marketplaces:manage_settings','marketplaces:manage_catalog_mapping','marketplaces:sync_catalog','marketplaces:manage_prices','marketplaces:manage_availability','marketplaces:view_orders','marketplaces:manage_orders','marketplaces:view_financial','marketplaces:reconcile','marketplaces:view_health','marketplaces:view_network']::text[]);

create table public.marketplace_webhook_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_connection_id uuid references public.marketplace_store_connections(id) on delete set null,
  provider_event_id text not null,event_type text not null,signature_verified boolean not null default false,replay_verified boolean not null default false,
  payload_hash text not null,payload_reference text,redacted_metadata jsonb not null default '{}',received_at timestamptz not null default now(),
  status text not null default 'queued' check(status in('queued','processing','processed','duplicate','failed','dead_letter')),
  attempt_count integer not null default 0,next_attempt_at timestamptz not null default now(),processed_at timestamptz,last_error text,correlation_id text not null,
  unique(connection_id,provider_event_id)
);
comment on column public.marketplace_webhook_events.payload_reference is 'Pointer to protected, retention-controlled storage. Raw payloads are never written to logs.';
create table public.marketplace_order_snapshots(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  external_order_id text not null,external_display_id text,source_event_id uuid references public.marketplace_webhook_events(id) on delete set null,
  normalized_snapshot jsonb not null,financial_snapshot jsonb not null default '{}',customer_data_policy text not null default 'minimum_required',
  snapshot_hash text not null,created_at timestamptz not null default now(),unique(connection_id,external_order_id),unique(connection_id,snapshot_hash)
);
create table public.marketplace_order_links(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  external_order_id text not null,external_display_id text,internal_order_id uuid not null references public.orders(id) on delete restrict,
  snapshot_id uuid not null references public.marketplace_order_snapshots(id) on delete restrict,external_status text,internal_status text,
  acknowledgement_status text not null default 'pending' check(acknowledgement_status in('pending','acknowledged','rejected','unsupported','failed')),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(connection_id,external_order_id),unique(connection_id,internal_order_id)
);

create table public.marketplace_external_catalog_items(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  external_id text not null,external_parent_id text,item_type text not null check(item_type in('category','product','variant','modifier_group','modifier','combo','promotion')),
  external_sku text,external_barcode text,external_reference text,name text,payload_reference text,snapshot_hash text not null,
  observed_at timestamptz not null default now(),unique(connection_id,store_id,external_id,item_type)
);
comment on table public.marketplace_external_catalog_items is 'Reference/read model only; public.products and the Phase 62 catalog remain the source of truth.';
create table public.marketplace_product_mappings(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  external_item_id text not null,internal_product_id uuid references public.products(id) on delete set null,internal_variant_id uuid references public.product_variations(id) on delete set null,
  mapping_method text not null check(mapping_method in('explicit','sku','barcode','external_reference','name_suggestion','unmatched')),
  status text not null default 'pending_review' check(status in('pending_review','confirmed','rejected','unmapped')),confidence numeric(5,4),reviewed_by uuid references auth.users(id),reviewed_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(connection_id,store_id,external_item_id)
);
create table public.marketplace_sync_policies(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,
  sync_mode text not null default 'import' check(sync_mode in('import','export','bidirectional_controlled')),field_policies jsonb not null default '{}',
  require_preview boolean not null default true,published_catalog_only boolean not null default true,capacity_hysteresis_seconds integer not null default 300,
  allow_provider_global_disable boolean not null default false,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(connection_id,store_id)
);
create table public.marketplace_sync_runs(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,
  sync_type text not null check(sync_type in('catalog_import','catalog_export','price','availability','status','orders_poll','financial','payout','backfill')),
  status text not null default 'queued' check(status in('queued','preview','running','completed','partial','failed','dead_letter')),
  cursor_value text,watermark_at timestamptz,preview jsonb not null default '{}',summary jsonb not null default '{}',attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,last_error text,correlation_id text not null,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.marketplace_drift_records(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  drift_type text not null check(drift_type in('catalog','price','availability','status','order_gap')),entity_reference text not null,
  internal_value jsonb not null default '{}',external_value jsonb not null default '{}',status text not null default 'open' check(status in('open','accepted','corrected','ignored')),
  detected_at timestamptz not null default now(),resolved_at timestamptz,resolved_by uuid references auth.users(id)
);
create table public.marketplace_status_mappings(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,direction text not null check(direction in('inbound','outbound')),
  external_status text not null,internal_status text not null check(internal_status in('new','confirmed','preparing','ready','out_for_delivery','completed','canceled','manual_review')),
  safe_terminal boolean not null default false,created_at timestamptz not null default now(),unique(connection_id,direction,external_status)
);
create table public.marketplace_cancellation_sagas(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  order_link_id uuid not null references public.marketplace_order_links(id) on delete restrict,state text not null default 'cancel_requested' check(state in('cancel_requested','provider_pending','cancelled','cancel_failed','manual_review')),
  reason text,refund_reference text,provider_reference text,idempotency_key text not null,requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),confirmed_at timestamptz,last_error text,unique(order_link_id,idempotency_key)
);
create table public.marketplace_financial_statements(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,external_statement_id text not null,
  period_start date not null,period_end date not null,currency text not null default 'BRL',gross_cents bigint not null default 0,net_cents bigint not null default 0,
  breakdown jsonb not null default '{"commission":0,"delivery":0,"payment":0,"subscription":0,"promotion":0,"adjustment":0}',
  source_reference text,imported_at timestamptz not null default now(),unique(connection_id,external_statement_id),check(period_end>=period_start)
);
create table public.marketplace_payouts(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,external_payout_id text not null,
  statement_id uuid references public.marketplace_financial_statements(id) on delete set null,expected_cents bigint not null,paid_cents bigint,
  paid_at timestamptz,status text not null default 'expected' check(status in('expected','paid','delayed','divergent','reconciled')),
  reconciliation_reference text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(connection_id,external_payout_id)
);
create table public.marketplace_health_samples(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,status text not null check(status in('healthy','degraded','down','rate_limited','circuit_open')),
  latency_ms integer,queue_depth integer not null default 0,error_rate numeric(7,4) not null default 0,rate_limit_remaining integer,
  details jsonb not null default '{}',sampled_at timestamptz not null default now()
);
create table public.marketplace_audit_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.marketplace_connections(id) on delete set null,store_id uuid references public.establishments(id) on delete set null,
  event_type text not null,actor_user_id uuid references auth.users(id),correlation_id text,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);

create index marketplace_webhooks_due_idx on public.marketplace_webhook_events(status,next_attempt_at) where status in('queued','failed');
create index marketplace_sync_due_idx on public.marketplace_sync_runs(status,next_attempt_at) where status in('queued','failed');
create index marketplace_orders_store_created_idx on public.marketplace_order_links(store_id,created_at desc);
create index marketplace_health_connection_sampled_idx on public.marketplace_health_samples(connection_id,sampled_at desc);
create index marketplace_drift_open_idx on public.marketplace_drift_records(connection_id,drift_type,detected_at desc) where status='open';

create or replace function marketplace_private.reject_snapshot_mutation() returns trigger language plpgsql set search_path='' as $$begin raise exception 'marketplace snapshots are immutable';end$$;
create trigger marketplace_order_snapshots_immutable before update or delete on public.marketplace_order_snapshots for each row execute function marketplace_private.reject_snapshot_mutation();

create or replace function public.marketplace_ingest_order(requested_connection uuid,requested_store uuid,requested_external_order_id text,requested_external_display_id text,requested_payload jsonb,requested_financial jsonb,requested_event uuid,requested_hash text,requested_correlation text,requested_environment text default 'production') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.marketplace_connections;snapshot_id uuid;created jsonb;internal_id uuid;org uuid;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'internal only';end if;
 select * into c from public.marketplace_connections where id=requested_connection for update;
 if not found or c.status not in('active','degraded') then raise exception 'marketplace connection unavailable';end if;
 select organization_id into org from public.establishments where id=requested_store;
 if org is null or org<>c.organization_id or not exists(select 1 from public.marketplace_store_connections where connection_id=c.id and store_id=requested_store and status='active') then raise exception 'invalid store mapping';end if;
 if exists(select 1 from public.marketplace_order_links where connection_id=c.id and external_order_id=requested_external_order_id) then
   return (select jsonb_build_object('duplicate',true,'order_id',internal_order_id,'external_order_id',external_order_id) from public.marketplace_order_links where connection_id=c.id and external_order_id=requested_external_order_id);
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(requested_payload->'items','[]'::jsonb)) i where not exists(select 1 from public.marketplace_product_mappings m where m.connection_id=c.id and m.store_id=requested_store and m.external_item_id=i->>'external_id' and m.status='confirmed')) then raise exception 'unmapped product';end if;
 insert into public.marketplace_order_snapshots(organization_id,connection_id,store_id,external_order_id,external_display_id,source_event_id,normalized_snapshot,financial_snapshot,snapshot_hash)
 values(org,c.id,requested_store,requested_external_order_id,requested_external_display_id,requested_event,requested_payload,coalesce(requested_financial,'{}'),requested_hash) returning id into snapshot_id;
 created:=public.integration_create_order(requested_store,requested_payload||jsonb_build_object('provider',(select provider_key from public.marketplace_provider_definitions where id=c.provider_id)),'marketplace',requested_correlation,requested_environment);
 internal_id:=(created->>'order_id')::uuid;
 insert into public.marketplace_order_links(organization_id,connection_id,store_id,external_order_id,external_display_id,internal_order_id,snapshot_id,external_status,internal_status)
 values(org,c.id,requested_store,requested_external_order_id,requested_external_display_id,internal_id,snapshot_id,requested_payload->>'status',coalesce(created->>'status','new'));
 perform public.enqueue_integration_event(org,requested_store,'marketplace.order.ingested','order',internal_id,jsonb_build_object('order_id',internal_id,'external_order_id',requested_external_order_id,'connection_id',c.id),'marketplace',requested_correlation,requested_environment);
 return created||jsonb_build_object('duplicate',false,'snapshot_id',snapshot_id,'external_order_id',requested_external_order_id);
end$$;
revoke all on function public.marketplace_ingest_order(uuid,uuid,text,text,jsonb,jsonb,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_ingest_order(uuid,uuid,text,text,jsonb,jsonb,uuid,text,text,text) to service_role;

create or replace function public.claim_marketplace_webhooks(requested_limit integer default 20) returns setof public.marketplace_webhook_events language plpgsql security definer set search_path='' as $$
begin if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'internal only';end if;
return query with claimed as(select id from public.marketplace_webhook_events where status in('queued','failed') and next_attempt_at<=now() order by received_at for update skip locked limit least(greatest(requested_limit,1),50))
update public.marketplace_webhook_events e set status='processing',attempt_count=attempt_count+1 from claimed c where e.id=c.id returning e.*;end$$;
revoke all on function public.claim_marketplace_webhooks(integer) from public,anon,authenticated;grant execute on function public.claim_marketplace_webhooks(integer) to service_role;

create or replace function public.store_marketplace_webhook_payload(requested_event uuid,requested_raw text) returns uuid language plpgsql security definer set search_path='' as $$
declare secret_id uuid;begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'internal only';end if;
 if octet_length(requested_raw)>524288 then raise exception 'payload too large';end if;
 if not exists(select 1 from public.marketplace_webhook_events where id=requested_event) then raise exception 'event not found';end if;
 select vault.create_secret(requested_raw,'marketplace-payload-'||requested_event::text,'Protected inbound payload; short retention') into secret_id;
 update public.marketplace_webhook_events set payload_reference=secret_id::text where id=requested_event;
 return secret_id;
end$$;
revoke all on function public.store_marketplace_webhook_payload(uuid,text) from public,anon,authenticated;grant execute on function public.store_marketplace_webhook_payload(uuid,text) to service_role;

create or replace function public.get_marketplace_connection_secret(requested_connection uuid) returns text language plpgsql security definer set search_path='' as $$
declare decrypted text;begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'internal only';end if;
 select v.decrypted_secret into decrypted from public.marketplace_connections c join public.integrations i on i.id=c.integration_id join vault.decrypted_secrets v on v.id=i.vault_config_secret_id where c.id=requested_connection;
 return decrypted;
end$$;
revoke all on function public.get_marketplace_connection_secret(uuid) from public,anon,authenticated;grant execute on function public.get_marketplace_connection_secret(uuid) to service_role;

create or replace function public.claim_marketplace_webhook_payloads(requested_limit integer default 20)
returns table(event_id uuid,organization_id uuid,connection_id uuid,store_connection_id uuid,provider_event_id text,event_type text,raw_payload text,attempt_count integer,correlation_id text)
language plpgsql security definer set search_path='' as $$begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'internal only';end if;
 return query with claimed as(select id from public.marketplace_webhook_events where status in('queued','failed') and next_attempt_at<=now() order by received_at for update skip locked limit least(greatest(requested_limit,1),50)),
 updated as(update public.marketplace_webhook_events e set status='processing',attempt_count=e.attempt_count+1 from claimed c where e.id=c.id returning e.*)
 select u.id,u.organization_id,u.connection_id,u.store_connection_id,u.provider_event_id,u.event_type,v.decrypted_secret,u.attempt_count,u.correlation_id
 from updated u join vault.decrypted_secrets v on v.id=u.payload_reference::uuid;
end$$;
revoke all on function public.claim_marketplace_webhook_payloads(integer) from public,anon,authenticated;grant execute on function public.claim_marketplace_webhook_payloads(integer) to service_role;

create or replace function public.purge_marketplace_webhook_payloads(requested_retention_days integer default 30) returns integer language plpgsql security definer set search_path='' as $$
declare removed integer:=0;r record;begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'internal only';end if;
 for r in select id,payload_reference from public.marketplace_webhook_events where received_at<now()-make_interval(days=>least(greatest(requested_retention_days,1),180)) and payload_reference is not null loop
   delete from vault.secrets where id=r.payload_reference::uuid;update public.marketplace_webhook_events set payload_reference=null where id=r.id;removed:=removed+1;
 end loop;return removed;
end$$;
revoke all on function public.purge_marketplace_webhook_payloads(integer) from public,anon,authenticated;grant execute on function public.purge_marketplace_webhook_payloads(integer) to service_role;

do $$declare t text;begin foreach t in array array['marketplace_provider_definitions','marketplace_connections','marketplace_store_connections','marketplace_capability_snapshots','marketplace_member_permissions','marketplace_webhook_events','marketplace_order_snapshots','marketplace_order_links','marketplace_external_catalog_items','marketplace_product_mappings','marketplace_sync_policies','marketplace_sync_runs','marketplace_drift_records','marketplace_status_mappings','marketplace_cancellation_sagas','marketplace_financial_statements','marketplace_payouts','marketplace_health_samples','marketplace_audit_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)','marketplace_service_'||t,t);end loop;end$$;
grant select on public.marketplace_provider_definitions to authenticated;
create policy marketplace_provider_read on public.marketplace_provider_definitions for select to authenticated using(active=true);
do $$declare t text;begin foreach t in array array['marketplace_connections','marketplace_store_connections','marketplace_capability_snapshots','marketplace_member_permissions','marketplace_webhook_events','marketplace_order_links','marketplace_external_catalog_items','marketplace_product_mappings','marketplace_sync_policies','marketplace_sync_runs','marketplace_drift_records','marketplace_status_mappings','marketplace_cancellation_sagas','marketplace_financial_statements','marketplace_payouts','marketplace_health_samples','marketplace_audit_events'] loop execute format('grant select on public.%I to authenticated',t);execute format('create policy %I on public.%I for select to authenticated using(private.integration_org_admin(organization_id))','marketplace_read_'||t,t);end loop;end$$;

insert into public.marketplace_provider_definitions(provider_key,display_name,connection_mode,adapter_version,official_api_only)
values('provider_template','Provedor homologado','oauth','v1',true) on conflict(provider_key)do nothing;

insert into public.search_command_registry(id,title,description,keywords,command_type,route,action_type,required_permission,risk_level,scope,position)
values('marketplace-integrations','Canais de delivery','Marketplaces, pedidos externos, catálogo, preços e saúde',array['marketplace','delivery','agregador','canal','pedidos externos'],'navigation','/painel/integracoes/marketplaces',null,'marketplaces:view','low','organization',77)
on conflict(id)do update set title=excluded.title,description=excluded.description,keywords=excluded.keywords,route=excluded.route,required_permission=excluded.required_permission,active=true;

insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity,active)
values
('marketplace.order_ingested',1,'marketplaces','Pedido externo recebido após entrada idempotente pelo Order Service.','{}',array['order_id','external_order_id','connection_id'],'sensitive',true),
('marketplace.connection_degraded',1,'marketplaces','Canal degradado sem interromper pedidos próprios.','{}',array['connection_id','status'],'normal',true),
('marketplace.order_gap_detected',1,'marketplaces','Lacuna identificada para backfill incremental com cursor.','{}',array['connection_id','store_id','watermark_at'],'normal',true)
on conflict(event_name,schema_version)do update set description=excluded.description,allowed_fields=excluded.allowed_fields,active=true;

insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,idempotency_supported,action_engine_required,active)
values
('marketplace_sync_catalog_preview','marketplaces','Gera diff sem publicar no provedor.','{}','marketplaces:sync_catalog','low',true,false,true),
('marketplace_pause_channel','marketplaces','Pausa controlada; exige confirmação e auditoria.','{}','marketplaces:manage_settings','high',true,true,true),
('marketplace_reprocess_order','marketplaces','Reprocessa pela chave idempotente, sem duplicar pedido.','{}','marketplaces:manage_orders','high',true,true,true)
on conflict(action_type)do update set description=excluded.description,risk_level=excluded.risk_level,action_engine_required=excluded.action_engine_required,active=true;
