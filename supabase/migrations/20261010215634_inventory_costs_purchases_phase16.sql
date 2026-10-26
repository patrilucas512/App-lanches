-- Phase 16: extend the existing inventory; products/orders remain canonical.
create schema if not exists inventory_private;
revoke all on schema inventory_private from public, anon;
grant usage on schema inventory_private to authenticated, service_role;

alter table public.plans add column if not exists inventory_enabled boolean not null default true;
alter table public.plans add column if not exists recipe_costing_enabled boolean not null default true;
alter table public.plans add column if not exists purchase_management_enabled boolean not null default true;
alter table public.plans add column if not exists multi_store_inventory_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists inventory_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists recipe_costing_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists purchase_management_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists multi_store_inventory_enabled boolean not null default false;

alter table public.inventory_items add column if not exists organization_id uuid references public.organizations(id);
alter table public.inventory_items add column if not exists sku text;
alter table public.inventory_items add column if not exists maximum numeric(18,4) check(maximum is null or maximum>=0);
alter table public.inventory_items add column if not exists average_cost_cents numeric(18,4) not null default 0 check(average_cost_cents>=0);
alter table public.inventory_items add column if not exists last_cost_cents numeric(18,4) not null default 0 check(last_cost_cents>=0);
alter table public.inventory_items add column if not exists track_stock boolean not null default true;
alter table public.inventory_items add column if not exists safety_stock numeric(18,4) not null default 0 check(safety_stock>=0);
alter table public.inventory_items add column if not exists warehouse_type text not null default 'store' check(warehouse_type in('store','central'));
alter table public.inventory_items add column if not exists auto_disable_on_stockout boolean not null default false;
alter table public.inventory_items add column if not exists internally_produced boolean not null default false;
alter table public.inventory_items drop constraint if exists inventory_items_unit_check;
alter table public.inventory_items add constraint inventory_items_unit_check check(unit in('un','kg','g','l','ml','pacote','caixa','porcao'));
update public.inventory_items i set organization_id=coalesce(e.organization_id,e.id) from public.establishments e where e.id=i.establishment_id and i.organization_id is null;
alter table public.inventory_items alter column organization_id set not null;
create unique index if not exists inventory_item_sku on public.inventory_items(establishment_id,lower(sku)) where sku is not null;
create index if not exists inventory_items_org_store on public.inventory_items(organization_id,establishment_id,active);
create index if not exists inventory_items_low_stock on public.inventory_items(establishment_id,needs_restock) where active;

alter table public.inventory_recipes add column if not exists variation_id uuid references public.product_variations(id) on delete cascade;
alter table public.inventory_recipes add column if not exists addon_id uuid references public.addons(id) on delete cascade;
alter table public.inventory_recipes add column if not exists recipe_unit text;
alter table public.inventory_recipes add column if not exists quantity_base numeric(18,4);
alter table public.inventory_recipes add column if not exists component_product_id uuid references public.products(id) on delete cascade;
update public.inventory_recipes r set recipe_unit=i.unit,quantity_base=r.quantity from public.inventory_items i where i.id=r.stock_item_id and r.quantity_base is null;
alter table public.inventory_recipes alter column quantity_base set not null;
alter table public.inventory_recipes add constraint inventory_recipe_target_once check(num_nonnulls(variation_id,addon_id)<=1);
create index if not exists inventory_recipes_variation on public.inventory_recipes(variation_id) where variation_id is not null;
create index if not exists inventory_recipes_addon on public.inventory_recipes(addon_id) where addon_id is not null;

alter table public.inventory_movements add column if not exists organization_id uuid references public.organizations(id);
alter table public.inventory_movements add column if not exists unit_cost_cents numeric(18,4);
alter table public.inventory_movements add column if not exists total_cost_cents bigint;
alter table public.inventory_movements add column if not exists reference_type text;
alter table public.inventory_movements add column if not exists reference_id uuid;
alter table public.inventory_movements add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.inventory_movements drop constraint if exists inventory_movements_kind_check;
alter table public.inventory_movements add constraint inventory_movements_kind_check check(kind in('entry','loss','adjust_in','adjust_out','sale','return','purchase','sale_consumption','cancellation_reversal','adjustment_positive','adjustment_negative','waste','transfer_out','transfer_in','inventory_count','return_to_supplier','production_in','production_out'));
update public.inventory_movements m set organization_id=coalesce(e.organization_id,e.id) from public.establishments e where e.id=m.establishment_id and m.organization_id is null;
alter table public.inventory_movements alter column organization_id set not null;
create index if not exists inventory_movements_reporting on public.inventory_movements(organization_id,establishment_id,kind,created_at desc);
create index if not exists inventory_movements_reference on public.inventory_movements(reference_type,reference_id) where reference_id is not null;

