-- Fase 98B (parte 2, MUDA o que as lojas veem): módulos avançados desligados no Básico e no Profissional.
-- Em produção, só com aprovação própria e depois de rodar a prévia scripts/dev/phase98b-plan-preview.sql.
--
-- Os planos são identificados pela ordem de preço entre os ativos e públicos (os códigos de produção não
-- seguem padrão): o 1º é o Básico, o 2º o Profissional, o 3º em diante (MasterApp/Premium) não perde nada e
-- ganha as flags avançadas que antes só existiam na loja. Listas iguais às de lib/plan-tiers.ts.
--
-- Lojas com linha em store_feature_flags mantêm os módulos que a linha liga (regra "plano OU loja");
-- quem perde é a loja sem linha, que só via o plano. A prévia lista loja a loja o que some.

do $$
declare
  c text;
  pilot text[] := array['workspace_enabled','personalized_home_enabled','kitchen_enabled','advanced_printing_enabled','cashier_enabled',
    'waiter_mode_enabled','table_qr_ordering_enabled','table_tabs_enabled','drivers_enabled','staff_management_enabled','pix_secure_enabled',
    'card_proof_enabled','order_tracking_enabled','customer_portal_enabled','pickup_display_enabled','notification_center_enabled',
    'reports_enabled','mfa_enabled'];
  basic text[] := pilot || array['customer_coupons_enabled','reorder_enabled'];
  professional text[] := basic || array['split_bill_enabled','coupons_enabled','custom_branding_enabled','inventory_enabled',
    'recipe_costing_enabled','purchase_management_enabled','financial_management_enabled','financial_reconciliation_enabled',
    'fiscal_module_enabled','accounting_export_enabled','supplier_document_import_enabled','reservations_enabled','loyalty_enabled',
    'loyalty_club_enabled','loyalty_portal_enabled','subscriptions_enabled','recurring_billing_enabled','workforce_management_enabled',
    'time_clock_enabled','shift_planning_enabled','labor_cost_enabled','advanced_reporting_enabled','menu_engineering_enabled',
    'profitability_analysis_enabled','manager_intelligence_enabled','analytics_center_enabled','crm_enabled','integrations_center_enabled',
    'webhooks_enabled','omnichannel_inbox_enabled','team_inbox_enabled','web_chat_enabled','global_search_enabled','command_palette_enabled',
    'quick_actions_enabled','campaigns_enabled','smart_promotions_enabled','customer_360_enabled','knowledge_base_enabled',
    'notification_digests_enabled','payment_terminal_integration_enabled','hardware_hub_enabled','local_hardware_agent_enabled'];
  premium_extra text[] := array['advanced_delivery_enabled','campaigns_enabled','driver_tracking_enabled','external_logistics_enabled',
    'forecast_recommendations_enabled','inventory_prediction_enabled','model_monitoring_enabled','route_optimization_enabled',
    'smart_dispatch_enabled','staffing_prediction_enabled'];
  ranked record;
  tier text[];
  sets text[];
begin
  foreach c in array professional || premium_extra loop
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='plans' and column_name=c) then
      raise exception 'PHASE98B_UNKNOWN_FLAG: %', c;
    end if;
  end loop;
  for ranked in
    select id, row_number() over (order by monthly_price_cents, sort_order, created_at) as tier_rank
    from public.plans where active and is_public
  loop
    if ranked.tier_rank >= 3 then
      sets := '{}';
      foreach c in array premium_extra loop sets := sets || format('%I = true', c); end loop;
    else
      tier := case ranked.tier_rank when 1 then basic else professional end;
      sets := '{}';
      for c in select column_name from information_schema.columns where table_schema='public' and table_name='plans'
               and column_name like '%\_enabled' and data_type = 'boolean' loop
        sets := sets || format('%I = %L', c, c = any(tier));
      end loop;
    end if;
    execute format('update public.plans set %s, updated_at = now() where id = %L', array_to_string(sets, ', '), ranked.id);
  end loop;
end $$;
