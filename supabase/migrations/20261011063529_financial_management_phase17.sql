-- Phase 17: auditable managerial finance built on official orders, payments,
-- purchases, subscriptions, inventory CMV and the existing physical POS cash shifts.

alter table public.plans add column if not exists financial_management_enabled boolean not null default true;
alter table public.plans add column if not exists financial_reconciliation_enabled boolean not null default true;
alter table public.plans add column if not exists financial_multi_store_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists financial_management_enabled boolean not null default true;

create table if not exists public.financial_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency text not null default 'BRL' check(currency='BRL'),
  approval_threshold_cents bigint not null default 0 check(approval_threshold_cents>=0),
  dual_approval_enabled boolean not null default false,
  overdue_alert_days integer not null default 3 check(overdue_alert_days between 1 and 30),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(length(btrim(name)) between 2 and 100), kind text not null check(kind in ('income','expense')),
  system_code text, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,system_code)
);

create table if not exists public.financial_cost_centers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade, name text not null check(length(btrim(name)) between 2 and 100),
  system_code text, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,store_id,system_code)
);
create unique index if not exists financial_cost_centers_scope_code_unique on public.financial_cost_centers(organization_id,coalesce(store_id,'00000000-0000-0000-0000-000000000000'::uuid),system_code) where system_code is not null;

create table if not exists public.financial_member_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default false, can_view_costs boolean not null default false, can_create boolean not null default false,
  can_edit boolean not null default false, can_mark_paid boolean not null default false, can_approve boolean not null default false,
  can_reconcile boolean not null default false, can_open_cash boolean not null default false, can_close_cash boolean not null default false,
  can_view_pnl boolean not null default false, can_view_consolidated boolean not null default false,
  updated_at timestamptz not null default now(), primary key(organization_id,user_id)
);

create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete restrict, type text not null check(type in ('income','expense')),
  category_id uuid not null references public.financial_categories(id) on delete restrict,
  cost_center_id uuid references public.financial_cost_centers(id) on delete restrict,
  source_type text not null check(source_type in ('order','purchase_order','supplier_invoice','subscription','gateway_fee','refund','manual','payroll_summary','other')),
  source_id uuid, description text not null check(length(btrim(description)) between 2 and 500), amount_cents bigint not null check(amount_cents>0),
  due_date date not null, paid_at timestamptz, paid_amount_cents bigint not null default 0 check(paid_amount_cents>=0),
  status text not null default 'pending' check(status in ('pending','paid','overdue','cancelled','partially_paid','pending_approval')),
  payment_method text, gateway_provider text, channel text, created_by_user_id uuid references auth.users(id) on delete set null,
  approved_by_user_id uuid references auth.users(id) on delete set null, approval_status text not null default 'not_required' check(approval_status in ('not_required','pending','approved','rejected')),
  installment_group_id uuid, installment_number integer, installment_count integer,
  parent_entry_id uuid references public.financial_entries(id) on delete restrict,
  idempotency_key text, metadata jsonb not null default '{}'::jsonb, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(paid_amount_cents<=amount_cents), check((installment_number is null and installment_count is null) or (installment_number between 1 and installment_count))
);
create unique index if not exists financial_entries_source_unique on public.financial_entries(organization_id,source_type,source_id,type) where source_id is not null;
create unique index if not exists financial_entries_idempotency_unique on public.financial_entries(organization_id,idempotency_key) where idempotency_key is not null;
create index if not exists financial_entries_scope_due_idx on public.financial_entries(organization_id,store_id,status,due_date);
create index if not exists financial_entries_source_idx on public.financial_entries(source_type,source_id);
create index if not exists financial_entries_category_paid_idx on public.financial_entries(organization_id,category_id,paid_at desc);

create table if not exists public.financial_entry_payments (
  id uuid primary key default gen_random_uuid(), entry_id uuid not null references public.financial_entries(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete restrict,
  amount_cents bigint not null check(amount_cents>0), payment_method text, paid_at timestamptz not null default now(),
  reference text, created_by_user_id uuid references auth.users(id) on delete set null, idempotency_key text not null,
  created_at timestamptz not null default now(), unique(organization_id,idempotency_key)
);
create index if not exists financial_payments_scope_date_idx on public.financial_entry_payments(organization_id,store_id,paid_at desc);

create table if not exists public.financial_reconciliations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.establishments(id) on delete cascade, order_id uuid references public.orders(id) on delete set null,
  payment_transaction_id uuid references public.order_payment_transactions(id) on delete set null,
  gateway text not null, payment_method text, expected_cents bigint not null check(expected_cents>=0), received_cents bigint,
  fee_cents bigint not null default 0 check(fee_cents>=0), net_cents bigint,
  expected_at timestamptz, received_at timestamptz, status text not null default 'pending' check(status in ('pending','matched','divergent','missing','manually_resolved')),
  difference_cents bigint generated always as (coalesce(received_cents,0)-(expected_cents-fee_cents)) stored,
  resolved_by uuid references auth.users(id) on delete set null, resolution_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(payment_transaction_id)
);
create index if not exists financial_reconciliation_scope_idx on public.financial_reconciliations(organization_id,store_id,status,expected_at desc);

create table if not exists public.financial_recurring_expenses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete restrict, category_id uuid not null references public.financial_categories(id) on delete restrict,
  cost_center_id uuid references public.financial_cost_centers(id) on delete restrict, description text not null,
  amount_cents bigint not null check(amount_cents>0), frequency text not null check(frequency in ('weekly','monthly','quarterly','yearly')),
  next_due_date date not null, end_date date, active boolean not null default true, created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(end_date is null or end_date>=next_due_date)
);

create table if not exists public.financial_budgets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade, category_id uuid not null references public.financial_categories(id) on delete restrict,
  month date not null check(date_trunc('month',month)::date=month), amount_cents bigint not null check(amount_cents>=0),
  created_by_user_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,store_id,category_id,month)
);

create table if not exists public.financial_attachments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null references public.financial_entries(id) on delete restrict, storage_path text not null, file_name text not null,
  mime_type text, size_bytes bigint check(size_bytes is null or size_bytes between 1 and 10485760), created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), unique(entry_id,storage_path)
);

