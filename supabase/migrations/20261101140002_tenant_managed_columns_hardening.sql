-- Situação de unidades e organizações e vínculos de membros só mudam por service_role ou rotinas internas do banco.
-- Clientes autenticados editam apenas os dados cadastrais e visuais listados nos grants abaixo.

revoke insert, update, delete on public.establishments from public, anon, authenticated;
grant update (
  name, description, phone, city, state, timezone,
  logo_url, cover_url, accent_color, secondary_color,
  menu_display_name, menu_logo_url, menu_background_color, menu_surface_color, menu_text_color, menu_muted_color,
  onboarding_completed, updated_at
) on public.establishments to authenticated;

revoke insert, update, delete on public.organizations from public, anon, authenticated;
grant update (business_type, operating_profile, timezone) on public.organizations to authenticated;

revoke insert, update, delete on public.establishment_members from public, anon, authenticated;
revoke insert, update, delete on public.organization_members from public, anon, authenticated;

grant select, insert, update, delete on public.establishments, public.organizations, public.establishment_members, public.organization_members to service_role;

-- Segunda barreira: continua valendo se um grant de tabela voltar a ser concedido por engano.
create or replace function private.guard_tenant_managed_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_table_name in ('establishment_members', 'organization_members') then
      raise exception 'Vínculo gerenciado pela plataforma' using errcode = '42501';
    elsif tg_table_name = 'establishments' then
      if new.id is distinct from old.id
        or new.organization_id is distinct from old.organization_id
        or new.active is distinct from old.active
        or new.public_menu_active is distinct from old.public_menu_active
        or new.blocked_at is distinct from old.blocked_at
        or new.block_type is distinct from old.block_type
        or new.block_reason is distinct from old.block_reason
        or new.block_message is distinct from old.block_message
        or new.unit_status is distinct from old.unit_status
        or new.ownership_type is distinct from old.ownership_type
        or new.test_environment is distinct from old.test_environment
        or new.production_reporting_enabled is distinct from old.production_reporting_enabled then
        raise exception 'Coluna protegida de establishments' using errcode = '42501';
      end if;
    elsif tg_table_name = 'organizations' then
      if new.id is distinct from old.id
        or new.status is distinct from old.status
        or new.billing_establishment_id is distinct from old.billing_establishment_id
        or new.is_test_organization is distinct from old.is_test_organization
        or new.test_safety_profile is distinct from old.test_safety_profile
        or new.created_by is distinct from old.created_by then
        raise exception 'Coluna protegida de organizations' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_tenant_managed_columns() from public;

drop trigger if exists establishments_guard_managed_columns on public.establishments;
create trigger establishments_guard_managed_columns
before update on public.establishments
for each row execute function private.guard_tenant_managed_columns();

drop trigger if exists organizations_guard_managed_columns on public.organizations;
create trigger organizations_guard_managed_columns
before update on public.organizations
for each row execute function private.guard_tenant_managed_columns();

drop trigger if exists establishment_members_guard_managed on public.establishment_members;
create trigger establishment_members_guard_managed
before insert or update or delete on public.establishment_members
for each row execute function private.guard_tenant_managed_columns();

drop trigger if exists organization_members_guard_managed on public.organization_members;
create trigger organization_members_guard_managed
before insert or update or delete on public.organization_members
for each row execute function private.guard_tenant_managed_columns();

-- A abertura da unidade pelo painel respeita decisões administrativas da plataforma.
create or replace function public.set_organization_store_status(requested_establishment_id uuid, requested_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare org_id uuid; held boolean;
begin
  select organization_id, (blocked_at is not null or not public_menu_active) into org_id, held from public.establishments where id=requested_establishment_id;
  if not private.has_organization_role(org_id,array['owner','admin']) or requested_status not in ('active','inactive','temporarily_closed') then raise exception 'Operação não autorizada.'; end if;
  if requested_status='active' and held then raise exception 'Unidade indisponível. Fale com o suporte.'; end if;
  update public.establishments set unit_status=requested_status,active=(requested_status='active'),updated_at=now() where id=requested_establishment_id;
  update public.service_modes set store_open=(requested_status='active') where establishment_id=requested_establishment_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'organization.store_status_changed','establishment',requested_establishment_id,jsonb_build_object('status',requested_status));
end $$;
