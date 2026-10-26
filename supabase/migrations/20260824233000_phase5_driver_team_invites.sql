alter table public.staff_roles drop constraint if exists staff_roles_system_key_check;
alter table public.staff_roles add constraint staff_roles_system_key_check
  check (system_key is null or system_key in ('cashier', 'driver'));

insert into public.staff_roles (establishment_id, name, description, color, financial_role, system_key)
select id, 'Motoboys', 'Equipe responsável pela retirada e entrega dos pedidos.', '#ea5b22', false, 'driver'
from public.establishments
on conflict (establishment_id, system_key) where system_key is not null do nothing;

create or replace function public.ensure_driver_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff_roles (establishment_id, name, description, color, financial_role, system_key)
  values (new.id, 'Motoboys', 'Equipe responsável pela retirada e entrega dos pedidos.', '#ea5b22', false, 'driver')
  on conflict (establishment_id, system_key) where system_key is not null do nothing;
  return new;
end $$;

drop trigger if exists establishments_ensure_driver_role on public.establishments;
create trigger establishments_ensure_driver_role
after insert on public.establishments
for each row execute function public.ensure_driver_role();

create table public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  custom_staff_member_id uuid not null references public.custom_staff_members(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  phone text not null,
  cpf_hash text,
  cpf_last4 text check (cpf_last4 is null or cpf_last4 ~ '^\d{4}$'),
  vehicle_type text not null default 'motorcycle' check (vehicle_type in ('motorcycle','bicycle','car','other')),
  vehicle_model text,
  vehicle_plate text,
  approval_status text not null default 'approved' check (approval_status in ('pending','approved','blocked')),
  active boolean not null default true,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (custom_staff_member_id),
  unique (id, establishment_id)
);

create index driver_profiles_establishment_status_idx
  on public.driver_profiles (establishment_id, active, approval_status);
create index driver_profiles_phone_idx
  on public.driver_profiles (establishment_id, regexp_replace(phone, '\D', '', 'g'));

create table public.driver_access_links (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  driver_profile_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint driver_access_profile_tenant_fk foreign key (driver_profile_id, establishment_id)
    references public.driver_profiles(id, establishment_id) on delete cascade
);

create unique index driver_access_one_valid_idx on public.driver_access_links (driver_profile_id)
  where used_at is null and revoked_at is null;
create index driver_access_establishment_idx on public.driver_access_links (establishment_id, created_at desc);

create trigger driver_profiles_touch before update on public.driver_profiles
for each row execute function public.touch_updated_at();

create or replace function public.sync_driver_profile_from_staff()
returns trigger language plpgsql security definer set search_path = '' as $$
declare driver_role boolean;
begin
  select role.system_key = 'driver' into driver_role
  from public.staff_roles role
  where role.id = new.role_id and role.establishment_id = new.establishment_id;

  if coalesce(driver_role, false) then
    if coalesce(regexp_replace(new.phone, '\D', '', 'g'), '') = '' then
      raise exception 'Informe o WhatsApp do motoboy.';
    end if;
    insert into public.driver_profiles (
      establishment_id, custom_staff_member_id, user_id, phone, approval_status, active
    ) values (
      new.establishment_id, new.id, new.user_id, new.phone, 'approved', new.status = 'active'
    )
    on conflict (custom_staff_member_id) do update set
      user_id = excluded.user_id,
      phone = excluded.phone,
      active = excluded.active,
      approval_status = case when public.driver_profiles.approval_status = 'blocked' then 'blocked' else 'approved' end;
  elsif tg_op = 'UPDATE' then
    update public.driver_profiles set active = false where custom_staff_member_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists custom_staff_sync_driver_profile on public.custom_staff_members;
create trigger custom_staff_sync_driver_profile
after insert or update of role_id, phone, status, user_id on public.custom_staff_members
for each row execute function public.sync_driver_profile_from_staff();

alter table public.driver_profiles enable row level security;
alter table public.driver_access_links enable row level security;

create policy driver_profiles_admin_all on public.driver_profiles for all to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));
create policy driver_profiles_self_read on public.driver_profiles for select to authenticated
using (user_id = (select auth.uid()));

