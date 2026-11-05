-- Fase 99C: alinhar a loja ao plano (superadmin), com prévia e proteção para módulos usados recentemente.
--
-- Por que: a regra é "plano OU loja"; lojas antigas têm a linha de store_feature_flags com quase tudo ligado
-- (padrão antigo), então limpar o plano não encurta o menu delas.
--
-- * public.preview_store_plan_alignment(loja): só leitura. Para cada flag ligada na linha da loja e desligada no
--   plano: some, ou fica porque a loja usou o módulo nos últimos 30 dias (tabela de atividade em
--   private.module_usage_sources). Flags que só existem na loja (entrega, WhatsApp, atendente) nunca saem.
-- * public.align_store_to_plan(loja, confirmação = slug da loja, módulos usados confirmados): desliga só as que
--   somem e as usadas que o superadmin confirmou uma a uma. Grava na auditoria de flags (Fase 98A).

create table if not exists private.module_usage_sources (
  flag text not null,
  table_name text not null,
  primary key (flag, table_name)
);
revoke all on private.module_usage_sources from public, anon, authenticated;
insert into private.module_usage_sources(flag, table_name) values
  ('inventory_enabled','inventory_movements'), ('purchase_management_enabled','purchase_orders'),
  ('financial_management_enabled','financial_entries'), ('fiscal_module_enabled','fiscal_documents'),
  ('reservations_enabled','reservations'), ('reservations_enabled','waitlist_entries'),
  ('subscriptions_enabled','customer_subscriptions'), ('campaigns_enabled','crm_campaigns'),
  ('time_clock_enabled','time_clock_entries'), ('workforce_management_enabled','time_clock_entries'),
  ('wms_enabled','warehouse_tasks'), ('transport_management_enabled','transport_trips'),
  ('ibp_enabled','ibp_audit_events'), ('mdm_enabled','master_audit_events'),
  ('customer_360_enabled','customer360_audit_events'), ('customer_journeys_enabled','journey_audit_events'),
  ('incident_management_enabled','incident_audit_events'), ('knowledge_base_enabled','knowledge_audit_events'),
  ('learning_center_enabled','learning_audit_events'), ('automation_center_enabled','automation_audit_events'),
  ('advanced_reporting_enabled','report_audit_events'), ('performance_management_enabled','performance_audit_events'),
  ('marketing_intelligence_enabled','marketing_audit_events'), ('procurement_intelligence_enabled','procurement_audit_events'),
  ('central_catalog_enabled','catalog_audit_events'), ('capacity_management_enabled','capacity_audit_events'),
  ('franchise_finance_enabled','franchise_finance_audit_events'), ('store_opening_enabled','store_opening_audit_events'),
  ('geo_management_enabled','geo_audit_events'), ('operational_audits_enabled','operational_audit_events'),
  ('central_production_enabled','production_audit_events'), ('supply_chain_planning_enabled','supply_audit_events'),
  ('data_catalog_enabled','data_governance_audit_events'), ('advanced_kds_enabled','kitchen_audit_events'),
  ('advanced_dining_room_enabled','dining_audit_events'), ('self_service_enabled','kiosk_audit_events'),
  ('customer_experience_enabled','cx_audit_events'), ('internal_communications_enabled','comms_audit_events'),
  ('advanced_workforce_planning_enabled','workforce_planning_audit_events'), ('demand_forecasting_enabled','forecast_audit_events'),
  ('menu_engineering_enabled','profitability_audit_events'), ('marketplace_integrations_enabled','marketplace_audit_events'),
  ('workspace_enabled','workspace_audit_events'), ('notification_center_enabled','notification_audit_events')
on conflict do nothing;

-- true = houve atividade nos últimos N dias; null = o módulo não tem fonte de uso mapeada.
create or replace function private.store_module_used_recently(requested_store_id uuid, requested_flag text, requested_days integer default 30)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  src record;
  col text;
  org uuid := (select organization_id from public.establishments where id = requested_store_id);
  found_any boolean := false;
  used boolean;