create table if not exists public.financial_action_previews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade, requested_by uuid not null references auth.users(id) on delete cascade,
  action_type text not null check(action_type in ('settle','cancel','approve','reconcile')), target_id uuid not null,
  payload jsonb not null default '{}'::jsonb, expires_at timestamptz not null default(now()+interval '10 minutes'), used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_audit_events (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete set null, actor_user_id uuid references auth.users(id) on delete set null,
  action text not null, entity_type text not null, entity_id uuid, before_data jsonb, after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists financial_audit_scope_idx on public.financial_audit_events(organization_id,store_id,created_at desc);

alter table public.financial_settings enable row level security;
alter table public.financial_categories enable row level security;
alter table public.financial_cost_centers enable row level security;
alter table public.financial_member_permissions enable row level security;
alter table public.financial_entries enable row level security;
alter table public.financial_entry_payments enable row level security;
alter table public.financial_reconciliations enable row level security;
alter table public.financial_recurring_expenses enable row level security;
alter table public.financial_budgets enable row level security;
alter table public.financial_attachments enable row level security;
alter table public.financial_action_previews enable row level security;
alter table public.financial_audit_events enable row level security;

create or replace function private.financial_can_access(target_organization uuid,target_store uuid,requested_permission text default 'view') returns boolean
language sql stable security definer set search_path=public,private,pg_temp as $$
  select (select auth.uid()) is not null and (
    exists(select 1 from public.organization_members om where om.organization_id=target_organization and om.user_id=(select auth.uid()) and om.active and om.role in ('owner','admin') and (target_store is null or om.all_stores or exists(select 1 from public.organization_member_store_access sa where sa.organization_id=target_organization and sa.user_id=om.user_id and sa.establishment_id=target_store)))
    or exists(select 1 from public.establishment_members em join public.establishments e on e.id=em.establishment_id where em.user_id=(select auth.uid()) and em.status='active' and e.organization_id=target_organization and (target_store is null or em.establishment_id=target_store) and em.role in ('owner','manager'))
    or exists(select 1 from public.financial_member_permissions fp where fp.organization_id=target_organization and fp.user_id=(select auth.uid()) and case requested_permission when 'view' then fp.can_view when 'costs' then fp.can_view_costs when 'create' then fp.can_create when 'edit' then fp.can_edit when 'paid' then fp.can_mark_paid when 'approve' then fp.can_approve when 'reconcile' then fp.can_reconcile when 'open_cash' then fp.can_open_cash when 'close_cash' then fp.can_close_cash when 'pnl' then fp.can_view_pnl when 'consolidated' then fp.can_view_consolidated else false end)
  )
$$;
revoke all on function private.financial_can_access(uuid,uuid,text) from public,anon;
grant execute on function private.financial_can_access(uuid,uuid,text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['financial_settings','financial_categories','financial_cost_centers','financial_member_permissions','financial_entries','financial_entry_payments','financial_reconciliations','financial_recurring_expenses','financial_budgets','financial_attachments','financial_action_previews','financial_audit_events'] loop
    execute format('drop policy if exists %I on public.%I','finance_read_'||t,t);
    execute format('create policy %I on public.%I for select to authenticated using(private.financial_can_access(organization_id,case when %L in (''financial_settings'',''financial_categories'',''financial_member_permissions'',''financial_action_previews'',''financial_attachments'') then null else %I end,''view''))','finance_read_'||t,t,t,case when t in ('financial_settings','financial_categories','financial_member_permissions','financial_action_previews','financial_attachments') then 'organization_id' else 'store_id' end);
  end loop;
end $$;

grant select on public.financial_settings,public.financial_categories,public.financial_cost_centers,public.financial_member_permissions,
 public.financial_entries,public.financial_entry_payments,public.financial_reconciliations,public.financial_recurring_expenses,
 public.financial_budgets,public.financial_attachments,public.financial_audit_events to authenticated;
revoke insert,update,delete on public.financial_settings,public.financial_categories,public.financial_cost_centers,public.financial_member_permissions,
 public.financial_entries,public.financial_entry_payments,public.financial_reconciliations,public.financial_recurring_expenses,
 public.financial_budgets,public.financial_attachments,public.financial_action_previews,public.financial_audit_events from anon,authenticated;

create or replace function private.ensure_financial_defaults(target_organization uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
  insert into public.financial_settings(organization_id) values(target_organization) on conflict do nothing;
  insert into public.financial_categories(organization_id,name,kind,system_code) values
   (target_organization,'Vendas','income','sales'),(target_organization,'Assinaturas','income','subscriptions'),(target_organization,'Taxas de serviço','income','service_fees'),(target_organization,'Outras receitas','income','other_income'),
   (target_organization,'CMV','expense','cmv'),(target_organization,'Fornecedores','expense','suppliers'),(target_organization,'Folha','expense','payroll'),(target_organization,'Aluguel','expense','rent'),
   (target_organization,'Energia','expense','energy'),(target_organization,'Água','expense','water'),(target_organization,'Gás','expense','gas'),(target_organization,'Marketing','expense','marketing'),
   (target_organization,'Taxas financeiras','expense','gateway_fees'),(target_organization,'Manutenção','expense','maintenance'),(target_organization,'Impostos','expense','taxes'),
   (target_organization,'Cancelamentos e reembolsos','expense','refunds'),(target_organization,'Outras despesas','expense','other_expense') on conflict(organization_id,system_code) do nothing;
  insert into public.financial_cost_centers(organization_id,name,system_code)
  select target_organization,v.name,v.code from (values('Administrativo','administrative'),('Cozinha','kitchen'),('Delivery','delivery'),('Marketing','marketing'),('Salão','dining')) v(name,code)
  where not exists(select 1 from public.financial_cost_centers c where c.organization_id=target_organization and c.store_id is null and c.system_code=v.code);
end $$;
revoke all on function private.ensure_financial_defaults(uuid) from public,anon,authenticated;

create or replace function private.financial_audit(target_org uuid,target_store uuid,target_action text,target_type text,target_id uuid,before_value jsonb,after_value jsonb) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 insert into public.financial_audit_events(organization_id,store_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) values(target_org,target_store,(select auth.uid()),target_action,target_type,target_id,before_value,after_value);
 insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(target_store,(select auth.uid()),'finance.'||target_action,target_type,target_id,jsonb_build_object('organization_id',target_org,'before',before_value,'after',after_value));
end $$;
revoke all on function private.financial_audit(uuid,uuid,text,text,uuid,jsonb,jsonb) from public,anon,authenticated;

create or replace function private.sync_order_financial() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid:=new.organization_id; store uuid:=coalesce(new.store_id,new.establishment_id); category uuid; existing_id uuid;
begin
 perform private.ensure_financial_defaults(org);
 select id into category from public.financial_categories where organization_id=org and system_code='sales';
 if (new.paid_at is not null or new.status::text in ('delivered','completed')) and new.status::text not in ('cancelled','canceled') then
   insert into public.financial_entries(organization_id,store_id,type,category_id,source_type,source_id,description,amount_cents,due_date,paid_at,paid_amount_cents,status,payment_method,channel,metadata)
   values(org,store,'income',category,'order',new.id,'Pedido #'||new.order_number,new.total_cents,coalesce(new.paid_at,new.updated_at)::date,coalesce(new.paid_at,new.updated_at),new.total_cents,'paid',new.payment_method,coalesce(new.order_source_channel,new.source_channel,new.source),jsonb_build_object('order_number',new.order_number))
   on conflict(organization_id,source_type,source_id,type) where source_id is not null do update set amount_cents=excluded.amount_cents,payment_method=excluded.payment_method,channel=excluded.channel,updated_at=now();
 end if;
 if new.status::text in ('cancelled','canceled') then
   select id into existing_id from public.financial_entries where organization_id=org and source_type='order' and source_id=new.id and type='income';
   if existing_id is not null then
     select id into category from public.financial_categories where organization_id=org and system_code='refunds';
     insert into public.financial_entries(organization_id,store_id,type,category_id,source_type,source_id,description,amount_cents,due_date,paid_at,paid_amount_cents,status,payment_method,channel,metadata)
     values(org,store,'expense',category,'refund',new.id,'Cancelamento/estorno do pedido #'||new.order_number,new.total_cents,current_date,now(),new.total_cents,'paid',new.payment_method,coalesce(new.order_source_channel,new.source_channel,new.source),jsonb_build_object('order_id',new.id))
     on conflict(organization_id,source_type,source_id,type) where source_id is not null do nothing;
   end if;
 end if;
 return new;
end $$;
drop trigger if exists orders_financial_sync on public.orders;
create trigger orders_financial_sync after insert or update of status,paid_at,total_cents,payment_method on public.orders for each row execute function private.sync_order_financial();

create or replace function private.sync_purchase_financial() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare po public.purchase_orders%rowtype; category uuid;
begin
 select * into po from public.purchase_orders where id=new.purchase_order_id;
 perform private.ensure_financial_defaults(po.organization_id);
 select id into category from public.financial_categories where organization_id=po.organization_id and system_code='suppliers';
 insert into public.financial_entries(organization_id,store_id,type,category_id,source_type,source_id,description,amount_cents,due_date,status,created_by_user_id,metadata)
 values(po.organization_id,po.establishment_id,'expense',category,'purchase_order',po.id,'Compra #'||po.order_number,po.total_cents,coalesce(po.expected_date,new.received_at::date),'pending',po.created_by,jsonb_build_object('supplier_id',po.supplier_id,'receipt_id',new.id))
 on conflict(organization_id,source_type,source_id,type) where source_id is not null do update set amount_cents=excluded.amount_cents,due_date=excluded.due_date,updated_at=now();
 return new;
end $$;
drop trigger if exists purchase_receipts_financial_sync on public.purchase_receipts;
create trigger purchase_receipts_financial_sync after insert on public.purchase_receipts for each row execute function private.sync_purchase_financial();

create or replace function private.sync_customer_subscription_financial() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare sub public.customer_subscriptions%rowtype; category uuid;
begin
 if new.status not in ('paid','approved') or new.amount_cents<=0 then return new; end if;
 select * into sub from public.customer_subscriptions where id=new.subscription_id;
 perform private.ensure_financial_defaults(new.organization_id);
 select id into category from public.financial_categories where organization_id=new.organization_id and system_code='subscriptions';
 insert into public.financial_entries(organization_id,store_id,type,category_id,source_type,source_id,description,amount_cents,due_date,paid_at,paid_amount_cents,status,payment_method,gateway_provider,metadata)
 values(new.organization_id,sub.establishment_id,'income',category,'subscription',new.id,'Receita de assinatura',new.amount_cents,new.occurred_at::date,new.occurred_at,new.amount_cents,'paid','online',new.provider,jsonb_build_object('subscription_id',new.subscription_id,'external_payment_id',new.external_payment_id))
 on conflict(organization_id,source_type,source_id,type) where source_id is not null do nothing;
 return new;
end $$;
drop trigger if exists customer_subscription_financial_sync on public.customer_subscription_billing_events;
create trigger customer_subscription_financial_sync after insert or update of status on public.customer_subscription_billing_events for each row execute function private.sync_customer_subscription_financial();

create or replace function private.sync_gateway_reconciliation() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; channel_value text;
begin
 select organization_id,coalesce(order_source_channel,source_channel,source) into org,channel_value from public.orders where id=new.order_id;
 if org is null then select organization_id into org from public.establishments where id=new.establishment_id; end if;
 if new.status in ('approved','paid') then
  insert into public.financial_reconciliations(organization_id,store_id,order_id,payment_transaction_id,gateway,payment_method,expected_cents,received_cents,fee_cents,net_cents,expected_at,received_at,status)
  values(org,new.establishment_id,new.order_id,new.id,new.provider,new.payment_kind,new.amount_cents,new.amount_cents,0,new.amount_cents,coalesce(new.approved_at,new.created_at),coalesce(new.approved_at,new.updated_at),'matched')
  on conflict(payment_transaction_id) do update set received_cents=excluded.received_cents,received_at=excluded.received_at,status='matched',updated_at=now();
 end if;
 return new;
end $$;
drop trigger if exists gateway_financial_reconciliation on public.order_payment_transactions;
create trigger gateway_financial_reconciliation after insert or update of status,amount_cents on public.order_payment_transactions for each row execute function private.sync_gateway_reconciliation();

create or replace function public.financial_create_entry(requested_establishment_id uuid,requested_type text,requested_category_id uuid,requested_cost_center_id uuid,requested_description text,requested_amount_cents bigint,requested_due_date date,requested_payment_method text default null,requested_installments integer default 1,requested_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; actor uuid:=(select auth.uid()); settings public.financial_settings%rowtype; group_id uuid:=gen_random_uuid(); i integer; amount_piece bigint; remainder bigint; saved uuid; ids jsonb:='[]'::jsonb; approval text;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 if actor is null or not private.financial_can_access(org,requested_establishment_id,'create') then raise exception 'Sem permissão para criar lançamentos.'; end if;
 if requested_type not in ('income','expense') or requested_amount_cents<=0 or requested_installments not between 1 and 60 then raise exception 'Dados financeiros inválidos.'; end if;
 if not exists(select 1 from public.financial_categories where id=requested_category_id and organization_id=org and kind=requested_type and active) then raise exception 'Categoria inválida.'; end if;
 perform private.ensure_financial_defaults(org); select * into settings from public.financial_settings where organization_id=org;
 approval:=case when requested_type='expense' and settings.approval_threshold_cents>0 and requested_amount_cents>=settings.approval_threshold_cents then 'pending' else 'not_required' end;
 amount_piece:=requested_amount_cents/requested_installments; remainder:=requested_amount_cents-(amount_piece*requested_installments);
 for i in 1..requested_installments loop
  insert into public.financial_entries(organization_id,store_id,type,category_id,cost_center_id,source_type,description,amount_cents,due_date,status,payment_method,created_by_user_id,approval_status,installment_group_id,installment_number,installment_count,idempotency_key)
  values(org,requested_establishment_id,requested_type,requested_category_id,requested_cost_center_id,'manual',btrim(requested_description),amount_piece+case when i=requested_installments then remainder else 0 end,(requested_due_date+(i-1)*interval '1 month')::date,case when approval='pending' then 'pending_approval' else 'pending' end,requested_payment_method,actor,approval,group_id,i,requested_installments,case when requested_idempotency_key is null then null else requested_idempotency_key||':'||i end) returning id into saved;
  perform private.financial_audit(org,requested_establishment_id,'entry_created','financial_entries',saved,null,jsonb_build_object('amount_cents',amount_piece+case when i=requested_installments then remainder else 0 end,'installment',i,'count',requested_installments)); ids:=ids||to_jsonb(saved);
 end loop;
 return jsonb_build_object('entry_ids',ids,'approval_status',approval,'installment_group_id',group_id);
end $$;

create or replace function public.financial_save_recurring(requested_establishment_id uuid,requested_id uuid,requested_category_id uuid,requested_cost_center_id uuid,requested_description text,requested_amount_cents bigint,requested_frequency text,requested_next_due_date date,requested_end_date date default null) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; saved public.financial_recurring_expenses%rowtype;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'create') then raise exception 'Sem permissão.'; end if;
 if requested_frequency not in ('weekly','monthly','quarterly','yearly') or requested_amount_cents<=0 then raise exception 'Recorrência inválida.'; end if;
 insert into public.financial_recurring_expenses(id,organization_id,store_id,category_id,cost_center_id,description,amount_cents,frequency,next_due_date,end_date,created_by_user_id)
 values(coalesce(requested_id,gen_random_uuid()),org,requested_establishment_id,requested_category_id,requested_cost_center_id,btrim(requested_description),requested_amount_cents,requested_frequency,requested_next_due_date,requested_end_date,(select auth.uid()))
 on conflict(id) do update set category_id=excluded.category_id,cost_center_id=excluded.cost_center_id,description=excluded.description,amount_cents=excluded.amount_cents,frequency=excluded.frequency,next_due_date=excluded.next_due_date,end_date=excluded.end_date,updated_at=now() returning * into saved;
 perform private.financial_audit(org,requested_establishment_id,'recurring_saved','financial_recurring_expenses',saved.id,null,to_jsonb(saved)); return to_jsonb(saved);
end $$;

create or replace function public.financial_generate_recurring(requested_establishment_id uuid,requested_until date default current_date) returns integer
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; r public.financial_recurring_expenses%rowtype; generated integer:=0; next_date date;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'create') then raise exception 'Sem permissão.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-recurring:'||requested_establishment_id::text,0));
 for r in select * from public.financial_recurring_expenses where organization_id=org and (store_id=requested_establishment_id or store_id is null) and active and next_due_date<=requested_until for update loop
  next_date:=r.next_due_date;
  while next_date<=requested_until and (r.end_date is null or next_date<=r.end_date) loop
   insert into public.financial_entries(organization_id,store_id,type,category_id,cost_center_id,source_type,source_id,description,amount_cents,due_date,status,created_by_user_id,idempotency_key,metadata)
   values(org,r.store_id,'expense',r.category_id,r.cost_center_id,'other',r.id,r.description,r.amount_cents,next_date,'pending',(select auth.uid()),'recurring:'||r.id::text||':'||next_date::text,jsonb_build_object('recurring_expense_id',r.id)) on conflict(organization_id,idempotency_key) where idempotency_key is not null do nothing;
   if found then generated:=generated+1; end if;
   next_date:=case r.frequency when 'weekly' then (next_date+interval '7 days')::date when 'monthly' then (next_date+interval '1 month')::date when 'quarterly' then (next_date+interval '3 months')::date else (next_date+interval '1 year')::date end;
  end loop;
  update public.financial_recurring_expenses set next_due_date=next_date,active=case when end_date is not null and next_date>end_date then false else active end,updated_at=now() where id=r.id;
 end loop;
 return generated;
