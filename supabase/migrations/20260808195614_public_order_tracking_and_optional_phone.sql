alter table public.orders
  alter column customer_phone drop not null,
  add column if not exists tracking_token uuid not null default gen_random_uuid();

create unique index if not exists orders_tracking_token_key on public.orders(tracking_token);

update public.establishment_settings set minimum_order_cents = 0 where minimum_order_cents <> 0;

update public.products p
set ingredients = (
  select coalesce(jsonb_agg(to_jsonb(btrim(value))) filter (where btrim(value) <> ''), '[]'::jsonb)
  from unnest(string_to_array(p.description, ',')) value
)
where p.ingredients = '[]'::jsonb
  and p.description is not null
  and p.description like '%,%';

drop function if exists public.place_public_order(text,text,text,text,jsonb,text,text,text,text);
create function public.place_public_order(
  requested_slug text, buyer_name text, buyer_phone text, requested_fulfillment text,
  requested_items jsonb, order_notes text default null, requested_table_number text default null,
  requested_source text default 'direct', requested_payment text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  target_establishment uuid; target_table uuid; customer_record uuid; created_order uuid; created_number bigint; created_tracking_token uuid;
  normalized_buyer_name text := btrim(regexp_replace(coalesce(buyer_name,''), '\s+', ' ', 'g'));
  normalized_phone text := regexp_replace(coalesce(buyer_phone,''), '\D', '', 'g');
  normalized_table_label text := upper(btrim(regexp_replace(coalesce(requested_table_number,''), '\s+', ' ', 'g')));
  item jsonb; product_record record; item_quantity integer; subtotal integer := 0;
  item_addons jsonb; item_removed jsonb; item_note text; addon jsonb; addon_config jsonb; addon_total integer;
  safe_source text := case when requested_source='qr' then 'qr' else 'direct' end;
  table_service_allowed boolean := false; pickup_allowed boolean := false; estimated integer := 45;
begin
  if char_length(normalized_buyer_name)<2 or char_length(normalized_buyer_name)>120 then raise exception 'Informe corretamente o nome.'; end if;
  if normalized_phone <> '' and char_length(normalized_phone)<10 then raise exception 'Confira o WhatsApp ou deixe o campo vazio.'; end if;
  if requested_fulfillment not in ('pickup','dine_in') then raise exception 'Forma de consumo inválida.'; end if;
  if requested_fulfillment='dine_in' and (normalized_buyer_name !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+' or char_length(normalized_table_label)<1 or char_length(normalized_table_label)>40) then
    raise exception 'Para consumir no local, informe nome e sobrenome e o número ou nome da mesa.';
  end if;
  if jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items)<1 or jsonb_array_length(requested_items)>50 then raise exception 'Itens do pedido inválidos.'; end if;

  select e.id,sm.table_service_enabled,(sm.counter_pickup_enabled or sm.delivery_enabled),s.estimated_minutes
  into target_establishment,table_service_allowed,pickup_allowed,estimated
  from public.establishments e join public.establishment_settings s on s.establishment_id=e.id
  join public.service_modes sm on sm.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=requested_slug and e.active and (sub.status in ('active','trialing') or sub.current_period_end>now());
  if target_establishment is null then raise exception 'Estabelecimento indisponível.'; end if;
  if requested_fulfillment='dine_in' and not table_service_allowed then raise exception 'Consumo no local indisponível.'; end if;
  if requested_fulfillment='pickup' and not pickup_allowed then raise exception 'Pedido para viagem indisponível.'; end if;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item->>'quantity')::integer,1),1),20);
    select id,name,price_cents,ingredients,addon_options into product_record from public.products
      where id=(item->>'product_id')::uuid and establishment_id=target_establishment and active;
    if product_record.id is null then raise exception 'Produto indisponível.'; end if;
    addon_total := 0;
    for addon in select value from jsonb_array_elements(coalesce(item->'addons','[]'::jsonb)) loop
      select value into addon_config from jsonb_array_elements(product_record.addon_options) where value->>'name'=addon->>'name' limit 1;
      if addon_config is null then raise exception 'Adicional inválido.'; end if;
      addon_total := addon_total + greatest(coalesce((addon_config->>'price_cents')::integer,0),0); addon_config := null;
    end loop;
    subtotal := subtotal + ((product_record.price_cents + addon_total) * item_quantity);
  end loop;
  if requested_fulfillment='dine_in' then target_table := private.resolve_operational_table(target_establishment,normalized_table_label); end if;

  if normalized_phone <> '' then
    insert into public.customers(establishment_id,name,phone,last_order_at) values(target_establishment,normalized_buyer_name,normalized_phone,now())
    on conflict(establishment_id,phone) do update set name=excluded.name,last_order_at=now() returning id into customer_record;
  end if;
  insert into public.orders(establishment_id,customer_id,fulfillment_type,customer_name,customer_phone,notes,subtotal_cents,total_cents,restaurant_table_id,source,payment_method)
  values(target_establishment,customer_record,requested_fulfillment,normalized_buyer_name,nullif(normalized_phone,''),nullif(btrim(order_notes),''),subtotal,subtotal,target_table,safe_source,nullif(btrim(requested_payment),''))
  returning id,order_number,tracking_token into created_order,created_number,created_tracking_token;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item->>'quantity')::integer,1),1),20);
    select id,name,price_cents,ingredients,addon_options into product_record from public.products where id=(item->>'product_id')::uuid and establishment_id=target_establishment and active;
    item_addons := '[]'::jsonb; addon_total := 0;
    for addon in select value from jsonb_array_elements(coalesce(item->'addons','[]'::jsonb)) loop
      select value into addon_config from jsonb_array_elements(product_record.addon_options) where value->>'name'=addon->>'name' limit 1;
      item_addons := item_addons || jsonb_build_array(jsonb_build_object('name',addon_config->>'name','price_cents',greatest(coalesce((addon_config->>'price_cents')::integer,0),0)));
      addon_total := addon_total + greatest(coalesce((addon_config->>'price_cents')::integer,0),0); addon_config := null;
    end loop;
    select coalesce(jsonb_agg(value),'[]'::jsonb) into item_removed from jsonb_array_elements(coalesce(item->'removed_ingredients','[]'::jsonb))
      where value in (select value from jsonb_array_elements(product_record.ingredients));
    item_note := left(nullif(btrim(item->>'notes'),''),300);
    insert into public.order_items(establishment_id,order_id,product_id,product_name,quantity,unit_price_cents,addons,removed_ingredients,notes,total_cents)
    values(target_establishment,created_order,product_record.id,product_record.name,item_quantity,product_record.price_cents,item_addons,item_removed,item_note,(product_record.price_cents+addon_total)*item_quantity);
  end loop;
  insert into public.kitchen_tickets(establishment_id,public_order_id) values(target_establishment,created_order);
  if customer_record is not null then update public.customers set total_orders=total_orders+1,total_spent_cents=total_spent_cents+subtotal,last_order_at=now() where id=customer_record; end if;
  return jsonb_build_object('order_id',created_order,'order_number',created_number,'total_cents',subtotal,'table_number',nullif(normalized_table_label,''),'tracking_token',created_tracking_token,'estimated_minutes',estimated,'sent_to_kitchen',true);
