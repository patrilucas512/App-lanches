-- Phase 16 hardening: conversion-aware recipes and consumption.
create or replace function public.inventory_save_recipe_v2(requested_establishment_id uuid,requested_product_id uuid,requested_recipe jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare line jsonb; item public.inventory_items%rowtype; base_quantity numeric; org uuid;
begin
 if not inventory_private.has_permission(requested_establishment_id,'adjust') then raise exception 'Sem permissão.'; end if;
 if not exists(select 1 from public.products where id=requested_product_id and establishment_id=requested_establishment_id) then raise exception 'Produto não encontrado.'; end if;
 if jsonb_typeof(requested_recipe)<>'array' or jsonb_array_length(requested_recipe)>100 then raise exception 'Ficha técnica inválida.'; end if;
 select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||requested_establishment_id,0));
 delete from public.inventory_recipes where product_id=requested_product_id and establishment_id=requested_establishment_id;
 for line in select value from jsonb_array_elements(requested_recipe) loop
  select * into item from public.inventory_items where id=(line->>'stock_item_id')::uuid and establishment_id=requested_establishment_id and active;
  if item.id is null then raise exception 'Escolha um insumo ativo desta unidade.'; end if;
  base_quantity:=public.inventory_convert_quantity(item.id,(line->>'quantity')::numeric,coalesce(line->>'unit',item.unit));
  insert into public.inventory_recipes(establishment_id,product_id,stock_item_id,quantity,recipe_unit,quantity_base,variation_id,addon_id,addon_name,removable_name,component_product_id)
  values(requested_establishment_id,requested_product_id,item.id,(line->>'quantity')::numeric,coalesce(line->>'unit',item.unit),base_quantity,
   nullif(line->>'variation_id','')::uuid,nullif(line->>'addon_id','')::uuid,btrim(coalesce(line->>'addon_name','')),btrim(coalesce(line->>'removable_name','')),nullif(line->>'component_product_id','')::uuid);
 end loop;
 insert into public.inventory_audit_events(organization_id,establishment_id,event_type,entity_type,entity_id,actor_id,metadata)
 values(org,requested_establishment_id,'recipe_saved','product',requested_product_id,auth.uid(),jsonb_build_object('lines',jsonb_array_length(requested_recipe)));
end $$;

create or replace function inventory_private.inventory_deduct_line() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_id uuid; channel text; added jsonb:='[]'; removed jsonb:='[]'; variations jsonb:='[]'; row record; used numeric; available numeric; shortage boolean; movement_kind text:='sale_consumption';
begin
 if new.product_id is null or not exists(select 1 from public.inventory_recipes where product_id=new.product_id and establishment_id=new.establishment_id) then return new; end if;
 if tg_table_name='pos_sale_items' then
  if exists(select 1 from public.pos_sales where id=new.pos_sale_id and source_order_id is not null) then return new; end if;
  channel:='pos'; parent_id:=new.pos_sale_id;
 elsif tg_table_name='order_items' then channel:='order';parent_id:=new.order_id;added:=coalesce(new.addons,'[]'::jsonb);removed:=coalesce(new.removed_ingredients,'[]'::jsonb);
 else channel:='table';parent_id:=new.table_order_id;added:=coalesce(new.addons,'[]'::jsonb);removed:=coalesce(new.removed_ingredients,'[]'::jsonb);variations:=coalesce(new.variations,'[]'::jsonb); end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||new.establishment_id::text,0));
 for row in
  select r.stock_item_id,sum(r.quantity_base * case
   when r.variation_id is not null then case when exists(select 1 from jsonb_array_elements(variations) v where v->>'id'=r.variation_id::text or lower(v->>'name')=lower((select name from public.product_variations where id=r.variation_id))) then 1 else 0 end
   when r.addon_id is not null then coalesce((select sum(greatest(coalesce((a->>'quantity')::numeric,1),1)) from jsonb_array_elements(added) a where a->>'id'=r.addon_id::text or lower(a->>'name')=lower((select name from public.addons where id=r.addon_id))),0)
   when r.addon_name<>'' then coalesce((select sum(greatest(coalesce((a->>'quantity')::numeric,1),1)) from jsonb_array_elements(added) a where lower(a->>'name')=lower(r.addon_name)),0)
   when r.removable_name<>'' and exists(select 1 from jsonb_array_elements_text(removed) x where lower(x)=lower(r.removable_name)) then 0 else 1 end) * new.quantity needed
  from public.inventory_recipes r join public.inventory_items s on s.id=r.stock_item_id and s.establishment_id=r.establishment_id
  where r.product_id=new.product_id and r.establishment_id=new.establishment_id and s.active and s.track_stock group by r.stock_item_id order by r.stock_item_id
 loop
  used:=row.needed; if used<=0 or exists(select 1 from public.inventory_movements where source_kind=channel and source_item_id=new.id and stock_item_id=row.stock_item_id and kind in('sale','sale_consumption')) then continue; end if;
  select balance,block_insufficient into available,shortage from public.inventory_items where id=row.stock_item_id for update;
  if shortage and available<used then raise exception 'Estoque insuficiente para %. Avise o estabelecimento.',new.product_name; end if;
  update public.inventory_items set balance=balance-used,updated_at=now() where id=row.stock_item_id;
  insert into public.inventory_movements(establishment_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,source_kind,source_parent_id,source_item_id)
  values(new.establishment_id,row.stock_item_id,-used,available-used,movement_kind,'Pedido: '||new.product_name,auth.uid(),inventory_private.inventory_actor(),channel,parent_id,new.id);
 end loop; return new;
