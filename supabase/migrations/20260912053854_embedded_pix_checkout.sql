-- Preserve all current transactions. Reserve one payment channel per order.
alter table public.order_payment_transactions
  add column if not exists payment_kind text not null default 'hosted'
  check (payment_kind in ('hosted','pix'));

-- A public online order must never be collected a second time at the POS.
create or replace function private.guard_online_order_pos_collection()
returns trigger language plpgsql set search_path = '' as $$
declare method text;
begin
  if new.source_order_id is not null then
    select payment_method into method from public.orders
    where id=new.source_order_id and establishment_id=new.establishment_id for update;
    if method in ('mercado_pago_online','pagarme_online') then
      raise exception 'Pedido com pagamento online: consulte a confirmação automática. Não receba novamente no caixa.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_online_order_pos_collection() from public,anon,authenticated;
create trigger guard_online_order_pos_collection
before insert or update of source_order_id on public.pos_sales
for each row execute function private.guard_online_order_pos_collection();

-- Late pending/declined callbacks must not revert a confirmed payment.
create or replace function private.guard_online_payment_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.online_payment_status = 'approved' and new.online_payment_status in ('pending','declined','canceled') then
    new.online_payment_status := old.online_payment_status;
    new.paid_at := old.paid_at;
  elsif old.online_payment_status = 'refunded' then
    new.online_payment_status := old.online_payment_status;
    new.paid_at := old.paid_at;
  end if;
  return new;
end $$;
revoke all on function private.guard_online_payment_state() from public,anon,authenticated;
create trigger guard_online_payment_state before update of online_payment_status on public.orders
for each row execute function private.guard_online_payment_state();

create or replace function private.guard_online_transaction_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='approved' and new.status in ('pending','declined','canceled') or old.status='refunded' then
    new.status:=old.status;
    new.raw_status:=old.raw_status;
  end if;
  return new;
end $$;
revoke all on function private.guard_online_transaction_state() from public,anon,authenticated;
create trigger guard_online_transaction_state before update of status on public.order_payment_transactions
for each row execute function private.guard_online_transaction_state();