begin
  for src in select table_name from private.module_usage_sources where flag = requested_flag loop
    if to_regclass('public.' || src.table_name) is null then continue; end if;
    select c.column_name into col from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = src.table_name and c.column_name in ('store_id','establishment_id')
      order by c.column_name = 'store_id' desc limit 1;
    found_any := true;
    if col is not null then
      execute format('select exists(select 1 from public.%I where %I = $1 and created_at > now() - make_interval(days => $2))', src.table_name, col)
        into used using requested_store_id, requested_days;
    else
      execute format('select exists(select 1 from public.%I where organization_id = $1 and created_at > now() - make_interval(days => $2))', src.table_name)
        into used using org, requested_days;
    end if;
    if used then return true; end if;
  end loop;
  return case when found_any then false else null end;
end $$;
revoke all on function private.store_module_used_recently(uuid, text, integer) from public, anon, authenticated;

create or replace function public.preview_store_plan_alignment(requested_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  store public.establishments%rowtype;
  plan_row jsonb;
  flags_row jsonb;
  items jsonb := '[]'::jsonb;
  k text;
  used boolean;
begin
  if not private.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into store from public.establishments where id = requested_store_id;
  if store.id is null then raise exception 'STORE_NOT_FOUND' using errcode = 'P0002'; end if;
  plan_row := coalesce(private.store_plan_flags(requested_store_id), '{}'::jsonb);
  select to_jsonb(f) into flags_row from public.store_feature_flags f where f.establishment_id = requested_store_id;
  if flags_row is null then
    return jsonb_build_object('store_id', store.id, 'slug', store.slug, 'plan', plan_row->>'name', 'has_row', false, 'items', '[]'::jsonb,
      'removes', 0, 'kept_used', 0, 'note', 'Loja sem linha em store_feature_flags: já segue só o plano.');
  end if;
  for k in select key from jsonb_each(flags_row) where key like '%\_enabled' and value = 'true'::jsonb order by key loop
    if not (plan_row ? k) or coalesce((plan_row->>k)::boolean, false) then continue; end if;  -- só da loja ou já no plano
    used := private.store_module_used_recently(requested_store_id, k, 30);
    items := items || jsonb_build_object('flag', k, 'used_30d', used, 'action', case when used then 'keep_used' else 'remove' end);
  end loop;
  return jsonb_build_object('store_id', store.id, 'slug', store.slug, 'plan', plan_row->>'name', 'has_row', true, 'items', items,
    'removes', (select count(*) from jsonb_array_elements(items) x where x->>'action' = 'remove'),
    'kept_used', (select count(*) from jsonb_array_elements(items) x where x->>'action' = 'keep_used'),
    'stays_by_plan', (select count(*) from jsonb_each(plan_row) j where j.key like '%\_enabled' and j.value = 'true'::jsonb));
end $$;
revoke all on function public.preview_store_plan_alignment(uuid) from public, anon;
grant execute on function public.preview_store_plan_alignment(uuid) to authenticated;

create or replace function public.align_store_to_plan(requested_store_id uuid, requested_confirmation text, requested_confirm_used text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  preview jsonb;
  item jsonb;
  sets text[] := '{}';
  turned_off text[] := '{}';
  kept text[] := '{}';
begin
  if not private.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  preview := public.preview_store_plan_alignment(requested_store_id);
  if requested_confirmation is distinct from (preview->>'slug') then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023', hint = 'Digite o slug da loja para confirmar.';
  end if;
  for item in select * from jsonb_array_elements(preview->'items') loop
    if item->>'action' = 'remove' or (item->>'flag') = any(coalesce(requested_confirm_used, '{}')) then
      sets := sets || format('%I = false', item->>'flag');
      turned_off := turned_off || (item->>'flag');
    else
      kept := kept || (item->>'flag');
    end if;
  end loop;
  if cardinality(sets) > 0 then
    perform set_config('masterapp.flag_actor', 'superadmin', true);
    execute format('update public.store_feature_flags set %s, updated_by = $1, updated_at = now() where establishment_id = $2',
                   array_to_string(sets, ', ')) using (select auth.uid()), requested_store_id;
    perform set_config('masterapp.flag_actor', '', true);
  end if;
  return jsonb_build_object('turned_off', to_jsonb(turned_off), 'kept_used', to_jsonb(kept), 'plan', preview->>'plan');
end $$;
revoke all on function public.align_store_to_plan(uuid, text, text[]) from public, anon;
grant execute on function public.align_store_to_plan(uuid, text, text[]) to authenticated;
