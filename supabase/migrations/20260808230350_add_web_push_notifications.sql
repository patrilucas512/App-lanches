create extension if not exists pg_net with schema extensions;

create table if not exists private.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on table private.app_secrets from public, anon, authenticated;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  audience text not null check (audience in ('customer', 'kitchen')),
  order_id uuid references public.orders(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  check ((audience = 'customer' and order_id is not null) or (audience = 'kitchen' and user_id is not null))
);
create unique index push_subscriptions_customer_unique on public.push_subscriptions (order_id, endpoint) where audience = 'customer';
create unique index push_subscriptions_kitchen_unique on public.push_subscriptions (establishment_id, endpoint) where audience = 'kitchen';
create index push_subscriptions_order_idx on public.push_subscriptions (order_id) where audience = 'customer';
create index push_subscriptions_establishment_audience_idx on public.push_subscriptions (establishment_id, audience);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, update, delete on table public.push_subscriptions to service_role;

create table public.push_notification_events (
  ticket_id uuid not null references public.kitchen_tickets(id) on delete cascade,
  event_name text not null check (event_name in ('new_order', 'ready')),
  sent_at timestamptz not null default now(),
  primary key (ticket_id, event_name)
);
alter table public.push_notification_events enable row level security;
revoke all on table public.push_notification_events from public, anon, authenticated;
grant select, insert on table public.push_notification_events to service_role;

create or replace function public.register_customer_push_subscription(requested_tracking_token uuid, requested_subscription jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target_order public.orders%rowtype;
  subscription_endpoint text := requested_subscription->>'endpoint';
  subscription_p256dh text := requested_subscription#>>'{keys,p256dh}';
  subscription_auth text := requested_subscription#>>'{keys,auth}';
begin
  select * into target_order from public.orders where tracking_token = requested_tracking_token and status not in ('completed', 'canceled');
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if subscription_endpoint is null or subscription_endpoint !~ '^https://' or length(subscription_endpoint) > 2048
    or length(coalesce(subscription_p256dh, '')) not between 40 and 255
    or length(coalesce(subscription_auth, '')) not between 8 and 255 then raise exception 'Assinatura de notificação inválida.'; end if;
  insert into public.push_subscriptions(establishment_id, audience, order_id, endpoint, p256dh, auth_key)
  values(target_order.establishment_id, 'customer', target_order.id, subscription_endpoint, subscription_p256dh, subscription_auth)
  on conflict (order_id, endpoint) where audience = 'customer'
  do update set p256dh = excluded.p256dh, auth_key = excluded.auth_key, updated_at = now(), expires_at = now() + interval '90 days';
  return true;
end; $$;

create or replace function public.register_kitchen_push_subscription(requested_establishment_id uuid, requested_subscription jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  subscription_endpoint text := requested_subscription->>'endpoint';
  subscription_p256dh text := requested_subscription#>>'{keys,p256dh}';
  subscription_auth text := requested_subscription#>>'{keys,auth}';
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id, array['owner','manager','attendant']::public.member_role[]) then raise exception 'Acesso não autorizado.'; end if;
  if subscription_endpoint is null or subscription_endpoint !~ '^https://' or length(subscription_endpoint) > 2048
    or length(coalesce(subscription_p256dh, '')) not between 40 and 255
    or length(coalesce(subscription_auth, '')) not between 8 and 255 then raise exception 'Assinatura de notificação inválida.'; end if;
  insert into public.push_subscriptions(establishment_id, audience, user_id, endpoint, p256dh, auth_key)
  values(requested_establishment_id, 'kitchen', auth.uid(), subscription_endpoint, subscription_p256dh, subscription_auth)
  on conflict (establishment_id, endpoint) where audience = 'kitchen'
  do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth_key = excluded.auth_key, updated_at = now(), expires_at = now() + interval '90 days';
  return true;
end; $$;

create or replace function public.get_push_private_key()
returns text language sql security definer set search_path = '' as $$
  select case when auth.role() = 'service_role' then (select value from private.app_secrets where name = 'vapid_private_key') else null end
$$;
revoke all on function public.register_customer_push_subscription(uuid, jsonb) from public;
revoke all on function public.register_kitchen_push_subscription(uuid, jsonb) from public;
revoke all on function public.get_push_private_key() from public;
revoke execute on function public.get_push_private_key() from anon, authenticated;
revoke execute on function public.register_kitchen_push_subscription(uuid, jsonb) from anon;
grant execute on function public.register_customer_push_subscription(uuid, jsonb) to anon, authenticated;
grant execute on function public.register_kitchen_push_subscription(uuid, jsonb) to authenticated;
grant execute on function public.get_push_private_key() to service_role;

create or replace function private.dispatch_push_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_name text;
begin
  if tg_op = 'INSERT' then event_name := 'new_order';
  elsif new.status = 'ready' and old.status is distinct from new.status then event_name := 'ready';
  else return new; end if;
  perform net.http_post(
    url := 'https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('ticket_id', new.id, 'event', event_name),
    timeout_milliseconds := 5000
  );
  return new;
end; $$;
drop trigger if exists kitchen_ticket_push_insert on public.kitchen_tickets;
create trigger kitchen_ticket_push_insert after insert on public.kitchen_tickets for each row execute function private.dispatch_push_notification();
drop trigger if exists kitchen_ticket_push_ready on public.kitchen_tickets;
create trigger kitchen_ticket_push_ready after update of status on public.kitchen_tickets for each row execute function private.dispatch_push_notification();