end $$;

create or replace function public.financial_preview_action(requested_establishment_id uuid,requested_action text,requested_target_id uuid,requested_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; needed text; preview public.financial_action_previews%rowtype; description text; amount bigint;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 needed:=case requested_action when 'settle' then 'paid' when 'approve' then 'approve' when 'reconcile' then 'reconcile' else 'edit' end;
 if requested_action not in ('settle','cancel','approve','reconcile') or not private.financial_can_access(org,requested_establishment_id,needed) then raise exception 'Sem permissão para esta ação.'; end if;
 if requested_action='reconcile' then select 'Conciliação '||gateway,expected_cents into description,amount from public.financial_reconciliations where id=requested_target_id and organization_id=org and store_id=requested_establishment_id;
 else select financial_entries.description,financial_entries.amount_cents into description,amount from public.financial_entries where id=requested_target_id and organization_id=org and store_id=requested_establishment_id; end if;
 if description is null then raise exception 'Registro não encontrado.'; end if;
 insert into public.financial_action_previews(organization_id,store_id,requested_by,action_type,target_id,payload) values(org,requested_establishment_id,(select auth.uid()),requested_action,requested_target_id,requested_payload) returning * into preview;
 return jsonb_build_object('preview_token',preview.id,'expires_at',preview.expires_at,'action',requested_action,'description',description,'amount_cents',amount,'payload',requested_payload);
end $$;

create or replace function public.financial_confirm_action(requested_establishment_id uuid,requested_preview_token uuid) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; p public.financial_action_previews%rowtype; e public.financial_entries%rowtype; rec public.financial_reconciliations%rowtype; amount bigint; remaining bigint; settings public.financial_settings%rowtype; fee_category uuid; fee_entry uuid;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 select * into p from public.financial_action_previews where id=requested_preview_token and organization_id=org and store_id=requested_establishment_id and requested_by=(select auth.uid()) and used_at is null and expires_at>now() for update;
 if not found then raise exception 'Confirmação inválida ou expirada.'; end if;
 if p.action_type='reconcile' then
  if not private.financial_can_access(org,requested_establishment_id,'reconcile') then raise exception 'Sem permissão.'; end if;
  select * into rec from public.financial_reconciliations where id=p.target_id and organization_id=org for update;
  amount:=greatest(0,coalesce((p.payload->>'received_cents')::bigint,rec.received_cents,0)); rec.fee_cents:=greatest(0,coalesce((p.payload->>'fee_cents')::bigint,rec.fee_cents,0));
  update public.financial_reconciliations set received_cents=amount,fee_cents=rec.fee_cents,net_cents=amount-rec.fee_cents,received_at=coalesce(received_at,now()),status=case when amount=expected_cents then 'matched' else 'manually_resolved' end,resolved_by=(select auth.uid()),resolution_notes=nullif(p.payload->>'notes',''),updated_at=now() where id=rec.id returning * into rec;
  if rec.fee_cents>0 then perform private.ensure_financial_defaults(org); select id into fee_category from public.financial_categories where organization_id=org and system_code='gateway_fees';
   insert into public.financial_entries(organization_id,store_id,type,category_id,source_type,source_id,description,amount_cents,due_date,paid_at,paid_amount_cents,status,payment_method,gateway_provider,metadata)
   values(org,requested_establishment_id,'expense',fee_category,'gateway_fee',rec.payment_transaction_id,'Taxa '||rec.gateway,rec.fee_cents,coalesce(rec.received_at,now())::date,coalesce(rec.received_at,now()),rec.fee_cents,'paid',rec.payment_method,rec.gateway,jsonb_build_object('reconciliation_id',rec.id))
   on conflict(organization_id,source_type,source_id,type) where source_id is not null do update set amount_cents=excluded.amount_cents,paid_amount_cents=excluded.amount_cents,updated_at=now() returning id into fee_entry;
  end if;
  perform private.financial_audit(org,requested_establishment_id,'reconciled','financial_reconciliations',rec.id,null,to_jsonb(rec));
 else
  select * into e from public.financial_entries where id=p.target_id and organization_id=org and store_id=requested_establishment_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if p.action_type='approve' then
   if not private.financial_can_access(org,requested_establishment_id,'approve') then raise exception 'Sem permissão.'; end if; select * into settings from public.financial_settings where organization_id=org;
   if settings.dual_approval_enabled and e.created_by_user_id=(select auth.uid()) then raise exception 'A aprovação dupla exige outro usuário.'; end if;
   update public.financial_entries set approval_status='approved',approved_by_user_id=(select auth.uid()),status='pending',updated_at=now() where id=e.id returning * into e; perform private.financial_audit(org,e.store_id,'approved','financial_entries',e.id,null,to_jsonb(e));
  elsif p.action_type='cancel' then
   if not private.financial_can_access(org,requested_establishment_id,'edit') then raise exception 'Sem permissão.'; end if;
   update public.financial_entries set status='cancelled',cancelled_at=now(),updated_at=now() where id=e.id and source_type in ('manual','other','payroll_summary','supplier_invoice') returning * into e;
   if not found then raise exception 'Lançamentos automáticos devem ser corrigidos na origem.'; end if; perform private.financial_audit(org,e.store_id,'cancelled','financial_entries',e.id,null,to_jsonb(e));
  else
   if not private.financial_can_access(org,requested_establishment_id,'paid') then raise exception 'Sem permissão.'; end if;
   if e.status in ('cancelled','paid','pending_approval') or e.approval_status='pending' then raise exception 'Lançamento não pode ser liquidado neste estado.'; end if;
   remaining:=e.amount_cents-e.paid_amount_cents; amount:=least(remaining,greatest(1,coalesce((p.payload->>'amount_cents')::bigint,remaining)));
   insert into public.financial_entry_payments(entry_id,organization_id,store_id,amount_cents,payment_method,reference,created_by_user_id,idempotency_key) values(e.id,org,e.store_id,amount,coalesce(p.payload->>'payment_method',e.payment_method),nullif(p.payload->>'reference',''),(select auth.uid()),p.id::text);
   update public.financial_entries set paid_amount_cents=paid_amount_cents+amount,paid_at=case when paid_amount_cents+amount=amount_cents then now() else paid_at end,status=case when paid_amount_cents+amount=amount_cents then 'paid' else 'partially_paid' end,payment_method=coalesce(p.payload->>'payment_method',payment_method),updated_at=now() where id=e.id returning * into e;
   perform private.financial_audit(org,e.store_id,'payment_recorded','financial_entries',e.id,null,jsonb_build_object('amount_cents',amount,'entry',to_jsonb(e)));
  end if;
 end if;
 update public.financial_action_previews set used_at=now() where id=p.id; return jsonb_build_object('ok',true,'action',p.action_type,'target_id',p.target_id);
end $$;

create or replace function public.financial_save_budget(requested_establishment_id uuid,requested_category_id uuid,requested_month date,requested_amount_cents bigint) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; saved public.financial_budgets%rowtype;
begin select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'edit') then raise exception 'Sem permissão.'; end if;
 insert into public.financial_budgets(organization_id,store_id,category_id,month,amount_cents,created_by_user_id) values(org,requested_establishment_id,requested_category_id,date_trunc('month',requested_month)::date,requested_amount_cents,(select auth.uid()))
 on conflict(organization_id,store_id,category_id,month) do update set amount_cents=excluded.amount_cents,updated_at=now() returning * into saved;
 perform private.financial_audit(org,requested_establishment_id,'budget_saved','financial_budgets',saved.id,null,to_jsonb(saved)); return to_jsonb(saved); end $$;

