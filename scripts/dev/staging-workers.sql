-- Somente para o banco de DESENVOLVIMENTO (masterapp-dev). Agenda no pg_cron os workers HTTP
-- apontando para a homologação (Vercel Preview, branch staging). Nenhum segredo fica neste arquivo:
-- os tokens são lidos do Vault na hora de cada chamada.
--
-- Segredos esperados no Vault do dev (ver docs/ambientes.md):
--   cx_worker_secret          workers das Fases 38, 57 e 93
--   privacy_worker_secret     worker de privacidade (Fases 95 e 96)
--   vercel_bypass_secret      "Protection Bypass for Automation" da Vercel (as prévias pedem login)
--   masterapp-phase20-worker  webhooks da Fase 20 (criado pela própria migration)
do $$
declare
  staging constant text := 'https://app-lanches-git-staging-lucas-patrick.vercel.app';
  headers constant text := $h$jsonb_build_object('Content-Type','application/json','x-vercel-protection-bypass',coalesce((select decrypted_secret from vault.decrypted_secrets where name='vercel_bypass_secret'),''),'Authorization','Bearer '||coalesce((select decrypted_secret from vault.decrypted_secrets where name='%s'),''))$h$;
  job record;
begin
  -- O banco de produção não tem este projeto de Vercel como destino; a checagem abaixo impede rodar lá.
  if exists(select 1 from cron.job where command like '%app-lanches-psi.vercel.app%') then
    raise exception 'Este banco agenda workers para a produção. O script é só para o masterapp-dev.';
  end if;

  for job in select * from (values
    ('masterapp-cx-worker', '*/5 * * * *', '/api/customer-experience/worker', 'cx_worker_secret'),
    ('masterapp-cx-worker-enqueue', '7 * * * *', '/api/customer-experience/worker?enqueue=1', 'cx_worker_secret'),
    ('masterapp-comms-worker', '*/5 * * * *', '/api/internal-communications/worker', 'cx_worker_secret'),
    ('masterapp-comms-worker-enqueue', '12 * * * *', '/api/internal-communications/worker?enqueue=1', 'cx_worker_secret'),
    ('masterapp-idgov-worker', '*/5 * * * *', '/api/identity-governance/worker', 'cx_worker_secret'),
    ('masterapp-idgov-worker-enqueue', '17 * * * *', '/api/identity-governance/worker?enqueue=1', 'cx_worker_secret'),
    ('masterapp-privacy-worker', '*/15 * * * *', '/api/privacy/worker', 'privacy_worker_secret')
  ) as j(name, schedule, path, secret) loop
    perform cron.schedule(job.name, job.schedule, format('select net.http_post(url:=%L,headers:=%s,body:=''{}''::jsonb,timeout_milliseconds:=30000)', staging || job.path, format(headers, job.secret)));
  end loop;

  -- A Fase 20 manda o token no cabeçalho X-MasterApp-Worker.
  perform cron.schedule('masterapp-phase20-webhook-worker', '* * * * *', format($c$select net.http_post(url:=%L,headers:=jsonb_build_object('Content-Type','application/json','x-vercel-protection-bypass',coalesce((select decrypted_secret from vault.decrypted_secrets where name='vercel_bypass_secret'),''),'X-MasterApp-Worker',(select v.decrypted_secret from private.integration_worker_settings s join vault.decrypted_secrets v on v.id=s.vault_secret_id where s.id=true)),body:='{"limit":20}'::jsonb,timeout_milliseconds:=15000)$c$, staging || '/api/integrations/webhooks/process'));
end $$;
