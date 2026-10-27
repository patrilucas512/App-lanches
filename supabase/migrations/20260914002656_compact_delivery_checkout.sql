-- Preserve existing destinations and payment/stock flow. Postal code is optional.
alter table public.delivery_settings add column service_city text check(service_city is null or char_length(btrim(service_city)) between 2 and 80), add column service_state text check(service_state is null or service_state ~ '^[A-Z]{2}$');
alter table public.delivery_destinations alter column postal_code drop not null, alter column city drop not null, alter column state drop not null;
CREATE OR REPLACE FUNCTION public.place_public_order_v2(requested_slug text, buyer_name text, buyer_phone text, requested_fulfillment text, requested_items jsonb, order_notes text DEFAULT NULL::text, requested_table_number text DEFAULT NULL::text, requested_source text DEFAULT 'direct'::text, requested_payment text DEFAULT NULL::text, requested_cash_received_cents integer DEFAULT NULL::integer, requested_delivery_address jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_establishment uuid;
  target_table uuid;
  customer_record uuid;
  created_order uuid;
  created_number bigint;
  created_tracking_token uuid;
  normalized_buyer_name text := btrim(regexp_replace(coalesce(buyer_name,''),'\s+',' ','g'));
  normalized_phone text := regexp_replace(coalesce(buyer_phone,''),'\D','','g');
  normalized_table_label text := upper(btrim(regexp_replace(coalesce(requested_table_number,''),'\s+',' ','g')));
  item jsonb;
  product_record record;
  item_quantity integer;
  subtotal integer := 0;
  delivery_fee integer := 0;
  order_total integer := 0;
  item_addons jsonb;
  item_removed jsonb;
  item_note text;
  resolved_addons jsonb;
  addon_total integer;
  safe_source text := case when requested_source='qr' then 'qr' else 'direct' end;
  table_service_allowed boolean := false;
  pickup_allowed boolean := false;
  takeaway_allowed boolean := false;
  delivery_allowed boolean := false;
  store_is_open boolean := false;
  estimated integer := 45;
  quoted record;
  address_postal_code text;
  address_street text;
  address_number text;
  address_complement text;
  address_neighborhood text;
  address_city text;
  address_state text;
  address_reference text;
  address_recipient text;
begin
  if char_length(normalized_buyer_name)<2 or char_length(normalized_buyer_name)>120 then
    raise exception 'Informe corretamente o nome.';
  end if;
  if normalized_phone<>'' and char_length(normalized_phone)<10 then
    raise exception 'Confira o WhatsApp ou deixe o campo vazio.';
  end if;
  if requested_fulfillment not in ('pickup','takeaway','delivery','dine_in') then
    raise exception 'Forma de atendimento inválida.';
  end if;
  if requested_fulfillment='dine_in' and (
    normalized_buyer_name !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+'
    or char_length(normalized_table_label)<1 or char_length(normalized_table_label)>40
  ) then
    raise exception 'Para consumir no local, informe nome e sobrenome e o número ou nome da mesa.';
  end if;
  if jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items)<1 or jsonb_array_length(requested_items)>50 then
    raise exception 'Itens do pedido inválidos.';
  end if;

  select e.id, sm.table_service_enabled, sm.counter_pickup_enabled,
    sm.takeaway_enabled, sm.delivery_enabled, sm.store_open, s.estimated_minutes
  into target_establishment, table_service_allowed, pickup_allowed,
    takeaway_allowed, delivery_allowed, store_is_open, estimated
  from public.establishments e
  join public.establishment_settings s on s.establishment_id=e.id
  join public.service_modes sm on sm.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=lower(btrim(requested_slug)) and e.active
    and (sub.status in ('active','trialing') or sub.current_period_end>now());

  if target_establishment is null then raise exception 'Estabelecimento indisponível.'; end if;
  if not store_is_open then raise exception 'A loja está fechada no momento.'; end if;
  if requested_fulfillment='dine_in' and not table_service_allowed then raise exception 'Consumo no local indisponível.'; end if;
  if requested_fulfillment='pickup' and not pickup_allowed then raise exception 'Retirada indisponível.'; end if;
  if requested_fulfillment='takeaway' and not takeaway_allowed then raise exception 'Pedido para viagem indisponível.'; end if;
  if requested_fulfillment='delivery' and not delivery_allowed then raise exception 'Entrega indisponível.'; end if;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item->>'quantity')::integer,1),1),999);
    select id,name,price_cents,ingredients into product_record
    from public.products
    where id=(item->>'product_id')::uuid
      and establishment_id=target_establishment and active;
    if product_record.id is null then raise exception 'Produto indisponível.'; end if;
    resolved_addons := private.resolve_public_order_addons(
      target_establishment, product_record.id, coalesce(item->'addons','[]'::jsonb)
    );
    subtotal := subtotal + ((product_record.price_cents + (resolved_addons->>'total_cents')::integer) * item_quantity);
  end loop;

  if requested_fulfillment='delivery' then
    if jsonb_typeof(requested_delivery_address) is distinct from 'object' then
      raise exception 'Informe o endereço completo para a entrega.';
    end if;
    if char_length(normalized_phone)<10 then
      raise exception 'Informe um WhatsApp válido para a entrega.';
    end if;

    address_postal_code := regexp_replace(coalesce(requested_delivery_address->>'postal_code',''),'\D','','g');
    address_street := left(btrim(coalesce(requested_delivery_address->>'street','')),120);
    address_number := left(btrim(coalesce(requested_delivery_address->>'number','')),20);
    address_complement := left(nullif(btrim(requested_delivery_address->>'complement'),''),120);
    address_neighborhood := left(btrim(coalesce(requested_delivery_address->>'neighborhood','')),80);
    address_city := left(btrim(coalesce(requested_delivery_address->>'city','')),80);
    address_state := upper(left(btrim(coalesce(requested_delivery_address->>'state','')),2));
    address_reference := left(nullif(btrim(requested_delivery_address->>'reference'),''),160);
    address_recipient := left(coalesce(nullif(btrim(requested_delivery_address->>'recipient_name'),''),normalized_buyer_name),120);

    address_postal_code := nullif(address_postal_code,'');
    address_city := coalesce(nullif(address_city,''),(select service_city from public.delivery_settings where establishment_id=target_establishment));
    address_state := coalesce(nullif(address_state,''),(select service_state from public.delivery_settings where establishment_id=target_establishment));
    if (address_postal_code is not null and address_postal_code !~ '^[0-9]{8}$')
      or char_length(address_street)<3 or char_length(address_number)<1
      or char_length(address_neighborhood)<2
      or (address_city is not null and char_length(address_city)<2)
      or (address_state is not null and address_state !~ '^[A-Z]{2}$') then
      raise exception 'Informe rua, número e bairro no endereço.';
    end if;

    select * into quoted from private.resolve_public_delivery_quote(
      target_establishment, address_neighborhood, subtotal
    );
    delivery_fee := quoted.delivery_fee_cents;
    estimated := quoted.estimated_minutes;
  end if;

  order_total := subtotal + delivery_fee;
  if requested_payment='cash' and (
    requested_cash_received_cents is null or requested_cash_received_cents < order_total
  ) then
    raise exception 'O valor em dinheiro deve ser igual ou maior que o total da compra.';
  end if;
  if requested_payment is distinct from 'cash' then requested_cash_received_cents := null; end if;
  if requested_fulfillment='dine_in' then
    target_table := private.resolve_operational_table(target_establishment,normalized_table_label);
  end if;

  if normalized_phone<>'' then
    insert into public.customers(establishment_id,name,phone,last_order_at)
    values(target_establishment,normalized_buyer_name,normalized_phone,now())
    on conflict(establishment_id,phone) do update
      set name=excluded.name,last_order_at=now()
    returning id into customer_record;
  end if;

  insert into public.orders(
    establishment_id,customer_id,fulfillment_type,customer_name,customer_phone,
    delivery_address,notes,subtotal_cents,delivery_fee_cents,total_cents,
    restaurant_table_id,source,payment_method,cash_received_cents,cash_change_cents
  ) values (
    target_establishment,customer_record,requested_fulfillment,normalized_buyer_name,
    nullif(normalized_phone,''),
    case when requested_fulfillment='delivery' then jsonb_build_object(
      'neighborhood',address_neighborhood,'city',address_city,'state',address_state
    ) end,
    nullif(left(btrim(order_notes),500),''),subtotal,delivery_fee,order_total,target_table,
    safe_source,nullif(btrim(requested_payment),''),requested_cash_received_cents,
    case when requested_payment='cash' then requested_cash_received_cents-order_total end
  ) returning id,order_number,tracking_token
  into created_order,created_number,created_tracking_token;

  if requested_fulfillment='delivery' then
    insert into public.delivery_destinations(
      delivery_order_id,establishment_id,delivery_zone_id,recipient_name,recipient_phone,
      postal_code,street,street_number,complement,neighborhood,city,state,reference
    ) values (
      created_order,target_establishment,quoted.delivery_zone_id,address_recipient,normalized_phone,
      address_postal_code,address_street,address_number,address_complement,address_neighborhood,
      address_city,address_state,address_reference
    );
  end if;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item->>'quantity')::integer,1),1),999);
    select id,name,price_cents,ingredients into product_record
    from public.products
    where id=(item->>'product_id')::uuid
      and establishment_id=target_establishment and active;
    resolved_addons := private.resolve_public_order_addons(
      target_establishment, product_record.id, coalesce(item->'addons','[]'::jsonb)
    );
    item_addons := resolved_addons->'items';
    addon_total := (resolved_addons->>'total_cents')::integer;
    select coalesce(jsonb_agg(value),'[]'::jsonb) into item_removed
    from jsonb_array_elements(coalesce(item->'removed_ingredients','[]'::jsonb))
    where value in (select value from jsonb_array_elements(product_record.ingredients));
    item_note := left(nullif(btrim(item->>'notes'),''),300);
    insert into public.order_items(
      establishment_id,order_id,product_id,product_name,quantity,unit_price_cents,
      addons,removed_ingredients,notes,total_cents
    ) values (
      target_establishment,created_order,product_record.id,product_record.name,item_quantity,
      product_record.price_cents,item_addons,item_removed,item_note,
      (product_record.price_cents+addon_total)*item_quantity
    );
  end loop;

  insert into public.kitchen_tickets(establishment_id,public_order_id)
  values(target_establishment,created_order);

  if customer_record is not null then
    update public.customers
    set total_orders=total_orders+1,total_spent_cents=total_spent_cents+order_total,last_order_at=now()
    where id=customer_record;
  end if;

  return jsonb_build_object(
    'order_id',created_order,'order_number',created_number,
    'subtotal_cents',subtotal,'delivery_fee_cents',delivery_fee,'total_cents',order_total,
    'cash_received_cents',requested_cash_received_cents,
    'cash_change_cents',case when requested_payment='cash' then requested_cash_received_cents-order_total end,
    'table_number',nullif(normalized_table_label,''),'tracking_token',created_tracking_token,
    'estimated_minutes',estimated,'sent_to_kitchen',true
  );
end
$function$
;
