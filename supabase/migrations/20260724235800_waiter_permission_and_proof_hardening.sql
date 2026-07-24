-- Generated with Supabase CLI; timestamp adjusted to follow the existing migrations.
create or replace function private.enforce_active_waiter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  establishment uuid := new.establishment_id;
  permission_key text := case tg_table_name
    when 'table_sessions' then 'open_tables'
    when 'table_orders' then 'create_orders'
    when 'table_payments' then 'register_payments'
    else null
  end;
begin
  if actor is not null and private.has_role(establishment, array['attendant']::public.member_role[]) then
    if not exists (
      select 1 from public.service_modes sm
      join public.waiters w on w.establishment_id = sm.establishment_id and w.user_id = actor
      where sm.establishment_id = establishment and sm.waiter_mode_enabled
        and w.active_now and w.status in ('active','serving')
        and (permission_key is null or coalesce((w.permissions ->> permission_key)::boolean, false))
    ) then raise exception 'Seu acesso está inativo ou sem permissão. Fale com o administrador.'; end if;
  end if;
  return new;
end
$$;

create trigger table_payments_active_waiter_guard before insert on public.table_payments
for each row execute function private.enforce_active_waiter();

create or replace function private.enforce_waiter_session_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is not null and private.has_role(new.establishment_id, array['attendant']::public.member_role[])
    and new.status = 'awaiting_payment' and old.status <> new.status
    and not exists (
      select 1 from public.waiters w
      where w.establishment_id = new.establishment_id and w.user_id = actor
        and w.active_now and w.status in ('active','serving')
        and coalesce((w.permissions ->> 'close_bills')::boolean, false)
    ) then raise exception 'Você não tem permissão para fechar contas.'; end if;
  return new;
end
$$;

create trigger table_sessions_waiter_update_guard before update on public.table_sessions
for each row execute function private.enforce_waiter_session_update();

drop policy payment_proofs_storage_read on storage.objects;
create policy payment_proofs_storage_read on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    (storage.foldername(name))[1] in (
      select m.establishment_id::text from public.establishment_members m
      where m.user_id = (select auth.uid()) and m.role in ('owner','manager')
    )
    or (
      (storage.foldername(name))[1] in (
        select m.establishment_id::text from public.establishment_members m
        where m.user_id = (select auth.uid()) and m.role = 'attendant'
      )
      and (storage.foldername(name))[3] = (select auth.uid())::text
    )
  )
);
