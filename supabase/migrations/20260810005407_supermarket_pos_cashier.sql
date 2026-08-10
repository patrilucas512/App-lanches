alter table public.products add column if not exists barcode text;
create unique index if not exists products_establishment_barcode_unique
  on public.products (establishment_id, barcode) where barcode is not null and barcode <> '';

alter table public.custom_staff_members
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists permissions jsonb not null default '{"open_register":true,"sell":true,"receive_orders":true,"close_register":true,"record_expenses":false}'::jsonb;
create unique index if not exists custom_staff_members_user_unique
  on public.custom_staff_members (user_id) where user_id is not null;

create table if not exists public.cashier_access_links (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  staff_member_id uuid not null references public.custom_staff_members(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  used_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists cashier_access_links_member_idx on public.cashier_access_links (staff_member_id, expires_at desc);

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  staff_member_id uuid not null references public.custom_staff_members(id) on delete restrict,
  operator_name text not null,
  status text not null default 'open' check (status in ('open','closed')),
  opening_cash_cents integer not null default 0 check (opening_cash_cents >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  expected_cash_cents integer,
  declared_cash_cents integer,
  difference_cents integer,
  gross_sales_cents integer,
  pix_cents integer,
  card_cents integer,
  cash_sales_cents integer,
  sales_count integer,
  closing_notes text,
  opened_by uuid not null references auth.users(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cash_shift_close_values check (
    (status = 'open' and closed_at is null) or
    (status = 'closed' and closed_at is not null and declared_cash_cents is not null and difference_cents is not null)
  )
);
create unique index if not exists cash_shifts_one_open_per_establishment
  on public.cash_shifts (establishment_id) where status = 'open';
create index if not exists cash_shifts_establishment_opened_idx on public.cash_shifts (establishment_id, opened_at desc);
create index if not exists cash_shifts_staff_opened_idx on public.cash_shifts (staff_member_id, opened_at desc);

create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  cash_shift_id uuid not null references public.cash_shifts(id) on delete restrict,
  staff_member_id uuid not null references public.custom_staff_members(id) on delete restrict,
  operator_name text not null,
  sale_number bigint generated always as identity,
  source text not null default 'pos' check (source in ('pos','manual','menu_order')),
  source_order_id uuid references public.orders(id) on delete restrict,
  customer_name text,
  payment_method text not null check (payment_method in ('pix','cash','credit_card','debit_card','transfer','other')),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  cash_received_cents integer,
  change_cents integer,
  status text not null default 'completed' check (status in ('completed','voided')),
  void_reason text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  unique (establishment_id, sale_number)
);
create unique index if not exists pos_sales_source_order_unique
  on public.pos_sales (source_order_id) where source_order_id is not null and status = 'completed';
create index if not exists pos_sales_shift_created_idx on public.pos_sales (cash_shift_id, created_at desc);
create index if not exists pos_sales_establishment_created_idx on public.pos_sales (establishment_id, created_at desc);

create table if not exists public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  pos_sale_id uuid not null references public.pos_sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  barcode text,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now()
);
create index if not exists pos_sale_items_sale_idx on public.pos_sale_items (pos_sale_id);
create index if not exists pos_sale_items_product_idx on public.pos_sale_items (product_id) where product_id is not null;

alter table public.cash_movements
  add column if not exists cash_shift_id uuid references public.cash_shifts(id) on delete restrict,
  add column if not exists pos_sale_id uuid references public.pos_sales(id) on delete restrict;
create index if not exists cash_movements_shift_idx on public.cash_movements (cash_shift_id, occurred_at desc);

alter table public.cashier_access_links enable row level security;
alter table public.cash_shifts enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;

create or replace function private.is_financial_employee(requested_establishment_id uuid, requested_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.custom_staff_members member
    join public.staff_roles role on role.id = member.role_id and role.establishment_id = member.establishment_id
    where member.establishment_id = requested_establishment_id
      and member.user_id = requested_user_id
      and member.status = 'active'
      and role.financial_role = true
  )
$$;

drop policy if exists custom_staff_members_employee_read on public.custom_staff_members;
create policy custom_staff_members_employee_read on public.custom_staff_members for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists staff_roles_employee_read on public.staff_roles;
create policy staff_roles_employee_read on public.staff_roles for select to authenticated
using (exists (select 1 from public.custom_staff_members member where member.role_id = staff_roles.id and member.user_id = (select auth.uid())));

create policy cashier_links_admin_all on public.cashier_access_links for all to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy cash_shifts_financial_read on public.cash_shifts for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]) or private.is_financial_employee(establishment_id));
create policy cash_shifts_financial_insert on public.cash_shifts for insert to authenticated
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]) and opened_by = (select auth.uid()));
create policy cash_shifts_financial_update on public.cash_shifts for update to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy pos_sales_financial_read on public.pos_sales for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]) or private.is_financial_employee(establishment_id));
create policy pos_items_financial_read on public.pos_sale_items for select to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]) or private.is_financial_employee(establishment_id));

