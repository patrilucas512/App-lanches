alter table public.deliveries
  add column if not exists distance_meters integer check (distance_meters is null or distance_meters >= 0),
  add column if not exists driver_payout_cents integer not null default 0 check (driver_payout_cents >= 0),
  add column if not exists logistics_margin_cents integer generated always as (customer_delivery_fee_cents - driver_payout_cents) stored;

create table if not exists public.driver_compensation_policies (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  driver_profile_id uuid not null,
  payout_model text not null check (payout_model in ('per_delivery','daily','daily_plus_delivery','salary','salary_plus_commission','custom')),
  per_delivery_cents integer not null default 0 check (per_delivery_cents >= 0),
  daily_rate_cents integer not null default 0 check (daily_rate_cents >= 0),
  monthly_salary_cents integer not null default 0 check (monthly_salary_cents >= 0),
  commission_basis_points integer not null default 0 check (commission_basis_points between 0 and 10000),
  distance_rates jsonb not null default '[]'::jsonb check (jsonb_typeof(distance_rates) = 'array'),
  effective_from date not null,
  effective_to date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint driver_compensation_policy_driver_tenant_fk foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete restrict,
  constraint driver_compensation_policy_period_check check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists driver_compensation_one_current_idx
  on public.driver_compensation_policies(driver_profile_id) where effective_to is null;
create index if not exists driver_compensation_period_idx
  on public.driver_compensation_policies(establishment_id, driver_profile_id, effective_from desc);

create table if not exists public.driver_financial_entries (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  driver_profile_id uuid not null,
  delivery_id uuid references public.deliveries(id) on delete restrict,
  policy_id uuid references public.driver_compensation_policies(id) on delete restrict,
  entry_type text not null check (entry_type in ('delivery_payout','daily_rate','salary','commission','bonus','fuel','rain','night','adjustment','reversal')),
  amount_cents integer not null check (amount_cents <> 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  competence_date date not null,
  idempotency_key text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint driver_financial_entry_driver_tenant_fk foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete restrict,
  unique(establishment_id, idempotency_key)
);

create index if not exists driver_financial_entries_driver_date_idx
  on public.driver_financial_entries(driver_profile_id, competence_date desc, id desc);
create index if not exists driver_financial_entries_establishment_date_idx
  on public.driver_financial_entries(establishment_id, competence_date desc);

create table if not exists public.driver_financial_closures (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  driver_profile_id uuid not null,
  period_start date not null,
  period_end date not null,
  deliveries_count integer not null default 0,
  order_value_cents bigint not null default 0,
  customer_fees_cents bigint not null default 0,
  delivery_payouts_cents bigint not null default 0,
  daily_rates_cents bigint not null default 0,
  salary_cents bigint not null default 0,
  commissions_cents bigint not null default 0,
  additions_cents bigint not null default 0,
  deductions_cents bigint not null default 0,
  total_payable_cents bigint not null default 0,
  logistics_margin_cents bigint not null default 0,
  status text not null default 'closed' check (status in ('closed','paid')),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint driver_financial_closure_driver_tenant_fk foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete restrict,
  constraint driver_financial_closure_period_check check (period_end >= period_start),
  unique(driver_profile_id, period_start, period_end)
);

create index if not exists driver_financial_closures_establishment_period_idx
  on public.driver_financial_closures(establishment_id, period_end desc);

alter table public.driver_compensation_policies enable row level security;
alter table public.driver_financial_entries enable row level security;
alter table public.driver_financial_closures enable row level security;

create policy driver_compensation_admin_read on public.driver_compensation_policies for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[])
    or exists(select 1 from public.driver_profiles d where d.id=driver_profile_id and d.user_id=(select auth.uid())));
create policy driver_financial_entries_admin_driver_read on public.driver_financial_entries for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[])
    or exists(select 1 from public.driver_profiles d where d.id=driver_profile_id and d.user_id=(select auth.uid())));
create policy driver_financial_closures_admin_driver_read on public.driver_financial_closures for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[])
    or exists(select 1 from public.driver_profiles d where d.id=driver_profile_id and d.user_id=(select auth.uid())));

revoke all on public.driver_compensation_policies, public.driver_financial_entries, public.driver_financial_closures from public, anon, authenticated;
grant select on public.driver_compensation_policies, public.driver_financial_entries, public.driver_financial_closures to authenticated;

create or replace function private.prevent_financial_history_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Registros financeiros são imutáveis. Registre um lançamento de ajuste ou reversão.';
end $$;

