-- Phase 43: self-service kiosks. Extends the canonical catalog/order/payment/KDS flows.
alter table public.plans add column if not exists self_service_enabled boolean not null default false;
alter table public.plans add column if not exists kiosk_payments_enabled boolean not null default false;
alter table public.plans add column if not exists pickup_display_enabled boolean not null default false;
alter table public.plans add column if not exists kiosk_loyalty_enabled boolean not null default false;
alter table public.plans add column if not exists kiosk_analytics_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists self_service_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists kiosk_payments_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists pickup_display_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists kiosk_loyalty_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists kiosk_analytics_enabled boolean not null default true;

create table public.kiosk_devices(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 2 and 100), device_code text not null unique, device_type text not null check(device_type in('kiosk','tablet','counter_terminal','self_checkout','order_display')),
 status text not null default 'offline' check(status in('online','offline','maintenance','disabled','degraded')), token_hash text unique, scopes text[] not null default array['kiosk:catalog','kiosk:create_session','kiosk:create_checkout','kiosk:payment','kiosk:order_status'],
 last_seen_at timestamptz, app_version text, config_version bigint not null default 1, config jsonb not null default '{"mode":"order_and_pay","payment_methods":["pix","pay_at_counter"],"session_timeout_seconds":180,"upsell_limit":2,"receipt":true,"accessibility":true}'::jsonb,
 revoked_at timestamptz, active boolean not null default true, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.kiosk_registration_tokens(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade,
 name text not null, device_type text not null check(device_type in('kiosk','tablet','counter_terminal','self_checkout','order_display')), token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.kiosk_sessions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, kiosk_device_id uuid not null references public.kiosk_devices(id) on delete restrict,
 started_at timestamptz not null default now(), ended_at timestamptz, expires_at timestamptz not null, status text not null default 'active' check(status in('active','checkout','payment','completed','abandoned','expired')), customer_id uuid references public.customers(id) on delete set null, order_id uuid references public.orders(id) on delete set null,
 locale text not null default 'pt-BR', metadata jsonb not null default '{}'::jsonb, last_activity_at timestamptz not null default now(), abandonment_step text check(abandonment_step is null or abandonment_step in('browsing','product','cart','checkout','payment'))
);
create table public.kiosk_payment_intents(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, kiosk_device_id uuid not null references public.kiosk_devices(id) on delete restrict, kiosk_session_id uuid not null references public.kiosk_sessions(id) on delete restrict,
 order_id uuid references public.orders(id) on delete restrict, provider text not null, method text not null check(method in('pix','card','pay_at_counter','voucher')), amount_cents bigint not null check(amount_cents>=0), status text not null default 'created' check(status in('created','pending','approved','declined','failed','expired','cancelled','reconciliation_required')), idempotency_key text not null,
 external_id text, recovery_state text, error_code text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(store_id,idempotency_key)
);
create table public.pickup_tokens(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, order_id uuid not null unique references public.orders(id) on delete cascade,
 token text not null, display_token text not null, status text not null default 'preparing' check(status in('preparing','ready','called','collected','expired','cancelled')), created_at timestamptz not null default now(), called_at timestamptz, completed_at timestamptz, expires_at timestamptz not null default(now()+interval '1 day'), call_count integer not null default 0, unique(store_id,display_token)
);
create table public.kiosk_funnel_events(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, kiosk_device_id uuid not null references public.kiosk_devices(id) on delete cascade, kiosk_session_id uuid references public.kiosk_sessions(id) on delete set null,
 event_type text not null check(event_type in('start','product_view','product_added','cart','checkout','payment_started','payment_succeeded','payment_failed','order_created','abandoned','reset')), product_id uuid references public.products(id) on delete set null, metadata jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);
