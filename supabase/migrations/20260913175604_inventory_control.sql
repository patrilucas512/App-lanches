-- Incremental inventory. No historical order is replayed and no existing product is changed.
create schema inventory_private;
revoke all on schema inventory_private from public,anon;
grant usage on schema inventory_private to authenticated;
create table public.inventory_items (
 id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id),
 name text not null check(length(btrim(name)) between 2 and 120),
 unit text not null check(unit in ('un','g','kg','ml','l')),
 balance numeric(18,4) not null default 0, minimum numeric(18,4) not null default 0 check(minimum>=0),
 block_insufficient boolean not null default false, active boolean not null default true,
 needs_restock boolean generated always as (active and balance<=minimum) stored,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(establishment_id,id)
);
create unique index inventory_item_name on public.inventory_items(establishment_id,lower(btrim(name)));
create table public.inventory_recipes (
 id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id),
 product_id uuid not null references public.products(id) on delete cascade,
 stock_item_id uuid not null, quantity numeric(18,4) not null check(quantity>0),
 addon_name text not null default '', removable_name text not null default '',
 foreign key(establishment_id,stock_item_id) references public.inventory_items(establishment_id,id),
 unique(product_id,stock_item_id,addon_name,removable_name),
 check(addon_name='' or removable_name='')
);
create index inventory_recipes_stock on public.inventory_recipes(stock_item_id);
create index inventory_recipes_tenant on public.inventory_recipes(establishment_id,product_id);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id),
 stock_item_id uuid not null, quantity numeric(18,4) not null check(quantity<>0), balance_after numeric(18,4) not null,
 kind text not null check(kind in ('entry','loss','adjust_in','adjust_out','sale','return')),
 reason text not null, actor_id uuid, actor_name text not null,
 source_kind text, source_parent_id uuid, source_item_id uuid, request_id uuid,
 created_at timestamptz not null default now(),
 foreign key(establishment_id,stock_item_id) references public.inventory_items(establishment_id,id)
);
create index inventory_movements_page on public.inventory_movements(establishment_id,created_at desc,id desc);
create index inventory_movements_stock on public.inventory_movements(stock_item_id);
create index inventory_movements_item_source on public.inventory_movements(source_item_id) where source_item_id is not null;
create index inventory_movements_source on public.inventory_movements(source_kind,source_parent_id) where source_parent_id is not null;
create unique index inventory_source_once on public.inventory_movements(source_kind,source_item_id,stock_item_id,kind) where source_item_id is not null;
create unique index inventory_manual_once on public.inventory_movements(establishment_id,request_id) where request_id is not null;
alter table public.inventory_items enable row level security;
alter table public.inventory_recipes enable row level security;
alter table public.inventory_movements enable row level security;
create policy inventory_items_read on public.inventory_items for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy inventory_recipes_read on public.inventory_recipes for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy inventory_movements_read on public.inventory_movements for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
revoke all on public.inventory_items,public.inventory_recipes,public.inventory_movements from anon,authenticated;
grant select on public.inventory_items,public.inventory_recipes,public.inventory_movements to authenticated;

create function inventory_private.inventory_authorize(tenant uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not private.has_role(tenant,array['owner','manager']::public.member_role[]) then raise exception 'Somente o proprietário ou gerente pode gerenciar estoque.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||tenant::text,0));
end $$;
create function inventory_private.inventory_actor() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select m.name from public.custom_staff_members m where m.user_id=auth.uid() limit 1),
 (select w.name from public.waiters w where w.user_id=auth.uid() limit 1),
 case when auth.uid() is null then 'Pedido do cliente / sistema' else 'Administrador' end)
$$;

