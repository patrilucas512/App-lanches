alter table public.products
  add column if not exists ingredients jsonb not null default '[]'::jsonb,
  add column if not exists addon_options jsonb not null default '[]'::jsonb;

alter table public.order_items
  add column if not exists removed_ingredients jsonb not null default '[]'::jsonb,
  add column if not exists notes text;

alter table public.service_modes
  add column if not exists auto_print_kitchen boolean not null default false;

alter table public.kitchen_tickets
  alter column table_order_id drop not null,
  add column if not exists public_order_id uuid references public.orders(id) on delete cascade;

create unique index if not exists kitchen_tickets_public_order_id_key
  on public.kitchen_tickets(public_order_id) where public_order_id is not null;
create index if not exists kitchen_tickets_establishment_status_created_idx
  on public.kitchen_tickets(establishment_id, status, created_at);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

alter table public.kitchen_tickets drop constraint if exists kitchen_ticket_single_source;
alter table public.kitchen_tickets add constraint kitchen_ticket_single_source
  check (num_nonnulls(table_order_id, public_order_id) = 1);

create or replace function public.get_public_menu(requested_slug text)
returns jsonb
language sql stable security definer set search_path = ''
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
    'banners', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'image_url', b.image_url, 'link_url', b.link_url) order by b.sort_order, b.created_at)
      from public.banners b where b.establishment_id=e.id and b.active and (b.starts_at is null or b.starts_at<=now()) and (b.ends_at is null or b.ends_at>=now())), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'description', c.description,
      'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'image_url', p.image_url,
        'price_cents', p.price_cents, 'compare_at_price_cents', p.compare_at_price_cents,
        'featured', p.featured, 'ingredients', p.ingredients, 'addon_options', p.addon_options
      ) order by p.sort_order, p.name) from public.products p
      where p.establishment_id=e.id and p.category_id=c.id and p.active), '[]'::jsonb)
    ) order by c.sort_order, c.name) from public.categories c where c.establishment_id=e.id and c.active), '[]'::jsonb)
  )
  from public.establishments e
  join public.establishment_settings s on s.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=requested_slug and e.active and e.onboarding_completed
    and (sub.status in ('active','trialing') or sub.current_period_end>now())
$$;