create or replace function public.financial_add_attachment(requested_establishment_id uuid,requested_entry_id uuid,requested_path text,requested_name text,requested_mime text,requested_size bigint) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; saved public.financial_attachments%rowtype;
begin select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'edit') or requested_path not like org::text||'/'||requested_establishment_id::text||'/%' then raise exception 'Anexo inválido.'; end if;
 if not exists(select 1 from public.financial_entries where id=requested_entry_id and organization_id=org and store_id=requested_establishment_id) then raise exception 'Lançamento inválido.'; end if;
 insert into public.financial_attachments(organization_id,entry_id,storage_path,file_name,mime_type,size_bytes,created_by_user_id) values(org,requested_entry_id,requested_path,left(requested_name,200),requested_mime,requested_size,(select auth.uid())) returning * into saved;
 perform private.financial_audit(org,requested_establishment_id,'attachment_added','financial_attachments',saved.id,null,jsonb_build_object('file_name',saved.file_name)); return to_jsonb(saved); end $$;

create or replace function public.financial_save_category(requested_establishment_id uuid,requested_id uuid,requested_name text,requested_kind text) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; saved public.financial_categories%rowtype;
begin select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'edit') or requested_kind not in ('income','expense') then raise exception 'Sem permissão ou tipo inválido.'; end if;
 insert into public.financial_categories(id,organization_id,name,kind) values(coalesce(requested_id,gen_random_uuid()),org,btrim(requested_name),requested_kind)
 on conflict(id) do update set name=excluded.name,kind=excluded.kind,updated_at=now() where financial_categories.organization_id=org and financial_categories.system_code is null returning * into saved;
 if saved.id is null then raise exception 'Categorias do sistema não podem ter o tipo alterado.'; end if;
 perform private.financial_audit(org,requested_establishment_id,'category_saved','financial_categories',saved.id,null,to_jsonb(saved)); return to_jsonb(saved); end $$;