drop trigger if exists driver_financial_entries_immutable on public.driver_financial_entries;
create trigger driver_financial_entries_immutable before update or delete on public.driver_financial_entries
for each row execute function private.prevent_financial_history_mutation();
drop trigger if exists driver_financial_closures_immutable on public.driver_financial_closures;
create trigger driver_financial_closures_immutable before update or delete on public.driver_financial_closures
for each row execute function private.prevent_financial_history_mutation();

create or replace function private.record_driver_delivery_financials()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  policy_record public.driver_compensation_policies%rowtype;
  order_total integer := 0;
  per_delivery integer := 0;
  commission integer := 0;
  rate jsonb;
  delivery_day date;
begin
  if new.status::text <> 'delivered' or old.status::text = 'delivered' then return new; end if;
  if new.delivered_driver_profile_id is null then
    new.driver_payout_cents := 0;
    return new;
  end if;
  delivery_day := (coalesce(new.delivered_at, now()) at time zone 'America/Sao_Paulo')::date;
  select * into policy_record from public.driver_compensation_policies p
   where p.driver_profile_id=new.delivered_driver_profile_id and p.effective_from<=delivery_day
     and (p.effective_to is null or p.effective_to>=delivery_day)
   order by p.effective_from desc limit 1;
  if policy_record.id is null then new.driver_payout_cents := 0; return new; end if;
  select coalesce(o.total_cents,0) into order_total from public.orders o where o.id=new.order_id;
  if policy_record.payout_model in ('per_delivery','daily_plus_delivery') then
    per_delivery := policy_record.per_delivery_cents;
    if new.distance_meters is not null then
      select item into rate from jsonb_array_elements(policy_record.distance_rates) item
       where (item->>'min_meters')::integer <= new.distance_meters
         and (item->>'max_meters')::integer >= new.distance_meters
       order by (item->>'min_meters')::integer limit 1;
      if rate is not null then per_delivery := (rate->>'amount_cents')::integer; end if;
    end if;
  end if;
  if policy_record.payout_model='salary_plus_commission' then
    commission := round(order_total * policy_record.commission_basis_points / 10000.0);
  end if;
  new.driver_payout_cents := greatest(0, per_delivery + commission);
  if per_delivery>0 then
    insert into public.driver_financial_entries(establishment_id,driver_profile_id,delivery_id,policy_id,entry_type,amount_cents,reason,competence_date,idempotency_key,created_by)
    values(new.establishment_id,new.delivered_driver_profile_id,new.id,policy_record.id,'delivery_payout',per_delivery,'Repasse da entrega concluída',delivery_day,'delivery:'||new.id,null)
    on conflict(establishment_id,idempotency_key) do nothing;
  end if;
  if commission>0 then
    insert into public.driver_financial_entries(establishment_id,driver_profile_id,delivery_id,policy_id,entry_type,amount_cents,reason,competence_date,idempotency_key,created_by)
    values(new.establishment_id,new.delivered_driver_profile_id,new.id,policy_record.id,'commission',commission,'Comissão sobre o pedido entregue',delivery_day,'commission:'||new.id,null)
    on conflict(establishment_id,idempotency_key) do nothing;
  end if;
  if policy_record.payout_model in ('daily','daily_plus_delivery') and policy_record.daily_rate_cents>0 then
    insert into public.driver_financial_entries(establishment_id,driver_profile_id,policy_id,entry_type,amount_cents,reason,competence_date,idempotency_key,created_by)
    values(new.establishment_id,new.delivered_driver_profile_id,policy_record.id,'daily_rate',policy_record.daily_rate_cents,'Diária do primeiro serviço concluído no dia',delivery_day,'daily:'||new.delivered_driver_profile_id||':'||delivery_day,null)
    on conflict(establishment_id,idempotency_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists deliveries_record_driver_financials on public.deliveries;
create trigger deliveries_record_driver_financials before update of status on public.deliveries
for each row execute function private.record_driver_delivery_financials();

create or replace function public.save_driver_compensation_policy(
  requested_driver_profile_id uuid, requested_payout_model text,
  requested_per_delivery_cents integer default 0, requested_daily_rate_cents integer default 0,
  requested_monthly_salary_cents integer default 0, requested_commission_basis_points integer default 0,
  requested_distance_rates jsonb default '[]'::jsonb, requested_effective_from date default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); driver public.driver_profiles%rowtype; starts date:=coalesce(requested_effective_from,(now() at time zone 'America/Sao_Paulo')::date); current_policy public.driver_compensation_policies%rowtype; saved public.driver_compensation_policies%rowtype; previous_max integer:=-1; item jsonb;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where id=requested_driver_profile_id;
  if driver.id is null or not private.has_role(driver.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para configurar este motoboy.'; end if;
  if requested_payout_model not in ('per_delivery','daily','daily_plus_delivery','salary','salary_plus_commission','custom') then raise exception 'Modelo de repasse inválido.'; end if;
  if least(requested_per_delivery_cents,requested_daily_rate_cents,requested_monthly_salary_cents,requested_commission_basis_points)<0 or requested_commission_basis_points>10000 then raise exception 'Valores financeiros inválidos.'; end if;
  if jsonb_typeof(coalesce(requested_distance_rates,'[]'::jsonb))<>'array' then raise exception 'Faixas de distância inválidas.'; end if;
  for item in select value from jsonb_array_elements(coalesce(requested_distance_rates,'[]'::jsonb)) order by (value->>'min_meters')::integer loop
    if (item->>'min_meters')::integer<0 or (item->>'max_meters')::integer<(item->>'min_meters')::integer or (item->>'amount_cents')::integer<0 or (item->>'min_meters')::integer<=previous_max then raise exception 'As faixas de distância devem ser válidas e não podem se sobrepor.'; end if;
    previous_max := (item->>'max_meters')::integer;
  end loop;
  select * into current_policy from public.driver_compensation_policies where driver_profile_id=driver.id and effective_to is null for update;
  if current_policy.id is not null and current_policy.effective_from>=starts then raise exception 'Já existe uma política iniciada nesta data. Escolha uma data posterior.'; end if;
  if current_policy.id is not null then update public.driver_compensation_policies set effective_to=starts-1 where id=current_policy.id; end if;
  insert into public.driver_compensation_policies(establishment_id,driver_profile_id,payout_model,per_delivery_cents,daily_rate_cents,monthly_salary_cents,commission_basis_points,distance_rates,effective_from,created_by)
  values(driver.establishment_id,driver.id,requested_payout_model,requested_per_delivery_cents,requested_daily_rate_cents,requested_monthly_salary_cents,requested_commission_basis_points,coalesce(requested_distance_rates,'[]'::jsonb),starts,actor) returning * into saved;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(driver.establishment_id,actor,'driver.compensation_policy_created','driver_compensation_policies',saved.id,jsonb_build_object('driver_profile_id',driver.id,'model',requested_payout_model,'effective_from',starts));
  return to_jsonb(saved);
end $$;

create or replace function public.add_driver_financial_adjustment(
  requested_driver_profile_id uuid, requested_entry_type text, requested_amount_cents integer,
  requested_direction text, requested_reason text, requested_competence_date date default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); driver public.driver_profiles%rowtype; entry_record public.driver_financial_entries%rowtype; entry_date date:=coalesce(requested_competence_date,(now() at time zone 'America/Sao_Paulo')::date); signed_amount integer;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into driver from public.driver_profiles where id=requested_driver_profile_id;
  if driver.id is null or not private.has_role(driver.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para lançar este ajuste.'; end if;
  if requested_entry_type not in ('bonus','fuel','rain','night','adjustment') or requested_direction not in ('credit','debit') or requested_amount_cents<=0 or char_length(btrim(coalesce(requested_reason,'')))<3 then raise exception 'Informe tipo, direção, valor e motivo válidos.'; end if;
  if exists(select 1 from public.driver_financial_closures c where c.driver_profile_id=driver.id and entry_date between c.period_start and c.period_end) then raise exception 'Este período já foi fechado. Faça o ajuste em um período aberto.'; end if;
  signed_amount:=case when requested_direction='debit' then -requested_amount_cents else requested_amount_cents end;
  insert into public.driver_financial_entries(establishment_id,driver_profile_id,entry_type,amount_cents,reason,competence_date,idempotency_key,created_by)
  values(driver.establishment_id,driver.id,requested_entry_type,signed_amount,btrim(requested_reason),entry_date,'manual:'||gen_random_uuid(),actor) returning * into entry_record;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(driver.establishment_id,actor,'driver.financial_adjustment_created','driver_financial_entries',null,jsonb_build_object('entry_id',entry_record.id,'driver_profile_id',driver.id,'type',requested_entry_type,'amount_cents',signed_amount,'reason',btrim(requested_reason)));
  return to_jsonb(entry_record);
end $$;

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

create or replace function public.get_driver_financial_dashboard(requested_establishment_id uuid, requested_date_from date default null, requested_date_to date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); starts date:=coalesce(requested_date_from,date_trunc('week',(now() at time zone 'America/Sao_Paulo')::date)::date); ends date:=coalesce(requested_date_to,(date_trunc('week',(now() at time zone 'America/Sao_Paulo')::date)+interval '6 days')::date); result jsonb;
begin
  if actor is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para consultar o financeiro dos motoboys.'; end if;
  if ends<starts or ends-starts>62 then raise exception 'Período inválido.'; end if;
  select jsonb_build_object('date_from',starts,'date_to',ends,
    'stats',jsonb_build_object(
      'deliveries',count(*),'order_value_cents',coalesce(sum(o.total_cents),0),'customer_fees_cents',coalesce(sum(d.customer_delivery_fee_cents),0),
      'driver_payouts_cents',coalesce((select sum(e.amount_cents) from public.driver_financial_entries e where e.establishment_id=requested_establishment_id and e.competence_date between starts and ends),0),
      'logistics_margin_cents',coalesce(sum(d.logistics_margin_cents),0)),
    'drivers',coalesce((select jsonb_agg(jsonb_build_object(
      'driver_profile_id',p.id,'name',s.name,'active',p.active,'payment_cycle',s.payment_cycle,
      'policy',(select to_jsonb(cp) from public.driver_compensation_policies cp where cp.driver_profile_id=p.id and cp.effective_to is null limit 1),
      'deliveries_count',(select count(*) from public.deliveries x where x.delivered_driver_profile_id=p.id and (x.delivered_at at time zone 'America/Sao_Paulo')::date between starts and ends),
      'customer_fees_cents',(select coalesce(sum(x.customer_delivery_fee_cents),0) from public.deliveries x where x.delivered_driver_profile_id=p.id and (x.delivered_at at time zone 'America/Sao_Paulo')::date between starts and ends),
      'total_payable_cents',(select coalesce(sum(e.amount_cents),0) from public.driver_financial_entries e where e.driver_profile_id=p.id and e.competence_date between starts and ends),
      'days',coalesce((select jsonb_agg(day_payload order by day_key) from (select day_key,jsonb_build_object('date',day_key,'deliveries',coalesce((select jsonb_agg(jsonb_build_object('order_number',od.order_number,'order_value_cents',od.total_cents,'customer_fee_cents',dx.customer_delivery_fee_cents,'driver_payout_cents',dx.driver_payout_cents) order by od.order_number) from public.deliveries dx join public.orders od on od.id=dx.order_id where dx.delivered_driver_profile_id=p.id and (dx.delivered_at at time zone 'America/Sao_Paulo')::date=day_key),'[]'::jsonb),'entries',coalesce((select jsonb_agg(jsonb_build_object('id',fe.id,'type',fe.entry_type,'amount_cents',fe.amount_cents,'reason',fe.reason) order by fe.id) from public.driver_financial_entries fe where fe.driver_profile_id=p.id and fe.competence_date=day_key),'[]'::jsonb),'total_cents',coalesce((select sum(fe.amount_cents) from public.driver_financial_entries fe where fe.driver_profile_id=p.id and fe.competence_date=day_key),0)) day_payload from generate_series(starts,ends,'1 day'::interval) day_key where exists(select 1 from public.deliveries dx where dx.delivered_driver_profile_id=p.id and (dx.delivered_at at time zone 'America/Sao_Paulo')::date=day_key) or exists(select 1 from public.driver_financial_entries fe where fe.driver_profile_id=p.id and fe.competence_date=day_key)) q),'[]'::jsonb)
    ) order by s.name) from public.driver_profiles p join public.custom_staff_members s on s.id=p.custom_staff_member_id where p.establishment_id=requested_establishment_id),'[]'::jsonb),
    'closures',coalesce((select jsonb_agg(to_jsonb(c) order by c.period_end desc) from public.driver_financial_closures c where c.establishment_id=requested_establishment_id limit 30),'[]'::jsonb)
  ) into result from public.deliveries d join public.orders o on o.id=d.order_id where d.establishment_id=requested_establishment_id and d.status='delivered' and (d.delivered_at at time zone 'America/Sao_Paulo')::date between starts and ends;
  return result;
end $$;

revoke all on function public.save_driver_compensation_policy(uuid,text,integer,integer,integer,integer,jsonb,date) from public,anon;
revoke all on function public.add_driver_financial_adjustment(uuid,text,integer,text,text,date) from public,anon;
revoke all on function public.close_driver_financial_period(uuid,date,date,text) from public,anon;
revoke all on function public.get_driver_financial_dashboard(uuid,date,date) from public,anon;
grant execute on function public.save_driver_compensation_policy(uuid,text,integer,integer,integer,integer,jsonb,date) to authenticated;
grant execute on function public.add_driver_financial_adjustment(uuid,text,integer,text,text,date) to authenticated;
grant execute on function public.close_driver_financial_period(uuid,date,date,text) to authenticated;
grant execute on function public.get_driver_financial_dashboard(uuid,date,date) to authenticated;
