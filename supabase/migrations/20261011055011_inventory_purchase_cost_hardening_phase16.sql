-- Keep purchase-unit price separate from canonical stock-unit cost.
alter table public.purchase_order_items add column if not exists base_unit_cost_cents numeric(18,6);
update public.purchase_order_items set base_unit_cost_cents=case when quantity_base>0 then total_cost_cents::numeric/quantity_base else 0 end where base_unit_cost_cents is null;
alter table public.purchase_order_items alter column base_unit_cost_cents set not null;
alter table public.purchase_order_items add constraint purchase_order_items_base_cost_check check(base_unit_cost_cents>=0);

create or replace function public.inventory_create_purchase_order(requested_establishment_id uuid,requested_supplier_id uuid,requested_items jsonb,requested_expected_date date,requested_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid; org uuid; line jsonb; total bigint:=0; approval bigint; initial_status text; base_quantity numeric; line_total bigint;
begin
 if not inventory_private.has_permission(requested_establishment_id,'purchase') then raise exception 'Sem permissão.'; end if; select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;
 if not exists(select 1 from public.suppliers where id=requested_supplier_id and organization_id=org and status='active') then raise exception 'Fornecedor inválido.'; end if;
 for line in select value from jsonb_array_elements(requested_items) loop total:=total+round((line->>'quantity')::numeric*(line->>'unit_cost_cents')::numeric); end loop;
 select purchase_approval_limit_cents into approval from public.inventory_settings where establishment_id=requested_establishment_id; initial_status:=case when approval is not null and total>approval then 'pending_approval' else 'approved' end;
 insert into public.purchase_orders(organization_id,establishment_id,supplier_id,status,total_cents,expected_date,created_by,approved_by,approved_at,notes)values(org,requested_establishment_id,requested_supplier_id,initial_status,total,requested_expected_date,auth.uid(),case when initial_status='approved' then auth.uid() end,case when initial_status='approved' then now() end,requested_notes)returning id into saved;
 for line in select value from jsonb_array_elements(requested_items) loop
  base_quantity:=public.inventory_convert_quantity((line->>'item_id')::uuid,(line->>'quantity')::numeric,line->>'unit'); line_total:=round((line->>'quantity')::numeric*(line->>'unit_cost_cents')::numeric);
  insert into public.purchase_order_items(purchase_order_id,inventory_item_id,quantity,purchase_unit,quantity_base,unit_cost_cents,base_unit_cost_cents,total_cost_cents)
  values(saved,(line->>'item_id')::uuid,(line->>'quantity')::numeric,line->>'unit',base_quantity,(line->>'unit_cost_cents')::numeric,line_total::numeric/base_quantity,line_total);
 end loop;
 insert into public.inventory_audit_events(organization_id,establishment_id,event_type,entity_type,entity_id,actor_id,metadata)values(org,requested_establishment_id,'purchase_created','purchase_order',saved,auth.uid(),jsonb_build_object('total_cents',total,'status',initial_status)); return saved;
end $$;

create or replace function public.inventory_purchase_action(requested_establishment_id uuid,requested_purchase_id uuid,requested_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchase_orders%rowtype; next_status text; permission_name text; begin
 permission_name:=case when requested_action='approve' then 'approve' else 'purchase' end; if not inventory_private.has_permission(requested_establishment_id,permission_name) then raise exception 'Sem permissão.'; end if;
 select * into p from public.purchase_orders where id=requested_purchase_id and establishment_id=requested_establishment_id for update; if p.id is null then raise exception 'Pedido não encontrado.'; end if;
 next_status:=case when requested_action='approve' and p.status='pending_approval' then 'approved' when requested_action='order' and p.status='approved' then 'ordered' when requested_action='cancel' and p.status in('draft','pending_approval','approved','ordered') then 'cancelled' else null end;
 if next_status is null then raise exception 'Ação incompatível com o status atual.'; end if;
 update public.purchase_orders set status=next_status,approved_by=case when next_status='approved' then auth.uid() else approved_by end,approved_at=case when next_status='approved' then now() else approved_at end,updated_at=now() where id=p.id;
 insert into public.inventory_audit_events(organization_id,establishment_id,event_type,entity_type,entity_id,actor_id,metadata)values(p.organization_id,p.establishment_id,'purchase_'||next_status,'purchase_order',p.id,auth.uid(),jsonb_build_object('previous_status',p.status)); return jsonb_build_object('ok',true,'status',next_status);
end $$;

create or replace function public.inventory_receive_purchase(requested_establishment_id uuid,requested_purchase_id uuid,requested_items jsonb,requested_document text,requested_notes text,requested_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchase_orders%rowtype; line jsonb; poi public.purchase_order_items%rowtype; i public.inventory_items%rowtype; received numeric; base_cost numeric; new_avg numeric; receipt uuid; completed boolean;
begin
 if not inventory_private.has_permission(requested_establishment_id,'receive') then raise exception 'Sem permissão.'; end if; perform pg_advisory_xact_lock(hashtextextended('inventory:'||requested_establishment_id,0)); if exists(select 1 from public.purchase_receipts where idempotency_key=requested_key) then return jsonb_build_object('ok',true,'duplicate',true); end if;
 select * into p from public.purchase_orders where id=requested_purchase_id and establishment_id=requested_establishment_id and status in('approved','ordered','partially_received') for update; if p.id is null then raise exception 'Pedido de compra não está disponível para recebimento.'; end if;
 insert into public.purchase_receipts(purchase_order_id,organization_id,establishment_id,document_number,received_by,notes,idempotency_key)values(p.id,p.organization_id,p.establishment_id,requested_document,auth.uid(),requested_notes,requested_key)returning id into receipt;
 for line in select value from jsonb_array_elements(requested_items) loop
  select * into poi from public.purchase_order_items where id=(line->>'purchase_order_item_id')::uuid and purchase_order_id=p.id for update; received:=(line->>'quantity_base')::numeric; base_cost:=poi.base_unit_cost_cents;
  if poi.id is null or received<=0 or poi.received_quantity_base+received>poi.quantity_base then raise exception 'Quantidade recebida inválida.'; end if;
  select * into i from public.inventory_items where id=poi.inventory_item_id and establishment_id=p.establishment_id for update; new_avg:=case when i.balance+received>0 then((i.balance*i.average_cost_cents)+(received*base_cost))/(i.balance+received) else base_cost end;
  update public.inventory_items set balance=balance+received,average_cost_cents=new_avg,last_cost_cents=base_cost,updated_at=now() where id=i.id returning * into i; update public.purchase_order_items set received_quantity_base=received_quantity_base+received where id=poi.id;
  insert into public.purchase_receipt_items(receipt_id,purchase_order_item_id,inventory_item_id,quantity_base,unit_cost_cents,lot_code,expires_on,divergence_quantity)values(receipt,poi.id,i.id,received,base_cost,line->>'lot_code',nullif(line->>'expires_on','')::date,poi.quantity_base-(poi.received_quantity_base+received));
  insert into public.inventory_movements(establishment_id,organization_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,unit_cost_cents,total_cost_cents,reference_type,reference_id)values(p.establishment_id,p.organization_id,i.id,received,i.balance,'purchase','Recebimento de compra',auth.uid(),inventory_private.inventory_actor(),base_cost,round(received*base_cost),'purchase_receipt',receipt);
 end loop;
 completed:=not exists(select 1 from public.purchase_order_items where purchase_order_id=p.id and received_quantity_base<quantity_base); update public.purchase_orders set status=case when completed then 'received' else 'partially_received' end,updated_at=now() where id=p.id;
 insert into public.inventory_audit_events(organization_id,establishment_id,event_type,entity_type,entity_id,actor_id,metadata)values(p.organization_id,p.establishment_id,'purchase_received','purchase_receipt',receipt,auth.uid(),jsonb_build_object('purchase_order_id',p.id,'complete',completed)); return jsonb_build_object('ok',true,'receipt_id',receipt,'status',case when completed then 'received' else 'partially_received' end);
end $$;

revoke all on function public.inventory_purchase_action(uuid,uuid,text) from public,anon;
grant execute on function public.inventory_purchase_action(uuid,uuid,text) to authenticated,service_role;
