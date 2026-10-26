alter table public.banners
  add column if not exists subtitle text,
  add column if not exists promotion_type text not null default 'banner'
    check (promotion_type in ('banner','percentage','fixed','free_delivery')),
  add column if not exists promotion_value integer
    check (promotion_value is null or promotion_value >= 0),
  add column if not exists destination_type text not null default 'menu'
    check (destination_type in ('menu','category','product','checkout','url')),
  add column if not exists destination_id uuid;
