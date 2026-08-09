alter table public.push_subscriptions drop constraint if exists push_subscriptions_audience_check;
alter table public.push_subscriptions add constraint push_subscriptions_audience_check
  check (audience in ('customer','kitchen','waiter'));

alter table public.push_subscriptions drop constraint if exists push_subscriptions_check;
alter table public.push_subscriptions add constraint push_subscriptions_check
  check (
    (audience='customer' and order_id is not null) or
    (audience in ('kitchen','waiter') and user_id is not null)
  );

create unique index if not exists push_subscriptions_waiter_unique
  on public.push_subscriptions(establishment_id,endpoint) where audience='waiter';

create or replace function public.register_waiter_push_subscription(
  requested_establishment_id uuid,
  requested_subscription jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  subscription_endpoint text := requested_subscription->>'endpoint';
  subscription_p256dh text := requested_subscription#>>'{keys,p256dh}';
  subscription_auth text := requested_subscription#>>'{keys,auth}';
  waiter_record public.waiters%rowtype;
  waiter_mode boolean;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager','attendant']::public.member_role[]) then
    raise exception 'Acesso não autorizado.';
  end if;
  select waiter_mode_enabled into waiter_mode from public.service_modes where establishment_id=requested_establishment_id;
  if not coalesce(waiter_mode,false) then raise exception 'O modo garçom está desativado.'; end if;

  if private.has_role(requested_establishment_id,array['attendant']::public.member_role[]) then
    select * into waiter_record from public.waiters
    where establishment_id=requested_establishment_id and user_id=auth.uid();
    if waiter_record.id is null or waiter_record.status in ('inactive','paused','blocked') or not waiter_record.active_now
      or (waiter_record.employment_type='daily' and waiter_record.work_date<>(now() at time zone 'America/Sao_Paulo')::date)
    then raise exception 'Seu acesso de garçom não está ativo hoje.'; end if;
  end if;

  if subscription_endpoint is null or subscription_endpoint !~ '^https://' or length(subscription_endpoint)>2048
    or length(coalesce(subscription_p256dh,'')) not between 40 and 255
    or length(coalesce(subscription_auth,'')) not between 8 and 255
  then raise exception 'Assinatura de notificação inválida.'; end if;

  insert into public.push_subscriptions(establishment_id,audience,user_id,endpoint,p256dh,auth_key)
  values(requested_establishment_id,'waiter',auth.uid(),subscription_endpoint,subscription_p256dh,subscription_auth)
  on conflict (establishment_id,endpoint) where audience='waiter'
  do update set user_id=auth.uid(),p256dh=excluded.p256dh,auth_key=excluded.auth_key,
    updated_at=now(),expires_at=now()+interval '90 days';
  return true;
end
$$;

revoke all on function public.register_waiter_push_subscription(uuid,jsonb) from public,anon;
grant execute on function public.register_waiter_push_subscription(uuid,jsonb) to authenticated;
