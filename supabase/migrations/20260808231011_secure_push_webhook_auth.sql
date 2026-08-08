create or replace function public.get_push_webhook_secret()
returns text language sql security definer set search_path = '' as $$
  select case when auth.role() = 'service_role' then (select value from private.app_secrets where name = 'push_webhook_secret') else null end
$$;
revoke all on function public.get_push_webhook_secret() from public;
revoke execute on function public.get_push_webhook_secret() from anon, authenticated;
grant execute on function public.get_push_webhook_secret() to service_role;

create or replace function private.dispatch_push_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_name text;
  webhook_secret text;
begin
  if tg_op = 'INSERT' then event_name := 'new_order';
  elsif new.status = 'ready' and old.status is distinct from new.status then event_name := 'ready';
  else return new; end if;
  select value into webhook_secret from private.app_secrets where name = 'push_webhook_secret';
  if webhook_secret is null then return new; end if;
  perform net.http_post(
    url := 'https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('ticket_id', new.id, 'event', event_name),
    timeout_milliseconds := 5000
  );
  return new;
end; $$;
