alter table public.custom_staff_members
  add column if not exists archived_at timestamptz;

create index if not exists custom_staff_members_visible_idx
  on public.custom_staff_members(establishment_id, role_id, created_at)
  where archived_at is null;

drop policy if exists products_cashier_read on public.products;
create policy products_cashier_read
on public.products
for select
to authenticated
using ((select private.is_financial_employee(establishment_id)));

create or replace function private.is_financial_employee(
  requested_establishment_id uuid,
  requested_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.custom_staff_members member
    join public.staff_roles role
      on role.id = member.role_id
     and role.establishment_id = member.establishment_id
    where member.establishment_id = requested_establishment_id
      and member.user_id = requested_user_id
      and member.status = 'active'
      and member.archived_at is null
      and role.financial_role = true
  )
$$;

create or replace function public.archive_cashier_staff_member(requested_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.custom_staff_members%rowtype;
  target_role public.staff_roles%rowtype;
begin
  if actor is null then
    raise exception 'Autenticação necessária.';
  end if;

  select * into target
  from public.custom_staff_members
  where id = requested_member_id
    and archived_at is null
  for update;

  select * into target_role
  from public.staff_roles
  where id = target.role_id
    and establishment_id = target.establishment_id;

  if target.id is null
     or target_role.id is null
     or target_role.financial_role is not true
     or not private.has_role(target.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para excluir este funcionário do caixa.';
  end if;

  update public.cashier_access_links
  set expires_at = least(expires_at, now()),
      used_at = coalesce(used_at, now())
  where staff_member_id = target.id
    and used_at is null;

  update public.custom_staff_members
  set status = 'inactive',
      user_id = null,
      archived_at = now(),
      updated_at = now()
  where id = target.id;

  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target.establishment_id,
    actor,
    'cashier.staff_archived',
    'custom_staff_members',
    target.id,
    jsonb_build_object(
      'name', target.name,
      'user_id', target.user_id,
      'financial_history_preserved', true
    )
  );

  return jsonb_build_object(
    'deleted', true,
    'archived', true,
    'id', target.id,
    'name', target.name
  );
end
$$;

revoke all on function public.archive_cashier_staff_member(uuid) from public, anon;
grant execute on function public.archive_cashier_staff_member(uuid) to authenticated;
