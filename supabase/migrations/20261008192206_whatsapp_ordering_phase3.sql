-- MasterApp WhatsApp ordering - Phase 3
-- The conversational cart is tenant-scoped and the final transaction delegates
-- order creation to the existing place_public_order_v2 service.

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source in ('direct','qr','whatsapp'));

create table public.whatsapp_carts (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  status text not null default 'active' check (status in ('active','awaiting_information','awaiting_confirmation','converted','abandoned','expired')),
  state text not null default 'browsing' check (state in ('browsing','building_cart','selecting_variant','selecting_addons','asking_fulfillment','collecting_address','validating_delivery','selecting_payment','collecting_change','final_confirmation','creating_order','completed','human_support')),
  customer_name text not null default 'Cliente WhatsApp',
  customer_phone text not null,
  fulfillment_type text check (fulfillment_type in ('pickup','takeaway','delivery')),
  delivery_address jsonb,
  payment_method text,
  cash_received_cents integer check (cash_received_cents is null or cash_received_cents >= 0),
  coupon_code text,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  context jsonb not null default '{}'::jsonb,
  converted_order_id uuid references public.orders(id) on delete set null,
  confirmation_message_id uuid references public.whatsapp_messages(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_cart_items (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  cart_id uuid not null references public.whatsapp_carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  variation_id uuid references public.product_variations(id) on delete set null,
  quantity integer not null check (quantity between 1 and 999),
  selected_addons jsonb not null default '[]'::jsonb,
  removed_ingredients jsonb not null default '[]'::jsonb,
  notes text,
  product_name text not null,
  variation_name text,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_cart_events (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  cart_id uuid not null references public.whatsapp_carts(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  event_type text not null,
  from_state text,
  to_state text,
  success boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.whatsapp_order_links (
  order_id uuid primary key references public.orders(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  cart_id uuid not null unique references public.whatsapp_carts(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  wa_id text not null,
  created_at timestamptz not null default now()
);

create table public.whatsapp_order_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  wa_id text not null,
  order_status text not null,
  message_text text not null,
  delivery_token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id, order_status)
);

create unique index whatsapp_carts_one_open_conversation_idx
  on public.whatsapp_carts(conversation_id)
  where status in ('active','awaiting_information','awaiting_confirmation');
create unique index whatsapp_carts_confirmation_message_idx
  on public.whatsapp_carts(confirmation_message_id)
  where confirmation_message_id is not null;
create index whatsapp_carts_tenant_status_updated_idx on public.whatsapp_carts(establishment_id,status,updated_at desc);
create index whatsapp_carts_expiration_idx on public.whatsapp_carts(expires_at) where status in ('active','awaiting_information','awaiting_confirmation');
create index whatsapp_cart_items_cart_created_idx on public.whatsapp_cart_items(cart_id,created_at,id);
create index whatsapp_cart_events_cart_created_idx on public.whatsapp_cart_events(cart_id,created_at desc);
create index whatsapp_order_links_tenant_conversation_idx on public.whatsapp_order_links(establishment_id,conversation_id,created_at desc);
create index whatsapp_order_outbox_pending_idx on public.whatsapp_order_notification_outbox(created_at) where status in ('pending','failed');

alter table public.whatsapp_carts enable row level security;
alter table public.whatsapp_cart_items enable row level security;
alter table public.whatsapp_cart_events enable row level security;
alter table public.whatsapp_order_links enable row level security;
alter table public.whatsapp_order_notification_outbox enable row level security;

create policy whatsapp_carts_team_read on public.whatsapp_carts for select to authenticated
  using (private.has_role(establishment_id,array['owner','manager','attendant']::public.member_role[]));
create policy whatsapp_cart_items_team_read on public.whatsapp_cart_items for select to authenticated
  using (private.has_role(establishment_id,array['owner','manager','attendant']::public.member_role[]));

revoke all on public.whatsapp_carts,public.whatsapp_cart_items,public.whatsapp_cart_events,public.whatsapp_order_links,public.whatsapp_order_notification_outbox from public,anon,authenticated;
grant select on public.whatsapp_carts,public.whatsapp_cart_items to authenticated;
grant select,insert,update,delete on public.whatsapp_carts,public.whatsapp_cart_items,public.whatsapp_cart_events,public.whatsapp_order_links,public.whatsapp_order_notification_outbox to service_role;

create or replace function private.apply_whatsapp_order_context()
returns trigger language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
  context := nullif(current_setting('masterapp.whatsapp_order_context',true),'')::jsonb;
  if context is null then return new; end if;
  new.source := 'whatsapp';
  new.subtotal_cents := (context->>'subtotal_cents')::integer;
  new.discount_cents := (context->>'discount_cents')::integer;
  new.delivery_fee_cents := (context->>'delivery_fee_cents')::integer;
  new.total_cents := (context->>'total_cents')::integer;
  new.cash_received_cents := nullif(context->>'cash_received_cents','')::integer;
  new.cash_change_cents := nullif(context->>'cash_change_cents','')::integer;
  return new;
end $$;

create or replace function private.apply_whatsapp_item_context()
returns trigger language plpgsql security definer set search_path='' as $$
declare context jsonb; item_context jsonb; item_index integer;
begin
  context := nullif(current_setting('masterapp.whatsapp_order_context',true),'')::jsonb;
  if context is null then return new; end if;
  item_index := coalesce(nullif(current_setting('masterapp.whatsapp_item_index',true),'')::integer,0);
  item_context := context->'items'->item_index;
  perform set_config('masterapp.whatsapp_item_index',(item_index+1)::text,true);
  if item_context is null or (item_context->>'product_id')::uuid is distinct from new.product_id then
    raise exception 'Os itens do carrinho foram alterados durante a confirmação.';
  end if;
  new.unit_price_cents := new.unit_price_cents + coalesce((item_context->>'variation_delta_cents')::integer,0);
  new.total_cents := new.total_cents + coalesce((item_context->>'variation_delta_cents')::integer,0) * new.quantity;
  if nullif(item_context->>'variation_name','') is not null then
    new.product_name := new.product_name || ' · ' || (item_context->>'variation_name');
  end if;
  return new;
end $$;

drop trigger if exists aa_whatsapp_order_context on public.orders;
create trigger aa_whatsapp_order_context before insert on public.orders for each row execute function private.apply_whatsapp_order_context();
drop trigger if exists aa_whatsapp_item_context on public.order_items;
create trigger aa_whatsapp_item_context before insert on public.order_items for each row execute function private.apply_whatsapp_item_context();

create or replace function public.finalize_whatsapp_cart(requested_cart_id uuid, requested_confirmation_message_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cart public.whatsapp_carts%rowtype;
  line record;
  establishment_slug text;
  phone_id text;
  requested_items jsonb := '[]'::jsonb;
  item_contexts jsonb := '[]'::jsonb;
  resolved jsonb;
  variation_delta integer;
  variation_label text;
  subtotal integer := 0;
  discount integer := 0;
  fee integer := 0;
  final_total integer := 0;
  quote record;
  coupon public.coupons%rowtype;
  official_result jsonb;
  order_row public.orders%rowtype;
  context jsonb;
  wa_identifier text;
begin
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-cart:'||requested_cart_id::text,0));
  select * into cart from public.whatsapp_carts where id=requested_cart_id for update;
  if not found then raise exception 'Carrinho não encontrado.'; end if;
  if cart.converted_order_id is not null then
    select * into order_row from public.orders where id=cart.converted_order_id;
    return jsonb_build_object('order_id',order_row.id,'order_number',order_row.order_number,'tracking_token',order_row.tracking_token,'total_cents',order_row.total_cents,'idempotent',true);
  end if;
  if cart.expires_at<=now() then
    update public.whatsapp_carts set status='expired',updated_at=now() where id=cart.id;
    raise exception 'Este carrinho expirou. Envie “novo pedido” para recomeçar.';
  end if;
  if cart.state<>'final_confirmation' or cart.status<>'awaiting_confirmation' then raise exception 'O carrinho ainda não está pronto para confirmação.'; end if;
  if requested_confirmation_message_id is null then raise exception 'Confirmação inválida.'; end if;

  select e.slug,c.wa_id into establishment_slug,wa_identifier
  from public.establishments e join public.whatsapp_contacts c on c.id=cart.contact_id
  where e.id=cart.establishment_id and c.establishment_id=cart.establishment_id;
  select wc.phone_number_id into phone_id from public.whatsapp_connections wc where wc.id=cart.connection_id and wc.establishment_id=cart.establishment_id and wc.status='connected';
  if establishment_slug is null or phone_id is null then raise exception 'A conexão ou o estabelecimento está indisponível.'; end if;

  for line in
    select ci.*,p.price_cents,p.active product_active,v.name live_variation_name,v.price_delta_cents,v.active variation_active
    from public.whatsapp_cart_items ci
    join public.products p on p.id=ci.product_id and p.establishment_id=ci.establishment_id
    left join public.product_variations v on v.id=ci.variation_id and v.product_id=ci.product_id and v.establishment_id=ci.establishment_id
    where ci.cart_id=cart.id and ci.establishment_id=cart.establishment_id
    order by ci.created_at,ci.id
  loop
    if not line.product_active then raise exception 'O produto % não está mais disponível.',line.product_name; end if;
    if line.variation_id is not null and coalesce(line.variation_active,false)=false then raise exception 'A variação de % não está mais disponível.',line.product_name; end if;
    variation_delta := case when line.variation_id is null then 0 else line.price_delta_cents end;
    variation_label := case when line.variation_id is null then null else line.live_variation_name end;
    resolved := private.resolve_public_order_addons(cart.establishment_id,line.product_id,coalesce(line.selected_addons,'[]'::jsonb));
    subtotal := subtotal + (line.price_cents + variation_delta + (resolved->>'total_cents')::integer) * line.quantity;
    requested_items := requested_items || jsonb_build_array(jsonb_build_object('product_id',line.product_id,'quantity',line.quantity,'addons',line.selected_addons,'removed_ingredients',line.removed_ingredients,'notes',line.notes));
    item_contexts := item_contexts || jsonb_build_array(jsonb_build_object('product_id',line.product_id,'variation_name',variation_label,'variation_delta_cents',variation_delta));
  end loop;
  if jsonb_array_length(requested_items)=0 then raise exception 'O carrinho está vazio.'; end if;

  if cart.coupon_code is not null then
    select * into coupon from public.coupons where establishment_id=cart.establishment_id and upper(code)=upper(cart.coupon_code) for update;
    if not found or not coupon.active or (coupon.starts_at is not null and coupon.starts_at>now()) or (coupon.ends_at is not null and coupon.ends_at<now()) or (coupon.usage_limit is not null and coupon.uses_count>=coupon.usage_limit) or subtotal<coupon.minimum_order_cents then
      raise exception 'O cupom informado não é válido para este pedido.';
    end if;
    discount := least(subtotal,case when coupon.discount_type='percentage' then floor(subtotal*coupon.discount_value/100.0)::integer else coupon.discount_value end);
  end if;

  if cart.fulfillment_type='delivery' then
    select * into quote from private.resolve_public_delivery_quote(cart.establishment_id,cart.delivery_address->>'neighborhood',subtotal-discount);
    fee := quote.delivery_fee_cents;
  elsif cart.fulfillment_type not in ('pickup','takeaway') then
    raise exception 'Escolha entrega ou retirada.';
  end if;
  final_total := greatest(0,subtotal-discount)+fee;
  if cart.payment_method is null then raise exception 'Escolha a forma de pagamento.'; end if;
  if cart.payment_method='cash' and (cart.cash_received_cents is null or cart.cash_received_cents<final_total) then raise exception 'O valor em dinheiro deve cobrir o total do pedido.'; end if;

  context := jsonb_build_object('subtotal_cents',subtotal,'discount_cents',discount,'delivery_fee_cents',fee,'total_cents',final_total,'cash_received_cents',case when cart.payment_method='cash' then cart.cash_received_cents end,'cash_change_cents',case when cart.payment_method='cash' then cart.cash_received_cents-final_total end,'items',item_contexts);
  perform set_config('masterapp.whatsapp_order_context',context::text,true);
  perform set_config('masterapp.whatsapp_item_index','0',true);
  update public.whatsapp_carts set state='creating_order',updated_at=now() where id=cart.id;

  -- The official service validates the pre-discount amount before our transaction
  -- trigger applies the conversational cart totals. Use a harmless high internal
  -- value for that validation; the BEFORE INSERT trigger persists the real cash
  -- received and change values calculated above.
  official_result := public.place_public_order_v2(establishment_slug,cart.customer_name,cart.customer_phone,cart.fulfillment_type,requested_items,null,null,'direct',cart.payment_method,case when cart.payment_method='cash' then 2147483647 end,cart.delivery_address);
  perform set_config('masterapp.whatsapp_order_context','',true);
  perform set_config('masterapp.whatsapp_item_index','',true);
  select * into order_row from public.orders where id=(official_result->>'order_id')::uuid for update;
  if order_row.id is null then raise exception 'O pedido não pôde ser criado.'; end if;

  if order_row.customer_id is not null then
    update public.customers set total_spent_cents=total_spent_cents + (order_row.total_cents-(official_result->>'total_cents')::integer) where id=order_row.customer_id;
  end if;
  if coupon.id is not null then update public.coupons set uses_count=uses_count+1 where id=coupon.id; end if;

  update public.whatsapp_carts set status='converted',state='completed',confirmation_message_id=requested_confirmation_message_id,converted_order_id=order_row.id,subtotal_cents=subtotal,discount_cents=discount,delivery_fee_cents=fee,total_cents=final_total,updated_at=now() where id=cart.id;
  insert into public.whatsapp_order_links(order_id,establishment_id,cart_id,connection_id,conversation_id,contact_id,wa_id)
  values(order_row.id,cart.establishment_id,cart.id,cart.connection_id,cart.conversation_id,cart.contact_id,wa_identifier)
  on conflict(order_id) do nothing;
  insert into public.whatsapp_cart_events(establishment_id,cart_id,conversation_id,message_id,event_type,from_state,to_state,metadata)
  values(cart.establishment_id,cart.id,cart.conversation_id,requested_confirmation_message_id,'order_created','final_confirmation','completed',jsonb_build_object('order_id',order_row.id,'order_number',order_row.order_number,'source','whatsapp'));
  return jsonb_build_object('order_id',order_row.id,'order_number',order_row.order_number,'tracking_token',order_row.tracking_token,'subtotal_cents',subtotal,'discount_cents',discount,'delivery_fee_cents',fee,'total_cents',final_total,'cash_change_cents',order_row.cash_change_cents,'sent_to_kitchen',true,'source',order_row.source,'idempotent',false);
end $$;

revoke all on function public.finalize_whatsapp_cart(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_whatsapp_cart(uuid,uuid) to service_role;
revoke all on function private.apply_whatsapp_order_context(),private.apply_whatsapp_item_context() from public,anon,authenticated;

create or replace function private.enqueue_whatsapp_order_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare link public.whatsapp_order_links%rowtype; event_id uuid; token uuid; text_message text;
begin
  if old.status is not distinct from new.status then return new; end if;
  select * into link from public.whatsapp_order_links where order_id=new.id;
  if not found then return new; end if;
  text_message := case new.status::text
    when 'confirmed' then 'Seu pedido #'||new.order_number||' foi confirmado.'
    when 'preparing' then 'Seu pedido #'||new.order_number||' está em preparo.'
    when 'ready' then case when new.fulfillment_type='delivery' then 'Seu pedido #'||new.order_number||' está pronto e será encaminhado para entrega.' else 'Seu pedido #'||new.order_number||' está pronto para retirada.' end
    when 'out_for_delivery' then 'Seu pedido #'||new.order_number||' saiu para entrega.'
    when 'completed' then 'Pedido #'||new.order_number||' entregue e finalizado. Obrigado!'
    when 'canceled' then 'O pedido #'||new.order_number||' foi cancelado. Fale com a equipe se precisar de ajuda.'
    else null end;
  if text_message is null then return new; end if;
  insert into public.whatsapp_order_notification_outbox(establishment_id,order_id,connection_id,conversation_id,contact_id,wa_id,order_status,message_text)
  values(new.establishment_id,new.id,link.connection_id,link.conversation_id,link.contact_id,link.wa_id,new.status::text,text_message)
  on conflict(order_id,order_status) do nothing returning id,delivery_token into event_id,token;
  if event_id is not null then
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-whatsapp-order-update',headers:=jsonb_build_object('Content-Type','application/json'),body:=jsonb_build_object('event_id',event_id,'token',token),timeout_milliseconds:=5000);
  end if;
  return new;
end $$;

drop trigger if exists orders_whatsapp_status_update on public.orders;
create trigger orders_whatsapp_status_update after update of status on public.orders for each row execute function private.enqueue_whatsapp_order_update();
revoke all on function private.enqueue_whatsapp_order_update() from public,anon,authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='whatsapp_carts') then alter publication supabase_realtime add table public.whatsapp_carts; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='whatsapp_cart_items') then alter publication supabase_realtime add table public.whatsapp_cart_items; end if;
end $$;
