-- Recover both provider failures and dispatches that never reached the Edge Function.
create or replace function private.run_whatsapp_commerce_jobs()
returns jsonb language plpgsql security definer set search_path='' as $$
declare row record; recovery_count integer:=0; retry_count integer:=0; expired_count integer:=0;
begin
  update public.order_payment_transactions t set status='expired',raw_status='expired',updated_at=now()
  from public.orders o where o.id=t.order_id and o.source='whatsapp' and t.payment_kind='pix' and t.status='pending' and t.expires_at<=now();
  get diagnostics expired_count=row_count;
  update public.orders o set online_payment_status='expired',updated_at=now()
  where o.source='whatsapp' and o.online_payment_status='pending' and exists(select 1 from public.order_payment_transactions t where t.order_id=o.id and t.status='expired');

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
    values(row.establishment_id,row.connection_id,row.conversation_id,row.contact_id,row.id,row.wa_id,'cart-recovery:'||row.id,'cart_recovery','Oi! Seu carrinho ainda está salvo 😊'||chr(10)||chr(10)||'Quer continuar de onde parou?')
    on conflict(establishment_id,event_key) do nothing;
    update public.whatsapp_carts set recovery_sent_at=now() where id=row.id and recovery_sent_at is null;
    recovery_count:=recovery_count+1;
  end loop;

  for row in select * from public.whatsapp_commerce_outbox
    where attempts<3 and ((status='failed' and next_attempt_at<=now()) or (status='pending' and created_at<=now()-interval '5 minutes'))
    order by next_attempt_at for update skip locked
  loop
    update public.whatsapp_commerce_outbox set status='pending',updated_at=now(),next_attempt_at=now()+interval '5 minutes' where id=row.id;
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/send-whatsapp-commerce-event',headers:=jsonb_build_object('Content-Type','application/json'),body:=jsonb_build_object('event_id',row.id,'token',row.delivery_token),timeout_milliseconds:=5000);
    retry_count:=retry_count+1;
  end loop;
  return jsonb_build_object('recoveries',recovery_count,'retries',retry_count,'expired_payments',expired_count);
end $$;
revoke all on function private.run_whatsapp_commerce_jobs() from public,anon,authenticated;
