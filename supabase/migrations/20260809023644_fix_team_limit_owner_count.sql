create or replace function private.enforce_team_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed integer;
  current_count integer;
begin
  if new.role = 'owner' and not exists (
    select 1 from public.subscriptions where establishment_id = new.establishment_id
  ) then
    return new;
  end if;

  select p.max_team_members into allowed
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.establishment_id = new.establishment_id;

  if allowed is null or new.role = 'owner' then
    return new;
  end if;

  select count(*) into current_count
  from public.establishment_members
  where establishment_id = new.establishment_id
    and role <> 'owner';

  if current_count >= allowed then
    raise exception 'Limite de funcionários atingido para o plano atual.';
  end if;

  return new;
end
$$;

revoke all on function private.enforce_team_limit() from public, anon, authenticated;
