alter table public.service_modes
  add column if not exists takeaway_enabled boolean not null default true,
  add column if not exists store_open boolean not null default true;

alter table public.orders drop constraint if exists orders_fulfillment_type_check;
alter table public.orders add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('pickup','takeaway','delivery','dine_in'));

create or replace function private.enforce_public_service_mode()
returns trigger language plpgsql security definer set search_path=''
as $$
declare mode_record public.service_modes%rowtype;
begin
  select * into mode_record from public.service_modes where establishment_id=new.establishment_id;
  if mode_record.id is null then return new; end if;
  if not mode_record.store_open then raise exception 'A loja está fechada no momento.'; end if;
  if not mode_record.customer_self_order_enabled then raise exception 'Este estabelecimento recebe pedidos somente pela equipe.'; end if;
  if new.fulfillment_type='pickup' and not mode_record.counter_pickup_enabled then raise exception 'Retirada indisponível.'; end if;
  if new.fulfillment_type='takeaway' and not mode_record.takeaway_enabled then raise exception 'Pedido para viagem indisponível.'; end if;
  if new.fulfillment_type='delivery' and not mode_record.delivery_enabled then raise exception 'Entrega indisponível.'; end if;
  if new.fulfillment_type='dine_in' and not mode_record.table_service_enabled then raise exception 'Consumo no local indisponível.'; end if;
  return new;
end $$;

create or replace function public.update_service_mode(requested_establishment_id uuid, requested_config jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  actor uuid := auth.uid(); saved public.service_modes%rowtype; old_config jsonb;
  selected_mode text := coalesce(requested_config->>'mode','mixed');
begin
  if actor is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then
    raise exception 'Somente proprietário ou gerente pode alterar o atendimento.';
  end if;
  if selected_mode not in ('counter','delivery','waiter','mixed') then raise exception 'Modo inválido.'; end if;
  select to_jsonb(sm) into old_config from public.service_modes sm where establishment_id=requested_establishment_id;
  insert into public.service_modes(
    establishment_id,mode,waiter_mode_enabled,table_service_enabled,takeaway_enabled,counter_pickup_enabled,
    delivery_enabled,store_open,customer_self_order_enabled,waiter_call_enabled,bill_closing_enabled,
    card_proof_required,manual_active_waiters,accepted_payment_methods,
    manager_approval_for_discount,manager_approval_for_cancellation,audit_enabled
  ) values (
    requested_establishment_id,selected_mode,
    coalesce((requested_config->>'waiter_mode_enabled')::boolean,false),
    coalesce((requested_config->>'table_service_enabled')::boolean,false),
    coalesce((requested_config->>'takeaway_enabled')::boolean,true),
    coalesce((requested_config->>'counter_pickup_enabled')::boolean,false),
    coalesce((requested_config->>'delivery_enabled')::boolean,false),
    coalesce((requested_config->>'store_open')::boolean,true),
    coalesce((requested_config->>'customer_self_order_enabled')::boolean,false),
    coalesce((requested_config->>'waiter_call_enabled')::boolean,false),
    coalesce((requested_config->>'bill_closing_enabled')::boolean,false),
    coalesce((requested_config->>'card_proof_required')::boolean,false),
    nullif(requested_config->>'manual_active_waiters','')::integer,
    case when jsonb_typeof(requested_config->'accepted_payment_methods')='array' then requested_config->'accepted_payment_methods' else '[]'::jsonb end,
    coalesce((requested_config->>'manager_approval_for_discount')::boolean,true),
    coalesce((requested_config->>'manager_approval_for_cancellation')::boolean,true),
    coalesce((requested_config->>'audit_enabled')::boolean,true)
  ) on conflict(establishment_id) do update set
    mode=excluded.mode,waiter_mode_enabled=excluded.waiter_mode_enabled,table_service_enabled=excluded.table_service_enabled,
    takeaway_enabled=excluded.takeaway_enabled,counter_pickup_enabled=excluded.counter_pickup_enabled,
    delivery_enabled=excluded.delivery_enabled,store_open=excluded.store_open,
    customer_self_order_enabled=excluded.customer_self_order_enabled,waiter_call_enabled=excluded.waiter_call_enabled,
    bill_closing_enabled=excluded.bill_closing_enabled,card_proof_required=excluded.card_proof_required,
    manual_active_waiters=excluded.manual_active_waiters,accepted_payment_methods=excluded.accepted_payment_methods,
    manager_approval_for_discount=excluded.manager_approval_for_discount,
    manager_approval_for_cancellation=excluded.manager_approval_for_cancellation,
    audit_enabled=excluded.audit_enabled,updated_at=now()
  returning * into saved;
  update public.establishment_settings set pickup_enabled=saved.counter_pickup_enabled,
    delivery_enabled=saved.delivery_enabled,dine_in_enabled=saved.table_service_enabled,
    waiter_calls_enabled=saved.waiter_call_enabled where establishment_id=requested_establishment_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,actor,'service_mode.updated','service_modes',saved.id,
    jsonb_build_object('old',old_config-'id'-'establishment_id','new',to_jsonb(saved)-'id'-'establishment_id'));
  return to_jsonb(saved);
