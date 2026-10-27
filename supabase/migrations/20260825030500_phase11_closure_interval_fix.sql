create or replace function public.close_driver_financial_period(
  requested_driver_profile_id uuid, requested_period_start date, requested_period_end date, requested_notes text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); driver public.driver_profiles%rowtype; policy_record public.driver_compensation_policies%rowtype; closure public.driver_financial_closures%rowtype; month_cursor date; segment_start date; segment_end date; salary_amount integer;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where id=requested_driver_profile_id for update;
  if driver.id is null or not private.has_role(driver.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para fechar este período.'; end if;
  if requested_period_start is null or requested_period_end<requested_period_start or requested_period_end-requested_period_start>62 then raise exception 'Período inválido. Use no máximo 63 dias.'; end if;
  if exists(select 1 from public.driver_financial_closures c where c.driver_profile_id=driver.id and daterange(c.period_start,c.period_end,'[]') && daterange(requested_period_start,requested_period_end,'[]')) then raise exception 'Este período possui fechamento total ou parcial.'; end if;
  month_cursor:=date_trunc('month',requested_period_start)::date;
  while month_cursor<=requested_period_end loop
    segment_start:=greatest(requested_period_start,month_cursor); segment_end:=least(requested_period_end,(month_cursor + interval '1 month' - interval '1 day')::date);
    select * into policy_record from public.driver_compensation_policies p where p.driver_profile_id=driver.id and p.effective_from<=segment_end and (p.effective_to is null or p.effective_to>=segment_start) order by p.effective_from desc limit 1;
    if policy_record.payout_model in ('salary','salary_plus_commission') and policy_record.monthly_salary_cents>0 then
      salary_amount:=round(policy_record.monthly_salary_cents*((segment_end-segment_start+1)::numeric/extract(day from (month_cursor + interval '1 month' - interval '1 day'))));
      if salary_amount>0 then insert into public.driver_financial_entries(establishment_id,driver_profile_id,policy_id,entry_type,amount_cents,reason,competence_date,idempotency_key,created_by) values(driver.establishment_id,driver.id,policy_record.id,'salary',salary_amount,'Salário proporcional do período fechado',segment_end,'salary:'||driver.id||':'||segment_start||':'||segment_end,actor) on conflict(establishment_id,idempotency_key) do nothing; end if;
    end if;
    month_cursor:=(month_cursor+interval '1 month')::date;
  end loop;
  insert into public.driver_financial_closures(establishment_id,driver_profile_id,period_start,period_end,deliveries_count,order_value_cents,customer_fees_cents,delivery_payouts_cents,daily_rates_cents,salary_cents,commissions_cents,additions_cents,deductions_cents,total_payable_cents,logistics_margin_cents,notes,created_by)
  select driver.establishment_id,driver.id,requested_period_start,requested_period_end,
    (select count(*) from public.deliveries d where d.delivered_driver_profile_id=driver.id and (d.delivered_at at time zone 'America/Sao_Paulo')::date between requested_period_start and requested_period_end),
    (select coalesce(sum(o.total_cents),0) from public.deliveries d join public.orders o on o.id=d.order_id where d.delivered_driver_profile_id=driver.id and (d.delivered_at at time zone 'America/Sao_Paulo')::date between requested_period_start and requested_period_end),
    (select coalesce(sum(d.customer_delivery_fee_cents),0) from public.deliveries d where d.delivered_driver_profile_id=driver.id and (d.delivered_at at time zone 'America/Sao_Paulo')::date between requested_period_start and requested_period_end),
    coalesce(sum(e.amount_cents) filter(where e.entry_type='delivery_payout'),0),coalesce(sum(e.amount_cents) filter(where e.entry_type='daily_rate'),0),coalesce(sum(e.amount_cents) filter(where e.entry_type='salary'),0),coalesce(sum(e.amount_cents) filter(where e.entry_type='commission'),0),coalesce(sum(e.amount_cents) filter(where e.entry_type in ('bonus','fuel','rain','night','adjustment') and e.amount_cents>0),0),abs(coalesce(sum(e.amount_cents) filter(where e.entry_type in ('bonus','fuel','rain','night','adjustment','reversal') and e.amount_cents<0),0)),coalesce(sum(e.amount_cents),0),
    (select coalesce(sum(d.logistics_margin_cents),0) from public.deliveries d where d.delivered_driver_profile_id=driver.id and (d.delivered_at at time zone 'America/Sao_Paulo')::date between requested_period_start and requested_period_end),nullif(btrim(requested_notes),''),actor
  from public.driver_financial_entries e where e.driver_profile_id=driver.id and e.competence_date between requested_period_start and requested_period_end
  returning * into closure;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(driver.establishment_id,actor,'driver.financial_period_closed','driver_financial_closures',closure.id,jsonb_build_object('driver_profile_id',driver.id,'period_start',requested_period_start,'period_end',requested_period_end,'total_payable_cents',closure.total_payable_cents));
  return to_jsonb(closure);
end $$;

revoke all on function public.close_driver_financial_period(uuid,date,date,text) from public,anon;
grant execute on function public.close_driver_financial_period(uuid,date,date,text) to authenticated;
