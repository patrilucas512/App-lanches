create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.member_role as enum ('owner', 'manager', 'attendant', 'catalog_editor');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete');
create type public.order_status as enum ('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'canceled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  is_superadmin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  annual_price_cents integer not null check (annual_price_cents >= 0),
  max_products integer,
  max_team_members integer,
  features jsonb not null default '[]'::jsonb,
  stripe_monthly_price_id text unique,
  stripe_annual_price_id text unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  legal_name text,
  document text,
  phone text,
  email text,
  logo_url text,
  cover_url text,
  accent_color text not null default '#f97316',
  active boolean not null default true,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.establishment_members (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  unique (establishment_id, user_id)
);

create table public.establishment_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  currency text not null default 'BRL',
  locale text not null default 'pt-BR',
  timezone text not null default 'America/Sao_Paulo',
  whatsapp text,
  instagram text,
  address jsonb not null default '{}'::jsonb,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  dine_in_enabled boolean not null default false,
  minimum_order_cents integer not null default 0 check (minimum_order_cents >= 0),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references public.establishments(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status public.subscription_status not null default 'trialing',
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'annual')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  image_url text,
  price_cents integer not null check (price_cents >= 0),
  compare_at_price_cents integer check (compare_at_price_cents is null or compare_at_price_cents >= price_cents),
  active boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.addon_groups (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  min_choices integer not null default 0 check (min_choices >= 0),
  max_choices integer not null default 1 check (max_choices >= min_choices),
  required boolean not null default false,
  sort_order integer not null default 0
);

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  addon_group_id uuid not null references public.addon_groups(id) on delete cascade,
  name text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0
);

create table public.product_addon_groups (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  addon_group_id uuid not null references public.addon_groups(id) on delete cascade,
  primary key (product_id, addon_group_id)
);

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  closed boolean not null default false,
  unique (establishment_id, weekday)
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  fee_cents integer not null default 0 check (fee_cents >= 0),
  minimum_order_cents integer not null default 0 check (minimum_order_cents >= 0),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  active boolean not null default true
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  minimum_order_cents integer not null default 0,
  usage_limit integer,
  uses_count integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  unique (establishment_id, code)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  phone text not null,
  email text,
  last_order_at timestamptz,
  total_orders integer not null default 0,
  total_spent_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (establishment_id, phone)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  order_number bigint generated always as identity,
  status public.order_status not null default 'new',
  fulfillment_type text not null check (fulfillment_type in ('pickup', 'delivery', 'dine_in')),
  customer_name text not null,
  customer_phone text not null,
  delivery_address jsonb,
  notes text,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, order_number)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  addons jsonb not null default '[]'::jsonb,
  total_cents integer not null check (total_cents >= 0)
);

create table public.stripe_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create table public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  stripe_invoice_id text not null unique,
  status text,
  amount_paid_cents integer not null default 0,
  hosted_invoice_url text,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid references public.establishments(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index establishment_members_user_idx on public.establishment_members (user_id, establishment_id);
create index categories_establishment_sort_idx on public.categories (establishment_id, active, sort_order);
create index products_establishment_category_idx on public.products (establishment_id, category_id, active, sort_order);
create index addon_groups_establishment_idx on public.addon_groups (establishment_id);
create index addons_establishment_group_idx on public.addons (establishment_id, addon_group_id, active);
create index product_addon_groups_establishment_idx on public.product_addon_groups (establishment_id);
create index business_hours_establishment_idx on public.business_hours (establishment_id);
create index delivery_zones_establishment_idx on public.delivery_zones (establishment_id, active);
create index coupons_establishment_active_idx on public.coupons (establishment_id, active);
create index customers_establishment_last_order_idx on public.customers (establishment_id, last_order_at desc);
create index orders_establishment_status_created_idx on public.orders (establishment_id, status, created_at desc);
create index orders_customer_idx on public.orders (customer_id);
create index order_items_establishment_order_idx on public.order_items (establishment_id, order_id);
create index subscription_invoices_establishment_idx on public.subscription_invoices (establishment_id, created_at desc);
create index audit_logs_establishment_created_idx on public.audit_logs (establishment_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create or replace function private.is_superadmin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select p.is_superadmin from public.profiles p where p.id = (select auth.uid())), false) $$;

create or replace function private.has_role(target_establishment uuid, allowed_roles public.member_role[] default null)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_superadmin() or exists (
    select 1 from public.establishment_members m
    where m.user_id = (select auth.uid())
      and m.establishment_id = target_establishment
      and (allowed_roles is null or m.role = any(allowed_roles))
  )
