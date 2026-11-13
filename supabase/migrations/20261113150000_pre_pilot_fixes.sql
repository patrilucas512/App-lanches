-- Correções antes do piloto, encontradas no teste de ponta a ponta de uma loja nova.
--
-- 1. Link do cardápio: a loja nova tinha o link montado sem tirar acentos ("Açaí da Praça" virava
--    "a-a-da-pra-a") e sem conferir nomes reservados nem links antigos de outras lojas.
-- 2. Atendimento: as escolhas do cadastro (entrega, retirada, formas de pagamento) só iam para
--    establishment_settings. O cardápio lê service_modes, criada com valores padrão quando a loja nasce.
-- 3. Número do pedido: vinha de uma sequência única do sistema, então o primeiro pedido de uma loja
--    nova podia aparecer como #116. Agora cada loja tem a própria numeração, a partir do maior número dela.
-- 4. Pix do estabelecimento: o cliente não via a chave. Ela é liberada só para quem tem o código de
--    acompanhamento de um pedido feito em Pix, para não expor a chave (às vezes um CPF) a qualquer visitante.

-- 1. Link sem acentos e sem colidir com nomes reservados ou links antigos.
do $$
declare
  def text := pg_get_functiondef('public.create_establishment(text,text)'::regprocedure);
  old_slug constant text := 'base_slug:=trim(both ''-'' from regexp_replace(lower(coalesce(nullif(requested_slug,''''),establishment_name)),''[^a-z0-9]+'',''-'',''g''));';
  old_loop constant text := 'while exists(select 1 from public.establishments where slug=final_slug) loop';
begin
  if position(old_slug in def) = 0 or position(old_loop in def) = 0 then
    raise exception 'PRE_PILOT_CREATE_ESTABLISHMENT_CHANGED: revisar a criação do link da loja';
  end if;
  def := replace(def, old_slug, 'base_slug:=public.normalize_menu_slug(coalesce(nullif(requested_slug,''''),establishment_name));');
  def := replace(def, old_loop, 'while exists(select 1 from public.establishments where slug=final_slug) or exists(select 1 from public.establishment_slug_history where slug=final_slug) or final_slug = any(array[''admin'',''api'',''app'',''ajuda'',''assinar'',''auth'',''blog'',''cadastro'',''caixa'',''cardapio'',''conta'',''cozinha'',''demo'',''garcom'',''help'',''home'',''login'',''loja'',''mail'',''masterapp'',''motoboy'',''onboarding'',''painel'',''planos'',''privacidade'',''status'',''superadmin'',''suporte'',''termos'',''www'']) loop');
  execute def;
end $$;

-- 2. O cadastro de 7 etapas passa as escolhas dele para o atendimento que o cardápio usa.
create or replace function public.apply_onboarding_service_mode(target_establishment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  settings public.establishment_settings%rowtype;
  payments jsonb;
  delivery boolean;
  pickup boolean;
begin
  if not exists (
    select 1 from public.establishment_members m
    where m.establishment_id = target_establishment and m.user_id = auth.uid() and m.role = 'owner'
  ) then raise exception 'FORBIDDEN'; end if;
  select * into settings from public.establishment_settings where establishment_id = target_establishment;
  if not found then return; end if;
  delivery := coalesce(settings.delivery_enabled, true);
  pickup := coalesce(settings.pickup_enabled, true);
  -- O cadastro usa *_on_delivery; a tela Atendimento e o cardápio usam credit_card/debit_card.
  select coalesce(jsonb_agg(distinct case value when 'credit_on_delivery' then 'credit_card' when 'debit_on_delivery' then 'debit_card' else value end), '[]'::jsonb)
    into payments
  from jsonb_array_elements_text(case when jsonb_typeof(settings.payment_methods) = 'array' then settings.payment_methods else '[]'::jsonb end) as value;
  if jsonb_array_length(payments) = 0 then payments := '["pix","cash"]'::jsonb; end if;
  update public.service_modes set
    delivery_enabled = delivery,
    counter_pickup_enabled = pickup,
    takeaway_enabled = pickup,
    -- O cadastro não pergunta sobre mesas; quem atende no salão liga isso em Atendimento.
    table_service_enabled = false,
    waiter_mode_enabled = false,
    mode = case when delivery and pickup then 'mixed' when delivery then 'delivery' else 'counter' end,
    accepted_payment_methods = payments
  where establishment_id = target_establishment;
end $$;
revoke all on function public.apply_onboarding_service_mode(uuid) from public, anon;
grant execute on function public.apply_onboarding_service_mode(uuid) to authenticated;

do $$
declare
  def text := pg_get_functiondef('public.complete_establishment_onboarding(jsonb)'::regprocedure);
  marker constant text := E'  return jsonb_build_object(\n    ''establishment_id'', target_establishment,';
begin
  if position(marker in def) = 0 then
    raise exception 'PRE_PILOT_COMPLETE_ONBOARDING_CHANGED: revisar o fim do cadastro';
  end if;
  if position('public.apply_onboarding_service_mode' in def) = 0 then
    def := replace(def, marker, E'  perform public.apply_onboarding_service_mode(target_establishment);\n\n' || marker);
    execute def;
  end if;
end $$;

-- 3. Numeração de pedidos por loja.
create table if not exists private.order_number_counters (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  last_number bigint not null
);
revoke all on private.order_number_counters from public, anon, authenticated;

create or replace function private.assign_store_order_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.order_number is not null then return new; end if;
  insert into private.order_number_counters as c (establishment_id, last_number)
  values (new.establishment_id, coalesce((select max(o.order_number) from public.orders o where o.establishment_id = new.establishment_id), 0) + 1)
  on conflict (establishment_id) do update set last_number = c.last_number + 1
  returning last_number into new.order_number;
  return new;
end $$;
revoke all on function private.assign_store_order_number() from public, anon, authenticated;

alter table public.orders alter column order_number drop identity if exists;
drop trigger if exists a0_assign_store_order_number on public.orders;
create trigger a0_assign_store_order_number before insert on public.orders
  for each row execute function private.assign_store_order_number();

-- 4. Chave Pix do estabelecimento para o pedido pago em Pix.
create or replace function public.get_public_order_pix(requested_tracking_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pix_key_type', p.pix_key_type,
    'pix_key', p.pix_key,
    'receiver_name', p.receiver_name,
    'total_cents', o.total_cents
  )
  from public.orders o
  join public.pix_settings p on p.establishment_id = o.establishment_id
  where o.tracking_token = requested_tracking_token
    and o.payment_method = 'pix'
    and o.status::text <> 'canceled'
  limit 1
$$;
revoke all on function public.get_public_order_pix(uuid) from public;
grant execute on function public.get_public_order_pix(uuid) to anon, authenticated;
