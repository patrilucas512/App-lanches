alter table public.kitchen_tickets
  add column if not exists delivered_by uuid references auth.users(id) on delete set null,
  add column if not exists delivered_by_name text;

create index if not exists kitchen_tickets_delivered_by_idx
  on public.kitchen_tickets (delivered_by)
  where delivered_by is not null;

create or replace function public.update_kitchen_ticket(
  requested_ticket_id uuid,
  requested_status public.kitchen_ticket_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.kitchen_tickets%rowtype;
  target_order public.table_orders%rowtype;
  target_session public.table_sessions%rowtype;
  waiter_record public.waiters%rowtype;
  actor uuid := auth.uid();
  actor_name text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;

  select * into target_ticket
  from public.kitchen_tickets
  where id = requested_ticket_id
  for update;

  if not found or not private.has_role(
    target_ticket.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then
    raise exception 'Comanda não encontrada.';
  end if;

  select * into waiter_record
  from public.waiters
  where establishment_id = target_ticket.establishment_id
    and user_id = actor;

  select coalesce(
    nullif(btrim(waiter_record.name), ''),
    nullif(btrim(profile.full_name), ''),
    'Equipe'
  )
  into actor_name
  from public.profiles profile
  where profile.id = actor;
  actor_name := coalesce(actor_name, nullif(btrim(waiter_record.name), ''), 'Equipe');

  if requested_status = 'canceled' then
    if not private.has_role(target_ticket.establishment_id, array['owner','manager']::public.member_role[]) then
      raise exception 'Somente proprietário ou gerente pode cancelar.';
    end if;
  elsif not (
    (target_ticket.status = 'received' and requested_status = 'preparing') or
    (target_ticket.status = 'preparing' and requested_status = 'ready') or
    (target_ticket.status = 'ready' and requested_status = 'delivered')
  ) then
    raise exception 'Mudança de status inválida.';
  end if;

  if requested_status = 'delivered'
    and private.has_role(target_ticket.establishment_id, array['attendant']::public.member_role[])
    and (
      waiter_record.id is null
      or waiter_record.status in ('inactive','paused','blocked')
      or not waiter_record.active_now
      or (
        waiter_record.employment_type = 'daily'
        and waiter_record.work_date <> (now() at time zone 'America/Sao_Paulo')::date
      )
    )
  then
    raise exception 'Seu acesso de garçom não está ativo hoje.';
  end if;

  update public.kitchen_tickets set
    status = requested_status,
    started_at = case when requested_status = 'preparing' then now() else started_at end,
    ready_at = case when requested_status = 'ready' then now() else ready_at end,
    delivered_at = case when requested_status = 'delivered' then now() else delivered_at end,
    delivered_by = case when requested_status = 'delivered' then actor else delivered_by end,
    delivered_by_name = case when requested_status = 'delivered' then actor_name else delivered_by_name end,
    updated_at = now()
  where id = requested_ticket_id
  returning * into target_ticket;

  update public.table_orders
  set kitchen_status = requested_status, updated_at = now()
  where id = target_ticket.table_order_id
  returning * into target_order;

  select * into target_session
  from public.table_sessions
  where id = target_order.table_session_id;

  update public.restaurant_tables
  set status = case requested_status
    when 'preparing' then 'preparing'::public.restaurant_table_status
    when 'ready' then 'ready'::public.restaurant_table_status
    else 'occupied'::public.restaurant_table_status
  end,
  updated_at = now()
  where id = target_session.table_id
    and status not in ('awaiting_payment', 'paid', 'blocked');

  return to_jsonb(target_ticket);
end
$$;

create or replace function public.register_table_payment(
  requested_session_id uuid,
  requested_payment_method text,
  requested_pix_payload text default null,
  requested_proof_path text default null,
  requested_card_machine text default null,
  requested_transaction_reference text default null,
  requested_cash_received_cents integer default null,
  requested_notes text default null,
  requested_device_info text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session_record public.table_sessions%rowtype;
  table_record public.restaurant_tables%rowtype;
  waiter_record public.waiters%rowtype;
  pix_record public.pix_settings%rowtype;
  mode_record public.service_modes%rowtype;
  payment_record public.table_payments%rowtype;
  actor_name text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;

  select * into session_record
  from public.table_sessions
  where id = requested_session_id
  for update;

  if not found or not private.has_role(
    session_record.establishment_id,
    array['owner','manager','attendant']::public.member_role[]
  ) then
    raise exception 'Conta não encontrada.';
  end if;

  if session_record.status <> 'awaiting_payment' or session_record.payment_status = 'confirmed' then
    raise exception 'Esta conta não aceita pagamento.';
  end if;

  select * into mode_record
  from public.service_modes
  where establishment_id = session_record.establishment_id;

  if not (mode_record.accepted_payment_methods ? requested_payment_method) then
    raise exception 'Forma de pagamento não aceita pelo estabelecimento.';
  end if;

  select * into waiter_record
  from public.waiters
  where establishment_id = session_record.establishment_id
    and user_id = actor;

  if private.has_role(session_record.establishment_id, array['attendant']::public.member_role[])
    and (
      waiter_record.id is null
      or waiter_record.status in ('inactive','paused','blocked')
      or not waiter_record.active_now
      or (
        waiter_record.employment_type = 'daily'
        and waiter_record.work_date <> (now() at time zone 'America/Sao_Paulo')::date
      )
    )
  then
    raise exception 'Seu acesso está inativo. Fale com o administrador.';
  end if;

  select coalesce(
    nullif(btrim(waiter_record.name), ''),
    nullif(btrim(profile.full_name), ''),
    'Equipe'
  )
  into actor_name
  from public.profiles profile
  where profile.id = actor;
  actor_name := coalesce(actor_name, nullif(btrim(waiter_record.name), ''), 'Equipe');

  select * into table_record
  from public.restaurant_tables
  where id = session_record.table_id;

  if requested_payment_method = 'pix' then
    select * into pix_record
    from public.pix_settings
    where establishment_id = session_record.establishment_id;
    if pix_record.id is null or nullif(btrim(requested_pix_payload), '') is null then
      raise exception 'Pix oficial inválido.';
    end if;
  end if;

  if requested_payment_method in ('credit_card','debit_card')
    and mode_record.card_proof_required
    and nullif(btrim(requested_proof_path), '') is null
  then
    raise exception 'Anexe a foto do comprovante da maquininha.';
  end if;

  if requested_payment_method = 'cash'
    and requested_cash_received_cents is not null
    and requested_cash_received_cents < session_record.total_cents
  then
    raise exception 'O valor para troco é menor que o total.';
  end if;

  insert into public.table_payments (
    establishment_id, table_session_id, payment_method, amount_cents,
    pix_payload, pix_copy_paste, receiver_name, receiver_document_masked,
    status, confirmed_by, confirmed_at, waiter_id, waiter_name, table_id, table_number,
    card_proof_image_url, card_machine_name, card_transaction_reference,
    cash_received_cents, cash_change_cents, notes, device_info
  ) values (
    session_record.establishment_id, session_record.id, requested_payment_method, session_record.total_cents,
    case when requested_payment_method = 'pix' then requested_pix_payload end,
    case when requested_payment_method = 'pix' then requested_pix_payload end,
    case when requested_payment_method = 'pix' then pix_record.receiver_name end,
    case when requested_payment_method = 'pix' then pix_record.receiver_document_masked end,
    'confirmed', actor, now(), waiter_record.id, actor_name, table_record.id, table_record.table_number,
    nullif(btrim(requested_proof_path), ''), nullif(btrim(requested_card_machine), ''),
    nullif(btrim(requested_transaction_reference), ''), requested_cash_received_cents,
    case when requested_payment_method = 'cash' and requested_cash_received_cents is not null
      then greatest(0, requested_cash_received_cents - session_record.total_cents) end,
    nullif(btrim(requested_notes), ''), left(requested_device_info, 500)
  )
  returning * into payment_record;

  if requested_payment_method in ('credit_card','debit_card')
    and payment_record.card_proof_image_url is not null
  then
    insert into public.payment_proofs (
      establishment_id, table_payment_id, waiter_id, table_session_id, table_id,
      payment_method, amount_cents, image_path, notes, device_info
    ) values (
      session_record.establishment_id, payment_record.id, waiter_record.id, session_record.id, table_record.id,
      requested_payment_method, session_record.total_cents, payment_record.card_proof_image_url,
      payment_record.notes, payment_record.device_info
    );
  end if;

  update public.table_sessions
  set status = 'paid', payment_status = 'confirmed', updated_at = now()
  where id = session_record.id;

  update public.restaurant_tables
  set status = 'paid', updated_at = now()
  where id = table_record.id;

  insert into public.audit_logs (
    establishment_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    session_record.establishment_id, actor, 'payment.registered', 'table_payments', payment_record.id,
    jsonb_build_object(
      'waiter_id', waiter_record.id,
      'waiter_name', actor_name,
      'table_id', table_record.id,
      'payment_method', requested_payment_method,
      'amount_cents', session_record.total_cents,
      'proof_uploaded', payment_record.card_proof_image_url is not null,
      'device_info', left(requested_device_info, 500)
    )
  );

  return to_jsonb(payment_record);
end
$$;

revoke all on function public.update_kitchen_ticket(uuid, public.kitchen_ticket_status) from public, anon;
revoke all on function public.register_table_payment(uuid, text, text, text, text, text, integer, text, text) from public, anon;
grant execute on function public.update_kitchen_ticket(uuid, public.kitchen_ticket_status) to authenticated;
grant execute on function public.register_table_payment(uuid, text, text, text, text, text, integer, text, text) to authenticated;
