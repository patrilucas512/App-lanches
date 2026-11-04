-- Fase 98B (parte 1, compatível com as lojas existentes): plano "Piloto" e flags para o menu.
--
-- Nada que as lojas existentes usam muda aqui:
--   * as flags novas do menu nascem LIGADAS nos planos atuais (o item aparecia sempre) e desligadas no Piloto;
--   * as flags avançadas que existiam só na loja ganham coluna no plano DESLIGADA: hoje, sem a coluna, o
--     servidor já tratava o plano como desligado (coalesce(plano, false)); a linha da loja continua valendo;
--   * linhas NOVAS de store_feature_flags deixam de nascer com ~165 módulos ligados: o padrão das colunas que
--     o plano controla passa a ser false (a regra é "plano OU loja", então quem decide é o plano). Linhas já
--     existentes não são tocadas. A limpeza dos planos Básico e Profissional está na parte 2
--     (20261104132000_phase98b_plan_cleanup.sql), com aprovação própria.
--   * o Piloto não aparece no site nem no autoatendimento de troca de plano (`is_public = false`) e não tem
--     preço (0): quem vincula a loja ao Piloto é o superadmin. Preço é decisão do dono do MasterApp.

alter table public.plans add column if not exists is_public boolean not null default true;
comment on column public.plans.is_public is 'Fase 98B: false = não aparece no site nem na troca de plano pelo dono (ex.: Piloto).';

do $$
declare
  c text;
  menu_flags text[] := array['manager_intelligence_enabled','analytics_center_enabled','multi_unit_enabled','crm_enabled',
    'integrations_center_enabled','integration_orchestration_enabled','digital_twin_enabled','enterprise_architecture_enabled',
    'enterprise_change_management_enabled','process_intelligence_enabled'];
  store_only_advanced text[] := array['advanced_delivery_enabled','campaigns_enabled','driver_tracking_enabled','external_logistics_enabled',
    'forecast_recommendations_enabled','inventory_prediction_enabled','model_monitoring_enabled','route_optimization_enabled',
    'smart_dispatch_enabled','staffing_prediction_enabled'];
  operational text[] := array['delivery_enabled','whatsapp_enabled','ai_enabled'];
begin
  foreach c in array menu_flags loop
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='plans' and column_name=c) then
      execute format('alter table public.plans add column %I boolean not null default false', c);
      execute format('update public.plans set %I = true', c);  -- compatível: o item aparecia para todos
    end if;
    execute format('alter table public.store_feature_flags add column if not exists %I boolean not null default false', c);
  end loop;
  foreach c in array store_only_advanced loop
    execute format('alter table public.plans add column if not exists %I boolean not null default false', c);
  end loop;
  for c in
    select s.column_name from information_schema.columns s
    where s.table_schema='public' and s.table_name='store_feature_flags' and s.column_name like '%\_enabled'
      and s.column_default = 'true' and not (s.column_name = any(operational))
      and exists (select 1 from information_schema.columns p where p.table_schema='public' and p.table_name='plans' and p.column_name=s.column_name)
  loop
    execute format('alter table public.store_feature_flags alter column %I set default false', c);
  end loop;
end $$;

-- Plano Piloto: limites copiados do plano ativo mais barato; só o núcleo ligado (lib/plan-tiers.ts PILOT_PLAN_FLAGS).
insert into public.plans(code, name, description, monthly_price_cents, annual_price_cents, max_products, max_team_members,
  max_monthly_orders, max_waiters, max_qr_codes, max_cashiers, max_inventory_items, max_drivers, max_establishments,
  max_concurrent_calls, included_voice_minutes, max_api_clients, max_webhook_endpoints, max_app_installations,
  features, active, is_public, sort_order)
select 'piloto', 'Piloto', 'Loja piloto: cardápio, pedidos (mesa, retirada e delivery), pagamento, cozinha e impressão, garçom, caixa, entregador, acompanhamento, notificações, WhatsApp e relatórios de vendas.',
  0, 0, b.max_products, b.max_team_members, b.max_monthly_orders, b.max_waiters, b.max_qr_codes, b.max_cashiers,
  b.max_inventory_items, b.max_drivers, 1, b.max_concurrent_calls, b.included_voice_minutes, b.max_api_clients,
  b.max_webhook_endpoints, b.max_app_installations, '[]'::jsonb, true, false, 0
from (select * from public.plans where active and code <> 'piloto' order by monthly_price_cents, sort_order limit 1) b
on conflict (code) do nothing;