create table public.inventory_unit_conversions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), inventory_item_id uuid references public.inventory_items(id) on delete cascade,
 from_unit text not null check(from_unit in('un','kg','g','l','ml','pacote','caixa','porcao')), to_unit text not null check(to_unit in('un','kg','g','l','ml','pacote','caixa','porcao')),
 factor numeric(18,6) not null check(factor>0), created_at timestamptz not null default now(), unique(organization_id,inventory_item_id,from_unit,to_unit)
);
create table public.inventory_settings(
 establishment_id uuid primary key references public.establishments(id) on delete cascade, organization_id uuid not null references public.organizations(id),
 negative_stock_policy text not null default 'block' check(negative_stock_policy in('block','allow_with_alert')), default_coverage_days integer not null default 7 check(default_coverage_days between 1 and 90),
 purchase_approval_limit_cents bigint, low_margin_percent numeric(6,2) not null default 30, updated_by uuid, updated_at timestamptz not null default now()
);
create table public.inventory_member_permissions(
 establishment_id uuid not null references public.establishments(id) on delete cascade, user_id uuid not null,
 can_view boolean not null default false, can_adjust boolean not null default false, can_count boolean not null default false, can_record_waste boolean not null default false,
 can_create_purchase boolean not null default false, can_approve_purchase boolean not null default false, can_receive_purchase boolean not null default false,
 can_manage_suppliers boolean not null default false, can_view_costs boolean not null default false, can_view_margin boolean not null default false,
 can_transfer boolean not null default false, updated_at timestamptz not null default now(), primary key(establishment_id,user_id)
);
create table public.suppliers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), establishment_id uuid references public.establishments(id),
 name text not null check(length(btrim(name)) between 2 and 160), document text, contact_name text, phone text, email text, average_lead_days integer not null default 0 check(average_lead_days between 0 and 365),
 status text not null default 'active' check(status in('active','inactive')), created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index suppliers_org_name on public.suppliers(organization_id,lower(name));
create table public.supplier_inventory_items(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), supplier_id uuid not null references public.suppliers(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id) on delete cascade, supplier_code text, purchase_unit text not null,
 units_per_purchase numeric(18,6) not null default 1 check(units_per_purchase>0), last_price_cents bigint check(last_price_cents is null or last_price_cents>=0),
 lead_days integer check(lead_days is null or lead_days>=0), last_purchased_at timestamptz, unique(supplier_id,inventory_item_id,purchase_unit)
);
create table public.purchase_orders(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), establishment_id uuid not null references public.establishments(id), supplier_id uuid not null references public.suppliers(id),
 order_number bigint generated always as identity, status text not null default 'draft' check(status in('draft','pending_approval','approved','ordered','partially_received','received','cancelled')),
 total_cents bigint not null default 0 check(total_cents>=0), expected_date date, document_url text, created_by uuid, approved_by uuid, approved_at timestamptz, notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index purchase_orders_page on public.purchase_orders(establishment_id,status,created_at desc);
create table public.purchase_order_items(
 id uuid primary key default gen_random_uuid(), purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id), quantity numeric(18,4) not null check(quantity>0), purchase_unit text not null,
 quantity_base numeric(18,4) not null check(quantity_base>0), unit_cost_cents numeric(18,4) not null check(unit_cost_cents>=0), total_cost_cents bigint not null check(total_cost_cents>=0),
 received_quantity_base numeric(18,4) not null default 0 check(received_quantity_base>=0), unique(purchase_order_id,inventory_item_id,purchase_unit)
);
create table public.purchase_receipts(
 id uuid primary key default gen_random_uuid(), purchase_order_id uuid not null references public.purchase_orders(id), organization_id uuid not null references public.organizations(id), establishment_id uuid not null references public.establishments(id),
 document_number text, document_url text, received_by uuid, received_at timestamptz not null default now(), notes text, idempotency_key uuid not null unique
);
create table public.purchase_receipt_items(
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.purchase_receipts(id) on delete cascade, purchase_order_item_id uuid not null references public.purchase_order_items(id),
 inventory_item_id uuid not null references public.inventory_items(id), quantity_base numeric(18,4) not null check(quantity_base>0), unit_cost_cents numeric(18,4) not null check(unit_cost_cents>=0),
 lot_code text, expires_on date, divergence_quantity numeric(18,4) not null default 0
);
create table public.inventory_counts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), establishment_id uuid not null references public.establishments(id),
 status text not null default 'open' check(status in('open','review','confirmed','cancelled')), started_by uuid, confirmed_by uuid, notes text,
 started_at timestamptz not null default now(), confirmed_at timestamptz
);
create table public.inventory_count_items(
 id uuid primary key default gen_random_uuid(), inventory_count_id uuid not null references public.inventory_counts(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id), system_quantity numeric(18,4) not null, counted_quantity numeric(18,4), difference numeric(18,4) generated always as (counted_quantity-system_quantity) stored,
 unique(inventory_count_id,inventory_item_id)
);
create table public.inventory_waste(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), establishment_id uuid not null references public.establishments(id), inventory_item_id uuid not null references public.inventory_items(id),
 quantity numeric(18,4) not null check(quantity>0), reason text not null check(reason in('expiration','preparation_error','breakage','waste','damage','other')), notes text,
 estimated_cost_cents bigint not null default 0, movement_id uuid unique references public.inventory_movements(id), created_by uuid, created_at timestamptz not null default now(), idempotency_key uuid not null unique
);
create table public.inventory_transfers(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), source_establishment_id uuid not null references public.establishments(id), destination_establishment_id uuid not null references public.establishments(id),
 status text not null default 'draft' check(status in('draft','pending','in_transit','received','cancelled')), requested_by uuid, sent_by uuid, received_by uuid, notes text,
 created_at timestamptz not null default now(), sent_at timestamptz, received_at timestamptz, check(source_establishment_id<>destination_establishment_id)
);
create index inventory_transfers_page on public.inventory_transfers(organization_id,status,created_at desc);
create table public.inventory_transfer_items(
 id uuid primary key default gen_random_uuid(), transfer_id uuid not null references public.inventory_transfers(id) on delete cascade,
 source_item_id uuid not null references public.inventory_items(id), destination_item_id uuid references public.inventory_items(id), quantity numeric(18,4) not null check(quantity>0),
 sent_quantity numeric(18,4) not null default 0, received_quantity numeric(18,4) not null default 0
);
create table public.inventory_audit_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id), establishment_id uuid not null references public.establishments(id),
 event_type text not null, entity_type text not null, entity_id uuid, actor_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index inventory_audit_page on public.inventory_audit_events(establishment_id,created_at desc);

