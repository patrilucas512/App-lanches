-- Link do cardápio com o nome da loja: o dono escolhe a parte do nome (slug) e o resto do endereço
-- continua sendo do MasterApp. Links antigos continuam funcionando: ficam guardados em
-- establishment_slug_history e as páginas públicas redirecionam para o nome novo.

create table if not exists public.establishment_slug_history (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  replaced_at timestamptz not null default now()
);
create index if not exists establishment_slug_history_store_idx on public.establishment_slug_history(establishment_id);
alter table public.establishment_slug_history enable row level security;
revoke all on public.establishment_slug_history from public, anon, authenticated;

create or replace function public.normalize_menu_slug(raw text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(raw, '')), 'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public.change_establishment_slug(requested_establishment_id uuid, requested_slug text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  current_slug text;
  new_slug text := public.normalize_menu_slug(requested_slug);
  reserved text[] := array['admin','api','app','ajuda','assinar','auth','blog','cadastro','caixa','cardapio','conta','cozinha','demo','garcom','help','home','login','loja','mail','masterapp','motoboy','onboarding','painel','planos','privacidade','status','superadmin','suporte','termos','www'];
begin
  if auth.uid() is null then raise exception 'AUTH'; end if;
  if not exists (
    select 1 from public.establishment_members m
    where m.establishment_id = requested_establishment_id and m.user_id = auth.uid()
      and m.role in ('owner','manager') and coalesce(m.status, 'active') = 'active'
  ) then raise exception 'FORBIDDEN'; end if;
  if length(new_slug) < 3 or length(new_slug) > 40 then raise exception 'SLUG_LENGTH'; end if;
  if new_slug = any(reserved) then raise exception 'SLUG_RESERVED'; end if;

  select slug into current_slug from public.establishments where id = requested_establishment_id for update;
  if current_slug is null then raise exception 'NOT_FOUND'; end if;
  if current_slug = new_slug then return new_slug; end if;

  if exists (select 1 from public.establishments where slug = new_slug and id <> requested_establishment_id)
     or exists (select 1 from public.establishment_slug_history where slug = new_slug and establishment_id <> requested_establishment_id) then
    raise exception 'SLUG_TAKEN';
  end if;

  -- Voltando a um nome que a própria loja já usou: ele deixa de ser link antigo.
  delete from public.establishment_slug_history where slug = new_slug;
  insert into public.establishment_slug_history(slug, establishment_id) values (current_slug, requested_establishment_id)
    on conflict (slug) do update set establishment_id = excluded.establishment_id, replaced_at = now();
  update public.establishments set slug = new_slug where id = requested_establishment_id;
  return new_slug;
end $$;

revoke all on function public.change_establishment_slug(uuid, text) from public, anon;
grant execute on function public.change_establishment_slug(uuid, text) to authenticated;
grant execute on function public.normalize_menu_slug(text) to authenticated;