create function inventory_private.inventory_save_item(tenant uuid,item_id uuid,item_name text,item_unit text,item_minimum numeric,block_stock boolean,is_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform inventory_private.inventory_authorize(tenant);
 if item_id is null then
  insert into public.inventory_items(establishment_id,name,unit,minimum,block_insufficient,active)
  values(tenant,btrim(item_name),item_unit,item_minimum,block_stock,is_active) returning id into result;
 else
  if not is_active and (exists(select 1 from public.inventory_recipes where stock_item_id=item_id)
   or exists(select 1 from public.inventory_items where id=item_id and balance<>0)) then
   raise exception 'Para arquivar, retire os vínculos dos produtos e zere o saldo com uma movimentação justificada.';
  end if;
  if exists(select 1 from public.inventory_items where id=item_id and establishment_id=tenant and unit<>item_unit)
   and (exists(select 1 from public.inventory_movements where stock_item_id=item_id) or exists(select 1 from public.inventory_recipes where stock_item_id=item_id))
  then raise exception 'A unidade não pode mudar após movimentações ou vínculos. Cadastre outro insumo com a unidade correta.'; end if;
  update public.inventory_items set name=btrim(item_name),unit=item_unit,minimum=item_minimum,block_insufficient=block_stock,active=is_active,updated_at=now()
  where id=item_id and establishment_id=tenant returning id into result;
  if result is null then raise exception 'Item não encontrado.'; end if;
 end if;
 return result;
end $$;
create function public.inventory_save_item(tenant uuid,item_id uuid,item_name text,item_unit text,item_minimum numeric,block_stock boolean,is_active boolean)
returns uuid language sql security invoker set search_path='' as $$
 select inventory_private.inventory_save_item(tenant,item_id,item_name,item_unit,item_minimum,block_stock,is_active)
$$;

create function inventory_private.inventory_adjust(tenant uuid,item_id uuid,amount numeric,movement_kind text,note text,request_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare item public.inventory_items%rowtype; delta numeric; result uuid;
begin
 perform inventory_private.inventory_authorize(tenant);
 if request_key is null or amount is null or amount<=0 or amount<>round(amount,4) or length(btrim(coalesce(note,'')))<3 then raise exception 'Informe quantidade positiva (até 4 casas decimais), motivo e chave de operação.'; end if;
 if movement_kind not in ('entry','loss','adjust_in','adjust_out') then raise exception 'Tipo de movimentação inválido.'; end if;
 select id into result from public.inventory_movements where establishment_id=tenant and request_id=request_key;
 if result is not null then
  if not exists(select 1 from public.inventory_movements where id=result and stock_item_id=item_id and abs(quantity)=amount and kind=movement_kind and reason=btrim(note)) then
   raise exception 'Esta operação já foi registrada com outros valores. Feche e abra uma nova movimentação.';
  end if;
  return result;
 end if;
 select * into item from public.inventory_items where id=item_id and establishment_id=tenant for update;
 if item.id is null then raise exception 'Item não encontrado.'; end if;
 delta:=case when movement_kind in ('entry','adjust_in') then amount else -amount end;
 if delta<0 and item.balance+delta<0 then raise exception 'A saída não pode exceder o saldo. Confira a contagem física.'; end if;
 update public.inventory_items set balance=balance+delta,updated_at=now() where id=item.id returning balance into item.balance;
 insert into public.inventory_movements(establishment_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,request_id)
 values(tenant,item.id,delta,item.balance,movement_kind,btrim(note),auth.uid(),inventory_private.inventory_actor(),request_key) returning id into result;
 return result;
end $$;
create function public.inventory_adjust(tenant uuid,item_id uuid,amount numeric,movement_kind text,note text,request_key uuid)
returns uuid language sql security invoker set search_path='' as $$
 select inventory_private.inventory_adjust(tenant,item_id,amount,movement_kind,note,request_key)
$$;

create function inventory_private.inventory_save_recipe(tenant uuid,target_product uuid,recipe jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare line jsonb;
begin
 perform inventory_private.inventory_authorize(tenant);
 if not exists(select 1 from public.products where id=target_product and establishment_id=tenant) then raise exception 'Produto não encontrado.'; end if;
 if jsonb_typeof(recipe)<>'array' or jsonb_array_length(recipe)>100 then raise exception 'Ficha técnica inválida.'; end if;
 delete from public.inventory_recipes where product_id=target_product and establishment_id=tenant;
 for line in select value from jsonb_array_elements(recipe) loop
  if not exists(select 1 from public.inventory_items where id=(line->>'stock_item_id')::uuid and establishment_id=tenant and active) then raise exception 'Escolha um item de estoque ativo do estabelecimento.'; end if;
  insert into public.inventory_recipes(establishment_id,product_id,stock_item_id,quantity,addon_name,removable_name)
  values(tenant,target_product,(line->>'stock_item_id')::uuid,(line->>'quantity')::numeric,btrim(coalesce(line->>'addon_name','')),btrim(coalesce(line->>'removable_name','')));
 end loop;
end $$;
create function public.inventory_save_recipe(tenant uuid,target_product uuid,recipe jsonb)
returns void language sql security invoker set search_path='' as $$
 select inventory_private.inventory_save_recipe(tenant,target_product,recipe)
$$;

create function inventory_private.inventory_deduct_line() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_id uuid; channel text; added jsonb:='[]'; removed jsonb:='[]'; row record; used numeric; factor numeric; available numeric; shortage boolean;
begin
 if new.product_id is null then return new; end if;
 if not exists(select 1 from public.inventory_recipes where product_id=new.product_id and establishment_id=new.establishment_id) then return new; end if;
 if tg_table_name='pos_sale_items' then
  -- Receiving an existing menu order is financial only: that order already consumed stock.
  if exists(select 1 from public.pos_sales where id=new.pos_sale_id and source_order_id is not null) then return new; end if;
  channel:='pos'; parent_id:=new.pos_sale_id;
 elsif tg_table_name='order_items' then
  channel:='order';parent_id:=new.order_id;added:=new.addons;removed:=new.removed_ingredients;
 else channel:='table';parent_id:=new.table_order_id;added:=new.addons;removed:=new.removed_ingredients;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||new.establishment_id::text,0));
 for row in select r.stock_item_id,
 sum(r.quantity * case when r.addon_name<>'' then coalesce((select sum(greatest(coalesce((a->>'quantity')::numeric,1),1)) from jsonb_array_elements(coalesce(added,'[]')) a where lower(a->>'name')=lower(r.addon_name)),0)
 when r.removable_name<>'' and exists(select 1 from jsonb_array_elements_text(coalesce(removed,'[]')) x where lower(x)=lower(r.removable_name)) then 0 else 1 end) * new.quantity as needed
 from public.inventory_recipes r join public.inventory_items s on s.id=r.stock_item_id and s.establishment_id=r.establishment_id
 where r.product_id=new.product_id and r.establishment_id=new.establishment_id and s.active
 group by r.stock_item_id order by r.stock_item_id loop
  used:=row.needed;
  if used<=0 or exists(select 1 from public.inventory_movements where source_kind=channel and source_item_id=new.id and stock_item_id=row.stock_item_id and kind='sale') then continue; end if;
  select balance,block_insufficient into available,shortage from public.inventory_items where id=row.stock_item_id for update;
  if shortage and available<used then raise exception 'Estoque insuficiente para %. Avise o estabelecimento.',new.product_name; end if;
  update public.inventory_items set balance=balance-used,updated_at=now() where id=row.stock_item_id;
  insert into public.inventory_movements(establishment_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,source_kind,source_parent_id,source_item_id)
  values(new.establishment_id,row.stock_item_id,-used,available-used,'sale','Pedido: '||new.product_name,auth.uid(),inventory_private.inventory_actor(),channel,parent_id,new.id);
 end loop;
 return new;
end $$;
create trigger inventory_public_line after insert on public.order_items for each row execute function inventory_private.inventory_deduct_line();
create trigger inventory_table_line after insert on public.table_order_items for each row execute function inventory_private.inventory_deduct_line();
create trigger inventory_pos_line after insert on public.pos_sale_items for each row execute function inventory_private.inventory_deduct_line();

create function inventory_private.inventory_cancel_order() returns trigger language plpgsql security definer set search_path='' as $$
declare channel text; row public.inventory_movements%rowtype; available numeric;
begin
 if tg_table_name='orders' then
  if old.status::text='canceled' and new.status::text<>'canceled' and exists(select 1 from public.inventory_movements where source_parent_id=new.id and kind='sale') then raise exception 'Pedido cancelado com estoque movimentado: crie um novo pedido.'; end if;
  if new.status::text<>'canceled' or old.status::text='canceled' then return new; end if;
  channel:='order';
  if old.status::text in ('preparing','ready','out_for_delivery','completed') then return new; end if;
 else
  if old.kitchen_status::text='canceled' and new.kitchen_status::text<>'canceled' and exists(select 1 from public.inventory_movements where source_parent_id=new.id and kind='sale') then raise exception 'Pedido cancelado com estoque movimentado: crie um novo pedido.'; end if;
  if new.kitchen_status::text<>'canceled' or old.kitchen_status::text='canceled' then return new; end if;
  channel:='table';
  if old.kitchen_status::text in ('preparing','ready','delivered') then return new; end if;
 end if;
 if exists(select 1 from public.kitchen_tickets k where (k.public_order_id=new.id or k.table_order_id=new.id) and (k.started_at is not null or k.ready_at is not null or k.delivered_at is not null)) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||new.establishment_id::text,0));
 for row in select * from public.inventory_movements where source_kind=channel and source_parent_id=new.id and kind='sale' order by stock_item_id,id loop
  if exists(select 1 from public.inventory_movements where source_kind=channel and source_item_id=row.source_item_id and stock_item_id=row.stock_item_id and kind='return') then continue; end if;
  update public.inventory_items set balance=balance-row.quantity,updated_at=now() where id=row.stock_item_id returning balance into available;
  insert into public.inventory_movements(establishment_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,source_kind,source_parent_id,source_item_id)
  values(row.establishment_id,row.stock_item_id,-row.quantity,available,'return','Cancelado antes do preparo',auth.uid(),inventory_private.inventory_actor(),channel,new.id,row.source_item_id);
 end loop;
 return new;
