create table public.delivery_group_suggestions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  first_delivery_id uuid not null references public.deliveries(id) on delete cascade,
  second_delivery_id uuid not null references public.deliveries(id) on delete cascade,
  status text not null default 'suggested' check (status in ('suggested','approved','ignored','expired')),
  compatibility_score integer not null check (compatibility_score between 0 and 100),
  reason text not null check (char_length(reason) between 5 and 300),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_group_suggestions_distinct_check check (first_delivery_id < second_delivery_id),
  constraint delivery_group_suggestions_pair_unique unique (first_delivery_id, second_delivery_id),
  constraint delivery_group_suggestions_decision_check check (
    (status = 'suggested' and decided_at is null and decided_by is null)
    or (status in ('approved','ignored') and decided_at is not null and decided_by is not null)
    or status = 'expired'
  )
);

create index delivery_group_suggestions_establishment_status_idx
  on public.delivery_group_suggestions(establishment_id, status, created_at desc);

create unique index delivery_group_suggestions_one_active_delivery_idx
  on public.delivery_group_suggestions(establishment_id, first_delivery_id)
  where status = 'approved';

create unique index delivery_group_suggestions_one_active_second_idx
  on public.delivery_group_suggestions(establishment_id, second_delivery_id)
  where status = 'approved';

create trigger delivery_group_suggestions_touch before update on public.delivery_group_suggestions
for each row execute function public.touch_updated_at();

alter table public.delivery_group_suggestions enable row level security;

create policy delivery_group_suggestions_admin_select on public.delivery_group_suggestions
for select to authenticated using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);

revoke all on table public.delivery_group_suggestions from public, anon, authenticated;
grant select on table public.delivery_group_suggestions to authenticated;

create or replace function public.refresh_delivery_group_suggestions(
  requested_establishment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  suggestions jsonb;
begin
  if actor is null or not private.has_role(requested_establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Sem permissao para consultar agrupamentos.';
  end if;

  update public.delivery_group_suggestions suggestion
  set status = 'expired', updated_at = now()
  where suggestion.establishment_id = requested_establishment_id
    and suggestion.status = 'suggested'
    and (
      suggestion.expires_at <= now()
      or not exists (
        select 1 from public.deliveries delivery
        where delivery.id in (suggestion.first_delivery_id, suggestion.second_delivery_id)
          and delivery.status = 'ready_for_dispatch'
        group by true having count(*) = 2
      )
    );

  insert into public.delivery_group_suggestions(
    establishment_id, first_delivery_id, second_delivery_id, compatibility_score, reason
  )
  select
    first_delivery.establishment_id,
    least(first_delivery.id, second_delivery.id),
    greatest(first_delivery.id, second_delivery.id),
    case when first_destination.delivery_zone_id is not null
      and first_destination.delivery_zone_id = second_destination.delivery_zone_id then 100 else 90 end,
    case when first_destination.delivery_zone_id is not null
      and first_destination.delivery_zone_id = second_destination.delivery_zone_id
      then 'Mesmo setor de entrega e pedidos prontos em horarios compativeis.'
      else 'Mesmo bairro e cidade, com pedidos prontos em horarios compativeis.' end
  from public.deliveries first_delivery
  join public.deliveries second_delivery
    on second_delivery.establishment_id = first_delivery.establishment_id
   and first_delivery.id < second_delivery.id
   and second_delivery.status = 'ready_for_dispatch'
  join public.delivery_destinations first_destination
    on first_destination.delivery_order_id = first_delivery.order_id
  join public.delivery_destinations second_destination
    on second_destination.delivery_order_id = second_delivery.order_id
  where first_delivery.establishment_id = requested_establishment_id
    and first_delivery.status = 'ready_for_dispatch'
    and abs(extract(epoch from (coalesce(first_delivery.ready_at, first_delivery.updated_at) - coalesce(second_delivery.ready_at, second_delivery.updated_at)))) <= 1200
    and private.normalize_delivery_area(first_destination.city) = private.normalize_delivery_area(second_destination.city)
    and private.normalize_delivery_area(first_destination.neighborhood) = private.normalize_delivery_area(second_destination.neighborhood)
  on conflict (first_delivery_id, second_delivery_id) do update
    set compatibility_score = excluded.compatibility_score,
        reason = excluded.reason,
        status = case when public.delivery_group_suggestions.status = 'expired' then 'suggested' else public.delivery_group_suggestions.status end,
        expires_at = case when public.delivery_group_suggestions.status = 'expired' then now() + interval '30 minutes' else public.delivery_group_suggestions.expires_at end,
        decided_by = case when public.delivery_group_suggestions.status = 'expired' then null else public.delivery_group_suggestions.decided_by end,
        decided_at = case when public.delivery_group_suggestions.status = 'expired' then null else public.delivery_group_suggestions.decided_at end,
        updated_at = now();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', suggestion.id,
    'status', suggestion.status,
    'compatibility_score', suggestion.compatibility_score,
    'reason', suggestion.reason,
    'expires_at', suggestion.expires_at,
    'first_delivery', jsonb_build_object(
      'id', first_delivery.id,
      'order_number', first_order.order_number,
      'customer_name', first_order.customer_name,
      'neighborhood', first_destination.neighborhood
    ),
    'second_delivery', jsonb_build_object(
      'id', second_delivery.id,
      'order_number', second_order.order_number,
      'customer_name', second_order.customer_name,
      'neighborhood', second_destination.neighborhood
    )
  ) order by suggestion.compatibility_score desc, suggestion.created_at), '[]'::jsonb)
  into suggestions
  from public.delivery_group_suggestions suggestion
  join public.deliveries first_delivery on first_delivery.id = suggestion.first_delivery_id
  join public.orders first_order on first_order.id = first_delivery.order_id
  join public.delivery_destinations first_destination on first_destination.delivery_order_id = first_delivery.order_id
  join public.deliveries second_delivery on second_delivery.id = suggestion.second_delivery_id
  join public.orders second_order on second_order.id = second_delivery.order_id
  join public.delivery_destinations second_destination on second_destination.delivery_order_id = second_delivery.order_id
  where suggestion.establishment_id = requested_establishment_id
    and suggestion.status in ('suggested','approved');

  return suggestions;