$$;

revoke all on function private.is_superadmin() from public;
revoke all on function private.has_role(uuid, public.member_role[]) from public;
grant execute on function private.is_superadmin() to authenticated;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger establishments_touch before update on public.establishments for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'phone', ''))
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.create_establishment(establishment_name text, requested_slug text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_id uuid;
  base_slug text;
  final_slug text;
  starter_plan uuid;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.establishment_members where user_id = current_user_id and role = 'owner') then
    raise exception 'an owner establishment already exists';
  end if;
  if char_length(trim(establishment_name)) < 2 then raise exception 'invalid establishment name'; end if;

  base_slug := trim(both '-' from regexp_replace(lower(coalesce(nullif(requested_slug, ''), establishment_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'minha-loja'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.establishments where slug = final_slug) loop
    final_slug := base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end loop;

  select id into starter_plan from public.plans where code = 'starter' and active limit 1;
  if starter_plan is null then raise exception 'starter plan not configured'; end if;

  insert into public.establishments (name, slug) values (trim(establishment_name), final_slug) returning id into new_id;
  insert into public.establishment_members (establishment_id, user_id, role) values (new_id, current_user_id, 'owner');
  insert into public.establishment_settings (establishment_id) values (new_id);
  insert into public.subscriptions (establishment_id, plan_id, status, trial_ends_at)
  values (new_id, starter_plan, 'trialing', now() + interval '14 days');
  insert into public.business_hours (establishment_id, weekday, opens_at, closes_at, closed)
  select new_id, day, '18:00'::time, '23:00'::time, day = 0 from generate_series(0, 6) day;
  return new_id;
end
$$;

revoke all on function public.create_establishment(text, text) from public, anon;
grant execute on function public.create_establishment(text, text) to authenticated;

create or replace function public.get_public_menu(requested_slug text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'establishment', jsonb_build_object(
      'id', e.id, 'name', e.name, 'slug', e.slug, 'logo_url', e.logo_url,
      'cover_url', e.cover_url, 'accent_color', e.accent_color, 'phone', e.phone
    ),
    'settings', jsonb_build_object(
      'whatsapp', s.whatsapp, 'instagram', s.instagram, 'pickup_enabled', s.pickup_enabled,
      'delivery_enabled', s.delivery_enabled, 'dine_in_enabled', s.dine_in_enabled,
      'minimum_order_cents', s.minimum_order_cents, 'address', s.address
    ),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens_at', h.opens_at, 'closes_at', h.closes_at, 'closed', h.closed) order by h.weekday)
      from public.business_hours h where h.establishment_id = e.id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'description', p.description, 'image_url', p.image_url,
            'price_cents', p.price_cents, 'compare_at_price_cents', p.compare_at_price_cents, 'featured', p.featured
          ) order by p.sort_order, p.name)
          from public.products p where p.establishment_id = e.id and p.category_id = c.id and p.active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c where c.establishment_id = e.id and c.active
    ), '[]'::jsonb)
  )
  from public.establishments e
  join public.establishment_settings s on s.establishment_id = e.id
  join public.subscriptions sub on sub.establishment_id = e.id
  where e.slug = requested_slug and e.active
    and (sub.status in ('active', 'trialing') or sub.current_period_end > now())
$$;

revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;

insert into public.plans (code, name, description, monthly_price_cents, annual_price_cents, max_products, max_team_members, features, sort_order)
values
  ('starter', 'Essencial', 'Para começar a vender com um cardápio profissional.', 4900, 49000, 60, 2, '["Cardápio digital", "Pedidos ilimitados", "Link compartilhável"]', 1),
  ('growth', 'Crescimento', 'Para operações que precisam de equipe e gestão.', 9900, 99000, 250, 8, '["Tudo do Essencial", "Cupons", "Equipe", "Relatórios"]', 2),
  ('scale', 'Escala', 'Para marcas com alto volume e atendimento prioritário.', 19900, 199000, null, null, '["Produtos ilimitados", "Equipe ilimitada", "Suporte prioritário"]', 3)