end $$;

-- Cancellation recognizes both legacy and Phase 16 consumption movements.
create or replace function inventory_private.inventory_cancel_order() returns trigger language plpgsql security definer set search_path='' as $$
declare channel text; row public.inventory_movements%rowtype; available numeric;
begin
 if tg_table_name='orders' then
  if old.status::text='canceled' and new.status::text<>'canceled' and exists(select 1 from public.inventory_movements where source_parent_id=new.id and kind in('sale','sale_consumption')) then raise exception 'Pedido cancelado com estoque movimentado: crie um novo pedido.'; end if;
  if new.status::text<>'canceled' or old.status::text='canceled' then return new; end if; channel:='order'; if old.status::text in('preparing','ready','out_for_delivery','completed') then return new; end if;
 else
  if old.kitchen_status::text='canceled' and new.kitchen_status::text<>'canceled' and exists(select 1 from public.inventory_movements where source_parent_id=new.id and kind in('sale','sale_consumption')) then raise exception 'Pedido cancelado com estoque movimentado: crie um novo pedido.'; end if;
  if new.kitchen_status::text<>'canceled' or old.kitchen_status::text='canceled' then return new; end if; channel:='table'; if old.kitchen_status::text in('preparing','ready','delivered') then return new; end if;
 end if;
 if exists(select 1 from public.kitchen_tickets k where(k.public_order_id=new.id or k.table_order_id=new.id)and(k.started_at is not null or k.ready_at is not null or k.delivered_at is not null))then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||new.establishment_id::text,0));
 for row in select * from public.inventory_movements where source_kind=channel and source_parent_id=new.id and kind in('sale','sale_consumption') order by stock_item_id,id loop
  if exists(select 1 from public.inventory_movements where source_kind=channel and source_item_id=row.source_item_id and stock_item_id=row.stock_item_id and kind in('return','cancellation_reversal')) then continue; end if;
  update public.inventory_items set balance=balance-row.quantity,updated_at=now() where id=row.stock_item_id returning balance into available;
  insert into public.inventory_movements(establishment_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,source_kind,source_parent_id,source_item_id)
  values(row.establishment_id,row.stock_item_id,-row.quantity,available,'cancellation_reversal','Cancelado antes do preparo',auth.uid(),inventory_private.inventory_actor(),channel,new.id,row.source_item_id);
 end loop; return new;
end $$;

revoke all on function public.inventory_save_recipe_v2(uuid,uuid,jsonb) from public,anon;
grant execute on function public.inventory_save_recipe_v2(uuid,uuid,jsonb) to authenticated,service_role;
revoke all on function inventory_private.inventory_deduct_line(),inventory_private.inventory_cancel_order() from public,anon,authenticated;