do $$ declare t text; begin foreach t in array array['inventory_unit_conversions','inventory_settings','inventory_member_permissions','suppliers','supplier_inventory_items','purchase_orders','purchase_order_items','purchase_receipts','purchase_receipt_items','inventory_counts','inventory_count_items','inventory_waste','inventory_transfers','inventory_transfer_items','inventory_audit_events'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t); end loop; end $$;

create or replace function inventory_private.has_permission(store uuid, permission_name text) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(store,array['owner','manager']::public.member_role[]) or exists(
  select 1 from public.inventory_member_permissions p where p.establishment_id=store and p.user_id=auth.uid() and case permission_name
   when 'view' then p.can_view when 'adjust' then p.can_adjust when 'count' then p.can_count when 'waste' then p.can_record_waste
   when 'purchase' then p.can_create_purchase when 'approve' then p.can_approve_purchase when 'receive' then p.can_receive_purchase
   when 'suppliers' then p.can_manage_suppliers when 'costs' then p.can_view_costs when 'margin' then p.can_view_margin when 'transfer' then p.can_transfer else false end)
$$;
create policy inventory_items_phase16_read on public.inventory_unit_conversions for select to authenticated using(exists(select 1 from public.inventory_items i where i.id=inventory_item_id and inventory_private.has_permission(i.establishment_id,'view')));
create policy inventory_settings_read on public.inventory_settings for select to authenticated using(inventory_private.has_permission(establishment_id,'view'));
create policy inventory_permissions_manager on public.inventory_member_permissions for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy suppliers_read on public.suppliers for select to authenticated using(establishment_id is null or inventory_private.has_permission(establishment_id,'view') or exists(select 1 from public.establishments e where e.organization_id=suppliers.organization_id and inventory_private.has_permission(e.id,'view')));
create policy supplier_items_read on public.supplier_inventory_items for select to authenticated using(exists(select 1 from public.inventory_items i where i.id=inventory_item_id and inventory_private.has_permission(i.establishment_id,'view')));
create policy purchase_orders_read on public.purchase_orders for select to authenticated using(inventory_private.has_permission(establishment_id,'view'));
create policy purchase_items_read on public.purchase_order_items for select to authenticated using(exists(select 1 from public.purchase_orders p where p.id=purchase_order_id and inventory_private.has_permission(p.establishment_id,'view')));
create policy purchase_receipts_read on public.purchase_receipts for select to authenticated using(inventory_private.has_permission(establishment_id,'view'));
create policy purchase_receipt_items_read on public.purchase_receipt_items for select to authenticated using(exists(select 1 from public.purchase_receipts r where r.id=receipt_id and inventory_private.has_permission(r.establishment_id,'view')));
create policy inventory_counts_read on public.inventory_counts for select to authenticated using(inventory_private.has_permission(establishment_id,'view'));
create policy inventory_count_items_read on public.inventory_count_items for select to authenticated using(exists(select 1 from public.inventory_counts c where c.id=inventory_count_id and inventory_private.has_permission(c.establishment_id,'view')));
create policy inventory_waste_read on public.inventory_waste for select to authenticated using(inventory_private.has_permission(establishment_id,'view'));
create policy inventory_transfers_read on public.inventory_transfers for select to authenticated using(inventory_private.has_permission(source_establishment_id,'view') or inventory_private.has_permission(destination_establishment_id,'view'));
create policy inventory_transfer_items_read on public.inventory_transfer_items for select to authenticated using(exists(select 1 from public.inventory_transfers t where t.id=transfer_id and(inventory_private.has_permission(t.source_establishment_id,'view') or inventory_private.has_permission(t.destination_establishment_id,'view'))));
create policy inventory_audit_read on public.inventory_audit_events for select to authenticated using(inventory_private.has_permission(establishment_id,'view'));
grant select on public.inventory_unit_conversions,public.inventory_settings,public.inventory_member_permissions,public.suppliers,public.supplier_inventory_items,public.purchase_orders,public.purchase_order_items,public.purchase_receipts,public.purchase_receipt_items,public.inventory_counts,public.inventory_count_items,public.inventory_waste,public.inventory_transfers,public.inventory_transfer_items,public.inventory_audit_events to authenticated;

