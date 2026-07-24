alter table public.establishments
  add column if not exists description text,
  add column if not exists secondary_color text not null default '#f5efe5',
  add column if not exists city text,
  add column if not exists state text;

alter table public.establishment_settings
  add column if not exists estimated_minutes integer not null default 45,
  add column if not exists payment_methods jsonb not null default '["pix","cash","credit_on_delivery","debit_on_delivery"]'::jsonb;

alter table public.delivery_zones
  add column if not exists free_delivery_above_cents integer;

alter table public.plans
  add column if not exists max_monthly_orders integer,
  add column if not exists custom_branding_enabled boolean not null default false,
  add column if not exists coupons_enabled boolean not null default false,
  add column if not exists reports_enabled boolean not null default false,
  add column if not exists loyalty_enabled boolean not null default false,
  add column if not exists custom_domain_enabled boolean not null default false;

alter table public.subscriptions
  add column if not exists stripe_price_id text,
  add column if not exists trial_start timestamp with time zone,
  add column if not exists current_period_start timestamp with time zone,
  add column if not exists canceled_at timestamp with time zone,
  add column if not exists payment_failed_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'establishments_secondary_color_check'
      and conrelid = 'public.establishments'::regclass
  ) then
    alter table public.establishments
      add constraint establishments_secondary_color_check
      check (secondary_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'establishments_state_check'
      and conrelid = 'public.establishments'::regclass
  ) then
    alter table public.establishments
      add constraint establishments_state_check
      check (state is null or state ~ '^[A-Z]{2}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_estimated_minutes_check'
      and conrelid = 'public.establishment_settings'::regclass
  ) then
    alter table public.establishment_settings
      add constraint settings_estimated_minutes_check
      check (estimated_minutes between 5 and 360);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_zones_free_delivery_check'
      and conrelid = 'public.delivery_zones'::regclass
  ) then
    alter table public.delivery_zones
      add constraint delivery_zones_free_delivery_check
      check (free_delivery_above_cents is null or free_delivery_above_cents >= 0);
  end if;
end
$$;

create table if not exists public.product_variations (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  price_delta_cents integer not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  title text not null,
  image_url text not null,
  link_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  event_type text not null check (event_type in (
    'menu_view',
    'product_view',
    'product_added',
    'cart_started',
    'checkout_started',
    'order_whatsapp'
  )),
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  value_cents integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists product_variations_establishment_product_idx
  on public.product_variations (establishment_id, product_id);
create index if not exists banners_establishment_active_idx
  on public.banners (establishment_id, active, sort_order);
create index if not exists usage_events_establishment_created_idx
  on public.usage_events (establishment_id, created_at desc);
create index if not exists usage_events_establishment_type_created_idx
  on public.usage_events (establishment_id, event_type, created_at desc);
create index if not exists usage_events_product_idx
  on public.usage_events (product_id);
create index if not exists usage_events_order_idx
  on public.usage_events (order_id);

alter table public.product_variations enable row level security;
alter table public.banners enable row level security;
alter table public.usage_events enable row level security;

create policy product_variations_member_read
  on public.product_variations for select to authenticated
  using (private.has_role(establishment_id, null));
create policy product_variations_catalog_insert
  on public.product_variations for insert to authenticated
  with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy product_variations_catalog_update
  on public.product_variations for update to authenticated
  using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]))
  with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy product_variations_catalog_delete
  on public.product_variations for delete to authenticated
  using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

create policy banners_member_read
  on public.banners for select to authenticated
  using (private.has_role(establishment_id, null));
create policy banners_catalog_insert
  on public.banners for insert to authenticated
  with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy banners_catalog_update
  on public.banners for update to authenticated
  using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]))
  with check (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));
create policy banners_catalog_delete
  on public.banners for delete to authenticated
  using (private.has_role(establishment_id, array['owner','manager','catalog_editor']::public.member_role[]));

create policy usage_events_member_read
  on public.usage_events for select to authenticated
  using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

revoke all on public.product_variations, public.banners, public.usage_events from anon, authenticated;
grant select on public.product_variations, public.banners, public.usage_events to authenticated;
grant insert, update, delete on public.product_variations, public.banners to authenticated;

