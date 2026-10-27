alter table public.push_subscriptions
  add column if not exists driver_profile_id uuid references public.driver_profiles(id) on delete cascade;

alter table public.push_subscriptions drop constraint if exists push_subscriptions_audience_check;
alter table public.push_subscriptions add constraint push_subscriptions_audience_check
  check (audience in ('customer','kitchen','waiter','driver','operations'));

alter table public.push_subscriptions drop constraint if exists push_subscriptions_check;
alter table public.push_subscriptions add constraint push_subscriptions_check
  check (
    (audience='customer' and order_id is not null and user_id is null and driver_profile_id is null) or
    (audience in ('kitchen','waiter','operations') and user_id is not null and order_id is null and driver_profile_id is null) or
    (audience='driver' and user_id is not null and driver_profile_id is not null and order_id is null)
  );

create unique index if not exists push_subscriptions_driver_unique
  on public.push_subscriptions(driver_profile_id,endpoint) where audience='driver';
create unique index if not exists push_subscriptions_operations_unique
  on public.push_subscriptions(establishment_id,endpoint) where audience='operations';

create table if not exists public.delivery_push_notification_events (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  assignment_id uuid references public.delivery_assignments(id) on delete cascade,
  incident_id uuid references public.delivery_incidents(id) on delete cascade,
  event_name text not null check (event_name in ('new_delivery_offer','driver_assigned','picked_up','on_route','driver_arrived','delivered','delivery_incident')),
  sent_at timestamptz not null default now()
);
create unique index if not exists delivery_push_events_dedupe_idx
  on public.delivery_push_notification_events(
    delivery_id,event_name,
    coalesce(assignment_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(incident_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists delivery_push_events_establishment_idx
  on public.delivery_push_notification_events(establishment_id,sent_at desc);
alter table public.delivery_push_notification_events enable row level security;
revoke all on table public.delivery_push_notification_events from public,anon,authenticated;
grant select,insert on table public.delivery_push_notification_events to service_role;

create or replace function private.push_subscription_is_valid(requested_subscription jsonb)
returns boolean language sql immutable set search_path='' as $$
  select requested_subscription->>'endpoint' ~ '^https://'
    and length(requested_subscription->>'endpoint') <= 2048
    and length(coalesce(requested_subscription#>>'{keys,p256dh}','')) between 40 and 255
    and length(coalesce(requested_subscription#>>'{keys,auth}','')) between 8 and 255
$$;
revoke all on function private.push_subscription_is_valid(jsonb) from public,anon,authenticated;

create or replace function public.register_driver_push_subscription(
  requested_driver_profile_id uuid,
  requested_subscription jsonb
)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  driver public.driver_profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles
  where id=requested_driver_profile_id and user_id=auth.uid() and active and approval_status='approved';
  if driver.id is null then raise exception 'Acesso de motoboy não autorizado.'; end if;
  if not private.push_subscription_is_valid(requested_subscription) then raise exception 'Assinatura de notificação inválida.'; end if;
  insert into public.push_subscriptions(establishment_id,audience,user_id,driver_profile_id,endpoint,p256dh,auth_key)
  values(driver.establishment_id,'driver',auth.uid(),driver.id,requested_subscription->>'endpoint',requested_subscription#>>'{keys,p256dh}',requested_subscription#>>'{keys,auth}')
  on conflict (driver_profile_id,endpoint) where audience='driver'
  do update set user_id=auth.uid(),p256dh=excluded.p256dh,auth_key=excluded.auth_key,updated_at=now(),expires_at=now()+interval '90 days';
  return true;
end $$;

create or replace function public.register_operations_push_subscription(
  requested_establishment_id uuid,
  requested_subscription jsonb
)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then
    raise exception 'Acesso administrativo não autorizado.';
  end if;
  if not private.push_subscription_is_valid(requested_subscription) then raise exception 'Assinatura de notificação inválida.'; end if;
  insert into public.push_subscriptions(establishment_id,audience,user_id,endpoint,p256dh,auth_key)
  values(requested_establishment_id,'operations',auth.uid(),requested_subscription->>'endpoint',requested_subscription#>>'{keys,p256dh}',requested_subscription#>>'{keys,auth}')
  on conflict (establishment_id,endpoint) where audience='operations'
  do update set user_id=auth.uid(),p256dh=excluded.p256dh,auth_key=excluded.auth_key,updated_at=now(),expires_at=now()+interval '90 days';
  return true;
end $$;

revoke all on function public.register_driver_push_subscription(uuid,jsonb) from public,anon;
revoke all on function public.register_operations_push_subscription(uuid,jsonb) from public,anon;
grant execute on function public.register_driver_push_subscription(uuid,jsonb) to authenticated;
grant execute on function public.register_operations_push_subscription(uuid,jsonb) to authenticated;

create or replace function private.dispatch_delivery_push_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  webhook_secret text;
  event_name text;
  target_delivery_id uuid;
  target_assignment_id uuid;
  target_incident_id uuid;
begin
  if tg_table_name='delivery_assignments' then
    if tg_op='INSERT' and new.status='offered' then event_name:='new_delivery_offer';
    elsif tg_op='UPDATE' and new.status='accepted' and old.status is distinct from new.status then event_name:='driver_assigned';
    else return new; end if;
    target_delivery_id:=new.delivery_id; target_assignment_id:=new.id;
  elsif tg_table_name='deliveries' then
    if tg_op<>'UPDATE' or old.status is not distinct from new.status then return new; end if;
    event_name:=case new.status
      when 'picked_up' then 'picked_up'
      when 'on_route' then 'on_route'
      when 'arrived' then 'driver_arrived'
      when 'delivered' then 'delivered'
      else null end;
    if event_name is null then return new; end if;
    target_delivery_id:=new.id;
    select id into target_assignment_id from public.delivery_assignments
      where delivery_id=new.id and status in ('accepted','completed') order by accepted_at desc nulls last limit 1;
  elsif tg_table_name='delivery_incidents' then
    if tg_op<>'INSERT' then return new; end if;
    event_name:='delivery_incident'; target_delivery_id:=new.delivery_id; target_incident_id:=new.id;
    select id into target_assignment_id from public.delivery_assignments
      where delivery_id=new.delivery_id and driver_profile_id=new.driver_profile_id order by created_at desc limit 1;
  else return new; end if;

  select value into webhook_secret from private.app_secrets where name='push_webhook_secret';
  if webhook_secret is null then return new; end if;
  perform net.http_post(
    url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-push-notification',
    headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',webhook_secret),
    body:=jsonb_build_object('delivery_id',target_delivery_id,'assignment_id',target_assignment_id,'incident_id',target_incident_id,'event',event_name),
    timeout_milliseconds:=5000
  );
  return new;
end $$;

drop trigger if exists delivery_assignment_push on public.delivery_assignments;
create trigger delivery_assignment_push after insert or update of status on public.delivery_assignments
  for each row execute function private.dispatch_delivery_push_notification();
drop trigger if exists delivery_status_push on public.deliveries;
create trigger delivery_status_push after update of status on public.deliveries
  for each row execute function private.dispatch_delivery_push_notification();
drop trigger if exists delivery_incident_push on public.delivery_incidents;
create trigger delivery_incident_push after insert on public.delivery_incidents
  for each row execute function private.dispatch_delivery_push_notification();

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_incidents') then
    alter publication supabase_realtime add table public.delivery_incidents;
  end if;
end $$;