insert into public.inventory_settings(establishment_id,organization_id)
select e.id,coalesce(e.organization_id,e.id) from public.establishments e on conflict(establishment_id) do nothing;

create or replace function public.inventory_convert_quantity(requested_item_id uuid,requested_quantity numeric,requested_from_unit text) returns numeric
language plpgsql stable security definer set search_path='' as $$ declare i public.inventory_items%rowtype; f numeric; begin
 select * into i from public.inventory_items where id=requested_item_id; if i.id is null then raise exception 'Insumo não encontrado.'; end if;
 if requested_from_unit=i.unit then return requested_quantity; end if;
 if requested_from_unit='kg' and i.unit='g' then return requested_quantity*1000; end if; if requested_from_unit='g' and i.unit='kg' then return requested_quantity/1000; end if;
 if requested_from_unit='l' and i.unit='ml' then return requested_quantity*1000; end if; if requested_from_unit='ml' and i.unit='l' then return requested_quantity/1000; end if;
 select factor into f from public.inventory_unit_conversions where organization_id=i.organization_id and inventory_item_id in(i.id,null) and from_unit=requested_from_unit and to_unit=i.unit order by inventory_item_id nulls last limit 1;
 if f is null then raise exception 'Conversão não cadastrada entre % e %.',requested_from_unit,i.unit; end if; return requested_quantity*f;
end $$;

create or replace function public.inventory_phase16_summary(requested_establishment_id uuid,requested_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare since_at timestamptz:=now()-make_interval(days=>least(greatest(requested_days,1),365)); begin
 if not inventory_private.has_permission(requested_establishment_id,'view') then raise exception 'Sem permissão.'; end if;
 return jsonb_build_object(
  'inventory_value_cents',(select coalesce(round(sum(balance*average_cost_cents)),0) from public.inventory_items where establishment_id=requested_establishment_id and active),
  'low_stock',(select count(*) from public.inventory_items where establishment_id=requested_establishment_id and active and balance<=minimum),
  'stockouts',(select count(*) from public.inventory_items where establishment_id=requested_establishment_id and active and balance<=0),
  'waste_cents',(select coalesce(sum(estimated_cost_cents),0) from public.inventory_waste where establishment_id=requested_establishment_id and created_at>=since_at),
  'pending_purchases',(select count(*) from public.purchase_orders where establishment_id=requested_establishment_id and status in('pending_approval','approved','ordered','partially_received')),
  'cmv_cents',(select coalesce(sum(abs(total_cost_cents)),0) from public.inventory_movements where establishment_id=requested_establishment_id and kind in('sale','sale_consumption') and created_at>=since_at),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'unit',i.unit,'stock',i.balance,'minimum',i.minimum,'average_cost_cents',i.average_cost_cents,'coverage_days',case when c.daily>0 then round(i.balance/c.daily,1) end,'suggested_purchase',greatest(0,round(c.daily*coalesce(s.default_coverage_days,7)+i.safety_stock-i.balance,4))) order by(i.balance<=i.minimum)desc,i.name),'[]'::jsonb) from public.inventory_items i left join public.inventory_settings s on s.establishment_id=i.establishment_id left join lateral(select coalesce(sum(abs(m.quantity))/greatest(requested_days,1),0) daily from public.inventory_movements m where m.stock_item_id=i.id and m.kind in('sale','sale_consumption') and m.created_at>=since_at)c on true where i.establishment_id=requested_establishment_id and i.active)
 ); end $$;

create or replace function public.inventory_product_costs(requested_establishment_id uuid) returns table(product_id uuid,product_name text,sale_price_cents integer,cost_cents bigint,gross_margin_cents bigint,gross_margin_percent numeric,estimated_capacity numeric)
language plpgsql stable security definer set search_path='' as $$ begin
 if not inventory_private.has_permission(requested_establishment_id,'costs') then raise exception 'Sem permissão para visualizar custos.'; end if;
 return query select p.id,p.name,p.price_cents,coalesce(round(sum(r.quantity_base*i.average_cost_cents)),0)::bigint,
 (p.price_cents-coalesce(round(sum(r.quantity_base*i.average_cost_cents)),0))::bigint,
 case when p.price_cents>0 then round((p.price_cents-coalesce(sum(r.quantity_base*i.average_cost_cents),0))*100/p.price_cents,2) else 0 end,
 min(case when r.quantity_base>0 then floor(i.balance/r.quantity_base) end)
 from public.products p left join public.inventory_recipes r on r.product_id=p.id and r.establishment_id=p.establishment_id and r.variation_id is null and r.addon_id is null
 left join public.inventory_items i on i.id=r.stock_item_id where p.establishment_id=requested_establishment_id group by p.id,p.name,p.price_cents order by gross_margin_percent desc nulls last;
end $$;