end $$;
create trigger inventory_public_cancel after update of status on public.orders for each row execute function inventory_private.inventory_cancel_order();
create trigger inventory_table_cancel after update of kitchen_status on public.table_orders for each row execute function inventory_private.inventory_cancel_order();

-- Tracked order lines are audit records. Product deletion can still null the FK.
create function inventory_private.inventory_protect_line() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.inventory_movements where source_item_id=old.id) then
  if tg_op='DELETE' then raise exception 'Pedido com estoque movimentado: cancele o pedido e preserve o histórico.'; end if;
  if new.quantity<>old.quantity or (new.product_id is distinct from old.product_id and new.product_id is not null)
   or (to_jsonb(new)->'addons') is distinct from (to_jsonb(old)->'addons')
   or (to_jsonb(new)->'removed_ingredients') is distinct from (to_jsonb(old)->'removed_ingredients')
  then raise exception 'Item com estoque movimentado não pode ser alterado. Cancele e lance um novo pedido.'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger inventory_public_protect before update or delete on public.order_items for each row execute function inventory_private.inventory_protect_line();
create trigger inventory_table_protect before update or delete on public.table_order_items for each row execute function inventory_private.inventory_protect_line();
create trigger inventory_pos_protect before update or delete on public.pos_sale_items for each row execute function inventory_private.inventory_protect_line();

