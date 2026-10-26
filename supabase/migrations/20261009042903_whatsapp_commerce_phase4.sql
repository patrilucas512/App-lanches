-- MasterApp WhatsApp commerce - Phase 4
-- Reuses official orders, payment gateway accounts and payment transactions.

create extension if not exists pg_cron with schema pg_catalog;

alter table public.whatsapp_connections
  add column if not exists cart_recovery_enabled boolean not null default false,
  add column if not exists cart_recovery_delay_minutes integer not null default 30,
  add column if not exists upsell_enabled boolean not null default true,
  add column if not exists pix_expiration_minutes integer not null default 30,
  add column if not exists notify_payment_confirmed boolean not null default true,
  add column if not exists notify_order_preparing boolean not null default true,
  add column if not exists notify_order_ready boolean not null default true,
  add column if not exists notify_order_out_for_delivery boolean not null default true,
  add column if not exists notify_order_delivered boolean not null default true;

alter table public.whatsapp_connections drop constraint if exists whatsapp_connections_cart_recovery_delay_check;
alter table public.whatsapp_connections add constraint whatsapp_connections_cart_recovery_delay_check
  check (cart_recovery_delay_minutes between 15 and 1440);
alter table public.whatsapp_connections drop constraint if exists whatsapp_connections_pix_expiration_check;
alter table public.whatsapp_connections add constraint whatsapp_connections_pix_expiration_check
  check (pix_expiration_minutes between 30 and 1440);

alter table public.whatsapp_contacts
  add column if not exists marketing_opt_out boolean not null default false,
  add column if not exists blocked_at timestamptz;

alter table public.whatsapp_carts
  add column if not exists recovery_sent_at timestamptz,
  add column if not exists recovered_at timestamptz,
  add column if not exists upsell_offer_count integer not null default 0,
  add column if not exists upsell_accepted_count integer not null default 0;

alter table public.whatsapp_carts drop constraint if exists whatsapp_carts_state_check;
alter table public.whatsapp_carts add constraint whatsapp_carts_state_check check (state in
  ('browsing','building_cart','selecting_variant','selecting_addons','asking_fulfillment',
   'collecting_address','validating_delivery','selecting_payment','collecting_change',
   'collecting_pix_payer','final_confirmation','creating_order','completed','human_support'));

alter table public.order_payment_transactions add column if not exists expires_at timestamptz;
alter table public.order_payment_transactions drop constraint if exists order_payment_transactions_status_check;
alter table public.order_payment_transactions add constraint order_payment_transactions_status_check
  check (status in ('pending','approved','declined','canceled','refunded','expired','error'));
alter table public.orders drop constraint if exists orders_online_payment_status_check;
alter table public.orders add constraint orders_online_payment_status_check
  check (online_payment_status is null or online_payment_status in
    ('pending','approved','declined','canceled','refunded','expired'));

create table public.whatsapp_commerce_outbox (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  cart_id uuid references public.whatsapp_carts(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  wa_id text not null,
  event_key text not null,
  event_type text not null check (event_type in ('cart_recovery','payment_approved','payment_expired')),
  message_text text not null,
  delivery_token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id,event_key),
  check (cart_id is not null or order_id is not null)
);
create index whatsapp_commerce_outbox_dispatch_idx on public.whatsapp_commerce_outbox(next_attempt_at,created_at)
  where status in ('pending','failed');
create index whatsapp_carts_recovery_idx on public.whatsapp_carts(establishment_id,updated_at)
  where status in ('active','awaiting_information','awaiting_confirmation') and recovery_sent_at is null;

alter table public.whatsapp_commerce_outbox enable row level security;
revoke all on public.whatsapp_commerce_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_commerce_outbox to service_role;

