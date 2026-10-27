-- Phase 45: safe central hardware hub. Existing printer connector remains compatible.
alter table public.plans add column if not exists hardware_hub_enabled boolean not null default true;
alter table public.plans add column if not exists local_hardware_agent_enabled boolean not null default true;
alter table public.plans add column if not exists advanced_printing_enabled boolean not null default true;
alter table public.plans add column if not exists payment_terminal_integration_enabled boolean not null default true;
alter table public.plans add column if not exists scale_integration_enabled boolean not null default true;

create table public.hardware_agents(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 2 and 100),agent_code text not null unique,token_hash text unique,scopes text[] not null default array['hardware:poll','hardware:ack','hardware:telemetry'],status text not null default 'offline' check(status in('online','offline','degraded','revoked')),
 app_version text,os_name text,last_seen_at timestamptz,revoked_at timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.hardware_agent_registration_tokens(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
 token_hash text not null unique,expires_at timestamptz not null,used_at timestamptz,created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table public.hardware_devices(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,agent_id uuid references public.hardware_agents(id) on delete set null,
 station_id uuid references public.kitchen_stations(id) on delete set null,name text not null,device_code text not null,device_type text not null check(device_type in('receipt_printer','kitchen_printer','label_printer','cash_drawer','payment_terminal','barcode_scanner','qr_scanner','scale','customer_display')),
 connection_type text not null check(connection_type in('network','usb','bluetooth','serial','local_agent','provider_cloud')),driver_key text,provider text,configuration jsonb not null default '{}',capabilities text[] not null default '{}',criticality text not null default 'normal' check(criticality in('low','normal','critical')),
 status text not null default 'offline' check(status in('online','offline','degraded','maintenance','disabled')),active boolean not null default true,last_seen_at timestamptz,last_error_code text,last_error_at timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(store_id,device_code)
);
create table public.hardware_commands(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,agent_id uuid references public.hardware_agents(id) on delete set null,device_id uuid not null references public.hardware_devices(id) on delete cascade,
 command_type text not null check(command_type in('print_receipt','print_kitchen_ticket','print_label','open_cash_drawer','display_message','read_scale','request_terminal_payment','cancel_terminal_payment','device_test')),payload jsonb not null default '{}',idempotency_key text not null,status text not null default 'queued' check(status in('queued','claimed','succeeded','failed','expired','cancelled')),
 priority integer not null default 100,attempt_count integer not null default 0,max_attempts integer not null default 3,expires_at timestamptz not null,claimed_at timestamptz,completed_at timestamptz,result jsonb,error_code text,error_message text,requested_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(store_id,idempotency_key),check(octet_length(payload::text)<=65536)
);
create table public.print_routing_rules(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,station_id uuid references public.kitchen_stations(id) on delete cascade,
 document_type text not null check(document_type in('receipt','kitchen_ticket','label','fiscal_copy')),primary_device_id uuid not null references public.hardware_devices(id) on delete cascade,fallback_device_id uuid references public.hardware_devices(id) on delete set null,priority integer not null default 100,conditions jsonb not null default '{}',active boolean not null default true,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.hardware_print_templates(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,name text not null,template_type text not null check(template_type in('receipt','kitchen_ticket','label','customer_copy')),content jsonb not null default '{}',version integer not null default 1,active boolean not null default true,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(store_id,name,version),check(octet_length(content::text)<=65536)
);
alter table public.printer_jobs add column if not exists hardware_device_id uuid references public.hardware_devices(id) on delete set null;
alter table public.printer_jobs add column if not exists routing_rule_id uuid references public.print_routing_rules(id) on delete set null;
alter table public.printer_jobs add column if not exists idempotency_key text;
alter table public.printer_jobs add column if not exists attempt_count integer not null default 0;
alter table public.printer_jobs add column if not exists dead_letter_at timestamptz;
alter table public.printer_jobs add column if not exists reprint_reason text;
create unique index if not exists printer_jobs_hardware_idempotency_idx on public.printer_jobs(establishment_id,idempotency_key) where idempotency_key is not null;
create table public.hardware_health_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,agent_id uuid references public.hardware_agents(id) on delete set null,device_id uuid references public.hardware_devices(id) on delete set null,
 severity text not null check(severity in('info','warning','critical')),event_type text not null,error_code text,message text,safe_metadata jsonb not null default '{}',cooldown_key text,occurred_at timestamptz not null default now()
);
create table public.hardware_audit_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,actor_id uuid references auth.users(id) on delete set null,agent_id uuid references public.hardware_agents(id) on delete set null,device_id uuid references public.hardware_devices(id) on delete set null,
 action text not null,reason text,safe_metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.payment_terminal_transactions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,device_id uuid not null references public.hardware_devices(id) on delete restrict,order_id uuid references public.orders(id) on delete set null,
 provider text not null,provider_reference text,amount_cents integer not null check(amount_cents>0),status text not null default 'pending' check(status in('pending','processing','approved','declined','cancelled','unknown','reconciled')),idempotency_key text not null,error_code text,created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(store_id,idempotency_key)
);
create table public.payment_terminal_locks(device_id uuid primary key references public.hardware_devices(id) on delete cascade,transaction_id uuid not null references public.payment_terminal_transactions(id) on delete cascade,locked_until timestamptz not null,created_at timestamptz not null default now());
create table public.product_barcodes(id uuid primary key default gen_random_uuid(),store_id uuid not null references public.establishments(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,code text not null,format text not null default 'EAN13',active boolean not null default true,created_at timestamptz not null default now(),unique(store_id,code));

create index hardware_agents_store_health_idx on public.hardware_agents(store_id,status,last_seen_at desc);
create index hardware_agents_created_by_idx on public.hardware_agents(created_by) where created_by is not null;
create index hardware_registration_store_expiry_idx on public.hardware_agent_registration_tokens(store_id,expires_at) where used_at is null;
create index hardware_registration_created_by_idx on public.hardware_agent_registration_tokens(created_by);
create index hardware_devices_store_health_idx on public.hardware_devices(store_id,status,last_seen_at desc);
create index hardware_devices_agent_idx on public.hardware_devices(agent_id) where agent_id is not null;
create index hardware_devices_station_idx on public.hardware_devices(station_id) where station_id is not null;
create index hardware_devices_created_by_idx on public.hardware_devices(created_by) where created_by is not null;
create index hardware_commands_agent_queue_idx on public.hardware_commands(agent_id,status,priority,created_at) where status in('queued','claimed');
create index hardware_commands_device_idx on public.hardware_commands(device_id,created_at desc);
create index hardware_commands_requested_by_idx on public.hardware_commands(requested_by) where requested_by is not null;
create index print_routes_store_station_idx on public.print_routing_rules(store_id,station_id,document_type,priority) where active;
create index print_routes_fallback_idx on public.print_routing_rules(fallback_device_id) where fallback_device_id is not null;
create index print_routes_created_by_idx on public.print_routing_rules(created_by) where created_by is not null;
create index print_templates_store_type_idx on public.hardware_print_templates(store_id,template_type,active);
create index print_templates_created_by_idx on public.hardware_print_templates(created_by) where created_by is not null;
create index hardware_health_store_time_idx on public.hardware_health_events(store_id,occurred_at desc);
create index hardware_health_device_time_idx on public.hardware_health_events(device_id,occurred_at desc) where device_id is not null;
create index hardware_health_agent_idx on public.hardware_health_events(agent_id) where agent_id is not null;
create index hardware_audit_store_time_idx on public.hardware_audit_events(store_id,created_at desc);
create index hardware_audit_actor_idx on public.hardware_audit_events(actor_id) where actor_id is not null;
create index hardware_audit_device_idx on public.hardware_audit_events(device_id) where device_id is not null;
create index terminal_tx_store_status_idx on public.payment_terminal_transactions(store_id,status,created_at desc);
create index terminal_tx_device_idx on public.payment_terminal_transactions(device_id,created_at desc);
create index terminal_tx_order_idx on public.payment_terminal_transactions(order_id) where order_id is not null;
create index terminal_tx_created_by_idx on public.payment_terminal_transactions(created_by) where created_by is not null;
create index terminal_locks_tx_idx on public.payment_terminal_locks(transaction_id);
create index product_barcodes_product_idx on public.product_barcodes(product_id);

do $$ declare t text; begin foreach t in array array['hardware_agents','hardware_agent_registration_tokens','hardware_devices','hardware_commands','print_routing_rules','hardware_print_templates','hardware_health_events','hardware_audit_events','payment_terminal_transactions','payment_terminal_locks','product_barcodes'] loop execute format('alter table public.%I enable row level security',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',t||'_service_only',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,certified,sensitive,allowed_dimensions) values
('hardware_device_availability','Hardware Device Availability','Disponibilidade observada dos dispositivos.','online interval / observed interval','hardware_health_events','device/day','Operações','hourly','percent','calculation',true,false,array['organization_id','store_id','device_id']),
('hardware_command_success_rate','Hardware Command Success Rate','Comandos concluídos com sucesso.','succeeded / completed','hardware_commands','store/day','Operações','hourly','percent','calculation',true,false,array['organization_id','store_id','device_id','command_type']),
('print_job_failure_rate','Print Job Failure Rate','Falhas de impressão por total de trabalhos.','failed / total','printer_jobs','store/day','Operações','hourly','percent','calculation',true,false,array['store_id']),
('terminal_unknown_rate','Terminal Unknown Rate','Transações que exigem reconciliação.','unknown / total','payment_terminal_transactions','store/day','Financeiro','hourly','percent','calculation',true,false,array['organization_id','store_id','provider'])
on conflict(metric_key) do update set name=excluded.name,description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth,updated_at=now();