revoke all on function inventory_private.inventory_authorize(uuid),inventory_private.inventory_actor(),inventory_private.inventory_deduct_line(),inventory_private.inventory_cancel_order(),inventory_private.inventory_protect_line() from public,anon,authenticated;
revoke all on function inventory_private.inventory_save_item(uuid,uuid,text,text,numeric,boolean,boolean),inventory_private.inventory_adjust(uuid,uuid,numeric,text,text,uuid),inventory_private.inventory_save_recipe(uuid,uuid,jsonb) from public,anon;
grant execute on function inventory_private.inventory_save_item(uuid,uuid,text,text,numeric,boolean,boolean),inventory_private.inventory_adjust(uuid,uuid,numeric,text,text,uuid),inventory_private.inventory_save_recipe(uuid,uuid,jsonb) to authenticated;
revoke all on function public.inventory_save_item(uuid,uuid,text,text,numeric,boolean,boolean),public.inventory_adjust(uuid,uuid,numeric,text,text,uuid),public.inventory_save_recipe(uuid,uuid,jsonb) from public,anon;
grant execute on function public.inventory_save_item(uuid,uuid,text,text,numeric,boolean,boolean),public.inventory_adjust(uuid,uuid,numeric,text,text,uuid),public.inventory_save_recipe(uuid,uuid,jsonb) to authenticated;
