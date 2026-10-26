drop policy if exists delivery_destinations_admin_select on public.delivery_destinations;
drop policy if exists delivery_destinations_operations_select on public.delivery_destinations;

create policy delivery_destinations_operations_select
on public.delivery_destinations
for select
to authenticated
using (
  private.has_role(
    establishment_id,
    array['owner','manager','kitchen']::public.member_role[]
  )
);
