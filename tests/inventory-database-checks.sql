-- Run inside a rollback-only transaction together with the migration on a test schema.
-- No fixture is committed. Uses existing membership/products only as foreign-key context.
begin;
do $test$
declare tenant uuid; actor uuid; product uuid; stock uuid; ord uuid; ord2 uuid; line_id uuid; sale uuid; table_order uuid; shift_id uuid; register_id uuid; employee_id uuid; request_key uuid:=gen_random_uuid(); denied boolean:=false;
begin
 select establishment_id,user_id into tenant,actor from public.establishment_members where role='owner' limit 1;
 select id into product from public.products where establishment_id=tenant limit 1;
 if tenant is null or product is null then raise exception 'Fixture requires existing establishment and product'; end if;
 select id into employee_id from public.custom_staff_members where establishment_id=tenant limit 1;
 insert into public.cash_registers(establishment_id,name) values(tenant,'__TESTE_ESTOQUE_ROLLBACK__') returning id into register_id;
 insert into public.cash_shifts(establishment_id,staff_member_id,operator_name,opened_by,cash_register_id,status) values(tenant,employee_id,'Teste rollback',actor,register_id,'open') returning id into shift_id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 stock:=public.inventory_save_item(tenant,null,'__TESTE_ESTOQUE_ROLLBACK__','un',2,true,true);
 perform public.inventory_adjust(tenant,stock,10,'entry','Teste reversível',request_key);
 perform public.inventory_adjust(tenant,stock,10,'entry','Teste reversível',request_key);
 if (select balance from public.inventory_items where id=stock)<>10 then raise exception 'duplicate adjustment'; end if;
 perform public.inventory_save_recipe(tenant,product,jsonb_build_array(
  jsonb_build_object('stock_item_id',stock,'quantity',2),
  jsonb_build_object('stock_item_id',stock,'quantity',1,'addon_name','Extra'),
  jsonb_build_object('stock_item_id',stock,'quantity',1,'removable_name','Tomate')));
 insert into public.orders(establishment_id,order_number,fulfillment_type,customer_name,subtotal_cents,total_cents)
 overriding system value values(tenant,-987654321,'pickup','Teste rollback',0,0) returning id into ord;
 insert into public.order_items(establishment_id,order_id,product_id,product_name,quantity,unit_price_cents,total_cents,addons,removed_ingredients)
 values(tenant,ord,product,'Teste',2,0,0,'[{"name":"Extra","quantity":2}]','["Tomate"]') returning id into line_id;
 if (select balance from public.inventory_items where id=stock)<>2 then raise exception 'addon or removed ingredient calculation'; end if;
 update public.orders set online_payment_status='approved' where id=ord;
 if (select balance from public.inventory_items where id=stock)<>2 then raise exception 'payment duplicated stock'; end if;
 insert into public.pos_sales(establishment_id,cash_shift_id,staff_member_id,operator_name,sale_number,source,source_order_id,payment_method,subtotal_cents,total_cents)
 overriding system value values(tenant,shift_id,employee_id,'Teste rollback',-987654321,'menu_order',ord,'cash',0,0) returning id into sale;
 if sale is null then raise exception 'Fixture requires one existing POS sale'; end if;
 insert into public.pos_sale_items(establishment_id,pos_sale_id,product_id,product_name,quantity,unit_price_cents,total_cents)
 values(tenant,sale,product,'Teste',2,0,0);
 if (select balance from public.inventory_items where id=stock)<>2 then raise exception 'POS copied order duplicated stock'; end if;
 update public.orders set status='canceled' where id=ord;
 update public.orders set status='canceled' where id=ord;
 if (select balance from public.inventory_items where id=stock)<>10 then raise exception 'cancellation not exactly once'; end if;
 insert into public.orders(establishment_id,order_number,fulfillment_type,customer_name,subtotal_cents,total_cents)
 overriding system value values(tenant,-987654322,'pickup','Teste rollback',0,0) returning id into ord2;
 insert into public.order_items(establishment_id,order_id,product_id,product_name,quantity,unit_price_cents,total_cents,removed_ingredients)
 values(tenant,ord2,product,'Teste',1,0,0,'["Tomate"]');
 update public.orders set status='preparing' where id=ord2;
 update public.orders set status='canceled' where id=ord2;
 if (select balance from public.inventory_items where id=stock)<>8 then raise exception 'prepared food incorrectly restocked'; end if;
 insert into public.pos_sales(establishment_id,cash_shift_id,staff_member_id,operator_name,sale_number,source,payment_method,subtotal_cents,total_cents)
 overriding system value values(tenant,shift_id,employee_id,'Teste rollback',-987654322,'pos','cash',0,0) returning id into sale;
 insert into public.pos_sale_items(establishment_id,pos_sale_id,product_id,product_name,quantity,unit_price_cents,total_cents)
 values(tenant,sale,product,'Teste',1,0,0);
 if (select balance from public.inventory_items where id=stock)<>5 then raise exception 'direct POS stock wrong'; end if;
 insert into public.table_orders(establishment_id,table_session_id,waiter_id,order_number)
 overriding system value select tenant,table_session_id,waiter_id,-987654321 from public.table_orders where establishment_id=tenant limit 1 returning id into table_order;
 if table_order is null then raise exception 'Fixture requires one existing table order'; end if;
 insert into public.table_order_items(establishment_id,table_order_id,product_id,product_name,quantity,unit_price_cents,total_cents)
 values(tenant,table_order,product,'Teste',1,0,0);
 if (select balance from public.inventory_items where id=stock)<>2 then raise exception 'waiter stock wrong'; end if;
 begin
  insert into public.table_order_items(establishment_id,table_order_id,product_id,product_name,quantity,unit_price_cents,total_cents)
  values(tenant,table_order,product,'Teste',2,0,0);
 exception when others then
  if sqlerrm not like 'Estoque insuficiente%' then raise; end if;
  denied:=true;
 end;
 if not denied or (select balance from public.inventory_items where id=stock)<>2 then raise exception 'insufficient stock not atomic'; end if;
 update public.table_orders set kitchen_status='canceled' where id=table_order;
 if (select balance from public.inventory_items where id=stock)<>5 then raise exception 'waiter cancellation stock wrong'; end if;
 denied:=false;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.inventory_adjust(tenant,stock,1,'entry','Acesso indevido',gen_random_uuid());
 exception when others then denied:=true; end;
 if not denied then raise exception 'unauthorized stock access'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
end $test$;
select 'PASS: manual idempotence, recipes/addons/removals, Pix no duplicate, POS no duplicate, cancellation exactly once, prepared food preserved, direct POS, waiter, insufficient rollback, authorization' as result;
set local role authenticated;
do $permissions$
declare tenant uuid; item uuid; denied boolean:=false;
begin
 select establishment_id,id into tenant,item from public.inventory_items where name='__TESTE_ESTOQUE_ROLLBACK__';
 if item is null then raise exception 'Owner cannot read inventory through RLS'; end if;
 perform public.inventory_adjust(tenant,item,1,'entry','Teste RPC autenticada',gen_random_uuid());
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.inventory_items where id=item) then raise exception 'RLS leaked inventory'; end if;
 if exists(select 1 from public.inventory_movements where stock_item_id=item) then raise exception 'RLS leaked ledger'; end if;
 begin perform public.inventory_adjust(tenant,item,1,'entry','Teste negado',gen_random_uuid()); exception when others then denied:=true; end;
 if not denied then raise exception 'RPC accepted cross-tenant update'; end if;
end $permissions$;
reset role;
select 'PASS inventory business rules and authenticated RPC/RLS' as result;
rollback;