create or replace function public.financial_save_cost_center(requested_establishment_id uuid,requested_id uuid,requested_name text) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; saved public.financial_cost_centers%rowtype;
begin select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'edit') then raise exception 'Sem permissão.'; end if;
 insert into public.financial_cost_centers(id,organization_id,store_id,name) values(coalesce(requested_id,gen_random_uuid()),org,requested_establishment_id,btrim(requested_name))
 on conflict(id) do update set name=excluded.name,updated_at=now() where financial_cost_centers.organization_id=org and financial_cost_centers.system_code is null returning * into saved;
 if saved.id is null then raise exception 'Centro de custo do sistema não pode ser alterado.'; end if;
 perform private.financial_audit(org,requested_establishment_id,'cost_center_saved','financial_cost_centers',saved.id,null,to_jsonb(saved)); return to_jsonb(saved); end $$;

create or replace function public.financial_configure_settings(requested_establishment_id uuid,requested_approval_threshold_cents bigint,requested_dual_approval boolean,requested_overdue_alert_days integer) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; saved public.financial_settings%rowtype;
begin select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'approve') then raise exception 'Sem permissão.'; end if;
 insert into public.financial_settings(organization_id,approval_threshold_cents,dual_approval_enabled,overdue_alert_days) values(org,greatest(0,requested_approval_threshold_cents),requested_dual_approval,greatest(1,least(30,requested_overdue_alert_days)))
 on conflict(organization_id) do update set approval_threshold_cents=excluded.approval_threshold_cents,dual_approval_enabled=excluded.dual_approval_enabled,overdue_alert_days=excluded.overdue_alert_days,updated_at=now() returning * into saved;
 perform private.financial_audit(org,requested_establishment_id,'settings_updated','financial_settings',org,null,to_jsonb(saved)); return to_jsonb(saved); end $$;