end $$;

create or replace function public.get_public_service_mode(requested_slug text)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'mode',sm.mode,'waiter_mode_enabled',sm.waiter_mode_enabled,
    'table_service_enabled',sm.table_service_enabled,'takeaway_enabled',sm.takeaway_enabled,
    'counter_pickup_enabled',sm.counter_pickup_enabled,'delivery_enabled',sm.delivery_enabled,
    'store_open',sm.store_open,'customer_self_order_enabled',sm.customer_self_order_enabled,
    'waiter_call_enabled',sm.waiter_call_enabled,'bill_closing_enabled',sm.bill_closing_enabled,
    'accepted_payment_methods',sm.accepted_payment_methods,
    'active_waiters',coalesce(sm.manual_active_waiters,(
      select count(*) from public.waiters w where w.establishment_id=e.id and w.active_now
        and w.status in ('active','serving') and (w.employment_type='fixed' or w.work_date=(now() at time zone 'America/Sao_Paulo')::date)
    ))
  ) from public.establishments e join public.service_modes sm on sm.establishment_id=e.id
  where e.slug=requested_slug and e.active
$$;

create or replace function public.set_store_open(requested_establishment_id uuid, requested_open boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); saved public.service_modes%rowtype;
begin
  if actor is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then
    raise exception 'Somente proprietário ou gerente pode abrir ou fechar a loja.';
  end if;
  insert into public.service_modes(establishment_id,store_open) values(requested_establishment_id,requested_open)
  on conflict(establishment_id) do update set store_open=excluded.store_open,updated_at=now()
  returning * into saved;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,actor,case when requested_open then 'store.opened' else 'store.closed' end,
    'service_modes',saved.id,jsonb_build_object('store_open',requested_open));
  return to_jsonb(saved);
end $$;

revoke all on function public.set_store_open(uuid,boolean) from public;
grant execute on function public.set_store_open(uuid,boolean) to authenticated;

drop function if exists public.place_public_order(text,text,text,text,jsonb,text,text,text,text);
create function public.place_public_order(
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
  item_addons jsonb; item_removed jsonb; item_note text; addon jsonb; addon_config jsonb; addon_total integer;
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
    select id,name,price_cents,ingredients,addon_options into product_record from public.products
      where id=(item->>'product_id')::uuid and establishment_id=target_establishment and active;
    if product_record.id is null then raise exception 'Produto indisponível.'; end if;
    addon_total:=0;
    for addon in select value from jsonb_array_elements(coalesce(item->'addons','[]'::jsonb)) loop
      select value into addon_config from jsonb_array_elements(product_record.addon_options) where value->>'name'=addon->>'name' limit 1;
      if addon_config is null then raise exception 'Adicional inválido.'; end if;
      addon_total:=addon_total+greatest(coalesce((addon_config->>'price_cents')::integer,0),0)*least(greatest(coalesce((addon->>'quantity')::integer,1),1),999);
      addon_config:=null;
    end loop;
    subtotal:=subtotal+((product_record.price_cents+addon_total)*item_quantity);
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
    select id,name,price_cents,ingredients,addon_options into product_record from public.products where id=(item->>'product_id')::uuid and establishment_id=target_establishment and active;
    item_addons:='[]'::jsonb; addon_total:=0;
    for addon in select value from jsonb_array_elements(coalesce(item->'addons','[]'::jsonb)) loop
      select value into addon_config from jsonb_array_elements(product_record.addon_options) where value->>'name'=addon->>'name' limit 1;
      item_addons:=item_addons||jsonb_build_array(jsonb_build_object('name',addon_config->>'name','price_cents',greatest(coalesce((addon_config->>'price_cents')::integer,0),0),'quantity',least(greatest(coalesce((addon->>'quantity')::integer,1),1),999)));
      addon_total:=addon_total+greatest(coalesce((addon_config->>'price_cents')::integer,0),0)*least(greatest(coalesce((addon->>'quantity')::integer,1),1),999); addon_config:=null;
    end loop;
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
