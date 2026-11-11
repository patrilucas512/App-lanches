-- Teste grátis com o plano mais completo por 15 dias; depois disso a loja precisa escolher um plano.
--
-- 1. Loja nova sem pagamento entra no plano público ativo mais caro (o mais completo), por 15 dias.
--    Antes: plano 'starter' ou o de menor sort_order, por 14 dias.
-- 2. Testes vencidos passam de 'trialing' para 'expired' (job de hora em hora). Os bloqueios que já
--    filtram status ('active','trialing','past_due') passam a negar a loja vencida, e o painel manda
--    para /painel/escolher-plano. Planos não públicos (Piloto, uso interno) ficam de fora.

do $$
declare def text := pg_get_functiondef('public.create_establishment(text,text)'::regprocedure);
begin
  if position('where active and is_public order by (lower(code)=''starter'') desc,sort_order,created_at' in def) = 0
     or position('now()+interval ''14 days''' in def) = 0 then
    raise exception 'TRIAL_FULL_PLAN_CREATE_ESTABLISHMENT_CHANGED: revisar a escolha do plano inicial';
  end if;
  def := replace(def, 'where active and is_public order by (lower(code)=''starter'') desc,sort_order,created_at',
                      'where active and is_public order by monthly_price_cents desc,sort_order,created_at');
  def := replace(def, 'now()+interval ''14 days''', 'now()+interval ''15 days''');
  execute def;
end $$;

create or replace function private.expire_due_trials()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update public.subscriptions s set status = 'expired'
  from public.plans p
  where p.id = s.plan_id and p.is_public
    and s.status = 'trialing' and s.trial_ends_at is not null and s.trial_ends_at <= now();
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function private.expire_due_trials() from public, anon, authenticated;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'masterapp-expire-due-trials';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('masterapp-expire-due-trials', '7 * * * *', 'select private.expire_due_trials()');
end $$;
