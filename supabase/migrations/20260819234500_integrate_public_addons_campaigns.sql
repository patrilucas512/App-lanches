create or replace function public.get_public_menu(requested_slug text)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'establishment', jsonb_build_object(
      'id', e.id, 'name', e.name, 'slug', e.slug, 'description', e.description,
      'logo_url', e.logo_url, 'cover_url', e.cover_url, 'accent_color', e.accent_color,
      'secondary_color', e.secondary_color, 'phone', e.phone, 'city', e.city, 'state', e.state
    ),
    'settings', jsonb_build_object(
      'whatsapp', s.whatsapp, 'instagram', s.instagram, 'pickup_enabled', s.pickup_enabled,
      'delivery_enabled', s.delivery_enabled, 'dine_in_enabled', s.dine_in_enabled,
      'minimum_order_cents', s.minimum_order_cents, 'estimated_minutes', s.estimated_minutes,
      'payment_methods', s.payment_methods, 'address', s.address
    ),
    'banners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'title', b.title, 'subtitle', b.subtitle,
        'image_url', b.image_url, 'link_url', b.link_url,
        'promotion_type', b.promotion_type, 'promotion_value', b.promotion_value,
        'destination_type', b.destination_type, 'destination_id', b.destination_id
      ) order by b.sort_order, b.created_at)
      from public.banners b
      where b.establishment_id=e.id and b.active
        and (b.starts_at is null or b.starts_at<=now())
        and (b.ends_at is null or b.ends_at>=now())
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'description', p.description,
            'image_url', p.image_url, 'price_cents', p.price_cents,
            'compare_at_price_cents', p.compare_at_price_cents,
            'featured', p.featured, 'ingredients', p.ingredients,
            'addon_options', p.addon_options,
            'addon_groups', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', ag.id, 'name', ag.name, 'description', ag.description,
                'min_choices', ag.min_choices, 'max_choices', ag.max_choices,
                'required', ag.required,
                'addons', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', a.id, 'group_id', ag.id, 'name', a.name,
                    'price_cents', a.price_cents
                  ) order by a.sort_order, a.name)
                  from public.addons a
                  where a.establishment_id=e.id and a.addon_group_id=ag.id and a.active
                ), '[]'::jsonb)
              ) order by ag.sort_order, ag.name)
              from public.product_addon_groups pag
              join public.addon_groups ag on ag.id=pag.addon_group_id
              where pag.establishment_id=e.id and pag.product_id=p.id and ag.active
            ), '[]'::jsonb)
          ) order by p.sort_order, p.name)
          from public.products p
          where p.establishment_id=e.id and p.category_id=c.id and p.active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c where c.establishment_id=e.id and c.active
    ), '[]'::jsonb)
  )
  from public.establishments e
  join public.establishment_settings s on s.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=requested_slug and e.active and e.onboarding_completed
    and (sub.status in ('active','trialing') or sub.current_period_end>now())
$$;

