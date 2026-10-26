create or replace function public.transfer_whatsapp_conversation_store(requested_conversation_id uuid, requested_target_store_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare conversation public.whatsapp_conversations%rowtype; source_org uuid; target_org uuid; cart_record public.whatsapp_carts%rowtype; item_count integer;
begin
  select * into conversation from public.whatsapp_conversations where id=requested_conversation_id for update;
  if conversation.id is null then raise exception 'Conversa não encontrada.'; end if;
  if not private.has_whatsapp_permission(conversation.establishment_id,'respond') then raise exception 'Sem permissão para transferir esta conversa.'; end if;
  select organization_id into source_org from public.establishments where id=conversation.establishment_id;
  select organization_id into target_org from public.establishments where id=requested_target_store_id and unit_status='active' and active;
  if target_org is null or source_org<>target_org or not private.has_store_access(requested_target_store_id) then raise exception 'Unidade de destino inválida ou não autorizada.'; end if;
  select * into cart_record from public.whatsapp_carts where conversation_id=conversation.id and status in ('active','awaiting_information','awaiting_confirmation','converted') order by updated_at desc limit 1 for update;
  if cart_record.converted_order_id is not null then raise exception 'Pedidos já confirmados não podem ser transferidos entre unidades.'; end if;
  if cart_record.id is not null then
    select count(*) into item_count from public.whatsapp_cart_items where cart_id=cart_record.id;
    if item_count>0 then raise exception 'Esvazie o carrinho com confirmação antes de transferir a conversa.'; end if;
    update public.whatsapp_carts set establishment_id=requested_target_store_id,context=context||jsonb_build_object('transferred_from_store_id',conversation.selected_store_id,'transferred_at',now()) where id=cart_record.id;
  end if;
  update public.whatsapp_conversations set selected_store_id=requested_target_store_id,routing_state=routing_state||jsonb_build_object('transferred_from_store_id',conversation.selected_store_id,'transferred_by',auth.uid(),'transferred_at',now()) where id=conversation.id;
  insert into public.whatsapp_store_selections(conversation_id,organization_id,establishment_id,selection_source,confirmed_at)
    values(conversation.id,source_org,requested_target_store_id,'human_transfer',now())
    on conflict(conversation_id) do update set establishment_id=excluded.establishment_id,selection_source=excluded.selection_source,confirmed_at=excluded.confirmed_at;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
    values(conversation.establishment_id,auth.uid(),'whatsapp.conversation_store_transferred','whatsapp_conversation',conversation.id,jsonb_build_object('from_store_id',conversation.selected_store_id,'to_store_id',requested_target_store_id,'history_preserved',true));
  return jsonb_build_object('conversation_id',conversation.id,'selected_store_id',requested_target_store_id,'history_preserved',true);
end $$;

revoke all on function public.transfer_whatsapp_conversation_store(uuid,uuid) from public,anon;
grant execute on function public.transfer_whatsapp_conversation_store(uuid,uuid) to authenticated;