create table public.kiosk_device_health(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, kiosk_device_id uuid not null references public.kiosk_devices(id) on delete cascade,
 connectivity text not null default 'online', payment_terminal_status text, printer_status text, app_version text, config_version bigint, safe_errors jsonb not null default '[]'::jsonb, recorded_at timestamptz not null default now()
);
create table public.kiosk_audit_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid not null references public.establishments(id) on delete cascade, kiosk_device_id uuid references public.kiosk_devices(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null, event_type text not null, entity_type text, entity_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.kiosk_member_permissions(
 store_id uuid not null references public.establishments(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, can_view boolean not null default true, can_manage_devices boolean not null default false, can_manage_config boolean not null default false, can_maintenance boolean not null default false, can_analytics boolean not null default false, can_pause_channel boolean not null default false, primary key(store_id,user_id)
);

create index kiosk_devices_scope_idx on public.kiosk_devices(store_id,status,active);
create index kiosk_registration_active_idx on public.kiosk_registration_tokens(store_id,expires_at) where used_at is null;
create index kiosk_sessions_device_idx on public.kiosk_sessions(kiosk_device_id,started_at desc);
create index kiosk_sessions_store_status_idx on public.kiosk_sessions(store_id,status,started_at desc);
create index kiosk_sessions_customer_idx on public.kiosk_sessions(customer_id) where customer_id is not null;
create index kiosk_sessions_order_idx on public.kiosk_sessions(order_id) where order_id is not null;
create index kiosk_payments_session_idx on public.kiosk_payment_intents(kiosk_session_id,created_at desc);
create index kiosk_payments_order_idx on public.kiosk_payment_intents(order_id) where order_id is not null;
create index pickup_queue_idx on public.pickup_tokens(store_id,status,created_at) where status in('preparing','ready','called');
create index kiosk_events_funnel_idx on public.kiosk_funnel_events(store_id,event_type,occurred_at desc);
create index kiosk_events_session_idx on public.kiosk_funnel_events(kiosk_session_id,occurred_at);
create index kiosk_health_latest_idx on public.kiosk_device_health(kiosk_device_id,recorded_at desc);
create index kiosk_audit_scope_idx on public.kiosk_audit_events(store_id,created_at desc);

do $$ declare t text; begin foreach t in array array['kiosk_devices','kiosk_registration_tokens','kiosk_sessions','kiosk_payment_intents','pickup_tokens','kiosk_funnel_events','kiosk_device_health','kiosk_audit_events','kiosk_member_permissions'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on table public.%I from public,anon,authenticated',t); execute format('grant all on table public.%I to service_role',t); execute format('grant select on table public.%I to authenticated',t);
end loop; end $$;
create policy kiosk_devices_admin_read on public.kiosk_devices for select to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]) or exists(select 1 from public.kiosk_member_permissions p where p.store_id=kiosk_devices.store_id and p.user_id=(select auth.uid()) and p.can_view));
create policy kiosk_registration_tokens_deny on public.kiosk_registration_tokens for all to anon,authenticated using(false) with check(false);
create policy kiosk_sessions_admin_read on public.kiosk_sessions for select to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]) or exists(select 1 from public.kiosk_member_permissions p where p.store_id=kiosk_sessions.store_id and p.user_id=(select auth.uid()) and p.can_view));
create policy kiosk_payments_admin_read on public.kiosk_payment_intents for select to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]) or exists(select 1 from public.kiosk_member_permissions p where p.store_id=kiosk_payment_intents.store_id and p.user_id=(select auth.uid()) and p.can_view));
create policy pickup_tokens_staff_read on public.pickup_tokens for select to authenticated using(private.has_role(store_id,array['owner','manager','attendant','kitchen']::public.member_role[]));
create policy kiosk_events_admin_read on public.kiosk_funnel_events for select to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]));
create policy kiosk_health_admin_read on public.kiosk_device_health for select to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]));
create policy kiosk_audit_admin_read on public.kiosk_audit_events for select to authenticated using(private.has_role(store_id,array['owner','manager']::public.member_role[]));
create policy kiosk_permissions_self_read on public.kiosk_member_permissions for select to authenticated using(user_id=(select auth.uid()) or private.has_role(store_id,array['owner','manager']::public.member_role[]));

create or replace function public.get_pickup_display(requested_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('store',jsonb_build_object('name',e.name,'logo_url',e.logo_url,'accent_color',e.accent_color),'preparing',coalesce((select jsonb_agg(jsonb_build_object('token',p.display_token,'status',p.status) order by p.created_at) from public.pickup_tokens p where p.store_id=e.id and p.status='preparing' and p.expires_at>now()),'[]'::jsonb),'ready',coalesce((select jsonb_agg(jsonb_build_object('token',p.display_token,'status',p.status,'called_at',p.called_at) order by p.called_at desc nulls last,p.created_at) from public.pickup_tokens p where p.store_id=e.id and p.status in('ready','called') and p.expires_at>now()),'[]'::jsonb)) from public.establishments e where e.slug=lower(btrim(requested_slug)) and e.active;
$$;
revoke all on function public.get_pickup_display(text) from public,anon,authenticated; grant execute on function public.get_pickup_display(text) to service_role;

create or replace function private.sync_kiosk_pickup_status() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status::text in('ready','delivered') then update public.pickup_tokens set status=case when new.status::text='ready' then 'ready' else 'collected' end,completed_at=case when new.status::text='delivered' then now() else completed_at end where order_id=new.id and status not in('collected','cancelled','expired'); end if; return new; end $$;
create trigger sync_kiosk_pickup_status after update of status on public.orders for each row when(old.status is distinct from new.status) execute function private.sync_kiosk_pickup_status();

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pickup_tokens') then alter publication supabase_realtime add table public.pickup_tokens; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kiosk_devices') then alter publication supabase_realtime add table public.kiosk_devices; end if;
end $$;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('kiosk_conversion_rate','Kiosk Conversion Rate','Sessões de autoatendimento convertidas em pedido.','orders/sessions','kiosk_sessions','store_day','Autoatendimento','hourly','percent','calculation',false,array['date','store','device']),
('kiosk_average_ticket','Kiosk Average Ticket','Ticket médio dos pedidos de autoatendimento.','sum(revenue)/orders','orders','store_day','Autoatendimento','hourly','cents','calculation',false,array['date','store','device']),
('kiosk_abandonment_rate','Kiosk Abandonment Rate','Sessões abandonadas.','abandoned/sessions','kiosk_sessions','store_day','Autoatendimento','hourly','percent','calculation',false,array['date','store','device']),
('kiosk_payment_success_rate','Payment Success Rate','Sucesso de pagamentos no autoatendimento.','approved/payment_attempts','kiosk_payment_intents','store_day','Autoatendimento','hourly','percent','calculation',false,array['date','store','device','method']),
('kiosk_average_session_duration','Average Session Duration','Duração média das sessões.','avg(ended_at-started_at)','kiosk_sessions','store_day','Autoatendimento','hourly','seconds','calculation',false,array['date','store','device']),
('self_service_order_share','Self-Service Order Share','Participação do autoatendimento nos pedidos.','kiosk_orders/all_orders','orders','store_day','Autoatendimento','hourly','percent','calculation',false,array['date','store']),
('pickup_wait_time','Pickup Wait Time','Tempo entre pronto e retirada.','avg(completed_at-called_at)','pickup_tokens','store_day','Autoatendimento','hourly','seconds','calculation',false,array['date','store'])
on conflict(metric_key) do nothing;

update public.plans set self_service_enabled=true,kiosk_payments_enabled=true,pickup_display_enabled=true,kiosk_loyalty_enabled=true,kiosk_analytics_enabled=true,updated_at=now() where active;
