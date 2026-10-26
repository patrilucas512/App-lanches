-- Reuse the existing gateway ledger, preserving all order payments.
alter table public.order_payment_transactions alter column order_id drop not null;
alter table public.order_payment_transactions
  add column table_session_id uuid references public.table_sessions(id) on delete restrict,
  add column initiated_by uuid references auth.users(id) on delete set null,
  add column waiter_id uuid references public.waiters(id) on delete set null,
  add column waiter_name text,
  add constraint gateway_payment_source check (num_nonnulls(order_id,table_session_id)=1);
create index gateway_table_history on public.order_payment_transactions(table_session_id,created_at desc)
  where table_session_id is not null;
create unique index gateway_table_active on public.order_payment_transactions(table_session_id)
  where table_session_id is not null and status in ('pending','approved','refunded');
alter table public.table_payments add column gateway_transaction_id uuid unique
  references public.order_payment_transactions(id) on delete restrict;

-- Only an authorized active employee can reserve/read a table charge.
create function public.reserve_table_pix(requested_session_id uuid, requested_create boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.table_sessions%rowtype; w public.waiters%rowtype;
  t public.order_payment_transactions%rowtype; a public.payment_gateway_accounts%rowtype;
  actor uuid:=auth.uid(); actor_name text; transaction_id uuid; table_label text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into s from public.table_sessions where id=requested_session_id for update;
  if s.id is null or not private.has_role(s.establishment_id,array['owner','manager','attendant']::public.member_role[])
    then raise exception 'Conta não encontrada.'; end if;
  select * into w from public.waiters where establishment_id=s.establishment_id and user_id=actor;
  if not private.has_role(s.establishment_id,array['owner','manager']::public.member_role[]) and
    (w.id is null or not w.active_now or w.status in ('inactive','paused','blocked')
      or (w.employment_type='daily' and w.work_date is distinct from (now() at time zone 'America/Sao_Paulo')::date)
      or coalesce((w.permissions->>'register_payments')::boolean,false)=false)
    then raise exception 'Seu acesso não permite receber pagamentos.'; end if;
  select * into t from public.order_payment_transactions where table_session_id=s.id order by created_at desc limit 1;
  if s.payment_status='confirmed' then return jsonb_build_object('status',coalesce(t.status,'approved'),'paid',true); end if;
  if s.status<>'awaiting_payment' or s.total_cents<=0 then raise exception 'Feche a conta antes de gerar o Pix.'; end if;
  if not exists(select 1 from public.service_modes where establishment_id=s.establishment_id and accepted_payment_methods ? 'pix')
    then raise exception 'Pix não habilitado pelo estabelecimento.'; end if;
  if t.id is null and not requested_create then return jsonb_build_object('needsPayer',true); end if;
  if (t.id is null or t.status in ('declined','canceled','error')) and requested_create then
    select * into a from public.payment_gateway_accounts where establishment_id=s.establishment_id and provider='mercado_pago' and active;
    if a.id is null then raise exception 'O administrador precisa ativar o Mercado Pago.'; end if;
    select coalesce(nullif(w.name,''),nullif(full_name,''),'Equipe') into actor_name from public.profiles where id=actor;
    transaction_id:=gen_random_uuid();
    insert into public.order_payment_transactions(id,establishment_id,table_session_id,gateway_account_id,provider,
      amount_cents,idempotency_key,payment_kind,initiated_by,waiter_id,waiter_name)
    values(transaction_id,s.establishment_id,s.id,a.id,'mercado_pago',s.total_cents,'table-pix:'||transaction_id,'pix',actor,w.id,coalesce(actor_name,'Equipe')) returning * into t;
  end if;
  select table_number into table_label from public.restaurant_tables where id=s.table_id;
  return jsonb_build_object('id',t.id,'status',t.status,'external_id',t.external_id,'gateway_account_id',t.gateway_account_id,
    'amount_cents',t.amount_cents,'created_at',t.created_at,'table_number',table_label);
end $$;
revoke all on function public.reserve_table_pix(uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_table_pix(uuid,boolean) to authenticated;

-- Freeze the closed bill while a charge is payable. Network calls happen outside locks.
create function private.guard_pending_table_pix() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.total_cents is distinct from old.total_cents or new.status is distinct from old.status) and exists
    (select 1 from public.order_payment_transactions where table_session_id=old.id and status='pending') then
    raise exception 'Existe um Pix em andamento. Aguarde a confirmação ou o encerramento pelo provedor.';
  end if;
  return new;
end $$;
revoke all on function private.guard_pending_table_pix() from public,anon,authenticated;
create trigger guard_pending_table_pix before update on public.table_sessions
  for each row execute function private.guard_pending_table_pix();

-- Replace only the evidence guard: Pix cannot be marked paid by any employee.
create or replace function private.validate_table_payment_evidence()
returns trigger language plpgsql set search_path='' as $$
declare expected_amount integer;
begin
  select total_cents into expected_amount from public.table_sessions
    where id=new.table_session_id and establishment_id=new.establishment_id for update;
  if expected_amount is null or new.amount_cents is distinct from expected_amount then
    raise exception 'Valor do pagamento não corresponde à conta.';
  end if;
  if new.payment_method='pix' then
    if new.gateway_transaction_id is null or not exists (
      select 1 from public.order_payment_transactions t where t.id=new.gateway_transaction_id
        and t.table_session_id=new.table_session_id and t.establishment_id=new.establishment_id
        and t.status='approved' and t.amount_cents=new.amount_cents and t.external_id is not null
        and t.provider='mercado_pago' and t.payment_kind='pix'
    ) then raise exception 'Pix somente é confirmado automaticamente pelo Mercado Pago.'; end if;
  elsif exists(select 1 from public.order_payment_transactions where table_session_id=new.table_session_id and status in ('pending','approved','refunded')) then
    raise exception 'Esta conta tem uma cobrança Pix. Consulte o pagamento antes de receber novamente.';
  end if;
  if new.payment_method in ('credit_card','debit_card') then
    if auth.uid() is null or new.card_proof_image_url is null
      or split_part(new.card_proof_image_url,'/',1)<>new.establishment_id::text
      or split_part(new.card_proof_image_url,'/',2)<>new.table_session_id::text
      or split_part(new.card_proof_image_url,'/',3)<>auth.uid()::text
      or not exists(select 1 from storage.objects o where o.bucket_id='payment-proofs'
        and o.name=new.card_proof_image_url and o.owner_id=auth.uid()::text
        and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')) then
      raise exception 'Fotografe e envie o comprovante desta conta antes de confirmar o cartão.';
    end if;
  end if;
  return new;
end $$;

-- The backend calls this only after a signed webhook + provider lookup, or a provider lookup on polling.
create function public.confirm_online_table_payment(requested_transaction_id uuid,requested_account_id uuid,
  requested_external_id text,requested_status text,requested_amount_cents integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.order_payment_transactions%rowtype; s public.table_sessions%rowtype;
  p public.table_payments%rowtype; table_label text; next_status text;
begin
  -- Consistent lock order with reservation/manual payment: session, then transaction.
  select * into t from public.order_payment_transactions where id=requested_transaction_id
    and gateway_account_id=requested_account_id and table_session_id is not null and provider='mercado_pago' and payment_kind='pix';
  if t.id is null then raise exception 'Cobrança não encontrada.'; end if;
  select * into s from public.table_sessions where id=t.table_session_id for update;
  select * into t from public.order_payment_transactions where id=t.id for update;
  if requested_amount_cents is distinct from t.amount_cents or requested_amount_cents is distinct from s.total_cents
    or t.establishment_id is distinct from s.establishment_id or nullif(requested_external_id,'') is null
    or (t.external_id is not null and t.external_id<>requested_external_id) then
    raise exception 'Cobrança não corresponde à conta.';
  end if;
  next_status:=case when requested_status in ('approved','declined','canceled','refunded') then requested_status else 'pending' end;
  if t.status='refunded' or (t.status='approved' and next_status in ('pending','declined','canceled')) then next_status:=t.status; end if;
  update public.order_payment_transactions set status=next_status,raw_status=requested_status,external_id=requested_external_id,
    approved_at=case when next_status='approved' then coalesce(approved_at,now()) else approved_at end where id=t.id;
  if next_status='approved' then
    select * into p from public.table_payments where gateway_transaction_id=t.id;
    if p.id is null then
      if s.status<>'awaiting_payment' or s.payment_status='confirmed' then raise exception 'Conta já liquidada ou encerrada. Conferência necessária.'; end if;
      select table_number into table_label from public.restaurant_tables where id=s.table_id;
      insert into public.table_payments(establishment_id,table_session_id,payment_method,amount_cents,status,confirmed_at,
        waiter_id,waiter_name,table_id,table_number,gateway_transaction_id,notes)
      values(s.establishment_id,s.id,'pix',t.amount_cents,'confirmed',now(),t.waiter_id,t.waiter_name,s.table_id,table_label,t.id,
        'Pix confirmado automaticamente pelo Mercado Pago. Transação: '||requested_external_id) returning * into p;
      update public.table_sessions set status='paid',payment_status='confirmed',updated_at=now() where id=s.id;
      update public.restaurant_tables set status='paid',updated_at=now() where id=s.table_id;
      insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
      values(s.establishment_id,t.initiated_by,'payment.pix_auto_confirmed','table_payments',p.id,
        jsonb_build_object('transaction_id',t.id,'external_id',requested_external_id,'waiter_id',t.waiter_id,'amount_cents',t.amount_cents));
    end if;
  elsif next_status='refunded' then
    update public.table_payments set status='canceled',notes='Pix estornado pelo Mercado Pago. Transação: '||requested_external_id
      where gateway_transaction_id=t.id and status='confirmed';
  end if;
  return jsonb_build_object('status',next_status,'paid',next_status='approved','table_session_id',s.id);
end $$;
revoke all on function public.confirm_online_table_payment(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.confirm_online_table_payment(uuid,uuid,text,text,integer) to service_role;