end $$;

create or replace function public.get_public_order_status(requested_tracking_token uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'order_number',o.order_number,'status',o.status,'fulfillment_type',o.fulfillment_type,
    'created_at',o.created_at,'updated_at',o.updated_at,'estimated_minutes',s.estimated_minutes,
    'table_number',rt.table_number,
    'kitchen_status',kt.status,'started_at',kt.started_at,'ready_at',kt.ready_at,'delivered_at',kt.delivered_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',oi.id,'product_name',oi.product_name,'quantity',oi.quantity,
      'addons',oi.addons,'removed_ingredients',oi.removed_ingredients
    ) order by oi.id) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb)
  )
  from public.orders o
  join public.establishment_settings s on s.establishment_id=o.establishment_id
  left join public.restaurant_tables rt on rt.id=o.restaurant_table_id
  left join public.kitchen_tickets kt on kt.public_order_id=o.id
  where o.tracking_token=requested_tracking_token
$$;

revoke all on function public.place_public_order(text,text,text,text,jsonb,text,text,text,text) from public;
grant execute on function public.place_public_order(text,text,text,text,jsonb,text,text,text,text) to anon,authenticated;
revoke all on function public.get_public_order_status(uuid) from public;
grant execute on function public.get_public_order_status(uuid) to anon,authenticated;
