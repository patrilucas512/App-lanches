begin;

-- Run with two fixture tenants/users in a staging project. These assertions document
-- the production invariants without weakening RLS or requiring service credentials.
do $$ begin
  if not exists(select 1 from pg_constraint where conname='whatsapp_messages_establishment_id_whatsapp_message_id_key') then
    raise exception 'missing webhook idempotency constraint';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='whatsapp_messages' and policyname='whatsapp_messages_read') then
    raise exception 'missing tenant read policy';
  end if;
  if has_table_privilege('anon','public.whatsapp_messages','select') then
    raise exception 'anonymous role must not read WhatsApp messages';
  end if;
  if has_function_privilege('authenticated','public.get_whatsapp_connection_secret(uuid)','execute') then
    raise exception 'authenticated role must not read Vault secrets';
  end if;
end $$;

rollback;
