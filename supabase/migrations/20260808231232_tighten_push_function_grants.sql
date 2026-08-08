revoke execute on function public.get_push_private_key() from anon, authenticated;
revoke execute on function public.get_push_webhook_secret() from anon, authenticated;
revoke execute on function public.register_kitchen_push_subscription(uuid, jsonb) from anon;