on conflict (code) do update set
  name = excluded.name, description = excluded.description, monthly_price_cents = excluded.monthly_price_cents,
  annual_price_cents = excluded.annual_price_cents, max_products = excluded.max_products,
  max_team_members = excluded.max_team_members, features = excluded.features, sort_order = excluded.sort_order;

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.establishments enable row level security;
alter table public.establishment_members enable row level security;
alter table public.establishment_settings enable row level security;
alter table public.subscriptions enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.addon_groups enable row level security;
alter table public.addons enable row level security;
alter table public.product_addon_groups enable row level security;
alter table public.business_hours enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.coupons enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stripe_events enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_own_read on public.profiles for select to authenticated using (id = (select auth.uid()) or private.is_superadmin());
create policy profiles_own_update on public.profiles for update to authenticated using (id = (select auth.uid()) or private.is_superadmin()) with check (id = (select auth.uid()) or private.is_superadmin());
create policy plans_authenticated_read on public.plans for select to authenticated using (active or private.is_superadmin());
create policy establishments_member_read on public.establishments for select to authenticated using (private.has_role(id, null));
create policy establishments_manager_update on public.establishments for update to authenticated using (private.has_role(id, array['owner','manager']::public.member_role[])) with check (private.has_role(id, array['owner','manager']::public.member_role[]));
create policy members_member_read on public.establishment_members for select to authenticated using (private.has_role(establishment_id, null));
create policy members_owner_manage on public.establishment_members for all to authenticated using (private.has_role(establishment_id, array['owner']::public.member_role[])) with check (private.has_role(establishment_id, array['owner']::public.member_role[]));
create policy settings_member_read on public.establishment_settings for select to authenticated using (private.has_role(establishment_id, null));
create policy settings_manager_update on public.establishment_settings for update to authenticated using (private.has_role(establishment_id, array['owner','manager']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy subscriptions_owner_read on public.subscriptions for select to authenticated using (private.has_role(establishment_id, array['owner']::public.member_role[]));
create policy invoices_owner_read on public.subscription_invoices for select to authenticated using (private.has_role(establishment_id, array['owner']::public.member_role[]));
create policy audit_manager_read on public.audit_logs for select to authenticated using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy categories_member_read on public.categories for select to authenticated using (private.has_role(establishment_id, null));
create policy categories_catalog_write on public.categories for all to authenticated using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy products_member_read on public.products for select to authenticated using (private.has_role(establishment_id, null));
create policy products_catalog_write on public.products for all to authenticated using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy addon_groups_member_read on public.addon_groups for select to authenticated using (private.has_role(establishment_id, null));
create policy addon_groups_catalog_write on public.addon_groups for all to authenticated using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy addons_member_read on public.addons for select to authenticated using (private.has_role(establishment_id, null));
create policy addons_catalog_write on public.addons for all to authenticated using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy product_addons_member_read on public.product_addon_groups for select to authenticated using (private.has_role(establishment_id, null));
create policy product_addons_catalog_write on public.product_addon_groups for all to authenticated using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

create policy business_hours_member_read on public.business_hours for select to authenticated using (private.has_role(establishment_id, null));
create policy business_hours_manager_write on public.business_hours for all to authenticated using (private.has_role(establishment_id, array['owner','manager']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy delivery_zones_member_read on public.delivery_zones for select to authenticated using (private.has_role(establishment_id, null));
create policy delivery_zones_manager_write on public.delivery_zones for all to authenticated using (private.has_role(establishment_id, array['owner','manager']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy coupons_member_read on public.coupons for select to authenticated using (private.has_role(establishment_id, null));
create policy coupons_manager_write on public.coupons for all to authenticated using (private.has_role(establishment_id, array['owner','manager']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy customers_operations on public.customers for all to authenticated using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy orders_operations on public.orders for all to authenticated using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));
create policy order_items_operations on public.order_items for all to authenticated using (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[])) with check (private.has_role(establishment_id, array['owner','manager','attendant']::public.member_role[]));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.plans, public.establishments, public.establishment_members,
  public.establishment_settings, public.subscriptions, public.categories, public.products,
  public.addon_groups, public.addons, public.product_addon_groups, public.business_hours,
  public.delivery_zones, public.coupons, public.customers, public.orders, public.order_items,
  public.subscription_invoices, public.audit_logs to authenticated;
grant insert, update, delete on public.categories, public.products, public.addon_groups, public.addons,
  public.product_addon_groups, public.business_hours, public.delivery_zones, public.coupons,
  public.customers, public.orders, public.order_items, public.establishment_members to authenticated;
grant update on public.profiles, public.establishments, public.establishment_settings to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on public.stripe_events from anon, authenticated;

