-- Somente para o banco de DESENVOLVIMENTO. Rode logo depois de aplicar as migrações.
-- Algumas migrações têm endereços de produção fixos em funções SQL e em um job do pg_cron.
-- Este script troca esses endereços por um domínio reservado que nunca responde
-- e desliga os jobs do pg_cron que ainda citam a produção.
do $$
declare
  production_functions constant text := 'https://qjwmjwubtgqginwhmajv.supabase.co';
  production_site constant text := 'https://mesa-viva-patrilucas.patricklucas512.chatgpt.site';
  disabled_endpoint constant text := 'https://dev-endpoint-disabled.invalid';
  item record;
  remaining integer;
begin
  if coalesce(current_setting('app.masterapp_test_environment', true), '') <> 'development' then
    raise exception 'Defina app.masterapp_test_environment=development para confirmar que este é o banco de desenvolvimento.';
  end if;

  for item in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind in ('f', 'p')
      and (p.prosrc like '%' || production_functions || '%' or p.prosrc like '%' || production_site || '%')
  loop
    execute replace(replace(pg_get_functiondef(item.oid), production_functions, disabled_endpoint), production_site, disabled_endpoint);
  end loop;

  for item in
    select jobid from cron.job
    where active and (command like '%' || production_functions || '%' or command like '%' || production_site || '%')
  loop
    perform cron.alter_job(item.jobid, active := false);
  end loop;

  select count(*) into remaining
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.prosrc like '%' || production_functions || '%' or p.prosrc like '%' || production_site || '%');
  if remaining > 0 then
    raise exception 'Ainda há % funções com endereços de produção.', remaining;
  end if;
end $$;
