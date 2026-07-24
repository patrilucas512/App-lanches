-- Generated with Supabase CLI; timestamp adjusted to follow the existing migrations.
create or replace function private.enforce_public_service_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mode_record public.service_modes%rowtype;
begin
  select * into mode_record from public.service_modes where establishment_id = new.establishment_id;
  if mode_record.id is null then return new; end if;
  if not mode_record.customer_self_order_enabled then
    raise exception 'Este estabelecimento recebe pedidos somente pela equipe.';
  end if;
  if new.fulfillment_type = 'pickup' and not mode_record.counter_pickup_enabled then
    raise exception 'Retirada no balcão indisponível.';
  end if;
  if new.fulfillment_type = 'delivery' and not mode_record.delivery_enabled then
    raise exception 'Entrega indisponível.';
  end if;
  if new.fulfillment_type = 'dine_in' and not mode_record.table_service_enabled then
    raise exception 'Atendimento em mesa indisponível.';
  end if;
  return new;
end
$$;

create trigger orders_service_mode_guard before insert on public.orders
for each row execute function private.enforce_public_service_mode();

create or replace function private.enforce_waiter_call_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.service_modes sm
    where sm.establishment_id = new.establishment_id
      and sm.waiter_mode_enabled and sm.table_service_enabled and sm.waiter_call_enabled
  ) then raise exception 'Chamada de garçom indisponível.'; end if;
  return new;
end
$$;

create trigger waiter_calls_service_mode_guard before insert on public.waiter_calls
for each row execute function private.enforce_waiter_call_mode();
