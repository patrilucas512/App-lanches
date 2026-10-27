alter table public.establishments
  add column if not exists menu_display_name text,
  add column if not exists menu_logo_url text,
  add column if not exists menu_background_color text,
  add column if not exists menu_surface_color text,
  add column if not exists menu_text_color text,
  add column if not exists menu_muted_color text;

alter table public.establishments
  add constraint establishments_menu_display_name_length
    check (menu_display_name is null or char_length(menu_display_name) between 2 and 80),
  add constraint establishments_menu_background_color_hex
    check (menu_background_color is null or menu_background_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint establishments_menu_surface_color_hex
    check (menu_surface_color is null or menu_surface_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint establishments_menu_text_color_hex
    check (menu_text_color is null or menu_text_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint establishments_menu_muted_color_hex
    check (menu_muted_color is null or menu_muted_color ~ '^#[0-9A-Fa-f]{6}$');

create or replace function public.get_public_menu(requested_slug text)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'establishment', jsonb_build_object(
      'id', e.id, 'name', coalesce(e.menu_display_name,e.name), 'slug', e.slug, 'description', e.description,
      'logo_url', coalesce(e.menu_logo_url,e.logo_url), 'cover_url', e.cover_url, 'accent_color', e.accent_color,
      'secondary_color', e.secondary_color, 'menu_background_color', e.menu_background_color,
      'menu_surface_color', e.menu_surface_color, 'menu_text_color', e.menu_text_color,
      'menu_muted_color', e.menu_muted_color, 'phone', e.phone, 'city', e.city, 'state', e.state
    ),
    'settings', jsonb_build_object(
      'whatsapp', s.whatsapp, 'instagram', s.instagram, 'pickup_enabled', s.pickup_enabled,
      'delivery_enabled', s.delivery_enabled, 'dine_in_enabled', s.dine_in_enabled,
      'minimum_order_cents', s.minimum_order_cents, 'estimated_minutes', s.estimated_minutes,
      'payment_methods', s.payment_methods, 'address', s.address
    ),
    'banners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'title', b.title, 'subtitle', b.subtitle,
        'image_url', b.image_url, 'link_url', b.link_url,
        'promotion_type', b.promotion_type, 'promotion_value', b.promotion_value,
        'destination_type', b.destination_type, 'destination_id', b.destination_id
      ) order by b.sort_order, b.created_at)
      from public.banners b
      where b.establishment_id=e.id and b.active
        and (b.starts_at is null or b.starts_at<=now())
        and (b.ends_at is null or b.ends_at>=now())
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'description', p.description,
            'image_url', p.image_url, 'price_cents', p.price_cents,
            'compare_at_price_cents', p.compare_at_price_cents,
            'featured', p.featured, 'ingredients', p.ingredients,
            'addon_options', p.addon_options,
            'addon_groups', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', ag.id, 'name', ag.name, 'description', ag.description,
                'min_choices', ag.min_choices, 'max_choices', ag.max_choices,
                'required', ag.required,
                'addons', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', a.id, 'group_id', ag.id, 'name', a.name,
                    'price_cents', a.price_cents
                  ) order by a.sort_order, a.name)
                  from public.addons a
                  where a.establishment_id=e.id and a.addon_group_id=ag.id and a.active
                ), '[]'::jsonb)
              ) order by ag.sort_order, ag.name)
              from public.product_addon_groups pag
              join public.addon_groups ag on ag.id=pag.addon_group_id
              where pag.establishment_id=e.id and pag.product_id=p.id and ag.active
            ), '[]'::jsonb)
          ) order by p.sort_order, p.name)
          from public.products p
          where p.establishment_id=e.id and p.category_id=c.id and p.active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c where c.establishment_id=e.id and c.active
    ), '[]'::jsonb)
  )
  from public.establishments e
  join public.establishment_settings s on s.establishment_id=e.id
  join public.subscriptions sub on sub.establishment_id=e.id
  where e.slug=requested_slug and e.active and e.onboarding_completed
    and (sub.status in ('active','trialing') or sub.current_period_end>now())
$$;