create or replace function public.financial_phase17_summary(requested_establishment_id uuid,requested_start date,requested_end date,requested_all_units boolean default false) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid; stores uuid[]; cmv bigint:=0; store_item uuid; inventory jsonb; gross bigint; refunds bigint; fees bigint; operating bigint; incomes bigint; expenses bigint;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.financial_can_access(org,requested_establishment_id,'view') then raise exception 'Sem acesso ao financeiro.'; end if;
 if requested_all_units and not private.financial_can_access(org,null,'consolidated') then raise exception 'Sem acesso ao consolidado.'; end if;
 perform private.ensure_financial_defaults(org);
 select array_agg(id) into stores from public.establishments where organization_id=org and active and (requested_all_units or id=requested_establishment_id);
 for store_item in select unnest(stores) loop begin select public.inventory_phase16_summary(store_item,greatest(1,requested_end-requested_start+1)) into inventory; cmv:=cmv+coalesce((inventory->>'cmv_cents')::bigint,0); exception when others then null; end; end loop;
 select coalesce(sum(amount_cents) filter(where type='income' and status in ('paid','partially_paid')),0),coalesce(sum(amount_cents) filter(where type='expense' and status in ('paid','partially_paid')),0) into incomes,expenses from public.financial_entries where organization_id=org and store_id=any(stores) and due_date between requested_start and requested_end;
 select coalesce(sum(amount_cents),0) into gross from public.financial_entries where organization_id=org and store_id=any(stores) and type='income' and status in ('paid','partially_paid') and due_date between requested_start and requested_end;
 select coalesce(sum(amount_cents),0) into refunds from public.financial_entries where organization_id=org and store_id=any(stores) and source_type='refund' and status in ('paid','partially_paid') and due_date between requested_start and requested_end;
 select coalesce(sum(amount_cents),0) into fees from public.financial_entries where organization_id=org and store_id=any(stores) and source_type='gateway_fee' and status in ('paid','partially_paid') and due_date between requested_start and requested_end;
 select coalesce(sum(amount_cents),0) into operating from public.financial_entries e join public.financial_categories c on c.id=e.category_id where e.organization_id=org and e.store_id=any(stores) and e.type='expense' and e.status in ('paid','partially_paid') and e.source_type not in ('refund','gateway_fee') and c.system_code<>'cmv' and e.due_date between requested_start and requested_end;
 update public.financial_entries set status='overdue',updated_at=now() where organization_id=org and store_id=any(stores) and status='pending' and due_date<current_date;
 return jsonb_build_object(
  'scope',jsonb_build_object('organization_id',org,'store_ids',stores,'all_units',requested_all_units,'currency','BRL'),
  'cards',jsonb_build_object('current_balance_cents',(select coalesce(sum(case when e.type='income' then p.amount_cents else -p.amount_cents end),0) from public.financial_entry_payments p join public.financial_entries e on e.id=p.entry_id where p.organization_id=org and p.store_id=any(stores)),'income_cents',incomes,'expense_cents',expenses,'result_cents',incomes-expenses,'payable_cents',(select coalesce(sum(amount_cents-paid_amount_cents),0) from public.financial_entries where organization_id=org and store_id=any(stores) and type='expense' and status in ('pending','overdue','partially_paid','pending_approval')),'receivable_cents',(select coalesce(sum(amount_cents-paid_amount_cents),0) from public.financial_entries where organization_id=org and store_id=any(stores) and type='income' and status in ('pending','overdue','partially_paid')),'divergences',(select count(*) from public.financial_reconciliations where organization_id=org and store_id=any(stores) and status in ('divergent','missing')),'open_cash_registers',(select count(*) from public.cash_shifts where establishment_id=any(stores) and status='open')),
  'pnl',jsonb_build_object('gross_revenue_cents',gross,'refunds_cents',refunds,'net_revenue_cents',gross-refunds,'cmv_cents',cmv,'gross_margin_cents',gross-refunds-cmv,'operating_expenses_cents',operating,'gateway_fees_cents',fees,'management_result_cents',gross-refunds-cmv-operating-fees,'disclaimer','Relatório gerencial. Não substitui demonstrações contábeis oficiais.'),
  'payables',(select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date),'[]'::jsonb) from (select e.id,e.description,e.amount_cents,e.paid_amount_cents,e.due_date,e.status,e.payment_method,e.store_id,c.name category,s.name supplier from public.financial_entries e join public.financial_categories c on c.id=e.category_id left join public.purchase_orders po on e.source_type='purchase_order' and po.id=e.source_id left join public.suppliers s on s.id=po.supplier_id where e.organization_id=org and e.store_id=any(stores) and e.type='expense' and e.status<>'cancelled' order by e.due_date desc limit 200)x),
  'receivables',(select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date),'[]'::jsonb) from (select e.id,e.description,e.amount_cents,e.paid_amount_cents,e.due_date,e.status,e.payment_method,e.store_id,e.source_type,e.source_id from public.financial_entries e where e.organization_id=org and e.store_id=any(stores) and e.type='income' and e.status<>'cancelled' order by e.due_date desc limit 200)x),
  'cash_flow',(select coalesce(jsonb_agg(to_jsonb(x) order by x.flow_date),'[]'::jsonb) from (select p.paid_at::date as flow_date,sum(p.amount_cents) filter(where e.type='income') income_cents,sum(p.amount_cents) filter(where e.type='expense') expense_cents from public.financial_entry_payments p join public.financial_entries e on e.id=p.entry_id where p.organization_id=org and p.store_id=any(stores) and p.paid_at::date between requested_start and requested_end group by p.paid_at::date)x),
  'projection',jsonb_build_object('label','Projeção gerencial para os próximos 7 dias','income_cents',(select coalesce(sum(amount_cents-paid_amount_cents),0) from public.financial_entries where organization_id=org and store_id=any(stores) and type='income' and status in ('pending','partially_paid') and due_date between current_date and current_date+7),'expense_cents',(select coalesce(sum(amount_cents-paid_amount_cents),0) from public.financial_entries where organization_id=org and store_id=any(stores) and type='expense' and status in ('pending','partially_paid','pending_approval') and due_date between current_date and current_date+7)),
  'reconciliations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.expected_at desc),'[]'::jsonb) from (select id,order_id,gateway,payment_method,expected_cents,received_cents,fee_cents,net_cents,difference_cents,status,expected_at,received_at from public.financial_reconciliations where organization_id=org and store_id=any(stores) order by expected_at desc limit 100)x),
  'cash_sessions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc),'[]'::jsonb) from (select id,establishment_id,operator_name,status,opening_cash_cents,opened_at,closed_at,expected_cash_cents,declared_cash_cents,difference_cents,gross_sales_cents from public.cash_shifts where establishment_id=any(stores) order by opened_at desc limit 50)x),
  'cash_movements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) from (select id,establishment_id,cash_shift_id,movement_type,category,payment_method,amount_cents,description,operator_name,occurred_at from public.cash_movements where establishment_id=any(stores) order by occurred_at desc limit 100)x),
  'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.kind,c.name),'[]'::jsonb) from public.financial_categories c where c.organization_id=org and c.active),
  'cost_centers',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]'::jsonb) from public.financial_cost_centers c where c.organization_id=org and c.active),
  'settings',(select to_jsonb(s) from public.financial_settings s where s.organization_id=org),
  'budgets',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) from (select b.id,b.month,b.amount_cents,b.store_id,c.name,c.system_code,coalesce(sum(e.amount_cents) filter(where e.status in ('paid','partially_paid')),0) actual_cents from public.financial_budgets b join public.financial_categories c on c.id=b.category_id left join public.financial_entries e on e.category_id=b.category_id and e.store_id=b.store_id and date_trunc('month',e.due_date)=b.month where b.organization_id=org and b.store_id=any(stores) and b.month=date_trunc('month',current_date)::date group by b.id,c.name,c.system_code)x),
  'by_store',(select coalesce(jsonb_agg(to_jsonb(x) order by x.result_cents desc),'[]'::jsonb) from (select st.id,st.name,coalesce(sum(e.amount_cents) filter(where e.type='income' and e.status in ('paid','partially_paid')),0) income_cents,coalesce(sum(e.amount_cents) filter(where e.type='expense' and e.status in ('paid','partially_paid')),0) expense_cents,coalesce(sum(case when e.type='income' then e.amount_cents else -e.amount_cents end) filter(where e.status in ('paid','partially_paid')),0) result_cents from public.establishments st left join public.financial_entries e on e.store_id=st.id and e.due_date between requested_start and requested_end where st.id=any(stores) group by st.id)x),
  'by_channel',(select coalesce(jsonb_agg(to_jsonb(x) order by x.revenue_cents desc),'[]'::jsonb) from (select coalesce(channel,'outros') channel,sum(amount_cents) revenue_cents from public.financial_entries where organization_id=org and store_id=any(stores) and type='income' and status in ('paid','partially_paid') and due_date between requested_start and requested_end group by coalesce(channel,'outros'))x),
  'supplier_summary',(select coalesce(jsonb_agg(to_jsonb(x) order by x.pending_cents desc),'[]'::jsonb) from (select s.id,s.name,coalesce(sum(po.total_cents),0) total_purchased_cents,coalesce(sum(e.amount_cents-e.paid_amount_cents) filter(where e.status in ('pending','overdue','partially_paid','pending_approval')),0) pending_cents,min(e.due_date) filter(where e.status in ('pending','overdue','partially_paid','pending_approval')) next_due_date,count(*) filter(where e.status='overdue') overdue_count from public.suppliers s left join public.purchase_orders po on po.supplier_id=s.id left join public.financial_entries e on e.source_type='purchase_order' and e.source_id=po.id where s.organization_id=org and (s.establishment_id is null or s.establishment_id=any(stores)) group by s.id)x),
  'recurring',(select coalesce(jsonb_agg(to_jsonb(r) order by r.next_due_date),'[]'::jsonb) from public.financial_recurring_expenses r where r.organization_id=org and (r.store_id is null or r.store_id=any(stores)) and r.active),
  'alerts',jsonb_build_array(jsonb_build_object('type','due_soon','message',(select coalesce(sum(amount_cents-paid_amount_cents),0) from public.financial_entries where organization_id=org and store_id=any(stores) and type='expense' and status in ('pending','partially_paid') and due_date between current_date and current_date+3)||' centavos vencem nos próximos 3 dias.'),jsonb_build_object('type','reconciliation','message',(select count(*) from public.financial_reconciliations where organization_id=org and store_id=any(stores) and status in ('divergent','missing'))||' recebimento(s) divergente(s).'),jsonb_build_object('type','cash_difference','message',(select count(*) from public.cash_shifts where establishment_id=any(stores) and status='closed' and difference_cents<>0 and closed_at>=now()-interval '7 days')||' fechamento(s) com diferença nos últimos 7 dias.'))
 );