do $$
declare
  c text;
  pilot text[] := array['workspace_enabled','personalized_home_enabled','kitchen_enabled','advanced_printing_enabled','cashier_enabled',
    'waiter_mode_enabled','table_qr_ordering_enabled','table_tabs_enabled','drivers_enabled','staff_management_enabled','pix_secure_enabled',
    'card_proof_enabled','order_tracking_enabled','customer_portal_enabled','pickup_display_enabled','notification_center_enabled',
    'reports_enabled','mfa_enabled'];
  sets text[] := '{}';
begin
  foreach c in array pilot loop
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='plans' and column_name=c) then
      raise exception 'PHASE98B_UNKNOWN_FLAG: %', c;
    end if;
  end loop;
  for c in select column_name from information_schema.columns where table_schema='public' and table_name='plans'
           and column_name like '%\_enabled' and data_type = 'boolean' loop
    sets := sets || format('%I = %L', c, c = any(pilot));
  end loop;
  execute format('update public.plans set %s, updated_at = now() where code = %L', array_to_string(sets, ', '), 'piloto');
end $$;

-- O dono não troca sozinho para um plano fora da vitrine (o Piloto custa 0); o superadmin pode.
-- Igual à Fase 22, mudando só a busca do plano de destino.
create or replace function public.preview_saas_plan_change(requested_organization_id uuid, requested_plan_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare current_sub record;target public.plans%rowtype;stores integer;members integer;conflicts jsonb:='[]';proration bigint:=0;remaining_seconds numeric;total_seconds numeric;begin
 if not private.billing_member(requested_organization_id,'change_plan') then raise exception 'Sem permissão billing:change_plan.';end if;
 select s.*,p.monthly_price_cents current_price into current_sub from public.subscriptions s join public.plans p on p.id=s.plan_id where s.organization_id=requested_organization_id limit 1;
 select * into target from public.plans where id=requested_plan_id and active and (is_public or private.is_superadmin());if target.id is null then raise exception 'Plano indisponível.';end if;
 select count(*) into stores from public.establishments where organization_id=requested_organization_id and unit_status<>'archived';
 select count(*) into members from public.organization_members where organization_id=requested_organization_id and active;
 if target.max_establishments is not null and stores>target.max_establishments then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('resource','stores','current',stores,'limit',target.max_establishments));end if;
 if target.max_team_members is not null and members>target.max_team_members then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('resource','team_members','current',members,'limit',target.max_team_members));end if;
 if current_sub.current_price is not null and current_sub.current_period_end>now() then
  remaining_seconds:=greatest(extract(epoch from (current_sub.current_period_end-now())),0);
  total_seconds:=greatest(extract(epoch from (current_sub.current_period_end-current_sub.current_period_start)),1);
  proration:=round((target.monthly_price_cents-current_sub.current_price)*remaining_seconds/total_seconds);
 end if;
 return jsonb_build_object('from_plan_id',current_sub.plan_id,'to_plan_id',target.id,'change_type',case when target.monthly_price_cents>=coalesce(current_sub.current_price,0) then 'upgrade' else 'downgrade' end,'proration_cents',proration,'effective_at',case when target.monthly_price_cents>=coalesce(current_sub.current_price,0) then now() else current_sub.current_period_end end,'conflicts',conflicts,'data_will_be_deleted',false);
end$function$;

-- O cadastro escolhia o plano inicial por sort_order entre os ativos: sem um plano 'starter' (caso de
-- produção) o Piloto (sort_order 0) viraria o plano de toda loja nova. Igual à versão atual, só com is_public.
do $$
declare def text := pg_get_functiondef('public.create_establishment(text,text)'::regprocedure);
begin
  if position('where active order by (lower(code)=''starter'') desc' in def) = 0 then
    raise exception 'PHASE98B_CREATE_ESTABLISHMENT_CHANGED: revisar a busca do plano inicial';
  end if;
  execute replace(def, 'where active order by (lower(code)=''starter'') desc', 'where active and is_public order by (lower(code)=''starter'') desc');
end $$;

-- O Piloto (is_public = false) não aparece na vitrine pública.
create or replace function public.public_saas_plans()
returns table(code text, name text, description text, monthly_price_cents integer, annual_price_cents integer, features jsonb)
language sql stable set search_path = '' as $$
  select p.code, p.name, p.description, p.monthly_price_cents, p.annual_price_cents,
    coalesce((select jsonb_agg(jsonb_build_object('key',f.key,'name',f.name,'enabled',pf.enabled,'limit',pf.limit_value) order by f.name)
              from public.saas_plan_features pf join public.saas_features f on f.key=pf.feature_key
              where pf.plan_id=p.id and f.public), '[]')
  from public.plans p where p.active and p.is_public order by p.sort_order, p.monthly_price_cents
$$;