create or replace function public.configure_whatsapp_commerce(
  requested_establishment_id uuid,
  requested_recovery_enabled boolean,
  requested_recovery_delay_minutes integer,
  requested_upsell_enabled boolean,
  requested_pix_expiration_minutes integer,
  requested_notify_payment boolean,
  requested_notify_preparing boolean,
  requested_notify_ready boolean,
  requested_notify_out_for_delivery boolean,
  requested_notify_delivered boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.whatsapp_connections%rowtype;
begin
  if auth.uid() is null or not private.has_whatsapp_permission(requested_establishment_id,'configure') then
    raise exception 'Sem permissão para configurar automações comerciais.';
  end if;
  if requested_recovery_delay_minutes not between 15 and 1440 then raise exception 'Tempo de recuperação inválido.'; end if;
  if requested_pix_expiration_minutes not between 30 and 1440 then raise exception 'Expiração do Pix inválida.'; end if;
  update public.whatsapp_connections set
    cart_recovery_enabled=requested_recovery_enabled,
    cart_recovery_delay_minutes=requested_recovery_delay_minutes,
    upsell_enabled=requested_upsell_enabled,
    pix_expiration_minutes=requested_pix_expiration_minutes,
    notify_payment_confirmed=requested_notify_payment,
    notify_order_preparing=requested_notify_preparing,
    notify_order_ready=requested_notify_ready,
    notify_order_out_for_delivery=requested_notify_out_for_delivery,
    notify_order_delivered=requested_notify_delivered,
    updated_at=now()
  where establishment_id=requested_establishment_id returning * into saved;
  if saved.id is null then raise exception 'Conexão do WhatsApp não encontrada.'; end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,auth.uid(),'whatsapp.commerce_configured','whatsapp_connection',saved.id,
    jsonb_build_object('recovery_enabled',saved.cart_recovery_enabled,'recovery_delay_minutes',saved.cart_recovery_delay_minutes,
      'upsell_enabled',saved.upsell_enabled,'pix_expiration_minutes',saved.pix_expiration_minutes));
  return jsonb_build_object(
    'cart_recovery_enabled',saved.cart_recovery_enabled,'cart_recovery_delay_minutes',saved.cart_recovery_delay_minutes,
    'upsell_enabled',saved.upsell_enabled,'pix_expiration_minutes',saved.pix_expiration_minutes,
    'notify_payment_confirmed',saved.notify_payment_confirmed,'notify_order_preparing',saved.notify_order_preparing,
    'notify_order_ready',saved.notify_order_ready,'notify_order_out_for_delivery',saved.notify_order_out_for_delivery,
    'notify_order_delivered',saved.notify_order_delivered);
