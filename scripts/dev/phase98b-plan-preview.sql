-- Fase 98B: prévia do impacto de 20261104132000_phase98b_plan_cleanup.sql, loja a loja. SOMENTE LEITURA
-- (um SELECT, nenhuma escrita): pode rodar em produção. Módulo efetivo = plano OU linha da loja.
-- Listas iguais às de lib/plan-tiers.ts (o teste tests/unit/plan-tiers-phase98.test.mjs confere).
with tiers as (
  select
    array['workspace_enabled','personalized_home_enabled','kitchen_enabled','advanced_printing_enabled','cashier_enabled',
      'waiter_mode_enabled','table_qr_ordering_enabled','table_tabs_enabled','drivers_enabled','staff_management_enabled','pix_secure_enabled',
      'card_proof_enabled','order_tracking_enabled','customer_portal_enabled','pickup_display_enabled','notification_center_enabled',
      'reports_enabled','mfa_enabled','customer_coupons_enabled','reorder_enabled']::text[] as basic,
    array['split_bill_enabled','coupons_enabled','custom_branding_enabled','inventory_enabled',
      'recipe_costing_enabled','purchase_management_enabled','financial_management_enabled','financial_reconciliation_enabled',
      'fiscal_module_enabled','accounting_export_enabled','supplier_document_import_enabled','reservations_enabled','loyalty_enabled',
      'loyalty_club_enabled','loyalty_portal_enabled','subscriptions_enabled','recurring_billing_enabled','workforce_management_enabled',
      'time_clock_enabled','shift_planning_enabled','labor_cost_enabled','advanced_reporting_enabled','menu_engineering_enabled',
      'profitability_analysis_enabled','manager_intelligence_enabled','analytics_center_enabled','crm_enabled','integrations_center_enabled',
      'webhooks_enabled','omnichannel_inbox_enabled','team_inbox_enabled','web_chat_enabled','global_search_enabled','command_palette_enabled',
      'quick_actions_enabled','campaigns_enabled','smart_promotions_enabled','customer_360_enabled','knowledge_base_enabled',
      'notification_digests_enabled','payment_terminal_integration_enabled','hardware_hub_enabled','local_hardware_agent_enabled']::text[] as professional_extra,
    array['advanced_delivery_enabled','campaigns_enabled','driver_tracking_enabled','external_logistics_enabled',
      'forecast_recommendations_enabled','inventory_prediction_enabled','model_monitoring_enabled','route_optimization_enabled',
      'smart_dispatch_enabled','staffing_prediction_enabled']::text[] as premium_extra
),
ranked as (
  select p.id, p.name, to_jsonb(p) as pj,
    case when p.active and coalesce((to_jsonb(p)->>'is_public')::boolean, true)
      then row_number() over (partition by (p.active and coalesce((to_jsonb(p)->>'is_public')::boolean, true)) order by p.monthly_price_cents, p.sort_order, p.created_at) end as tier_rank
  from public.plans p
),
stores as (
  select e.id, e.slug, r.name as plan_name, r.tier_rank, r.pj, to_jsonb(f) as fj
  from public.establishments e
  left join lateral (select s.plan_id from public.subscriptions s where s.establishment_id = e.id
                     and s.status::text in ('active','trialing','past_due') order by s.created_at desc limit 1) s on true
  left join ranked r on r.id = s.plan_id
  left join public.store_feature_flags f on f.establishment_id = e.id
),
flags as (
  select st.*, k.key,
    coalesce((st.pj->>k.key)::boolean, false) as plan_now,
    coalesce((st.fj->>k.key)::boolean, false) as store_value,
    case
      when st.tier_rank is null then coalesce((st.pj->>k.key)::boolean, false)
      when st.tier_rank = 1 then k.key = any(t.basic)
      when st.tier_rank = 2 then k.key = any(t.basic || t.professional_extra)
      else coalesce((st.pj->>k.key)::boolean, false) or k.key = any(t.premium_extra)
    end as plan_after
  from stores st cross join tiers t
  cross join lateral (select key from jsonb_each(coalesce(st.pj, '{}'::jsonb)) where key like '%\_enabled') k
)
select slug as loja, plan_name as plano, (fj is not null) as tem_linha_na_loja,
  count(*) filter (where plan_now or store_value) as modulos_agora,
  count(*) filter (where plan_after or store_value) as modulos_depois,
  string_agg(key, ', ' order by key) filter (where (plan_now or store_value) and not (plan_after or store_value)) as somem,
  string_agg(key, ', ' order by key) filter (where not (plan_now or store_value) and (plan_after or store_value)) as aparecem
from flags group by slug, plan_name, fj is not null order by slug;
