create or replace function public.confirm_public_order_received(requested_tracking_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.kitchen_tickets%rowtype;
  target_order public.orders%rowtype;
begin
  select * into target_order
  from public.orders
  where tracking_token = requested_tracking_token
  for update;

  if target_order.id is null then
    raise exception 'Pedido não encontrado.';
  end if;

  select * into target_ticket
  from public.kitchen_tickets
  where public_order_id = target_order.id
  for update;

  if target_ticket.id is null then
    raise exception 'Comanda não encontrada.';
  end if;

  if target_ticket.status not in ('ready', 'delivered') then
    raise exception 'O pedido ainda não está pronto para retirada.';
  end if;

  if target_ticket.status = 'ready' then
    update public.kitchen_tickets
    set status = 'delivered',
        delivered_at = now(),
        delivered_by = null,
        delivered_by_name = 'Confirmado pelo cliente',
        updated_at = now()
    where id = target_ticket.id;

    update public.orders
    set status = 'completed', updated_at = now()
    where id = target_order.id;
  end if;

  return jsonb_build_object('confirmed', true, 'order_number', target_order.order_number, 'status', 'delivered');
end
$$;

revoke all on function public.confirm_public_order_received(uuid) from public;
grant execute on function public.confirm_public_order_received(uuid) to anon, authenticated;