end $$;
revoke all on function public.configure_whatsapp_commerce(uuid,boolean,integer,boolean,integer,boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.configure_whatsapp_commerce(uuid,boolean,integer,boolean,integer,boolean,boolean,boolean,boolean,boolean) to authenticated;

create or replace function public.get_whatsapp_commerce_metrics(requested_establishment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz := date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if auth.uid() is null or not private.has_whatsapp_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para visualizar métricas.'; end if;
  return jsonb_build_object(
    'conversations_today',(select count(*) from public.whatsapp_conversations where establishment_id=requested_establishment_id and last_message_at>=start_at),
    'orders_today',(select count(*) from public.orders where establishment_id=requested_establishment_id and source='whatsapp' and created_at>=start_at),
    'paid_orders_today',(select count(*) from public.orders where establishment_id=requested_establishment_id and source='whatsapp' and online_payment_status='approved' and paid_at>=start_at),
    'revenue_today_cents',(select coalesce(sum(total_cents),0) from public.orders where establishment_id=requested_establishment_id and source='whatsapp' and created_at>=start_at and status::text<>'canceled'),
    'recovered_carts_today',(select count(*) from public.whatsapp_carts where establishment_id=requested_establishment_id and recovered_at>=start_at),
    'upsells_accepted_today',(select coalesce(sum(upsell_accepted_count),0) from public.whatsapp_carts where establishment_id=requested_establishment_id and updated_at>=start_at));
end $$;
revoke all on function public.get_whatsapp_commerce_metrics(uuid) from public,anon,authenticated;
grant execute on function public.get_whatsapp_commerce_metrics(uuid) to authenticated;

create or replace function private.dispatch_whatsapp_commerce_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform net.http_post(
    url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-whatsapp-commerce-event',
    headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('event_id',new.id,'token',new.delivery_token),
    timeout_milliseconds:=5000);
  return new;
end $$;
revoke all on function private.dispatch_whatsapp_commerce_event() from public,anon,authenticated;
create trigger whatsapp_commerce_outbox_dispatch after insert on public.whatsapp_commerce_outbox
for each row execute function private.dispatch_whatsapp_commerce_event();

create or replace function private.enqueue_whatsapp_payment_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare link public.whatsapp_order_links%rowtype; connection public.whatsapp_connections%rowtype; event_type text; text_message text;
begin
  if old.online_payment_status is not distinct from new.online_payment_status then return new; end if;
  if new.online_payment_status not in ('approved','expired') then return new; end if;
  select * into link from public.whatsapp_order_links where order_id=new.id;
  if not found then return new; end if;
  select * into connection from public.whatsapp_connections where id=link.connection_id and establishment_id=new.establishment_id;
  if new.online_payment_status='approved' then
    if not connection.notify_payment_confirmed then return new; end if;
    event_type:='payment_approved'; text_message:='Pagamento confirmado ✅'||chr(10)||chr(10)||'Seu pedido #'||new.order_number||' já está seguindo para preparo.';
  else
    event_type:='payment_expired'; text_message:='O Pix do pedido #'||new.order_number||' expirou e não foi marcado como pago. Abra o acompanhamento para gerar uma nova cobrança ou fale com a equipe.';
  end if;
  insert into public.whatsapp_commerce_outbox(establishment_id,connection_id,conversation_id,contact_id,order_id,wa_id,event_key,event_type,message_text)
  values(new.establishment_id,link.connection_id,link.conversation_id,link.contact_id,new.id,link.wa_id,
    'payment:'||new.id||':'||new.online_payment_status,event_type,text_message)
  on conflict(establishment_id,event_key) do nothing;
  return new;
end $$;
revoke all on function private.enqueue_whatsapp_payment_update() from public,anon,authenticated;
drop trigger if exists orders_whatsapp_payment_update on public.orders;
create trigger orders_whatsapp_payment_update after update of online_payment_status on public.orders
for each row execute function private.enqueue_whatsapp_payment_update();

create or replace function private.enqueue_whatsapp_order_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare link public.whatsapp_order_links%rowtype; connection public.whatsapp_connections%rowtype; event_id uuid; token uuid; text_message text; enabled boolean;
begin
  if old.status is not distinct from new.status then return new; end if;
  select * into link from public.whatsapp_order_links where order_id=new.id;
  if not found then return new; end if;
  select * into connection from public.whatsapp_connections where id=link.connection_id and establishment_id=new.establishment_id;
  text_message := case new.status::text
    when 'confirmed' then 'Seu pedido #'||new.order_number||' foi confirmado.'
    when 'preparing' then 'Seu pedido #'||new.order_number||' está em preparo.'
    when 'ready' then case when new.fulfillment_type='delivery' then 'Seu pedido #'||new.order_number||' está pronto e será encaminhado para entrega.' else 'Seu pedido #'||new.order_number||' está pronto para retirada.' end
    when 'out_for_delivery' then 'Seu pedido #'||new.order_number||' saiu para entrega.'
    when 'completed' then 'Pedido #'||new.order_number||' entregue e finalizado. Obrigado!'
    when 'canceled' then 'O pedido #'||new.order_number||' foi cancelado. Fale com a equipe se precisar de ajuda.'
    else null end;
  enabled := case new.status::text
    when 'preparing' then connection.notify_order_preparing
    when 'ready' then connection.notify_order_ready
    when 'out_for_delivery' then connection.notify_order_out_for_delivery
    when 'completed' then connection.notify_order_delivered
    else true end;
  if text_message is null or not coalesce(enabled,false) then return new; end if;
  insert into public.whatsapp_order_notification_outbox(establishment_id,order_id,connection_id,conversation_id,contact_id,wa_id,order_status,message_text)
  values(new.establishment_id,new.id,link.connection_id,link.conversation_id,link.contact_id,link.wa_id,new.status::text,text_message)
  on conflict(order_id,order_status) do nothing returning id,delivery_token into event_id,token;
  if event_id is not null then
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-whatsapp-order-update',headers:=jsonb_build_object('Content-Type','application/json'),body:=jsonb_build_object('event_id',event_id,'token',token),timeout_milliseconds:=5000);
  end if;
  return new;
end $$;
revoke all on function private.enqueue_whatsapp_order_update() from public,anon,authenticated;

create or replace function private.run_whatsapp_commerce_jobs()
returns jsonb language plpgsql security definer set search_path='' as $$
declare row record; recovery_count integer:=0; retry_count integer:=0; expired_count integer:=0;
begin
  update public.order_payment_transactions t set status='expired',raw_status='expired',updated_at=now()
  from public.orders o where o.id=t.order_id and o.source='whatsapp' and t.payment_kind='pix' and t.status='pending' and t.expires_at<=now();
  get diagnostics expired_count=row_count;
  update public.orders o set online_payment_status='expired',updated_at=now()
  where o.source='whatsapp' and o.online_payment_status='pending' and exists(
    select 1 from public.order_payment_transactions t where t.order_id=o.id and t.status='expired');

  for row in
    select c.*,co.wa_id from public.whatsapp_carts c
    join public.whatsapp_connections wc on wc.id=c.connection_id and wc.establishment_id=c.establishment_id
    join public.whatsapp_conversations cv on cv.id=c.conversation_id and cv.establishment_id=c.establishment_id
    join public.whatsapp_contacts co on co.id=c.contact_id and co.establishment_id=c.establishment_id
    where wc.status='connected' and wc.cart_recovery_enabled and not cv.human_controlled and cv.status<>'resolved'
      and not co.marketing_opt_out and co.blocked_at is null
      and c.status in ('active','awaiting_information','awaiting_confirmation') and c.recovery_sent_at is null
      and c.updated_at<=now()-make_interval(mins=>wc.cart_recovery_delay_minutes)
      and c.expires_at>now() and exists(select 1 from public.whatsapp_cart_items ci where ci.cart_id=c.id)
      and exists(select 1 from public.whatsapp_messages m where m.conversation_id=c.conversation_id and m.direction='inbound' and m.message_timestamp>=now()-interval '24 hours')
    for update of c skip locked
  loop
    insert into public.whatsapp_commerce_outbox(establishment_id,connection_id,conversation_id,contact_id,cart_id,wa_id,event_key,event_type,message_text)
    values(row.establishment_id,row.connection_id,row.conversation_id,row.contact_id,row.id,row.wa_id,
      'cart-recovery:'||row.id,'cart_recovery','Oi! Seu carrinho ainda está salvo 😊'||chr(10)||chr(10)||'Quer continuar de onde parou?')
    on conflict(establishment_id,event_key) do nothing;
    update public.whatsapp_carts set recovery_sent_at=now() where id=row.id and recovery_sent_at is null;
    recovery_count:=recovery_count+1;
  end loop;

  for row in select * from public.whatsapp_commerce_outbox
    where status='failed' and attempts<3 and next_attempt_at<=now() order by next_attempt_at for update skip locked
  loop
    update public.whatsapp_commerce_outbox set status='pending',updated_at=now() where id=row.id;
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-whatsapp-commerce-event',headers:=jsonb_build_object('Content-Type','application/json'),body:=jsonb_build_object('event_id',row.id,'token',row.delivery_token),timeout_milliseconds:=5000);
    retry_count:=retry_count+1;
  end loop;
  return jsonb_build_object('recoveries',recovery_count,'retries',retry_count,'expired_payments',expired_count);
end $$;
revoke all on function private.run_whatsapp_commerce_jobs() from public,anon,authenticated;

do $$
declare existing bigint;
begin
  select jobid into existing from cron.job where jobname='masterapp-whatsapp-commerce';
  if existing is not null then perform cron.unschedule(existing); end if;
  perform cron.schedule('masterapp-whatsapp-commerce','*/5 * * * *','select private.run_whatsapp_commerce_jobs()');
end $$;
