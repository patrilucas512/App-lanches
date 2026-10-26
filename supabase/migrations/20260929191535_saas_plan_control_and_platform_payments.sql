-- Central SaaS plan enforcement and platform-owned payment gateways.
create extension if not exists supabase_vault with schema vault;

create table if not exists public.platform_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (provider in ('mercado_pago','pagarme')),
  active boolean not null default false,
  environment text not null default 'test' check (environment in ('test','production')),
  merchant_account_id text,
  secret_id uuid,
  webhook_secret_id uuid,
  configured_by uuid references public.profiles(id) on delete set null,
  configured_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saas_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete restrict,
  provider text not null check (provider in ('mercado_pago','pagarme')),
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  amount_cents integer not null check (amount_cents >= 0),
  customer_name text not null,
  customer_email text not null,
  establishment_name text not null,
  external_id text,
  checkout_url text,
  status text not null default 'pending' check (status in ('pending','approved','declined','canceled','refunded','error')),
  raw_status text,
  idempotency_key text not null unique,
  establishment_id uuid references public.establishments(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscription_invoices
  alter column stripe_invoice_id drop not null,
  add column if not exists payment_provider text,
  add column if not exists provider_invoice_id text;

create unique index if not exists saas_checkout_provider_external_key
  on public.saas_checkout_sessions(provider,external_id) where external_id is not null;
create index if not exists saas_checkout_created_idx on public.saas_checkout_sessions(created_at desc);
create index if not exists saas_checkout_plan_idx on public.saas_checkout_sessions(plan_id,status);

alter table public.platform_payment_accounts enable row level security;
alter table public.saas_checkout_sessions enable row level security;

revoke all on public.platform_payment_accounts, public.saas_checkout_sessions from public, anon, authenticated;
grant select on public.platform_payment_accounts, public.saas_checkout_sessions to authenticated;
grant all on public.platform_payment_accounts, public.saas_checkout_sessions to service_role;

drop policy if exists platform_payment_accounts_superadmin on public.platform_payment_accounts;
create policy platform_payment_accounts_superadmin on public.platform_payment_accounts
for select to authenticated using ((select private.is_superadmin()));
drop policy if exists saas_checkout_sessions_superadmin on public.saas_checkout_sessions;
create policy saas_checkout_sessions_superadmin on public.saas_checkout_sessions
for select to authenticated using ((select private.is_superadmin()));

drop trigger if exists platform_payment_accounts_touch on public.platform_payment_accounts;
create trigger platform_payment_accounts_touch before update on public.platform_payment_accounts
for each row execute function public.touch_updated_at();
drop trigger if exists saas_checkout_sessions_touch on public.saas_checkout_sessions;
create trigger saas_checkout_sessions_touch before update on public.saas_checkout_sessions
for each row execute function public.touch_updated_at();

create or replace function public.configure_platform_payment_gateway(
  requested_provider text,
  requested_active boolean,
  requested_environment text,
  requested_secret text default null,
  requested_webhook_secret text default null,
  requested_merchant_account_id text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  saved public.platform_payment_accounts%rowtype;
  next_secret_id uuid;
  next_webhook_secret_id uuid;
begin
  if not private.is_superadmin() then raise exception 'Acesso exclusivo do Super Administrador.'; end if;
  if requested_provider not in ('mercado_pago','pagarme') then raise exception 'Provedor inválido.'; end if;
  if requested_environment not in ('test','production') then raise exception 'Ambiente inválido.'; end if;

  select * into saved from public.platform_payment_accounts where provider=requested_provider for update;
  if nullif(btrim(requested_secret),'') is not null then
    if saved.secret_id is null then
      select vault.create_secret(requested_secret,'masterapp-saas-'||requested_provider||'-credential') into next_secret_id;
    else
      perform vault.update_secret(saved.secret_id,requested_secret);
      next_secret_id := saved.secret_id;
    end if;
  else next_secret_id := saved.secret_id; end if;

  if nullif(btrim(requested_webhook_secret),'') is not null then
    if saved.webhook_secret_id is null then
      select vault.create_secret(requested_webhook_secret,'masterapp-saas-'||requested_provider||'-webhook') into next_webhook_secret_id;
    else
      perform vault.update_secret(saved.webhook_secret_id,requested_webhook_secret);
      next_webhook_secret_id := saved.webhook_secret_id;
    end if;
  else next_webhook_secret_id := saved.webhook_secret_id; end if;

  if requested_active and next_secret_id is null then raise exception 'Informe a chave secreta antes de ativar.'; end if;

  insert into public.platform_payment_accounts(provider,active,environment,merchant_account_id,secret_id,webhook_secret_id,configured_by,configured_at,last_error)
  values(requested_provider,requested_active,requested_environment,nullif(btrim(requested_merchant_account_id),''),next_secret_id,next_webhook_secret_id,auth.uid(),now(),null)
  on conflict(provider) do update set active=excluded.active,environment=excluded.environment,
    merchant_account_id=excluded.merchant_account_id,secret_id=excluded.secret_id,
    webhook_secret_id=excluded.webhook_secret_id,configured_by=auth.uid(),configured_at=now(),last_error=null
  returning * into saved;

  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,new_value)
  values(auth.uid(),'platform.payment_gateway_configured','platform_payment_account',saved.id,
    jsonb_build_object('provider',saved.provider,'active',saved.active,'environment',saved.environment,'configured',saved.secret_id is not null));
  return jsonb_build_object('id',saved.id,'provider',saved.provider,'active',saved.active,
    'environment',saved.environment,'merchant_account_id',saved.merchant_account_id,
    'configured',saved.secret_id is not null,'webhook_configured',saved.webhook_secret_id is not null,
    'configured_at',saved.configured_at);
end $$;

create or replace function public.get_platform_payment_gateway_secret(requested_account_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account public.platform_payment_accounts%rowtype; credential text; webhook_secret text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into account from public.platform_payment_accounts where id=requested_account_id;
  if account.id is null then raise exception 'Configuração não encontrada.'; end if;
  select decrypted_secret into credential from vault.decrypted_secrets where id=account.secret_id;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where id=account.webhook_secret_id;
  return jsonb_build_object('credential',credential,'webhook_secret',webhook_secret);
end $$;

create or replace function private.enforce_plan_resource()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  plan public.plans%rowtype;
  current_count integer;
  module_key text := tg_argv[0];
  limit_key text := tg_argv[1];
  enabled boolean := true;
  allowed integer;
begin
  select p.* into plan from public.subscriptions s join public.plans p on p.id=s.plan_id
  where s.establishment_id=new.establishment_id order by s.created_at desc limit 1;
  if plan.id is null then return new; end if;

  enabled := case module_key
    when 'cashier' then plan.cashier_enabled
    when 'inventory' then plan.inventory_enabled
    when 'staff' then plan.staff_management_enabled
    when 'drivers' then plan.drivers_enabled
    when 'waiters' then plan.waiter_mode_enabled
    when 'kitchen' then plan.kitchen_enabled
    else true end;
  if not enabled then raise exception 'Este recurso não está incluído no plano atual.'; end if;

  allowed := case limit_key
    when 'cashiers' then plan.max_cashiers
    when 'inventory_items' then plan.max_inventory_items
    when 'staff' then plan.max_team_members
    when 'drivers' then plan.max_drivers
    when 'waiters' then plan.max_waiters
    when 'qr_codes' then plan.max_qr_codes
    else null end;
  if allowed is null then return new; end if;

  execute format('select count(*) from public.%I where establishment_id=$1',tg_table_name)
    into current_count using new.establishment_id;
  if current_count >= allowed then
    raise exception 'Limite de % atingido para o plano atual.',replace(limit_key,'_',' ');
  end if;
  return new;
end $$;

create or replace function private.enforce_monthly_order_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare allowed integer; current_count integer;
begin
  select p.max_monthly_orders into allowed from public.subscriptions s join public.plans p on p.id=s.plan_id
  where s.establishment_id=new.establishment_id order by s.created_at desc limit 1;
  if allowed is null then return new; end if;
  select count(*) into current_count from public.orders where establishment_id=new.establishment_id
    and created_at>=date_trunc('month',now()) and created_at<date_trunc('month',now())+interval '1 month';
  if current_count>=allowed then raise exception 'Limite mensal de pedidos atingido para o plano atual.'; end if;
  return new;
end $$;

drop trigger if exists cash_registers_plan_limit on public.cash_registers;
create trigger cash_registers_plan_limit before insert on public.cash_registers for each row execute function private.enforce_plan_resource('cashier','cashiers');
drop trigger if exists inventory_items_plan_limit on public.inventory_items;
create trigger inventory_items_plan_limit before insert on public.inventory_items for each row execute function private.enforce_plan_resource('inventory','inventory_items');
drop trigger if exists custom_staff_plan_limit on public.custom_staff_members;
create trigger custom_staff_plan_limit before insert on public.custom_staff_members for each row execute function private.enforce_plan_resource('staff','staff');
drop trigger if exists driver_profiles_plan_limit on public.driver_profiles;
create trigger driver_profiles_plan_limit before insert on public.driver_profiles for each row execute function private.enforce_plan_resource('drivers','drivers');
drop trigger if exists waiters_plan_limit on public.waiters;
create trigger waiters_plan_limit before insert on public.waiters for each row execute function private.enforce_plan_resource('waiters','waiters');
drop trigger if exists restaurant_tables_plan_limit on public.restaurant_tables;
create trigger restaurant_tables_plan_limit before insert on public.restaurant_tables for each row execute function private.enforce_plan_resource('waiters','qr_codes');
drop trigger if exists orders_monthly_plan_limit on public.orders;
create trigger orders_monthly_plan_limit before insert on public.orders for each row execute function private.enforce_monthly_order_limit();

revoke all on function public.configure_platform_payment_gateway(text,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.configure_platform_payment_gateway(text,boolean,text,text,text,text) to authenticated;
revoke all on function public.get_platform_payment_gateway_secret(uuid) from public,anon,authenticated;
grant execute on function public.get_platform_payment_gateway_secret(uuid) to service_role;
revoke all on function private.enforce_plan_resource() from public,anon,authenticated;
revoke all on function private.enforce_monthly_order_limit() from public,anon,authenticated;