create or replace function private.resolve_public_order_addons(
  requested_establishment_id uuid,
  requested_product_id uuid,
  requested_addons jsonb
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  requested_addon jsonb;
  addon_record record;
  group_record record;
  legacy_addon jsonb;
  addon_quantity integer;
  selected_count integer;
  resolved_items jsonb := '[]'::jsonb;
  resolved_total integer := 0;
begin
  if requested_addons is null then requested_addons := '[]'::jsonb; end if;
  if jsonb_typeof(requested_addons) <> 'array' or jsonb_array_length(requested_addons) > 100 then
    raise exception 'Adicionais inválidos.';
  end if;

  for requested_addon in select value from jsonb_array_elements(requested_addons) loop
    addon_quantity := case
      when coalesce(requested_addon->>'quantity','') ~ '^[0-9]+$'
        then least(greatest((requested_addon->>'quantity')::integer, 1), 999)
      else 1
    end;
    addon_record := null;
    if coalesce(requested_addon->>'id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      select a.id, a.name, a.price_cents, ag.id as group_id, ag.name as group_name
      into addon_record
      from public.addons a
      join public.addon_groups ag on ag.id=a.addon_group_id
      join public.product_addon_groups pag
        on pag.addon_group_id=ag.id and pag.product_id=requested_product_id
      where a.id=(requested_addon->>'id')::uuid
        and a.establishment_id=requested_establishment_id
        and ag.establishment_id=requested_establishment_id
        and pag.establishment_id=requested_establishment_id
        and a.active and ag.active;
      if addon_record.id is null then raise exception 'Adicional inválido.'; end if;
      resolved_items := resolved_items || jsonb_build_array(jsonb_build_object(
        'addon_id', addon_record.id, 'group_id', addon_record.group_id,
        'group_name', addon_record.group_name, 'name', addon_record.name,
        'price_cents', addon_record.price_cents, 'quantity', addon_quantity
      ));
      resolved_total := resolved_total + addon_record.price_cents * addon_quantity;
    else
      select value into legacy_addon
      from public.products p, jsonb_array_elements(coalesce(p.addon_options,'[]'::jsonb))
      where p.id=requested_product_id and p.establishment_id=requested_establishment_id
        and value->>'name'=requested_addon->>'name'
      limit 1;
      if legacy_addon is null then raise exception 'Adicional inválido.'; end if;
      resolved_items := resolved_items || jsonb_build_array(jsonb_build_object(
        'name', legacy_addon->>'name',
        'price_cents', greatest(coalesce((legacy_addon->>'price_cents')::integer,0),0),
        'quantity', addon_quantity
      ));
      resolved_total := resolved_total
        + greatest(coalesce((legacy_addon->>'price_cents')::integer,0),0) * addon_quantity;
      legacy_addon := null;
    end if;
  end loop;

  for group_record in
    select ag.id, ag.name, ag.min_choices, ag.max_choices
    from public.product_addon_groups pag
    join public.addon_groups ag on ag.id=pag.addon_group_id
    where pag.establishment_id=requested_establishment_id
      and pag.product_id=requested_product_id and ag.active
  loop
    select coalesce(sum(
      case when coalesce(value->>'quantity','') ~ '^[0-9]+$'
        then least(greatest((value->>'quantity')::integer,1),999) else 1 end
    ),0)::integer into selected_count
    from jsonb_array_elements(requested_addons) selection
    join public.addons a on a.id=case
      when coalesce(selection.value->>'id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (selection.value->>'id')::uuid else null end
    where a.addon_group_id=group_record.id and a.active;
    if selected_count < group_record.min_choices then
      raise exception 'Escolha pelo menos % opção(ões) em %.', group_record.min_choices, group_record.name;
    end if;
    if selected_count > group_record.max_choices then
      raise exception 'Escolha no máximo % opção(ões) em %.', group_record.max_choices, group_record.name;
    end if;
  end loop;

  return jsonb_build_object('items', resolved_items, 'total_cents', resolved_total);
end $$;

revoke all on function private.resolve_public_order_addons(uuid,uuid,jsonb) from public;

create or replace function public.place_public_order(
  requested_slug text,buyer_name text,buyer_phone text,requested_fulfillment text,
  requested_items jsonb,order_notes text default null,requested_table_number text default null,
  requested_source text default 'direct',requested_payment text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  target_establishment uuid; target_table uuid; customer_record uuid; created_order uuid; created_number bigint; created_tracking_token uuid;
  normalized_buyer_name text:=btrim(regexp_replace(coalesce(buyer_name,''),'\s+',' ','g'));
  normalized_phone text:=regexp_replace(coalesce(buyer_phone,''),'\D','','g');
  normalized_table_label text:=upper(btrim(regexp_replace(coalesce(requested_table_number,''),'\s+',' ','g')));
  item jsonb; product_record record; item_quantity integer; subtotal integer:=0;
  item_addons jsonb; item_removed jsonb; item_note text; resolved_addons jsonb; addon_total integer;
  safe_source text:=case when requested_source='qr' then 'qr' else 'direct' end;
  table_service_allowed boolean:=false; pickup_allowed boolean:=false; takeaway_allowed boolean:=false;
  delivery_allowed boolean:=false; store_is_open boolean:=false; estimated integer:=45;
begin
  if char_length(normalized_buyer_name)<2 or char_length(normalized_buyer_name)>120 then raise exception 'Informe corretamente o nome.'; end if;
  if normalized_phone<>'' and char_length(normalized_phone)<10 then raise exception 'Confira o WhatsApp ou deixe o campo vazio.'; end if;
  if requested_fulfillment not in ('pickup','takeaway','delivery','dine_in') then raise exception 'Forma de atendimento inválida.'; end if;
  if requested_fulfillment='dine_in' and (normalized_buyer_name !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+' or char_length(normalized_table_label)<1 or char_length(normalized_table_label)>40) then
    raise exception 'Para consumir no local, informe nome e sobrenome e o número ou nome da mesa.';
  end if;
  if jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items)<1 or jsonb_array_length(requested_items)>50 then raise exception 'Itens do pedido inválidos.'; end if;
  select e.id,sm.table_service_enabled,sm.counter_pickup_enabled,sm.takeaway_enabled,sm.delivery_enabled,sm.store_open,s.estimated_minutes
  into target_establishment,table_service_allowed,pickup_allowed,takeaway_allowed,delivery_allowed,store_is_open,estimated
  from public.establishments e join public.establishment_settings s on s.establishment_id=e.id
  join public.service_modes sm on sm.establishment_id=e.id join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=requested_slug and e.active and (sub.status in ('active','trialing') or sub.current_period_end>now());
  if target_establishment is null then raise exception 'Estabelecimento indisponível.'; end if;
  if not store_is_open then raise exception 'A loja está fechada no momento.'; end if;
  if requested_fulfillment='dine_in' and not table_service_allowed then raise exception 'Consumo no local indisponível.'; end if;
  if requested_fulfillment='pickup' and not pickup_allowed then raise exception 'Retirada indisponível.'; end if;
  if requested_fulfillment='takeaway' and not takeaway_allowed then raise exception 'Pedido para viagem indisponível.'; end if;
  if requested_fulfillment='delivery' and not delivery_allowed then raise exception 'Entrega indisponível.'; end if;
  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity:=least(greatest(coalesce((item->>'quantity')::integer,1),1),999);
    select id,name,price_cents,ingredients into product_record from public.products
      where id=(item->>'product_id')::uuid and establishment_id=target_establishment and active;
    if product_record.id is null then raise exception 'Produto indisponível.'; end if;
    resolved_addons:=private.resolve_public_order_addons(target_establishment,product_record.id,coalesce(item->'addons','[]'::jsonb));
    subtotal:=subtotal+((product_record.price_cents+(resolved_addons->>'total_cents')::integer)*item_quantity);
  end loop;
  if requested_fulfillment='dine_in' then target_table:=private.resolve_operational_table(target_establishment,normalized_table_label); end if;
  if normalized_phone<>'' then
    insert into public.customers(establishment_id,name,phone,last_order_at) values(target_establishment,normalized_buyer_name,normalized_phone,now())
    on conflict(establishment_id,phone) do update set name=excluded.name,last_order_at=now() returning id into customer_record;
  end if;
  insert into public.orders(establishment_id,customer_id,fulfillment_type,customer_name,customer_phone,notes,subtotal_cents,total_cents,restaurant_table_id,source,payment_method)
  values(target_establishment,customer_record,requested_fulfillment,normalized_buyer_name,nullif(normalized_phone,''),nullif(btrim(order_notes),''),subtotal,subtotal,target_table,safe_source,nullif(btrim(requested_payment),''))
  returning id,order_number,tracking_token into created_order,created_number,created_tracking_token;
  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity:=least(greatest(coalesce((item->>'quantity')::integer,1),1),999);
    select id,name,price_cents,ingredients into product_record from public.products where id=(item->>'product_id')::uuid and establishment_id=target_establishment and active;
    resolved_addons:=private.resolve_public_order_addons(target_establishment,product_record.id,coalesce(item->'addons','[]'::jsonb));
    item_addons:=resolved_addons->'items'; addon_total:=(resolved_addons->>'total_cents')::integer;
    select coalesce(jsonb_agg(value),'[]'::jsonb) into item_removed from jsonb_array_elements(coalesce(item->'removed_ingredients','[]'::jsonb))
      where value in(select value from jsonb_array_elements(product_record.ingredients));
    item_note:=left(nullif(btrim(item->>'notes'),''),300);
    insert into public.order_items(establishment_id,order_id,product_id,product_name,quantity,unit_price_cents,addons,removed_ingredients,notes,total_cents)
    values(target_establishment,created_order,product_record.id,product_record.name,item_quantity,product_record.price_cents,item_addons,item_removed,item_note,(product_record.price_cents+addon_total)*item_quantity);
  end loop;
  insert into public.kitchen_tickets(establishment_id,public_order_id) values(target_establishment,created_order);
  if customer_record is not null then update public.customers set total_orders=total_orders+1,total_spent_cents=total_spent_cents+subtotal,last_order_at=now() where id=customer_record; end if;
  return jsonb_build_object('order_id',created_order,'order_number',created_number,'total_cents',subtotal,'table_number',nullif(normalized_table_label,''),'tracking_token',created_tracking_token,'estimated_minutes',estimated,'sent_to_kitchen',true);
end $$;

revoke all on function public.place_public_order(text,text,text,text,jsonb,text,text,text,text) from public;
grant execute on function public.place_public_order(text,text,text,text,jsonb,text,text,text,text) to anon,authenticated;