create policy orders_cashier_read on public.orders for select to authenticated
using (private.is_financial_employee(establishment_id));
create policy order_items_cashier_read on public.order_items for select to authenticated
using (private.is_financial_employee(establishment_id));
create policy table_payments_cashier_read on public.table_payments for select to authenticated
using (private.is_financial_employee(establishment_id));
create policy cash_movements_cashier_read on public.cash_movements for select to authenticated
using (private.is_financial_employee(establishment_id));
create policy establishments_cashier_read on public.establishments for select to authenticated
using (private.is_financial_employee(id));

create or replace function public.create_cashier_invite(requested_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); target public.custom_staff_members%rowtype; role_record public.staff_roles%rowtype; link public.cashier_access_links%rowtype;
begin
  select * into target from public.custom_staff_members where id = requested_member_id;
  select * into role_record from public.staff_roles where id = target.role_id;
  if actor is null or target.id is null or role_record.financial_role is not true or not private.has_role(target.establishment_id, array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão para gerar este acesso.'; end if;
  if coalesce(regexp_replace(target.phone, '\D','','g'),'') = '' then raise exception 'Cadastre o WhatsApp do funcionário.'; end if;
  update public.cashier_access_links set expires_at = now(), used_at = coalesce(used_at, now()) where staff_member_id = target.id and used_at is null;
  insert into public.cashier_access_links(establishment_id,staff_member_id,created_by) values(target.establishment_id,target.id,actor) returning * into link;
  return jsonb_build_object('token',link.token,'expires_at',link.expires_at,'name',target.name,'phone',target.phone,'reset',target.user_id is not null);
end $$;

create or replace function public.claim_cashier_invite_as_user(requested_token uuid, requested_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.cashier_access_links%rowtype; target public.custom_staff_members%rowtype;
begin
  select * into link from public.cashier_access_links where token=requested_token and used_at is null and expires_at>now() for update;
  if link.id is null then raise exception 'Convite inválido ou expirado.'; end if;
  select * into target from public.custom_staff_members where id=link.staff_member_id for update;
  update public.custom_staff_members set user_id=requested_user_id,status='active' where id=target.id;
  update public.cashier_access_links set used_at=now() where id=link.id;
  return jsonb_build_object('activated',true,'establishment_id',target.establishment_id,'member_id',target.id);
end $$;

create or replace function public.open_cash_shift(requested_opening_cash_cents integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); employee public.custom_staff_members%rowtype; new_shift public.cash_shifts%rowtype;
begin
  select member.* into employee from public.custom_staff_members member join public.staff_roles role on role.id=member.role_id where member.user_id=actor and member.status='active' and role.financial_role=true limit 1;
  if employee.id is null then raise exception 'Acesso de caixa não autorizado.'; end if;
  if requested_opening_cash_cents < 0 then raise exception 'Valor inicial inválido.'; end if;
  insert into public.cash_shifts(establishment_id,staff_member_id,operator_name,opening_cash_cents,opened_by) values(employee.establishment_id,employee.id,employee.name,requested_opening_cash_cents,actor) returning * into new_shift;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(employee.establishment_id,actor,'cash.shift_opened','cash_shifts',new_shift.id,jsonb_build_object('operator',employee.name,'opening_cash_cents',requested_opening_cash_cents));
  return to_jsonb(new_shift);
exception when unique_violation then raise exception 'Já existe um caixa aberto neste estabelecimento.';
end $$;

create or replace function public.register_pos_sale(requested_shift_id uuid, requested_items jsonb, requested_payment_method text, requested_customer_name text default null, requested_source_order_id uuid default null, requested_cash_received_cents integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); shift_record public.cash_shifts%rowtype; employee public.custom_staff_members%rowtype; sale public.pos_sales%rowtype; item jsonb; product public.products%rowtype; order_record public.orders%rowtype; subtotal integer:=0; qty integer; price integer; item_name text; item_barcode text; change_value integer;
begin
  select * into shift_record from public.cash_shifts where id=requested_shift_id and status='open' for update;
  select member.* into employee from public.custom_staff_members member join public.staff_roles role on role.id=member.role_id where member.user_id=actor and member.id=shift_record.staff_member_id and member.status='active' and role.financial_role=true;
  if shift_record.id is null or employee.id is null then raise exception 'Caixa fechado ou acesso inválido.'; end if;
  if requested_payment_method not in ('pix','cash','credit_card','debit_card','transfer','other') then raise exception 'Forma de pagamento inválida.'; end if;
  if requested_source_order_id is not null then
    select * into order_record from public.orders where id=requested_source_order_id and establishment_id=shift_record.establishment_id;
    if order_record.id is null then raise exception 'Pedido não encontrado.'; end if;
    subtotal:=order_record.total_cents;
    insert into public.pos_sales(establishment_id,cash_shift_id,staff_member_id,operator_name,source,source_order_id,customer_name,payment_method,subtotal_cents,total_cents,cash_received_cents,change_cents)
    values(shift_record.establishment_id,shift_record.id,employee.id,employee.name,'menu_order',order_record.id,order_record.customer_name,requested_payment_method,subtotal,subtotal,requested_cash_received_cents,greatest(coalesce(requested_cash_received_cents,subtotal)-subtotal,0)) returning * into sale;
    insert into public.pos_sale_items(establishment_id,pos_sale_id,product_id,product_name,quantity,unit_price_cents,total_cents)
    select establishment_id,sale.id,product_id,product_name,quantity,unit_price_cents,total_cents from public.order_items where order_id=order_record.id;
  else
    if jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items)=0 then raise exception 'Adicione pelo menos um item.'; end if;
    insert into public.pos_sales(establishment_id,cash_shift_id,staff_member_id,operator_name,source,customer_name,payment_method,subtotal_cents,total_cents)
    values(shift_record.establishment_id,shift_record.id,employee.id,employee.name,'pos',nullif(btrim(requested_customer_name),''),requested_payment_method,0,0) returning * into sale;
    for item in select * from jsonb_array_elements(requested_items) loop
      qty:=greatest(coalesce((item->>'quantity')::integer,1),1);
      if nullif(item->>'product_id','') is not null then
        select * into product from public.products where id=(item->>'product_id')::uuid and establishment_id=shift_record.establishment_id and active=true;
        if product.id is null then raise exception 'Produto indisponível.'; end if;
        item_name:=product.name; price:=product.price_cents; item_barcode:=product.barcode;
      else
        item_name:=btrim(coalesce(item->>'name','')); price:=coalesce((item->>'unit_price_cents')::integer,-1); item_barcode:=nullif(item->>'barcode','');
        if length(item_name)<2 or price<0 then raise exception 'Item avulso inválido.'; end if;
      end if;
      insert into public.pos_sale_items(establishment_id,pos_sale_id,product_id,product_name,barcode,quantity,unit_price_cents,total_cents) values(shift_record.establishment_id,sale.id,product.id,item_name,item_barcode,qty,price,qty*price);
      subtotal:=subtotal+(qty*price); product:=null;
    end loop;
    change_value:=greatest(coalesce(requested_cash_received_cents,subtotal)-subtotal,0);
    update public.pos_sales set subtotal_cents=subtotal,total_cents=subtotal,cash_received_cents=requested_cash_received_cents,change_cents=case when requested_payment_method='cash' then change_value else null end where id=sale.id returning * into sale;
  end if;
  if requested_payment_method='cash' and coalesce(requested_cash_received_cents,sale.total_cents)<sale.total_cents then raise exception 'O valor recebido é menor que o total.'; end if;
  insert into public.cash_movements(establishment_id,staff_member_id,staff_role_id,operator_name,movement_type,category,payment_method,amount_cents,description,reference,created_by,cash_shift_id,pos_sale_id)
  values(shift_record.establishment_id,employee.id,employee.role_id,employee.name,'inflow',case when requested_source_order_id is null then 'Venda no caixa' else 'Pedido do cardápio' end,requested_payment_method,sale.total_cents,'Venda concluída pelo caixa','#'||sale.sale_number,actor,shift_record.id,sale.id);
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(shift_record.establishment_id,actor,'pos.sale_completed','pos_sales',sale.id,jsonb_build_object('operator',employee.name,'total_cents',sale.total_cents,'payment_method',requested_payment_method));
  return to_jsonb(sale);
end $$;

create or replace function public.close_cash_shift(requested_shift_id uuid, requested_declared_cash_cents integer, requested_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); shift_record public.cash_shifts%rowtype; employee public.custom_staff_members%rowtype; gross integer; cash_total integer; pix_total integer; card_total integer; movement_cash integer; expected integer; sale_count integer; table_gross integer; table_cash integer; table_pix integer; table_card integer; table_count integer; closed_record public.cash_shifts%rowtype;
begin
  select * into shift_record from public.cash_shifts where id=requested_shift_id and status='open' for update;
  select member.* into employee from public.custom_staff_members member join public.staff_roles role on role.id=member.role_id where member.user_id=actor and member.id=shift_record.staff_member_id and role.financial_role=true;
  if shift_record.id is null or employee.id is null then raise exception 'Caixa não encontrado ou sem autorização.'; end if;
  select coalesce(sum(total_cents),0),count(*),coalesce(sum(total_cents) filter(where payment_method='cash'),0),coalesce(sum(total_cents) filter(where payment_method='pix'),0),coalesce(sum(total_cents) filter(where payment_method in ('credit_card','debit_card')),0) into gross,sale_count,cash_total,pix_total,card_total from public.pos_sales where cash_shift_id=shift_record.id and status='completed';
  select coalesce(sum(amount_cents),0),count(*),coalesce(sum(amount_cents) filter(where payment_method='cash'),0),coalesce(sum(amount_cents) filter(where payment_method='pix'),0),coalesce(sum(amount_cents) filter(where payment_method in ('credit_card','debit_card')),0) into table_gross,table_count,table_cash,table_pix,table_card from public.table_payments where establishment_id=shift_record.establishment_id and confirmed_at>=shift_record.opened_at and confirmed_at<=now() and status='confirmed';
  gross:=gross+table_gross; sale_count:=sale_count+table_count; cash_total:=cash_total+table_cash; pix_total:=pix_total+table_pix; card_total:=card_total+table_card;
  select coalesce(sum(case when movement_type='inflow' then amount_cents else -amount_cents end),0) into movement_cash from public.cash_movements where cash_shift_id=shift_record.id and payment_method='cash' and pos_sale_id is null;
  expected:=shift_record.opening_cash_cents+cash_total+movement_cash;
  update public.cash_shifts set status='closed',closed_at=now(),expected_cash_cents=expected,declared_cash_cents=requested_declared_cash_cents,difference_cents=requested_declared_cash_cents-expected,gross_sales_cents=gross,pix_cents=pix_total,card_cents=card_total,cash_sales_cents=cash_total,sales_count=sale_count,closing_notes=nullif(btrim(requested_notes),''),closed_by=actor where id=shift_record.id returning * into closed_record;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(shift_record.establishment_id,actor,'cash.shift_closed','cash_shifts',shift_record.id,jsonb_build_object('operator',employee.name,'expected_cash_cents',expected,'declared_cash_cents',requested_declared_cash_cents,'difference_cents',requested_declared_cash_cents-expected));
  return to_jsonb(closed_record);
end $$;

create or replace function public.record_cash_adjustment(requested_shift_id uuid, requested_movement_type text, requested_category text, requested_payment_method text, requested_amount_cents integer, requested_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); shift_record public.cash_shifts%rowtype; employee public.custom_staff_members%rowtype; movement public.cash_movements%rowtype;
begin
  select * into shift_record from public.cash_shifts where id=requested_shift_id and status='open' for update;
  select member.* into employee from public.custom_staff_members member join public.staff_roles role on role.id=member.role_id where member.user_id=actor and member.id=shift_record.staff_member_id and member.status='active' and role.financial_role=true;
  if shift_record.id is null or employee.id is null then raise exception 'Caixa fechado ou acesso inválido.'; end if;
  if requested_movement_type not in ('inflow','outflow') or requested_payment_method not in ('pix','cash','credit_card','debit_card','transfer','other') or requested_amount_cents<=0 then raise exception 'Movimentação inválida.'; end if;
  insert into public.cash_movements(establishment_id,staff_member_id,staff_role_id,operator_name,movement_type,category,payment_method,amount_cents,description,created_by,cash_shift_id)
  values(shift_record.establishment_id,employee.id,employee.role_id,employee.name,requested_movement_type,btrim(requested_category),requested_payment_method,requested_amount_cents,nullif(btrim(requested_description),''),actor,shift_record.id) returning * into movement;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(shift_record.establishment_id,actor,'cash.adjustment_registered','cash_movements',movement.id,jsonb_build_object('operator',employee.name,'type',requested_movement_type,'amount_cents',requested_amount_cents,'category',requested_category));
  return to_jsonb(movement);
end $$;

create or replace function public.get_employee_login_candidates(requested_kind text, requested_name text, requested_slug text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare normalized_name text:=lower(regexp_replace(btrim(coalesce(requested_name,'')),'\s+',' ','g')); result jsonb;
begin
  if requested_kind not in ('waiter','kitchen','cashier') or length(normalized_name)<3 then return '[]'::jsonb; end if;
  if requested_kind='cashier' then
    select coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) into result from (
      select member.user_id,'c.'||regexp_replace(coalesce(member.phone,''),'\D','','g')||'@caixa.mesaviva.app' as login_email,member.status,true as active_now,member.employment_type as access_type,member.work_date,e.slug as establishment_slug
      from public.custom_staff_members member join public.staff_roles role on role.id=member.role_id join public.establishments e on e.id=member.establishment_id
      where member.user_id is not null and role.financial_role=true and lower(regexp_replace(btrim(member.name),'\s+',' ','g'))=normalized_name and (nullif(btrim(requested_slug),'') is null or e.slug=lower(btrim(requested_slug))) limit 5
    ) candidate;
  elsif requested_kind='waiter' then
    select coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) into result from (select w.user_id,'w.'||regexp_replace(coalesce(w.phone,''),'\D','','g')||'@garcom.mesaviva.app' as login_email,w.status,w.active_now,w.employment_type as access_type,w.work_date,e.slug as establishment_slug from public.waiters w join public.establishments e on e.id=w.establishment_id where w.user_id is not null and lower(regexp_replace(btrim(w.name),'\s+',' ','g'))=normalized_name and (nullif(btrim(requested_slug),'') is null or e.slug=lower(btrim(requested_slug))) limit 5) candidate;
  else
    select coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) into result from (select k.user_id,'k.'||regexp_replace(coalesce(k.phone,''),'\D','','g')||'@cozinha.mesaviva.app' as login_email,k.status,true as active_now,k.access_type,k.work_date,e.slug as establishment_slug from public.kitchen_operators k join public.establishments e on e.id=k.establishment_id where k.user_id is not null and lower(regexp_replace(btrim(k.name),'\s+',' ','g'))=normalized_name and (nullif(btrim(requested_slug),'') is null or e.slug=lower(btrim(requested_slug))) limit 5) candidate;
  end if; return result;
