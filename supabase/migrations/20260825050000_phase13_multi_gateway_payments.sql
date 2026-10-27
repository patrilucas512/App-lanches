create extension if not exists supabase_vault with schema vault;

alter table public.orders
  add column if not exists online_payment_status text,
  add column if not exists paid_at timestamptz;

alter table public.orders drop constraint if exists orders_online_payment_status_check;
alter table public.orders add constraint orders_online_payment_status_check
  check (online_payment_status is null or online_payment_status in
    ('pending','approved','declined','canceled','refunded'));

create table public.payment_gateway_accounts (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  provider text not null check (provider in ('mercado_pago','pagarme')),
  active boolean not null default false,
  environment text not null default 'test' check (environment in ('test','production')),
  merchant_account_id text,
  secret_id uuid,
  webhook_secret_id uuid,
  configured_by uuid references auth.users(id) on delete set null,
  configured_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, provider)
);

create table public.order_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  gateway_account_id uuid not null references public.payment_gateway_accounts(id) on delete restrict,
  provider text not null check (provider in ('mercado_pago','pagarme')),
  external_id text,
  status text not null default 'pending' check (status in
    ('pending','approved','declined','canceled','refunded','error')),
  raw_status text,
  amount_cents integer not null check (amount_cents >= 0),
  checkout_url text,
  idempotency_key text not null,
  approved_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, idempotency_key)
);

create unique index order_payment_transactions_provider_external_key
  on public.order_payment_transactions(provider, external_id)
  where external_id is not null;
create index order_payment_transactions_order_idx
  on public.order_payment_transactions(order_id, created_at desc);
create index payment_gateway_accounts_active_idx
  on public.payment_gateway_accounts(establishment_id, active);

alter table public.payment_gateway_accounts enable row level security;
alter table public.order_payment_transactions enable row level security;

revoke all on public.payment_gateway_accounts, public.order_payment_transactions
  from public, anon, authenticated;
grant select on public.payment_gateway_accounts, public.order_payment_transactions
  to authenticated;
grant all on public.payment_gateway_accounts, public.order_payment_transactions
  to service_role;

create policy payment_gateway_accounts_admin_read
on public.payment_gateway_accounts for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy order_payment_transactions_admin_read
on public.order_payment_transactions for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create trigger payment_gateway_accounts_touch before update on public.payment_gateway_accounts
for each row execute function public.touch_updated_at();
create trigger order_payment_transactions_touch before update on public.order_payment_transactions
for each row execute function public.touch_updated_at();

create or replace function private.defer_unpaid_online_order_ticket()
returns trigger language plpgsql set search_path = '' as $$
declare payment_state text;
begin
  if new.public_order_id is null then return new; end if;
  select online_payment_status into payment_state
  from public.orders where id = new.public_order_id;
  if payment_state = 'pending' then return null; end if;
  return new;
end $$;

drop trigger if exists defer_unpaid_online_order_ticket on public.kitchen_tickets;
create trigger defer_unpaid_online_order_ticket
before insert on public.kitchen_tickets for each row
execute function private.defer_unpaid_online_order_ticket();

create or replace function private.initialize_online_payment()
returns trigger language plpgsql set search_path = '' as $$
declare gateway_provider text;
begin
  gateway_provider := case new.payment_method
    when 'mercado_pago_online' then 'mercado_pago'
    when 'pagarme_online' then 'pagarme'
    else null end;
  if gateway_provider is null then return new; end if;
  if not exists (
    select 1 from public.payment_gateway_accounts a
    where a.establishment_id = new.establishment_id
      and a.provider = gateway_provider and a.active and a.secret_id is not null
  ) then raise exception 'Pagamento online indisponível neste estabelecimento.'; end if;
  new.online_payment_status := 'pending';
  return new;
end $$;

drop trigger if exists initialize_online_payment on public.orders;
create trigger initialize_online_payment before insert on public.orders
for each row execute function private.initialize_online_payment();

