-- Fixed staff drivers receive the next kitchen dispatch automatically.
-- Partner drivers keep the explicit accept/reject offer flow.
create or replace function public.refresh_fixed_driver_shift()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  driver public.driver_profiles%rowtype;
  availability public.driver_availability%rowtype;
  assignment public.delivery_assignments%rowtype;
  pending record;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;

  select profile.* into driver
  from public.driver_profiles profile
  join public.custom_staff_members member
    on member.id = profile.custom_staff_member_id
   and member.establishment_id = profile.establishment_id
  where profile.user_id = actor
    and profile.driver_kind = 'fixed'
    and profile.active
    and profile.approval_status = 'approved'
    and member.status = 'active';

  if driver.id is null then return jsonb_build_object('fixed', false); end if;

  select * into availability from public.driver_availability
  where driver_profile_id = driver.id for update;

  if availability.status = 'offered' then
    select candidate.* into assignment
    from public.delivery_assignments candidate
    where candidate.driver_profile_id = driver.id and candidate.status = 'offered'
    order by candidate.offered_at desc limit 1 for update;

    if assignment.id is null then
      update public.driver_availability set status = 'available', available_since = now()
      where driver_profile_id = driver.id and active_delivery_count = 0;
    else
      if assignment.expires_at <= now() then
        update public.delivery_assignments set expires_at = now() + interval '60 seconds'
        where id = assignment.id;
      end if;
      perform public.accept_delivery_assignment(assignment.id);
    end if;
  end if;

  select * into availability from public.driver_availability
  where driver_profile_id = driver.id for update;

  if availability.status = 'available' and availability.active_delivery_count = 0 then
    for pending in
      select id from public.deliveries
      where establishment_id = driver.establishment_id and status = 'searching_driver'
      order by ready_at, id for update skip locked
    loop
      perform private.offer_next_driver_locked(pending.id, actor);
      select candidate.* into assignment
      from public.delivery_assignments candidate
      where candidate.driver_profile_id = driver.id and candidate.status = 'offered'
      order by candidate.offered_at desc limit 1 for update;
      if assignment.id is not null then
        perform public.accept_delivery_assignment(assignment.id);
      end if;
      exit;
    end loop;
  end if;

  select * into availability from public.driver_availability
  where driver_profile_id = driver.id;
  return jsonb_build_object(
    'fixed', true,
    'driver_profile_id', driver.id,
    'status', availability.status,
    'active_delivery_count', availability.active_delivery_count,
    'automatic_assignment', true
  );
end $$;

revoke all on function public.refresh_fixed_driver_shift() from public, anon;
grant execute on function public.refresh_fixed_driver_shift() to authenticated;