create or replace function public.complete_establishment_onboarding(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_establishment uuid;
  category_record uuid;
  establishment_name text := trim(payload #>> '{establishment,name}');
  first_product_name text := trim(coalesce(payload #>> '{product,name}', ''));
  category_name text := trim(coalesce(payload #>> '{product,category}', ''));
  product_price integer := coalesce((payload #>> '{product,price_cents}')::integer, 0);
  zone_name text := trim(coalesce(payload #>> '{delivery_zone,name}', ''));
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  select em.establishment_id into target_establishment
  from public.establishment_members em
  where em.user_id = current_user_id and em.role = 'owner'
  order by em.created_at
  limit 1;

  if target_establishment is null then
    raise exception 'owner establishment not found';
  end if;
  if char_length(establishment_name) < 2 or char_length(establishment_name) > 100 then
    raise exception 'invalid establishment name';
  end if;
  if coalesce(payload #>> '{establishment,accent_color}', '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'invalid accent color';
  end if;
  if coalesce(payload #>> '{establishment,secondary_color}', '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'invalid secondary color';
  end if;
  if jsonb_typeof(coalesce(payload #> '{settings,payment_methods}', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid payment methods';
  end if;

  update public.establishments
  set
    name = establishment_name,
    description = nullif(trim(payload #>> '{establishment,description}'), ''),
    phone = nullif(trim(payload #>> '{establishment,phone}'), ''),
    logo_url = nullif(trim(payload #>> '{establishment,logo_url}'), ''),
    cover_url = nullif(trim(payload #>> '{establishment,cover_url}'), ''),
    accent_color = payload #>> '{establishment,accent_color}',
    secondary_color = payload #>> '{establishment,secondary_color}',
    city = nullif(trim(payload #>> '{establishment,city}'), ''),
    state = nullif(upper(trim(payload #>> '{establishment,state}')), ''),
    onboarding_completed = true,
    updated_at = now()
  where id = target_establishment;

  update public.establishment_settings
  set
    whatsapp = nullif(trim(payload #>> '{settings,whatsapp}'), ''),
    address = coalesce(payload #> '{settings,address}', '{}'::jsonb),
    pickup_enabled = coalesce((payload #>> '{settings,pickup_enabled}')::boolean, true),
    delivery_enabled = coalesce((payload #>> '{settings,delivery_enabled}')::boolean, false),
    minimum_order_cents = greatest(coalesce((payload #>> '{settings,minimum_order_cents}')::integer, 0), 0),
    estimated_minutes = least(greatest(coalesce((payload #>> '{settings,estimated_minutes}')::integer, 45), 5), 360),
    payment_methods = payload #> '{settings,payment_methods}',
    updated_at = now()
  where establishment_id = target_establishment;

  update public.business_hours
  set
    opens_at = coalesce(nullif(payload #>> '{operation,opens_at}', '')::time, opens_at),
    closes_at = coalesce(nullif(payload #>> '{operation,closes_at}', '')::time, closes_at)
  where establishment_id = target_establishment and not closed;

  if zone_name <> '' and coalesce((payload #>> '{settings,delivery_enabled}')::boolean, false) then
    insert into public.delivery_zones (
      establishment_id, name, fee_cents, minimum_order_cents, estimated_minutes,
      free_delivery_above_cents, active
    ) values (
      target_establishment,
      zone_name,
      greatest(coalesce((payload #>> '{delivery_zone,fee_cents}')::integer, 0), 0),
      greatest(coalesce((payload #>> '{settings,minimum_order_cents}')::integer, 0), 0),
      least(greatest(coalesce((payload #>> '{settings,estimated_minutes}')::integer, 45), 5), 360),
      nullif((payload #>> '{delivery_zone,free_delivery_above_cents}')::integer, 0),
      true
    );
  end if;

  if first_product_name <> '' and category_name <> '' and product_price > 0 then
    insert into public.categories (establishment_id, name, sort_order)
    values (target_establishment, category_name, 0)
    returning id into category_record;

    insert into public.products (
      establishment_id, category_id, name, description, image_url, price_cents, active, featured
    ) values (
      target_establishment,
      category_record,
      first_product_name,
      nullif(trim(payload #>> '{product,description}'), ''),
      nullif(trim(payload #>> '{product,image_url}'), ''),
      product_price,
      coalesce((payload #>> '{product,active}')::boolean, true),
      true
    );
  end if;

  return jsonb_build_object(
    'establishment_id', target_establishment,
    'slug', (select e.slug from public.establishments e where e.id = target_establishment)
  );
end
$$;

revoke all on function public.complete_establishment_onboarding(jsonb) from public, anon;
grant execute on function public.complete_establishment_onboarding(jsonb) to authenticated;

create or replace function public.record_public_event(
  requested_slug text,
  requested_event text,
  requested_product uuid default null,
  requested_order uuid default null,
  requested_value_cents integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_establishment uuid;
begin
  if requested_event not in (
    'menu_view',
    'product_view',
    'product_added',
    'cart_started',
    'checkout_started',
    'order_whatsapp'
  ) then
    raise exception 'invalid usage event';
  end if;

  select e.id into target_establishment
  from public.establishments e
  join public.subscriptions s on s.establishment_id = e.id
  where e.slug = requested_slug
    and e.active
    and e.onboarding_completed
    and (s.status in ('active', 'trialing') or s.current_period_end > now());

  if target_establishment is null then
    return false;
  end if;

  insert into public.usage_events (
    establishment_id, event_type, product_id, order_id, value_cents
  ) values (
    target_establishment, requested_event, requested_product, requested_order,
    case when requested_value_cents is null then null else greatest(requested_value_cents, 0) end
  );
  return true;
end
$$;

revoke all on function public.record_public_event(text, text, uuid, uuid, integer) from public;
grant execute on function public.record_public_event(text, text, uuid, uuid, integer) to anon, authenticated;

create or replace function public.get_public_menu(requested_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'establishment', jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'slug', e.slug,
      'description', e.description,
      'logo_url', e.logo_url,
      'cover_url', e.cover_url,
      'accent_color', e.accent_color,
      'secondary_color', e.secondary_color,
      'phone', e.phone,
      'city', e.city,
      'state', e.state
    ),
    'settings', jsonb_build_object(
      'whatsapp', s.whatsapp,
      'instagram', s.instagram,
      'pickup_enabled', s.pickup_enabled,
      'delivery_enabled', s.delivery_enabled,
      'dine_in_enabled', s.dine_in_enabled,
      'minimum_order_cents', s.minimum_order_cents,
      'estimated_minutes', s.estimated_minutes,
      'payment_methods', s.payment_methods,
      'address', s.address
    ),
    'banners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'title', b.title,
        'image_url', b.image_url,
        'link_url', b.link_url
      ) order by b.sort_order, b.created_at)
      from public.banners b
      where b.establishment_id = e.id
        and b.active
        and (b.starts_at is null or b.starts_at <= now())
        and (b.ends_at is null or b.ends_at >= now())
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', h.weekday,
        'opens_at', h.opens_at,
        'closes_at', h.closes_at,
        'closed', h.closed
      ) order by h.weekday)
      from public.business_hours h
      where h.establishment_id = e.id
    ), '[]'::jsonb),
    'delivery_zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id,
        'name', z.name,
        'fee_cents', z.fee_cents,
        'minimum_order_cents', z.minimum_order_cents,
        'estimated_minutes', z.estimated_minutes,
        'free_delivery_above_cents', z.free_delivery_above_cents
      ) order by z.name)
      from public.delivery_zones z
      where z.establishment_id = e.id and z.active
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'description', p.description,
            'image_url', p.image_url,
            'price_cents', p.price_cents,
            'compare_at_price_cents', p.compare_at_price_cents,
            'featured', p.featured
          ) order by p.sort_order, p.name)
          from public.products p
          where p.establishment_id = e.id
            and p.category_id = c.id
            and p.active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c
      where c.establishment_id = e.id and c.active
    ), '[]'::jsonb)
  )
  from public.establishments e
  join public.establishment_settings s on s.establishment_id = e.id
  join public.subscriptions sub on sub.establishment_id = e.id
  where e.slug = requested_slug
    and e.active
    and e.onboarding_completed
    and (sub.status in ('active', 'trialing') or sub.current_period_end > now())
$$;

revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;

update public.plans
set
  max_monthly_orders = case code when 'starter' then 500 when 'growth' then 5000 else null end,
  custom_branding_enabled = code in ('growth', 'scale'),
  coupons_enabled = code in ('growth', 'scale'),
  reports_enabled = code in ('growth', 'scale'),
  loyalty_enabled = code = 'scale',
  custom_domain_enabled = code = 'scale'
where code in ('starter', 'growth', 'scale');
