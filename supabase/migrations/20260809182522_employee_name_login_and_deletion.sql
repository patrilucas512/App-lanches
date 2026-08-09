create unique index if not exists waiters_establishment_login_name_unique
  on public.waiters (establishment_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

create unique index if not exists kitchen_establishment_login_name_unique
  on public.kitchen_operators (establishment_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

create or replace function public.get_employee_login_candidates(
  requested_kind text,
  requested_name text,
  requested_slug text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_name text := lower(regexp_replace(btrim(coalesce(requested_name, '')), '\s+', ' ', 'g'));
  result jsonb;
begin
  if requested_kind not in ('waiter', 'kitchen') or length(normalized_name) < 3 then
    return '[]'::jsonb;
  end if;

  if requested_kind = 'waiter' then
    select coalesce(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb)
    into result
    from (
      select w.user_id,
        'w.' || regexp_replace(coalesce(w.phone, ''), '\D', '', 'g') || '@garcom.mesaviva.app' as login_email,
        w.status, w.active_now, w.employment_type as access_type, w.work_date, e.slug as establishment_slug
      from public.waiters w
      join public.establishments e on e.id = w.establishment_id
      where w.user_id is not null
        and lower(regexp_replace(btrim(w.name), '\s+', ' ', 'g')) = normalized_name
        and (nullif(btrim(requested_slug), '') is null or e.slug = lower(btrim(requested_slug)))
      limit 5
    ) candidate;
  else
    select coalesce(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb)
    into result
    from (
      select k.user_id,
        'k.' || regexp_replace(coalesce(k.phone, ''), '\D', '', 'g') || '@cozinha.mesaviva.app' as login_email,
        k.status, true as active_now, k.access_type, k.work_date, e.slug as establishment_slug
      from public.kitchen_operators k
      join public.establishments e on e.id = k.establishment_id
      where k.user_id is not null
        and lower(regexp_replace(btrim(k.name), '\s+', ' ', 'g')) = normalized_name
        and (nullif(btrim(requested_slug), '') is null or e.slug = lower(btrim(requested_slug)))
      limit 5
    ) candidate;
  end if;

  return result;
end
$$;

revoke all on function public.get_employee_login_candidates(text,text,text) from public, anon, authenticated;
grant execute on function public.get_employee_login_candidates(text,text,text) to service_role;

create or replace function public.delete_waiter(requested_waiter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.waiters%rowtype;
begin
  select * into target from public.waiters where id = requested_waiter_id for update;
  if target.id is null or actor is null
    or not private.has_role(target.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para excluir este funcionário.';
  end if;

  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.establishment_id, actor, 'waiter.deleted', 'waiters', target.id,
    jsonb_build_object('name', target.name, 'user_id', target.user_id));

  delete from public.waiters where id = target.id;
  if target.user_id is not null then
    delete from public.establishment_members
    where establishment_id = target.establishment_id and user_id = target.user_id and role = 'attendant';
  end if;

  return jsonb_build_object('deleted', true, 'id', target.id, 'name', target.name);
end
$$;

create or replace function public.delete_kitchen_operator(requested_operator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.kitchen_operators%rowtype;
begin
  select * into target from public.kitchen_operators where id = requested_operator_id for update;
  if target.id is null or actor is null
    or not private.has_role(target.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para excluir este funcionário.';
  end if;

  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.establishment_id, actor, 'kitchen.operator_deleted', 'kitchen_operators', target.id,
    jsonb_build_object('name', target.name, 'user_id', target.user_id));

  delete from public.kitchen_operators where id = target.id;
  if target.user_id is not null then
    delete from public.establishment_members
    where establishment_id = target.establishment_id and user_id = target.user_id and role = 'kitchen';
  end if;

  return jsonb_build_object('deleted', true, 'id', target.id, 'name', target.name);
end
$$;

revoke all on function public.delete_waiter(uuid) from public, anon;
revoke all on function public.delete_kitchen_operator(uuid) from public, anon;
grant execute on function public.delete_waiter(uuid) to authenticated;
grant execute on function public.delete_kitchen_operator(uuid) to authenticated;