end $$;

create or replace function public.decide_delivery_group_suggestion(
  requested_suggestion_id uuid,
  requested_decision text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  suggestion public.delivery_group_suggestions%rowtype;
  first_delivery public.deliveries%rowtype;
  second_delivery public.deliveries%rowtype;
  normalized_decision text := lower(btrim(requested_decision));
begin
  if actor is null then raise exception 'Autenticacao necessaria.'; end if;
  if normalized_decision not in ('approved','ignored') then raise exception 'Decisao invalida.'; end if;

  select * into suggestion from public.delivery_group_suggestions
  where id = requested_suggestion_id for update;
  if suggestion.id is null or not private.has_role(suggestion.establishment_id, array['owner','manager']::public.member_role[]) then
    raise exception 'Agrupamento nao encontrado ou sem permissao.';
  end if;
  if suggestion.status <> 'suggested' or suggestion.expires_at <= now() then
    raise exception 'Esta sugestao nao esta mais disponivel.';
  end if;

  select * into first_delivery from public.deliveries where id = suggestion.first_delivery_id for update;
  select * into second_delivery from public.deliveries where id = suggestion.second_delivery_id for update;
  if first_delivery.status <> 'ready_for_dispatch' or second_delivery.status <> 'ready_for_dispatch' then
    raise exception 'Os dois pedidos precisam estar prontos e sem despacho iniciado.';
  end if;
  if normalized_decision = 'approved' and exists (
    select 1 from public.delivery_group_suggestions active_group
    where active_group.status = 'approved' and active_group.id <> suggestion.id
      and (active_group.first_delivery_id in (first_delivery.id, second_delivery.id)
        or active_group.second_delivery_id in (first_delivery.id, second_delivery.id))
  ) then raise exception 'Um dos pedidos ja pertence a outro agrupamento aprovado.'; end if;

  update public.delivery_group_suggestions set
    status = normalized_decision,
    decided_by = actor,
    decided_at = now(),
    updated_at = now()
  where id = suggestion.id returning * into suggestion;

  insert into public.delivery_events(
    establishment_id, delivery_id, event_type, actor_type, actor_user_id, metadata
  ) values
    (suggestion.establishment_id, first_delivery.id, 'delivery_group_' || normalized_decision, 'user', actor,
      jsonb_build_object('suggestion_id', suggestion.id, 'paired_delivery_id', second_delivery.id, 'score', suggestion.compatibility_score)),
    (suggestion.establishment_id, second_delivery.id, 'delivery_group_' || normalized_decision, 'user', actor,
      jsonb_build_object('suggestion_id', suggestion.id, 'paired_delivery_id', first_delivery.id, 'score', suggestion.compatibility_score));

  insert into public.audit_logs(establishment_id, actor_id, action, entity_type, entity_id, metadata)
  values(suggestion.establishment_id, actor, 'delivery.group_' || normalized_decision,
    'delivery_group_suggestions', suggestion.id,
    jsonb_build_object('first_delivery_id', first_delivery.id, 'second_delivery_id', second_delivery.id,
      'compatibility_score', suggestion.compatibility_score));

  return to_jsonb(suggestion);
end $$;

revoke all on function public.refresh_delivery_group_suggestions(uuid) from public, anon;
revoke all on function public.decide_delivery_group_suggestion(uuid,text) from public, anon;
grant execute on function public.refresh_delivery_group_suggestions(uuid) to authenticated;
grant execute on function public.decide_delivery_group_suggestion(uuid,text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_group_suggestions'
  ) then alter publication supabase_realtime add table public.delivery_group_suggestions; end if;
end $$;