end $$;

revoke all on function public.create_cashier_invite(uuid) from public,anon;
revoke all on function public.claim_cashier_invite_as_user(uuid,uuid) from public,anon,authenticated;
revoke all on function public.open_cash_shift(integer) from public,anon;
revoke all on function public.register_pos_sale(uuid,jsonb,text,text,uuid,integer) from public,anon;
revoke all on function public.close_cash_shift(uuid,integer,text) from public,anon;
revoke all on function public.record_cash_adjustment(uuid,text,text,text,integer,text) from public,anon;
revoke all on function public.get_employee_login_candidates(text,text,text) from public,anon,authenticated;
grant execute on function public.create_cashier_invite(uuid) to authenticated;
grant execute on function public.claim_cashier_invite_as_user(uuid,uuid) to service_role;
grant execute on function public.open_cash_shift(integer) to authenticated;
grant execute on function public.register_pos_sale(uuid,jsonb,text,text,uuid,integer) to authenticated;
grant execute on function public.close_cash_shift(uuid,integer,text) to authenticated;
grant execute on function public.record_cash_adjustment(uuid,text,text,text,integer,text) to authenticated;
grant execute on function public.get_employee_login_candidates(text,text,text) to service_role;

grant select on public.cashier_access_links to authenticated;
grant select on public.cash_shifts to authenticated;
grant select on public.pos_sales,public.pos_sale_items to authenticated;
grant select on public.orders,public.order_items,public.table_payments,public.products to authenticated;