end $$;

-- Create one private bucket and tenant-scoped object policies for financial documents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('financial-documents','financial-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','text/plain']) on conflict(id) do update set public=false,file_size_limit=10485760;
drop policy if exists financial_documents_insert on storage.objects;
create policy financial_documents_insert on storage.objects for insert to authenticated with check(bucket_id='financial-documents' and private.financial_can_access(((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid,'edit'));
drop policy if exists financial_documents_read on storage.objects;
create policy financial_documents_read on storage.objects for select to authenticated using(bucket_id='financial-documents' and private.financial_can_access(((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid,'view'));

do $$ declare org_record record; begin for org_record in select distinct organization_id from public.establishments loop perform private.ensure_financial_defaults(org_record.organization_id); end loop; end $$;

-- Backfill official, already-recognized sources. Unique source keys make this safe to rerun.
insert into public.financial_entries(organization_id,store_id,type,category_id,source_type,source_id,description,amount_cents,due_date,paid_at,paid_amount_cents,status,payment_method,channel,metadata)
select o.organization_id,o.store_id,'income',c.id,'order',o.id,'Pedido #'||o.order_number,o.total_cents,coalesce(o.paid_at,o.updated_at)::date,coalesce(o.paid_at,o.updated_at),o.total_cents,'paid',o.payment_method,coalesce(o.order_source_channel,o.source_channel,o.source),jsonb_build_object('order_number',o.order_number)
from public.orders o join public.financial_categories c on c.organization_id=o.organization_id and c.system_code='sales' where (o.paid_at is not null or o.status::text in ('delivered','completed')) and o.status::text not in ('cancelled','canceled')
on conflict(organization_id,source_type,source_id,type) where source_id is not null do nothing;

insert into public.financial_entries(organization_id,store_id,type,category_id,source_type,source_id,description,amount_cents,due_date,status,created_by_user_id,metadata)
select po.organization_id,po.establishment_id,'expense',c.id,'purchase_order',po.id,'Compra #'||po.order_number,po.total_cents,coalesce(po.expected_date,min(pr.received_at)::date),'pending',po.created_by,jsonb_build_object('supplier_id',po.supplier_id)
from public.purchase_orders po join public.purchase_receipts pr on pr.purchase_order_id=po.id join public.financial_categories c on c.organization_id=po.organization_id and c.system_code='suppliers' group by po.id,c.id
on conflict(organization_id,source_type,source_id,type) where source_id is not null do nothing;

do $$ declare f regprocedure; begin
 foreach f in array array[
  'public.financial_create_entry(uuid,text,uuid,uuid,text,bigint,date,text,integer,text)'::regprocedure,
  'public.financial_save_recurring(uuid,uuid,uuid,uuid,text,bigint,text,date,date)'::regprocedure,
  'public.financial_generate_recurring(uuid,date)'::regprocedure,
  'public.financial_preview_action(uuid,text,uuid,jsonb)'::regprocedure,
  'public.financial_confirm_action(uuid,uuid)'::regprocedure,
  'public.financial_save_budget(uuid,uuid,date,bigint)'::regprocedure,
  'public.financial_add_attachment(uuid,uuid,text,text,text,bigint)'::regprocedure,
  'public.financial_save_category(uuid,uuid,text,text)'::regprocedure,
  'public.financial_save_cost_center(uuid,uuid,text)'::regprocedure,
  'public.financial_configure_settings(uuid,bigint,boolean,integer)'::regprocedure,
  'public.financial_phase17_summary(uuid,date,date,boolean)'::regprocedure
 ] loop execute format('revoke all on function %s from public,anon',f); execute format('grant execute on function %s to authenticated',f); end loop;
end $$;

grant usage,select on sequence public.financial_audit_events_id_seq to authenticated;
