-- Cadastro de loja nova e catálogo voltam a funcionar com organization_id obrigatório desde a Fase 7.

-- Categorias e produtos herdam a organização da loja, como pedidos já fazem.
create or replace function private.fill_organization_from_establishment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select e.organization_id into new.organization_id from public.establishments e where e.id = new.establishment_id;
  return new;
end;
$$;

revoke all on function private.fill_organization_from_establishment() from public, anon, authenticated;

drop trigger if exists categories_fill_organization on public.categories;
create trigger categories_fill_organization
before insert on public.categories
for each row execute function private.fill_organization_from_establishment();

drop trigger if exists products_fill_organization on public.products;
create trigger products_fill_organization
before insert on public.products
for each row execute function private.fill_organization_from_establishment();

-- A loja nasce com a própria organização, e quem a cria é dono das duas.
create or replace function public.create_establishment(establishment_name text, requested_slug text default null::text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text;
  new_id uuid;
  new_organization_id uuid;
  new_subscription_id uuid;
  base_slug text;
  final_slug text;
  organization_slug text;
  selected_plan uuid;
  paid_checkout public.saas_checkout_sessions%rowtype;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.establishment_members where user_id=current_user_id and role='owner') then raise exception 'an owner establishment already exists'; end if;
  if char_length(trim(establishment_name))<2 then raise exception 'invalid establishment name'; end if;
  select lower(email) into current_email from auth.users where id=current_user_id;

  select * into paid_checkout from public.saas_checkout_sessions
  where status='approved' and establishment_id is null and lower(customer_email)=current_email
  order by approved_at desc nulls last,created_at desc limit 1 for update skip locked;

  if paid_checkout.id is not null then selected_plan:=paid_checkout.plan_id;
  else
    select id into selected_plan from public.plans where active order by (lower(code)='starter') desc,sort_order,created_at limit 1;
  end if;
  if selected_plan is null then raise exception 'no active SaaS plan configured'; end if;

  base_slug:=trim(both '-' from regexp_replace(lower(coalesce(nullif(requested_slug,''),establishment_name)),'[^a-z0-9]+','-','g'));
  if base_slug='' then base_slug:='minha-loja'; end if;
  final_slug:=base_slug;
  while exists(select 1 from public.establishments where slug=final_slug) loop
    final_slug:=base_slug||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6);
  end loop;
  organization_slug:=final_slug;
  while exists(select 1 from public.organizations where slug=organization_slug) loop
    organization_slug:=final_slug||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6);
  end loop;

  insert into public.organizations(name,slug,created_by) values(trim(establishment_name),organization_slug,current_user_id) returning id into new_organization_id;
  insert into public.establishments(name,slug,email,organization_id) values(trim(establishment_name),final_slug,current_email,new_organization_id) returning id into new_id;
  update public.organizations set billing_establishment_id=new_id where id=new_organization_id;
  insert into public.organization_members(organization_id,user_id,role,all_stores,active) values(new_organization_id,current_user_id,'owner',true,true);
  insert into public.establishment_members(establishment_id,user_id,role) values(new_id,current_user_id,'owner');
  insert into public.establishment_settings(establishment_id) values(new_id);
  insert into public.subscriptions(establishment_id,organization_id,plan_id,status,billing_cycle,trial_ends_at,current_period_start,current_period_end)
  values(new_id,new_organization_id,selected_plan,case when paid_checkout.id is null then 'trialing'::public.subscription_status else 'active'::public.subscription_status end,
    coalesce(paid_checkout.billing_cycle,'monthly'),case when paid_checkout.id is null then now()+interval '14 days' end,
    case when paid_checkout.id is not null then now() end,
    case when paid_checkout.billing_cycle='annual' then now()+interval '1 year' when paid_checkout.id is not null then now()+interval '1 month' end)
  returning id into new_subscription_id;
  insert into public.business_hours(establishment_id,weekday,opens_at,closes_at,closed)
  select new_id,day,'18:00'::time,'23:00'::time,day=0 from generate_series(0,6) day;

  if paid_checkout.id is not null then
    update public.saas_checkout_sessions set establishment_id=new_id,subscription_id=new_subscription_id where id=paid_checkout.id;
    insert into public.subscription_invoices(establishment_id,stripe_invoice_id,status,amount_paid_cents,hosted_invoice_url,payment_provider,provider_invoice_id)
    values(new_id,null,'paid',paid_checkout.amount_cents,paid_checkout.checkout_url,paid_checkout.provider,paid_checkout.external_id);
  end if;
  return new_id;
end $$;
