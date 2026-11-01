-- Colunas de privilégio de public.profiles só mudam por service_role ou por rotinas internas do banco.
-- Clientes autenticados editam apenas os dados do próprio perfil listados no grant abaixo.

revoke insert, update on public.profiles from public, anon, authenticated;
grant update (full_name, phone, last_login_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- Segunda barreira: continua valendo se um grant de tabela voltar a ser concedido por engano.
create or replace function private.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.is_superadmin or new.status <> 'active' then
        raise exception 'Coluna protegida de profiles' using errcode = '42501';
      end if;
    elsif new.id is distinct from old.id
      or new.is_superadmin is distinct from old.is_superadmin
      or new.status is distinct from old.status
      or new.created_at is distinct from old.created_at then
      raise exception 'Coluna protegida de profiles' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_profile_privileged_columns() from public;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
before insert or update on public.profiles
for each row execute function private.guard_profile_privileged_columns();