drop function if exists public.place_public_order(text,text,text,text,jsonb,text,text,text);
create function public.place_public_order(
  requested_slug text, buyer_name text, buyer_phone text, requested_fulfillment text,
  requested_items jsonb, order_notes text default null, requested_table_number text default null,
  requested_source text default 'direct', requested_payment text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  target_establishment uuid; target_table uuid; customer_record uuid; created_order uuid; created_number bigint;
  normalized_buyer_name text := btrim(regexp_replace(coalesce(buyer_name,''), '\s+', ' ', 'g'));
  normalized_table_label text := upper(btrim(regexp_replace(coalesce(requested_table_number,''), '\s+', ' ', 'g')));
  item jsonb; product_record record; item_quantity integer; subtotal integer := 0; minimum_total integer := 0;
  item_addons jsonb; item_removed jsonb; item_note text; addon jsonb; addon_config jsonb; addon_total integer;
  safe_source text := case when requested_source='qr' then 'qr' else 'direct' end;
begin
  if char_length(normalized_buyer_name)<2 or char_length(normalized_buyer_name)>120 or char_length(regexp_replace(buyer_phone,'\D','','g'))<8 then
    raise exception 'Informe corretamente o nome e o WhatsApp.';
  end if;
  if requested_fulfillment not in ('pickup','delivery','dine_in') then raise exception 'Forma de recebimento inválida.'; end if;
  if requested_fulfillment='dine_in' and (normalized_buyer_name !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+' or char_length(normalized_table_label)<1 or char_length(normalized_table_label)>40) then
    raise exception 'Para consumir no local, informe nome e sobrenome e o número ou nome da mesa.';
  end if;
  if jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items)<1 or jsonb_array_length(requested_items)>50 then raise exception 'Itens do pedido inválidos.'; end if;

  select e.id,s.minimum_order_cents into target_establishment,minimum_total
  from public.establishments e join public.establishment_settings s on s.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=requested_slug and e.active and (sub.status in ('active','trialing') or sub.current_period_end>now());
  if target_establishment is null then raise exception 'Estabelecimento indisponível.'; end if;

  for item in select value from jsonb_array_elements(requested_items) loop
    item_quantity := least(greatest(coalesce((item->>'quantity')::integer,1),1),20);
    select id,name,price_cents,ingredients,addon_options into product_record from public.products
      where id=(item->>'product_id')::uuid and establishment_id=target_establishment and active;
    if product_record.id is null then raise exception 'Produto indisponível.'; end if;
    addon_total := 0;
    for addon in select value from jsonb_array_elements(coalesce(item->'addons','[]'::jsonb)) loop
      select value into addon_config from jsonb_array_elements(product_record.addon_options) where value->>'name'=addon->>'name' limit 1;
      if addon_config is null then raise exception 'Adicional inválido.'; end if;
      addon_total := addon_total + greatest(coalesce((addon_config->>'price_cents')::integer,0),0);
      addon_config := null;
    end loop;
    subtotal := subtotal + ((product_record.price_cents + addon_total) * item_quantity);
  end loop;
  if subtotal<minimum_total then raise exception 'O pedido não atingiu o valor mínimo.'; end if;
  if requested_fulfillment='dine_in' then target_table := private.resolve_operational_table(target_establishment,normalized_table_label); end if;

  insert into public.customers(establishment_id,name,phone,last_order_at) values(target_establishment,normalized_buyer_name,btrim(buyer_phone),now())
  on conflict(establishment_id,phone) do update set name=excluded.name,last_order_at=now() returning id into customer_record;
  insert into public.orders(establishment_id,customer_id,fulfillment_type,customer_name,customer_phone,notes,subtotal_cents,total_cents,restaurant_table_id,source,payment_method)
  values(target_establishment,customer_record,requested_fulfillment,normalized_buyer_name,btrim(buyer_phone),nullif(btrim(order_notes),''),subtotal,subtotal,target_table,safe_source,nullif(btrim(requested_payment),''))
  returning id,order_number into created_order,created_number;

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
  update public.customers set total_orders=total_orders+1,total_spent_cents=total_spent_cents+subtotal,last_order_at=now() where id=customer_record;
  return jsonb_build_object('order_id',created_order,'order_number',created_number,'total_cents',subtotal,'table_number',nullif(normalized_table_label,''),'sent_to_kitchen',true);
end $$;

create or replace function public.create_waiter_call(requested_slug text, requested_table_number text, requested_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare target_establishment uuid; target_table uuid; existing_call record; created_call uuid; normalized_label text;
begin
  normalized_label := upper(btrim(regexp_replace(coalesce(requested_table_number,''), '\s+', ' ', 'g')));
  if char_length(normalized_label)<1 or char_length(normalized_label)>40 then raise exception 'Informe o número ou nome da mesa.'; end if;
  select e.id into target_establishment from public.establishments e
  join public.service_modes sm on sm.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=requested_slug and e.active and e.onboarding_completed and sm.waiter_call_enabled
    and (sub.status in ('active','trialing') or sub.current_period_end>now());
  if target_establishment is null then raise exception 'Chamada de garçom indisponível.'; end if;
  target_table := private.resolve_operational_table(target_establishment,normalized_label);
  if char_length(coalesce(requested_note,''))>300 then raise exception 'Observação muito longa.'; end if;
  select wc.id,wc.created_at into existing_call from public.waiter_calls wc where wc.establishment_id=target_establishment and wc.table_id=target_table and wc.status='waiting' and wc.created_at>now()-interval '2 minutes' order by wc.created_at desc limit 1;
  if existing_call.id is not null then return jsonb_build_object('id',existing_call.id,'created_at',existing_call.created_at,'duplicate',true); end if;
  insert into public.waiter_calls(establishment_id,table_id,customer_note) values(target_establishment,target_table,nullif(btrim(requested_note),'')) returning id into created_call;
  return jsonb_build_object('id',created_call,'created_at',now(),'duplicate',false,'table_number',normalized_label);
end $$;

create or replace function public.update_kitchen_ticket(requested_ticket_id uuid, requested_status public.kitchen_ticket_status)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare target_ticket public.kitchen_tickets%rowtype; target_order public.table_orders%rowtype; target_session public.table_sessions%rowtype; waiter_record public.waiters%rowtype; actor uuid:=auth.uid(); actor_name text;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  select * into target_ticket from public.kitchen_tickets where id=requested_ticket_id for update;
  if not found or not private.has_role(target_ticket.establishment_id,array['owner','manager','attendant']::public.member_role[]) then raise exception 'Comanda não encontrada.'; end if;
  select * into waiter_record from public.waiters where establishment_id=target_ticket.establishment_id and user_id=actor;
  select coalesce(nullif(btrim(waiter_record.name),''),nullif(btrim(p.full_name),''),'Equipe') into actor_name from public.profiles p where p.id=actor;
  actor_name:=coalesce(actor_name,nullif(btrim(waiter_record.name),''),'Equipe');
  if requested_status='canceled' then
    if not private.has_role(target_ticket.establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente proprietário ou gerente pode cancelar.'; end if;
  elsif not ((target_ticket.status='received' and requested_status='preparing') or (target_ticket.status='preparing' and requested_status='ready') or (target_ticket.status='ready' and requested_status='delivered')) then raise exception 'Mudança de status inválida.'; end if;
  update public.kitchen_tickets set status=requested_status,
    started_at=case when requested_status='preparing' then now() else started_at end,
    ready_at=case when requested_status='ready' then now() else ready_at end,
    delivered_at=case when requested_status='delivered' then now() else delivered_at end,
    delivered_by=case when requested_status='delivered' then actor else delivered_by end,
    delivered_by_name=case when requested_status='delivered' then actor_name else delivered_by_name end,updated_at=now()
  where id=requested_ticket_id returning * into target_ticket;
  if target_ticket.public_order_id is not null then
    update public.orders set status=(case requested_status when 'received' then 'new' when 'preparing' then 'preparing' when 'ready' then 'ready' when 'delivered' then 'completed' else 'canceled' end)::public.order_status,updated_at=now() where id=target_ticket.public_order_id;
  else
    update public.table_orders set kitchen_status=requested_status,updated_at=now() where id=target_ticket.table_order_id returning * into target_order;
    select * into target_session from public.table_sessions where id=target_order.table_session_id;
    update public.restaurant_tables set status=case requested_status when 'preparing' then 'preparing'::public.restaurant_table_status when 'ready' then 'ready'::public.restaurant_table_status else 'occupied'::public.restaurant_table_status end,updated_at=now()
      where id=target_session.table_id and status not in ('awaiting_payment','paid','blocked');
  end if;
  return to_jsonb(target_ticket);
end $$;

revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon,authenticated;
revoke all on function public.place_public_order(text,text,text,text,jsonb,text,text,text,text) from public;
grant execute on function public.place_public_order(text,text,text,text,jsonb,text,text,text,text) to anon,authenticated;
revoke all on function public.create_waiter_call(text,text,text) from public;
grant execute on function public.create_waiter_call(text,text,text) to anon,authenticated;
revoke all on function public.update_kitchen_ticket(uuid,public.kitchen_ticket_status) from public,anon;
grant execute on function public.update_kitchen_ticket(uuid,public.kitchen_ticket_status) to authenticated;
