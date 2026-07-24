insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_member_select
on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.establishment_members em
    where em.user_id = (select auth.uid())
      and em.establishment_id::text = (storage.foldername(name))[1]
  )
);

create policy product_images_catalog_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.establishment_members em
    where em.user_id = (select auth.uid())
      and em.establishment_id::text = (storage.foldername(name))[1]
      and em.role in ('owner', 'manager', 'catalog_editor')
  )
);

create policy product_images_catalog_update
on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.establishment_members em
    where em.user_id = (select auth.uid())
      and em.establishment_id::text = (storage.foldername(name))[1]
      and em.role in ('owner', 'manager', 'catalog_editor')
  )
)
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.establishment_members em
    where em.user_id = (select auth.uid())
      and em.establishment_id::text = (storage.foldername(name))[1]
      and em.role in ('owner', 'manager', 'catalog_editor')
  )
);

create policy product_images_catalog_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.establishment_members em
    where em.user_id = (select auth.uid())
      and em.establishment_id::text = (storage.foldername(name))[1]
      and em.role in ('owner', 'manager', 'catalog_editor')
  )
);