create or replace function public.configure_payment_gateway(
  requested_establishment_id uuid,
  requested_provider text,
  requested_active boolean,
  requested_environment text,
  requested_secret text default null,
  requested_webhook_secret text default null,
  requested_merchant_account_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved public.payment_gateway_accounts%rowtype;
  next_secret_id uuid;
  next_webhook_secret_id uuid;
begin
  if actor is null or not private.has_role(requested_establishment_id,
    array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para configurar pagamentos.';
  end if;
  if requested_provider not in ('mercado_pago','pagarme') then raise exception 'Provedor inválido.'; end if;
  if requested_environment not in ('test','production') then raise exception 'Ambiente inválido.'; end if;

  select * into saved from public.payment_gateway_accounts
  where establishment_id=requested_establishment_id and provider=requested_provider for update;

  if nullif(btrim(requested_secret),'') is not null then
    if saved.secret_id is null then
      select vault.create_secret(requested_secret,
        'masterapp-'||requested_provider||'-'||requested_establishment_id||'-credential') into next_secret_id;
    else
      perform vault.update_secret(saved.secret_id, requested_secret);
      next_secret_id := saved.secret_id;
    end if;
  else next_secret_id := saved.secret_id; end if;

  if nullif(btrim(requested_webhook_secret),'') is not null then
    if saved.webhook_secret_id is null then
      select vault.create_secret(requested_webhook_secret,
        'masterapp-'||requested_provider||'-'||requested_establishment_id||'-webhook') into next_webhook_secret_id;
    else
      perform vault.update_secret(saved.webhook_secret_id, requested_webhook_secret);
      next_webhook_secret_id := saved.webhook_secret_id;
    end if;
  else next_webhook_secret_id := saved.webhook_secret_id; end if;

  if requested_active and next_secret_id is null then
    raise exception 'Informe a credencial secreta antes de ativar.';
  end if;

  insert into public.payment_gateway_accounts(
    establishment_id,provider,active,environment,merchant_account_id,
    secret_id,webhook_secret_id,configured_by,configured_at,last_error
  ) values (
    requested_establishment_id,requested_provider,requested_active,requested_environment,
    nullif(btrim(requested_merchant_account_id),''),next_secret_id,next_webhook_secret_id,
    actor,now(),null
  ) on conflict(establishment_id,provider) do update set
    active=excluded.active,environment=excluded.environment,
    merchant_account_id=excluded.merchant_account_id,secret_id=excluded.secret_id,
    webhook_secret_id=excluded.webhook_secret_id,configured_by=actor,
    configured_at=now(),last_error=null
  returning * into saved;

  return jsonb_build_object('id',saved.id,'provider',saved.provider,'active',saved.active,
    'environment',saved.environment,'merchant_account_id',saved.merchant_account_id,
    'configured',saved.secret_id is not null,'webhook_configured',saved.webhook_secret_id is not null,
    'configured_at',saved.configured_at);
end $$;

create or replace function public.get_payment_gateway_secret(requested_account_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account public.payment_gateway_accounts%rowtype; credential text; webhook_secret text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into account from public.payment_gateway_accounts where id=requested_account_id;
  if account.id is null then raise exception 'Configuração não encontrada.'; end if;
  select decrypted_secret into credential from vault.decrypted_secrets where id=account.secret_id;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where id=account.webhook_secret_id;
  return jsonb_build_object('credential',credential,'webhook_secret',webhook_secret);
end $$;

create or replace function public.get_public_payment_gateways(requested_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider',a.provider,
    'label',case a.provider when 'mercado_pago' then 'Mercado Pago' else 'Pagar.me' end
  ) order by a.provider),'[]'::jsonb)
  from public.payment_gateway_accounts a
  join public.establishments e on e.id=a.establishment_id
  join public.subscriptions s on s.establishment_id=e.id
  where e.slug=lower(btrim(requested_slug)) and e.active and a.active and a.secret_id is not null
    and (s.status in ('active','trialing') or s.current_period_end>now())
$$;

create or replace function public.record_online_payment_session(
  requested_order_id uuid, requested_gateway_account_id uuid,
  requested_external_id text, requested_checkout_url text, requested_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.order_payment_transactions%rowtype; target_order public.orders%rowtype; account public.payment_gateway_accounts%rowtype;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into target_order from public.orders where id=requested_order_id for update;
  select * into account from public.payment_gateway_accounts where id=requested_gateway_account_id and active;
  if target_order.id is null or account.id is null or target_order.establishment_id<>account.establishment_id then
    raise exception 'Pedido ou provedor inválido.';
  end if;
  insert into public.order_payment_transactions(establishment_id,order_id,gateway_account_id,
    provider,external_id,amount_cents,checkout_url,idempotency_key)
  values(target_order.establishment_id,target_order.id,account.id,account.provider,
    requested_external_id,target_order.total_cents,requested_checkout_url,requested_idempotency_key)
  on conflict(establishment_id,idempotency_key) do update set
    external_id=excluded.external_id,checkout_url=excluded.checkout_url
  returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.confirm_online_order_payment(
  requested_gateway_account_id uuid, requested_external_id text,
  requested_status text, requested_raw_status text, requested_amount_cents integer,
  requested_order_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare transaction_record public.order_payment_transactions%rowtype; target_order public.orders%rowtype; normalized_status text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  normalized_status := case when requested_status in ('approved','declined','canceled','refunded') then requested_status else 'pending' end;
  select * into transaction_record from public.order_payment_transactions
  where gateway_account_id=requested_gateway_account_id and external_id=requested_external_id for update;
  if transaction_record.id is null and requested_order_id is not null then
    select * into transaction_record from public.order_payment_transactions
    where gateway_account_id=requested_gateway_account_id and order_id=requested_order_id
    order by created_at desc limit 1 for update;
  end if;
  if transaction_record.id is null then raise exception 'Transação não encontrada.'; end if;
  select * into target_order from public.orders where id=transaction_record.order_id for update;
  if requested_amount_cents is distinct from target_order.total_cents then raise exception 'Valor confirmado diverge do pedido.'; end if;
  update public.order_payment_transactions set status=normalized_status,raw_status=left(requested_raw_status,100),
    external_id=coalesce(external_id,requested_external_id),
    approved_at=case when normalized_status='approved' then coalesce(approved_at,now()) else approved_at end,
    declined_at=case when normalized_status='declined' then coalesce(declined_at,now()) else declined_at end
  where id=transaction_record.id;
  update public.orders set online_payment_status=normalized_status,
    paid_at=case when normalized_status='approved' then coalesce(paid_at,now()) else paid_at end
  where id=target_order.id;
  if normalized_status='approved' then
    insert into public.kitchen_tickets(establishment_id,public_order_id)
    values(target_order.establishment_id,target_order.id) on conflict do nothing;
  end if;
  return jsonb_build_object('order_id',target_order.id,'status',normalized_status,
    'sent_to_kitchen',normalized_status='approved');
end $$;

revoke all on function private.defer_unpaid_online_order_ticket() from public,anon,authenticated;
revoke all on function private.initialize_online_payment() from public,anon,authenticated;
revoke all on function public.configure_payment_gateway(uuid,text,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.configure_payment_gateway(uuid,text,boolean,text,text,text,text) to authenticated;
revoke all on function public.get_payment_gateway_secret(uuid) from public,anon,authenticated;
grant execute on function public.get_payment_gateway_secret(uuid) to service_role;
revoke all on function public.get_public_payment_gateways(text) from public,anon,authenticated;
grant execute on function public.get_public_payment_gateways(text) to anon,authenticated;
revoke all on function public.record_online_payment_session(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_online_payment_session(uuid,uuid,text,text,text) to service_role;
revoke all on function public.confirm_online_order_payment(uuid,text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.confirm_online_order_payment(uuid,text,text,text,integer,uuid) to service_role;

-- Keep customer tracking useful while payment is pending and before a kitchen ticket exists.
create or replace function public.get_public_order_status(requested_tracking_token uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'order_number',o.order_number,'status',o.status,'fulfillment_type',o.fulfillment_type,
    'created_at',o.created_at,'updated_at',o.updated_at,'estimated_minutes',s.estimated_minutes,
    'table_number',rt.table_number,'payment_method',o.payment_method,
    'online_payment_status',o.online_payment_status,
    'kitchen_status',kt.status,'started_at',kt.started_at,'ready_at',kt.ready_at,'delivered_at',coalesce(d.delivered_at,kt.delivered_at),
    'delivery_status',d.status,
    'delivery_pin',case when d.delivery_pin_required and d.status in ('on_route','arrived')
      then private.delivery_pin_for_token(o.tracking_token,d.id) end,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',oi.id,'product_name',oi.product_name,'quantity',oi.quantity,
      'addons',oi.addons,'removed_ingredients',oi.removed_ingredients
    ) order by oi.id) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb)
  )
  from public.orders o
  join public.establishment_settings s on s.establishment_id=o.establishment_id
  left join public.restaurant_tables rt on rt.id=o.restaurant_table_id
  left join public.kitchen_tickets kt on kt.public_order_id=o.id
  left join public.deliveries d on d.order_id=o.id
  where o.tracking_token=requested_tracking_token
$$;
revoke all on function public.get_public_order_status(uuid) from public,anon,authenticated;
grant execute on function public.get_public_order_status(uuid) to anon,authenticated;