create policy driver_access_links_admin_all on public.driver_access_links for all to authenticated
using (private.has_role(establishment_id, array['owner','manager']::public.member_role[]))
with check (private.has_role(establishment_id, array['owner','manager']::public.member_role[]));

create policy establishments_driver_read on public.establishments for select to authenticated
using (exists (
  select 1 from public.driver_profiles driver
  where driver.establishment_id = establishments.id and driver.user_id = (select auth.uid())
));

create or replace function public.create_driver_invite(requested_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target public.custom_staff_members%rowtype;
  driver public.driver_profiles%rowtype;
  raw_token uuid := gen_random_uuid();
  invitation public.driver_access_links%rowtype;
  invitation_expires_at timestamptz;
begin
  select member.* into target
  from public.custom_staff_members member
  join public.staff_roles role on role.id = member.role_id and role.system_key = 'driver'
  where member.id = requested_member_id;

  select * into driver from public.driver_profiles where custom_staff_member_id = target.id;
  if actor is null or target.id is null or driver.id is null
     or not private.has_role(target.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissão para gerar este acesso.';
  end if;
  if target.status <> 'active' or driver.approval_status <> 'approved' or not driver.active then
    raise exception 'Ative e aprove o motoboy antes de gerar o acesso.';
  end if;

  invitation_expires_at := case when target.employment_type = 'daily'
    then (target.work_date + interval '1 day')::timestamptz
    else now() + interval '48 hours' end;
  if invitation_expires_at <= now() then raise exception 'A data de trabalho deste diarista já terminou.'; end if;

  update public.driver_access_links set revoked_at = now()
  where driver_profile_id = driver.id and used_at is null and revoked_at is null;

  insert into public.driver_access_links (
    establishment_id, driver_profile_id, token_hash, expires_at, created_by
  ) values (
    target.establishment_id, driver.id,
    encode(extensions.digest(raw_token::text, 'sha256'), 'hex'),
    invitation_expires_at, actor
  ) returning * into invitation;

  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.establishment_id, actor, 'driver.invite_created', 'driver_profiles', driver.id,
    jsonb_build_object('staff_member_id', target.id, 'reset', target.user_id is not null, 'expires_at', invitation.expires_at));

  return jsonb_build_object('token', raw_token, 'expires_at', invitation.expires_at,
    'name', target.name, 'phone', target.phone, 'reset', target.user_id is not null);
end $$;

create or replace function public.get_driver_invite_for_activation(requested_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'driver_profile_id', driver.id,
    'staff_member_id', member.id,
    'name', member.name,
    'phone', member.phone,
    'user_id', member.user_id,
    'employment_type', member.employment_type,
    'work_date', member.work_date
  ) into result
  from public.driver_access_links link
  join public.driver_profiles driver on driver.id = link.driver_profile_id
  join public.custom_staff_members member on member.id = driver.custom_staff_member_id
  where link.token_hash = encode(extensions.digest(requested_token::text, 'sha256'), 'hex')
    and link.used_at is null and link.revoked_at is null and link.expires_at > now()
    and driver.active and driver.approval_status = 'approved' and member.status = 'active';
  return result;
end $$;

create or replace function public.claim_driver_invite_as_user(requested_token uuid, requested_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invitation public.driver_access_links%rowtype;
  driver public.driver_profiles%rowtype;
  target public.custom_staff_members%rowtype;
begin
  select * into invitation from public.driver_access_links
  where token_hash = encode(extensions.digest(requested_token::text, 'sha256'), 'hex')
    and used_at is null and revoked_at is null and expires_at > now()
  for update;
  if invitation.id is null then raise exception 'Convite inválido ou expirado.'; end if;

  select * into driver from public.driver_profiles where id = invitation.driver_profile_id for update;
  select * into target from public.custom_staff_members where id = driver.custom_staff_member_id for update;
  if not driver.active or driver.approval_status <> 'approved' or target.status <> 'active' then
    raise exception 'Este acesso não está ativo.';
  end if;

  update public.custom_staff_members set user_id = requested_user_id where id = target.id;
  update public.driver_profiles set user_id = requested_user_id, last_access_at = now() where id = driver.id;
  update public.driver_access_links set used_at = now() where id = invitation.id;
  insert into public.audit_logs (establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.establishment_id, requested_user_id, 'driver.invite_claimed', 'driver_profiles', driver.id,
    jsonb_build_object('staff_member_id', target.id));
  return jsonb_build_object('activated', true, 'establishment_id', target.establishment_id, 'driver_profile_id', driver.id);
end $$;

create or replace function public.get_employee_login_candidates(requested_kind text, requested_name text, requested_slug text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare normalized_name text:=lower(regexp_replace(btrim(coalesce(requested_name,'')),'\s+',' ','g')); result jsonb;
begin
  if requested_kind not in ('waiter','kitchen','cashier','driver') or length(normalized_name)<3 then return '[]'::jsonb; end if;
  if requested_kind in ('cashier','driver') then
    select coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) into result from (
      select member.user_id,
        case when requested_kind='driver' then 'd.' else 'c.' end || regexp_replace(coalesce(member.phone,''),'\D','','g') ||
          case when requested_kind='driver' then '@motoboy.masterapp.app' else '@caixa.mesaviva.app' end as login_email,
        member.status, true as active_now, member.employment_type as access_type, member.work_date, e.slug as establishment_slug
      from public.custom_staff_members member
      join public.staff_roles role on role.id=member.role_id
      join public.establishments e on e.id=member.establishment_id
      left join public.driver_profiles driver on driver.custom_staff_member_id=member.id
      where member.user_id is not null
        and ((requested_kind='cashier' and role.financial_role=true) or
             (requested_kind='driver' and role.system_key='driver' and driver.active and driver.approval_status='approved'))
        and lower(regexp_replace(btrim(member.name),'\s+',' ','g'))=normalized_name
        and (nullif(btrim(requested_slug),'') is null or e.slug=lower(btrim(requested_slug))) limit 5
    ) candidate;
  elsif requested_kind='waiter' then
    select coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) into result from (select w.user_id,'w.'||regexp_replace(coalesce(w.phone,''),'\D','','g')||'@garcom.mesaviva.app' as login_email,w.status,w.active_now,w.employment_type as access_type,w.work_date,e.slug as establishment_slug from public.waiters w join public.establishments e on e.id=w.establishment_id where w.user_id is not null and lower(regexp_replace(btrim(w.name),'\s+',' ','g'))=normalized_name and (nullif(btrim(requested_slug),'') is null or e.slug=lower(btrim(requested_slug))) limit 5) candidate;
  else
    select coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) into result from (select k.user_id,'k.'||regexp_replace(coalesce(k.phone,''),'\D','','g')||'@cozinha.mesaviva.app' as login_email,k.status,true as active_now,k.access_type,k.work_date,e.slug as establishment_slug from public.kitchen_operators k join public.establishments e on e.id=k.establishment_id where k.user_id is not null and lower(regexp_replace(btrim(k.name),'\s+',' ','g'))=normalized_name and (nullif(btrim(requested_slug),'') is null or e.slug=lower(btrim(requested_slug))) limit 5) candidate;
  end if;
  return result;
end $$;

revoke all on public.driver_profiles, public.driver_access_links from anon;
grant select, insert, update, delete on public.driver_profiles to authenticated;
grant select on public.driver_access_links to authenticated;

revoke all on function public.ensure_driver_role() from public, anon, authenticated;
revoke all on function public.sync_driver_profile_from_staff() from public, anon, authenticated;
revoke all on function public.create_driver_invite(uuid) from public, anon;
revoke all on function public.get_driver_invite_for_activation(uuid) from public, anon, authenticated;
revoke all on function public.claim_driver_invite_as_user(uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_employee_login_candidates(text,text,text) from public, anon, authenticated;
grant execute on function public.create_driver_invite(uuid) to authenticated;
grant execute on function public.get_driver_invite_for_activation(uuid) to service_role;
grant execute on function public.claim_driver_invite_as_user(uuid,uuid) to service_role;
grant execute on function public.get_employee_login_candidates(text,text,text) to service_role;