create or replace function public.inventory_save_item_v2(requested_establishment_id uuid,requested_item_id uuid,requested_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$ declare saved uuid; org uuid; begin
 if not inventory_private.has_permission(requested_establishment_id,'adjust') then raise exception 'Sem permissão.'; end if; perform pg_advisory_xact_lock(hashtextextended('inventory:'||requested_establishment_id,0));
 select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;
 if requested_item_id is null then insert into public.inventory_items(establishment_id,organization_id,name,sku,unit,minimum,maximum,safety_stock,block_insufficient,track_stock,active,warehouse_type,auto_disable_on_stockout,internally_produced)
 values(requested_establishment_id,org,btrim(requested_payload->>'name'),nullif(btrim(requested_payload->>'sku'),''),requested_payload->>'unit',coalesce((requested_payload->>'minimum')::numeric,0),nullif(requested_payload->>'maximum','')::numeric,coalesce((requested_payload->>'safety_stock')::numeric,0),coalesce((requested_payload->>'block_insufficient')::boolean,false),coalesce((requested_payload->>'track_stock')::boolean,true),coalesce((requested_payload->>'active')::boolean,true),coalesce(requested_payload->>'warehouse_type','store'),coalesce((requested_payload->>'auto_disable_on_stockout')::boolean,false),coalesce((requested_payload->>'internally_produced')::boolean,false)) returning id into saved;
 else update public.inventory_items set name=btrim(requested_payload->>'name'),sku=nullif(btrim(requested_payload->>'sku'),''),minimum=coalesce((requested_payload->>'minimum')::numeric,minimum),maximum=nullif(requested_payload->>'maximum','')::numeric,safety_stock=coalesce((requested_payload->>'safety_stock')::numeric,safety_stock),block_insufficient=coalesce((requested_payload->>'block_insufficient')::boolean,block_insufficient),track_stock=coalesce((requested_payload->>'track_stock')::boolean,track_stock),active=coalesce((requested_payload->>'active')::boolean,active),warehouse_type=coalesce(requested_payload->>'warehouse_type',warehouse_type),auto_disable_on_stockout=coalesce((requested_payload->>'auto_disable_on_stockout')::boolean,auto_disable_on_stockout),internally_produced=coalesce((requested_payload->>'internally_produced')::boolean,internally_produced),updated_at=now() where id=requested_item_id and establishment_id=requested_establishment_id returning id into saved; end if;
 insert into public.inventory_audit_events(organization_id,establishment_id,event_type,entity_type,entity_id,actor_id,metadata) values(org,requested_establishment_id,'item_saved','inventory_item',saved,auth.uid(),requested_payload); return saved; end $$;

create or replace function public.inventory_record_waste(requested_establishment_id uuid,requested_item_id uuid,requested_quantity numeric,requested_reason text,requested_notes text,requested_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$ declare i public.inventory_items%rowtype; movement uuid; saved uuid; org uuid; begin
 if not inventory_private.has_permission(requested_establishment_id,'waste') then raise exception 'Sem permissão.'; end if; select * into i from public.inventory_items where id=requested_item_id and establishment_id=requested_establishment_id for update; if i.id is null then raise exception 'Insumo não encontrado.'; end if;
 if exists(select 1 from public.inventory_waste where idempotency_key=requested_key) then return(select id from public.inventory_waste where idempotency_key=requested_key); end if;
 if requested_quantity<=0 or(i.balance<requested_quantity and coalesce((select negative_stock_policy from public.inventory_settings where establishment_id=requested_establishment_id),'block')='block') then raise exception 'Quantidade inválida ou saldo insuficiente.'; end if;
 org:=i.organization_id; update public.inventory_items set balance=balance-requested_quantity,updated_at=now() where id=i.id returning balance into i.balance;
 insert into public.inventory_movements(establishment_id,organization_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,unit_cost_cents,total_cost_cents,request_id) values(requested_establishment_id,org,i.id,-requested_quantity,i.balance,'waste',requested_reason,auth.uid(),inventory_private.inventory_actor(),i.average_cost_cents,round(requested_quantity*i.average_cost_cents),requested_key) returning id into movement;
 insert into public.inventory_waste(organization_id,establishment_id,inventory_item_id,quantity,reason,notes,estimated_cost_cents,movement_id,created_by,idempotency_key) values(org,requested_establishment_id,i.id,requested_quantity,requested_reason,requested_notes,round(requested_quantity*i.average_cost_cents),movement,auth.uid(),requested_key) returning id into saved; return saved; end $$;

create or replace function public.inventory_start_count(requested_establishment_id uuid,requested_notes text default null) returns uuid language plpgsql security definer set search_path='' as $$ declare saved uuid; org uuid; begin
 if not inventory_private.has_permission(requested_establishment_id,'count') then raise exception 'Sem permissão.'; end if; if exists(select 1 from public.inventory_counts where establishment_id=requested_establishment_id and status in('open','review')) then raise exception 'Já existe um inventário aberto.'; end if;
 select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id; insert into public.inventory_counts(organization_id,establishment_id,started_by,notes)values(org,requested_establishment_id,auth.uid(),requested_notes)returning id into saved;
 insert into public.inventory_count_items(inventory_count_id,inventory_item_id,system_quantity)select saved,id,balance from public.inventory_items where establishment_id=requested_establishment_id and active and track_stock; return saved; end $$;
create or replace function public.inventory_confirm_count(requested_establishment_id uuid,requested_count_id uuid,requested_counts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare c public.inventory_counts%rowtype; line jsonb; ci public.inventory_count_items%rowtype; item public.inventory_items%rowtype; adjusted integer:=0; begin
 if not inventory_private.has_permission(requested_establishment_id,'count') then raise exception 'Sem permissão.'; end if; perform pg_advisory_xact_lock(hashtextextended('inventory:'||requested_establishment_id,0)); select * into c from public.inventory_counts where id=requested_count_id and establishment_id=requested_establishment_id and status in('open','review') for update; if c.id is null then raise exception 'Inventário não encontrado.'; end if;
 for line in select value from jsonb_array_elements(requested_counts) loop update public.inventory_count_items set counted_quantity=(line->>'quantity')::numeric where inventory_count_id=c.id and inventory_item_id=(line->>'item_id')::uuid returning * into ci; select * into item from public.inventory_items where id=ci.inventory_item_id for update; if ci.difference<>0 then update public.inventory_items set balance=ci.counted_quantity,updated_at=now() where id=item.id; insert into public.inventory_movements(establishment_id,organization_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,unit_cost_cents,total_cost_cents,reference_type,reference_id) values(c.establishment_id,c.organization_id,item.id,ci.difference,ci.counted_quantity,'inventory_count','Contagem física confirmada',auth.uid(),inventory_private.inventory_actor(),item.average_cost_cents,round(abs(ci.difference)*item.average_cost_cents),'inventory_count',c.id); adjusted:=adjusted+1; end if; end loop;
 update public.inventory_counts set status='confirmed',confirmed_by=auth.uid(),confirmed_at=now() where id=c.id; return jsonb_build_object('ok',true,'adjusted_items',adjusted); end $$;

create or replace function public.inventory_save_supplier(requested_establishment_id uuid,requested_supplier_id uuid,requested_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$ declare saved uuid; org uuid; begin
 if not inventory_private.has_permission(requested_establishment_id,'suppliers') then raise exception 'Sem permissão.'; end if; select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id;
 if requested_supplier_id is null then insert into public.suppliers(organization_id,establishment_id,name,document,contact_name,phone,email,average_lead_days,status,created_by)values(org,requested_establishment_id,btrim(requested_payload->>'name'),requested_payload->>'document',requested_payload->>'contact_name',requested_payload->>'phone',requested_payload->>'email',coalesce((requested_payload->>'average_lead_days')::integer,0),coalesce(requested_payload->>'status','active'),auth.uid())returning id into saved;
 else update public.suppliers set name=btrim(requested_payload->>'name'),document=requested_payload->>'document',contact_name=requested_payload->>'contact_name',phone=requested_payload->>'phone',email=requested_payload->>'email',average_lead_days=coalesce((requested_payload->>'average_lead_days')::integer,average_lead_days),status=coalesce(requested_payload->>'status',status),updated_at=now() where id=requested_supplier_id and organization_id=org returning id into saved; end if; return saved; end $$;

create or replace function public.inventory_create_purchase_order(requested_establishment_id uuid,requested_supplier_id uuid,requested_items jsonb,requested_expected_date date,requested_notes text) returns uuid language plpgsql security definer set search_path='' as $$ declare saved uuid; org uuid; line jsonb; total bigint:=0; approval bigint; initial_status text; begin
 if not inventory_private.has_permission(requested_establishment_id,'purchase') then raise exception 'Sem permissão.'; end if; select coalesce(organization_id,id) into org from public.establishments where id=requested_establishment_id; if not exists(select 1 from public.suppliers where id=requested_supplier_id and organization_id=org and status='active') then raise exception 'Fornecedor inválido.'; end if;
 for line in select value from jsonb_array_elements(requested_items) loop total:=total+round((line->>'quantity')::numeric*(line->>'unit_cost_cents')::numeric); end loop; select purchase_approval_limit_cents into approval from public.inventory_settings where establishment_id=requested_establishment_id; initial_status:=case when approval is not null and total>approval then 'pending_approval' else 'approved' end;
 insert into public.purchase_orders(organization_id,establishment_id,supplier_id,status,total_cents,expected_date,created_by,approved_by,approved_at,notes)values(org,requested_establishment_id,requested_supplier_id,initial_status,total,requested_expected_date,auth.uid(),case when initial_status='approved' then auth.uid() end,case when initial_status='approved' then now() end,requested_notes)returning id into saved;
 for line in select value from jsonb_array_elements(requested_items) loop insert into public.purchase_order_items(purchase_order_id,inventory_item_id,quantity,purchase_unit,quantity_base,unit_cost_cents,total_cost_cents)values(saved,(line->>'item_id')::uuid,(line->>'quantity')::numeric,line->>'unit',public.inventory_convert_quantity((line->>'item_id')::uuid,(line->>'quantity')::numeric,line->>'unit'),(line->>'unit_cost_cents')::numeric,round((line->>'quantity')::numeric*(line->>'unit_cost_cents')::numeric)); end loop; return saved; end $$;

create or replace function public.inventory_receive_purchase(requested_establishment_id uuid,requested_purchase_id uuid,requested_items jsonb,requested_document text,requested_notes text,requested_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare p public.purchase_orders%rowtype; line jsonb; poi public.purchase_order_items%rowtype; i public.inventory_items%rowtype; received numeric; new_avg numeric; receipt uuid; completed boolean; begin
 if not inventory_private.has_permission(requested_establishment_id,'receive') then raise exception 'Sem permissão.'; end if; perform pg_advisory_xact_lock(hashtextextended('inventory:'||requested_establishment_id,0)); if exists(select 1 from public.purchase_receipts where idempotency_key=requested_key) then return jsonb_build_object('ok',true,'duplicate',true); end if;
 select * into p from public.purchase_orders where id=requested_purchase_id and establishment_id=requested_establishment_id and status in('approved','ordered','partially_received') for update; if p.id is null then raise exception 'Pedido de compra não está disponível para recebimento.'; end if; insert into public.purchase_receipts(purchase_order_id,organization_id,establishment_id,document_number,received_by,notes,idempotency_key)values(p.id,p.organization_id,p.establishment_id,requested_document,auth.uid(),requested_notes,requested_key)returning id into receipt;
 for line in select value from jsonb_array_elements(requested_items) loop select * into poi from public.purchase_order_items where id=(line->>'purchase_order_item_id')::uuid and purchase_order_id=p.id for update; received:=(line->>'quantity_base')::numeric; if poi.id is null or received<=0 or poi.received_quantity_base+received>poi.quantity_base then raise exception 'Quantidade recebida inválida.'; end if; select * into i from public.inventory_items where id=poi.inventory_item_id and establishment_id=p.establishment_id for update; new_avg:=case when i.balance+received>0 then((i.balance*i.average_cost_cents)+(received*(line->>'unit_cost_cents')::numeric))/(i.balance+received) else(line->>'unit_cost_cents')::numeric end; update public.inventory_items set balance=balance+received,average_cost_cents=new_avg,last_cost_cents=(line->>'unit_cost_cents')::numeric,updated_at=now() where id=i.id returning * into i; update public.purchase_order_items set received_quantity_base=received_quantity_base+received where id=poi.id;
 insert into public.purchase_receipt_items(receipt_id,purchase_order_item_id,inventory_item_id,quantity_base,unit_cost_cents,lot_code,expires_on,divergence_quantity)values(receipt,poi.id,i.id,received,(line->>'unit_cost_cents')::numeric,line->>'lot_code',nullif(line->>'expires_on','')::date,poi.quantity_base-(poi.received_quantity_base+received)); insert into public.inventory_movements(establishment_id,organization_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,unit_cost_cents,total_cost_cents,reference_type,reference_id)values(p.establishment_id,p.organization_id,i.id,received,i.balance,'purchase','Recebimento de compra',auth.uid(),inventory_private.inventory_actor(),(line->>'unit_cost_cents')::numeric,round(received*(line->>'unit_cost_cents')::numeric),'purchase_receipt',receipt); end loop;
 completed:=not exists(select 1 from public.purchase_order_items where purchase_order_id=p.id and received_quantity_base<quantity_base); update public.purchase_orders set status=case when completed then 'received' else 'partially_received' end,updated_at=now() where id=p.id; return jsonb_build_object('ok',true,'receipt_id',receipt,'status',case when completed then 'received' else 'partially_received' end); end $$;

create or replace function public.inventory_create_transfer(requested_source_id uuid,requested_destination_id uuid,requested_items jsonb,requested_notes text) returns uuid language plpgsql security definer set search_path='' as $$ declare saved uuid; org uuid; line jsonb; begin
 if not inventory_private.has_permission(requested_source_id,'transfer') then raise exception 'Sem permissão.'; end if; select coalesce(organization_id,id) into org from public.establishments where id=requested_source_id; if not exists(select 1 from public.establishments where id=requested_destination_id and coalesce(organization_id,id)=org) then raise exception 'Destino de outra organização.'; end if; insert into public.inventory_transfers(organization_id,source_establishment_id,destination_establishment_id,status,requested_by,notes)values(org,requested_source_id,requested_destination_id,'pending',auth.uid(),requested_notes)returning id into saved; for line in select value from jsonb_array_elements(requested_items) loop insert into public.inventory_transfer_items(transfer_id,source_item_id,destination_item_id,quantity)values(saved,(line->>'source_item_id')::uuid,nullif(line->>'destination_item_id','')::uuid,(line->>'quantity')::numeric); end loop; return saved; end $$;
create or replace function public.inventory_transfer_action(requested_establishment_id uuid,requested_transfer_id uuid,requested_action text) returns jsonb language plpgsql security definer set search_path='' as $$ declare t public.inventory_transfers%rowtype; line public.inventory_transfer_items%rowtype; source_item public.inventory_items%rowtype; destination_item public.inventory_items%rowtype; begin
 if not inventory_private.has_permission(requested_establishment_id,'transfer') then raise exception 'Sem permissão.'; end if; select * into t from public.inventory_transfers where id=requested_transfer_id for update; if t.id is null or requested_establishment_id not in(t.source_establishment_id,t.destination_establishment_id) then raise exception 'Transferência não encontrada.'; end if; perform pg_advisory_xact_lock(hashtextextended('inventory:'||t.organization_id,0));
 if requested_action='send' then if t.status<>'pending' or requested_establishment_id<>t.source_establishment_id then raise exception 'Transferência não pode ser enviada.'; end if; for line in select * from public.inventory_transfer_items where transfer_id=t.id order by source_item_id loop select * into source_item from public.inventory_items where id=line.source_item_id and establishment_id=t.source_establishment_id for update; if source_item.balance<line.quantity then raise exception 'Saldo insuficiente para transferência.'; end if; update public.inventory_items set balance=balance-line.quantity,updated_at=now() where id=source_item.id returning * into source_item; update public.inventory_transfer_items set sent_quantity=line.quantity where id=line.id; insert into public.inventory_movements(establishment_id,organization_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,unit_cost_cents,total_cost_cents,reference_type,reference_id)values(t.source_establishment_id,t.organization_id,source_item.id,-line.quantity,source_item.balance,'transfer_out','Transferência entre unidades',auth.uid(),inventory_private.inventory_actor(),source_item.average_cost_cents,round(line.quantity*source_item.average_cost_cents),'inventory_transfer',t.id); end loop; update public.inventory_transfers set status='in_transit',sent_by=auth.uid(),sent_at=now() where id=t.id;
 elsif requested_action='receive' then if t.status<>'in_transit' or requested_establishment_id<>t.destination_establishment_id then raise exception 'Transferência não pode ser recebida.'; end if; for line in select * from public.inventory_transfer_items where transfer_id=t.id order by destination_item_id loop select * into destination_item from public.inventory_items where id=line.destination_item_id and establishment_id=t.destination_establishment_id for update; if destination_item.id is null then raise exception 'Vincule o insumo de destino antes de receber.'; end if; update public.inventory_items set balance=balance+line.sent_quantity,updated_at=now() where id=destination_item.id returning * into destination_item; update public.inventory_transfer_items set received_quantity=line.sent_quantity where id=line.id; insert into public.inventory_movements(establishment_id,organization_id,stock_item_id,quantity,balance_after,kind,reason,actor_id,actor_name,unit_cost_cents,total_cost_cents,reference_type,reference_id)values(t.destination_establishment_id,t.organization_id,destination_item.id,line.sent_quantity,destination_item.balance,'transfer_in','Transferência recebida',auth.uid(),inventory_private.inventory_actor(),destination_item.average_cost_cents,round(line.sent_quantity*destination_item.average_cost_cents),'inventory_transfer',t.id); end loop; update public.inventory_transfers set status='received',received_by=auth.uid(),received_at=now() where id=t.id; else raise exception 'Ação inválida.'; end if; return jsonb_build_object('ok',true,'action',requested_action); end $$;

-- Preserve the existing idempotent sale trigger while attaching cost snapshots to new consumption.
create or replace function inventory_private.inventory_movement_cost_snapshot() returns trigger language plpgsql security definer set search_path='' as $$ declare i public.inventory_items%rowtype; begin select * into i from public.inventory_items where id=new.stock_item_id; new.organization_id:=coalesce(new.organization_id,i.organization_id); if new.unit_cost_cents is null then new.unit_cost_cents:=i.average_cost_cents; end if; if new.total_cost_cents is null then new.total_cost_cents:=round(abs(new.quantity)*new.unit_cost_cents); end if; return new; end $$;
drop trigger if exists inventory_movement_cost_snapshot on public.inventory_movements;
create trigger inventory_movement_cost_snapshot before insert on public.inventory_movements for each row execute function inventory_private.inventory_movement_cost_snapshot();

revoke all on function inventory_private.has_permission(uuid,text),inventory_private.inventory_movement_cost_snapshot() from public,anon,authenticated;
do $$ declare fn text; begin foreach fn in array array['inventory_convert_quantity(uuid,numeric,text)','inventory_phase16_summary(uuid,integer)','inventory_product_costs(uuid)','inventory_save_item_v2(uuid,uuid,jsonb)','inventory_record_waste(uuid,uuid,numeric,text,text,uuid)','inventory_start_count(uuid,text)','inventory_confirm_count(uuid,uuid,jsonb)','inventory_save_supplier(uuid,uuid,jsonb)','inventory_create_purchase_order(uuid,uuid,jsonb,date,text)','inventory_receive_purchase(uuid,uuid,jsonb,text,text,uuid)','inventory_create_transfer(uuid,uuid,jsonb,text)','inventory_transfer_action(uuid,uuid,text)'] loop execute 'revoke all on function public.'||fn||' from public,anon'; execute 'grant execute on function public.'||fn||' to authenticated,service_role'; end loop; end $$;
