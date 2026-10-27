-- Keep the realized cash-flow ledger aligned with automatic paid entries without duplication.
create or replace function private.sync_financial_entry_payment() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare recorded bigint; missing bigint;
begin
  if new.status not in ('paid','partially_paid') or new.paid_amount_cents<=0 then return new; end if;
  select coalesce(sum(amount_cents),0) into recorded from public.financial_entry_payments where entry_id=new.id;
  missing:=new.paid_amount_cents-recorded;
  if missing>0 then
    insert into public.financial_entry_payments(entry_id,organization_id,store_id,amount_cents,payment_method,paid_at,reference,created_by_user_id,idempotency_key)
    values(new.id,new.organization_id,new.store_id,missing,new.payment_method,coalesce(new.paid_at,new.updated_at,new.created_at),'Sincronização da origem oficial',new.created_by_user_id,'entry-sync:'||new.id::text||':'||new.paid_amount_cents::text)
    on conflict(organization_id,idempotency_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.sync_financial_entry_payment() from public,anon,authenticated;
drop trigger if exists financial_entries_payment_sync on public.financial_entries;
create trigger financial_entries_payment_sync after insert or update of paid_amount_cents,status on public.financial_entries for each row execute function private.sync_financial_entry_payment();

insert into public.financial_entry_payments(entry_id,organization_id,store_id,amount_cents,payment_method,paid_at,reference,created_by_user_id,idempotency_key)
select e.id,e.organization_id,e.store_id,e.paid_amount_cents,e.payment_method,coalesce(e.paid_at,e.updated_at,e.created_at),'Sincronização da origem oficial',e.created_by_user_id,'entry-sync:'||e.id::text||':'||e.paid_amount_cents::text
from public.financial_entries e
where e.status in ('paid','partially_paid') and e.paid_amount_cents>0 and not exists(select 1 from public.financial_entry_payments p where p.entry_id=e.id)
on conflict(organization_id,idempotency_key) do nothing;
