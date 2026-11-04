-- Fase 98I: o cadastro registra o aceite dos termos de uso e da política de privacidade (versão e data).
-- O formulário de /cadastro exige a caixa "Li e aceito" e envia as versões nos metadados do signUp
-- (legal_terms_version, legal_privacy_version). Este gatilho grava o aceite com a data do SERVIDOR no momento
-- em que a conta nasce, inclusive quando a confirmação de e-mail ainda está pendente.
-- Os textos são rascunho (lib/legal.ts) até a aprovação do dono do MasterApp.

create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document text not null check (document in ('saas_terms','saas_privacy','customer_terms','customer_privacy')),
  version text not null check (char_length(version) between 1 and 60),
  accepted_at timestamptz not null default now(),
  source text not null default 'signup' check (source in ('signup','reacceptance','portal')),
  unique (user_id, document, version)
);
create index if not exists legal_acceptances_document_idx on public.legal_acceptances(document, version);
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from anon, authenticated;
grant select on public.legal_acceptances to authenticated;
drop policy if exists legal_acceptances_read on public.legal_acceptances;
create policy legal_acceptances_read on public.legal_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_superadmin()));

create or replace function private.record_signup_legal_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  terms text := left(btrim(coalesce(meta->>'legal_terms_version', '')), 60);
  privacy text := left(btrim(coalesce(meta->>'legal_privacy_version', '')), 60);
begin
  if terms <> '' then
    insert into public.legal_acceptances(user_id, document, version) values (new.id, 'saas_terms', terms) on conflict do nothing;
  end if;
  if privacy <> '' then
    insert into public.legal_acceptances(user_id, document, version) values (new.id, 'saas_privacy', privacy) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function private.record_signup_legal_acceptance() from public, anon, authenticated;

drop trigger if exists on_auth_user_legal_acceptance on auth.users;
create trigger on_auth_user_legal_acceptance after insert on auth.users
  for each row execute function private.record_signup_legal_acceptance();
