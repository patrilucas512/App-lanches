-- Fase 99E: a cozinha não conseguia aceitar pedido do cardápio ("Sem permissão para atualizar métricas.").
-- O gatilho refresh_manager_daily_metrics_after_order (em public.orders) chamava public.refresh_manager_daily_metrics,
-- que confere a permissão do Copiloto do gerente de quem fez a ação. Cozinha, caixa, garçom e entregador não têm essa
-- permissão: qualquer mudança deles no pedido dava erro e era desfeita. O dono passava porque tem a permissão.
-- Causa raiz: a conta das métricas vira uma função interna (sem checagem, só o servidor chama). A função pública
-- continua exigindo a permissão para quem pede a atualização na tela; o gatilho chama a interna.
create or replace function private.refresh_manager_daily_metrics_internal(requested_establishment_id uuid, requested_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare tz text; day_start timestamptz; day_end timestamptz;
begin
  select coalesce(timezone,'America/Sao_Paulo') into tz from public.establishments where id=requested_establishment_id;
  if tz is null then raise exception 'Estabelecimento inválido.'; end if;
  day_start:=(requested_date::timestamp at time zone tz); day_end:=((requested_date+1)::timestamp at time zone tz);
  insert into public.manager_daily_metrics(establishment_id,metric_date,approved_orders,cancelled_orders,pending_orders,revenue_cents,delivery_orders,whatsapp_orders,ai_orders,refreshed_at)
  select requested_establishment_id,requested_date,
    count(*) filter(where o.status='completed' or o.online_payment_status='approved'),
    count(*) filter(where o.status='canceled' or o.online_payment_status in ('canceled','declined','refunded','charged_back')),
    count(*) filter(where not(o.status='completed' or o.online_payment_status='approved') and not(o.status='canceled' or coalesce(o.online_payment_status,'') in ('canceled','declined','refunded','charged_back'))),
    coalesce(sum(o.total_cents) filter(where o.status='completed' or o.online_payment_status='approved'),0),
    count(*) filter(where o.fulfillment_type='delivery'),count(*) filter(where lower(coalesce(o.source,'')) like '%whatsapp%'),
    count(*) filter(where exists(select 1 from public.ai_conversation_analysis a where a.generated_order_id=o.id)),now()
  from public.orders o where o.establishment_id=requested_establishment_id and o.created_at>=day_start and o.created_at<day_end
  on conflict(establishment_id,metric_date) do update set approved_orders=excluded.approved_orders,cancelled_orders=excluded.cancelled_orders,pending_orders=excluded.pending_orders,revenue_cents=excluded.revenue_cents,delivery_orders=excluded.delivery_orders,whatsapp_orders=excluded.whatsapp_orders,ai_orders=excluded.ai_orders,refreshed_at=now();
end $$;
revoke all on function private.refresh_manager_daily_metrics_internal(uuid, date) from public, anon, authenticated;

create or replace function public.refresh_manager_daily_metrics(requested_establishment_id uuid, requested_date date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.has_manager_copilot_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para atualizar métricas.'; end if;
  perform private.refresh_manager_daily_metrics_internal(requested_establishment_id, requested_date);
end $$;

create or replace function private.refresh_manager_daily_metrics_from_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_tz text; new_tz text;
begin
  if tg_op<>'DELETE' then
    select coalesce(timezone,'America/Sao_Paulo') into new_tz from public.establishments where id=new.establishment_id;
    perform private.refresh_manager_daily_metrics_internal(new.establishment_id,(new.created_at at time zone new_tz)::date);
  end if;
  if tg_op<>'INSERT' and (tg_op='DELETE' or old.establishment_id<>new.establishment_id or old.created_at<>new.created_at) then
    select coalesce(timezone,'America/Sao_Paulo') into old_tz from public.establishments where id=old.establishment_id;
    perform private.refresh_manager_daily_metrics_internal(old.establishment_id,(old.created_at at time zone old_tz)::date);
  end if;
  return coalesce(new,old);
end $$;
