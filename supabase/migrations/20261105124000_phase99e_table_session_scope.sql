-- Fase 99E: abrir mesa pelo garçom falhava desde a Fase 42 ("null value in column organization_id of relation
-- table_sessions"). A 42 tornou store_id e organization_id obrigatórios, mas open_table_session_by_label (e qualquer
-- outro caminho que cria a sessão) só grava establishment_id. Em produção a última mesa aberta é de 13/09/2026.
-- Causa raiz corrigida no banco: todo insert em table_sessions herda loja e organização do estabelecimento.
create or replace function private.fill_table_session_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.store_id is null then new.store_id := new.establishment_id; end if;
  if new.organization_id is null then
    select e.organization_id into new.organization_id from public.establishments e where e.id = new.establishment_id;
  end if;
  return new;
end $$;
revoke all on function private.fill_table_session_scope() from public, anon, authenticated;

drop trigger if exists table_sessions_fill_scope on public.table_sessions;
create trigger table_sessions_fill_scope before insert on public.table_sessions
  for each row execute function private.fill_table_session_scope();
