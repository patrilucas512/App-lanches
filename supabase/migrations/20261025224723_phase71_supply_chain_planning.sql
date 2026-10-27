-- Phase 71: explainable supply-chain planning over the official Inventory, Procurement and Phase 70 ledgers.
-- Snapshots and facts are read models only; inventory_movements remains the transactional source of truth.
-- quality: allow-nonconcurrent-index reason=new-empty-phase71-tables
alter table public.plans add column if not exists supply_chain_planning_enabled boolean not null default false,
 add column if not exists multi_echelon_inventory_enabled boolean not null default false,
 add column if not exists redistribution_recommendations_enabled boolean not null default false,
 add column if not exists supply_scenarios_enabled boolean not null default false,
 add column if not exists dynamic_safety_stock_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists supply_chain_planning_enabled boolean not null default true,
 add column if not exists multi_echelon_inventory_enabled boolean not null default true,
 add column if not exists redistribution_recommendations_enabled boolean not null default true,
 add column if not exists supply_scenarios_enabled boolean not null default true,
 add column if not exists dynamic_safety_stock_enabled boolean not null default true;

alter table public.inventory_items add column if not exists supply_criticality text not null default 'normal',
 add column if not exists transport_requirement text,
 add column if not exists planning_enabled boolean not null default true;
alter table public.inventory_items drop constraint if exists inventory_items_supply_criticality_check;
alter table public.inventory_items add constraint inventory_items_supply_criticality_check check(supply_criticality in('critical','important','normal'));

create table public.supply_nodes(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 node_type text not null check(node_type in('supplier','distribution_center','central_kitchen','warehouse','store','virtual_node')),
 entity_type text not null,entity_id uuid,name text not null,active boolean not null default true,
 region_id uuid references public.network_regions(id) on delete set null,legal_entity_id uuid,timezone text not null default 'America/Sao_Paulo',
 metadata jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,node_type,entity_type,entity_id)
);
comment on table public.supply_nodes is 'Planning references to existing suppliers, stores, warehouses and production units; never duplicates the domain entity.';

create table public.transport_profiles(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,mode text not null default 'road',temperature_mode text not null check(temperature_mode in('ambient','chilled','frozen','custom')),
 min_temperature numeric,max_temperature numeric,cost_model jsonb not null default '{}',capacity_model jsonb not null default '{}',active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.lead_time_profiles(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 source_node_id uuid not null references public.supply_nodes(id) on delete cascade,destination_node_id uuid not null references public.supply_nodes(id) on delete cascade,
 item_scope_type text not null default 'all' check(item_scope_type in('all','category','item','brand','custom_group')),item_scope_id uuid,
 base_lead_time_hours numeric not null check(base_lead_time_hours>=0),variability_method text not null default 'median' check(variability_method in('fixed','median','median_variability','provider')),
 service_days smallint[] not null default '{1,2,3,4,5}',cutoff_time time,receiving_hours jsonb not null default '{}',active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.supply_links(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 source_node_id uuid not null references public.supply_nodes(id) on delete cascade,destination_node_id uuid not null references public.supply_nodes(id) on delete cascade,
 item_scope_type text not null default 'all' check(item_scope_type in('all','category','item','brand','custom_group')),item_scope_id uuid,
 priority integer not null default 100,lead_time_profile_id uuid references public.lead_time_profiles(id) on delete set null,
 transport_profile_id uuid references public.transport_profiles(id) on delete set null,transfer_policy text not null default 'internal_only' check(transfer_policy in('internal_only','commercial_workflow_required','blocked')),
 active boolean not null default true,valid_from date not null default current_date,valid_until date,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(source_node_id<>destination_node_id),check(valid_until is null or valid_until>=valid_from)
);

create table public.safety_stock_policies(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,node_id uuid not null references public.supply_nodes(id) on delete cascade,
 inventory_item_id uuid references public.inventory_items(id) on delete cascade,category_id uuid references public.categories(id) on delete cascade,category_key text,
 method text not null check(method in('fixed_quantity','fixed_days_of_cover','demand_variability','lead_time_variability','manual')),
 fixed_quantity numeric,fixed_days numeric,service_factor numeric not null default 1.65,source_floor_quantity numeric not null default 0,settings jsonb not null default '{}',active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(inventory_item_id is not null or category_id is not null or category_key is not null)
);
create table public.replenishment_calendars(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,node_id uuid not null references public.supply_nodes(id) on delete cascade,
 name text not null,order_days smallint[] not null default '{}',cutoff_time time,timezone text not null default 'America/Sao_Paulo',emergency_requires_approval boolean not null default true,
 active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.replenishment_policies(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,node_id uuid not null references public.supply_nodes(id) on delete cascade,
 inventory_item_id uuid references public.inventory_items(id) on delete cascade,category_id uuid references public.categories(id) on delete cascade,category_key text,
 method text not null check(method in('min_max','reorder_point','periodic_review','days_of_cover','forecast_driven')),
 min_qty numeric,max_qty numeric,reorder_point numeric,target_cover_days numeric,safety_stock_policy_id uuid references public.safety_stock_policies(id) on delete set null,
 replenishment_calendar_id uuid references public.replenishment_calendars(id) on delete set null,transfer_before_buy boolean not null default false,
 production_before_buy boolean not null default false,allocation_policy text not null default 'manual' check(allocation_policy in('proportional','minimum_service','priority_store','contractual_priority','manual','demand_weighted')),
 active boolean not null default true,version integer not null default 1,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(inventory_item_id is not null or category_id is not null or category_key is not null)
);

create table public.supply_planning_runs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 horizon_start timestamptz not null,horizon_end timestamptz not null,scenario text not null default 'base',status text not null default 'queued' check(status in('queued','running','completed','partial','failed')),
 input_snapshot_version text not null,input_snapshot jsonb not null default '{}',partition_strategy jsonb not null default '{}',started_at timestamptz,completed_at timestamptz,
 created_by uuid references auth.users(id) on delete set null,created_by_system boolean not null default false,error_summary text,created_at timestamptz not null default now(),
 check(horizon_end>horizon_start)
);
create table public.network_inventory_snapshots(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,
 planning_run_id uuid references public.supply_planning_runs(id) on delete set null,node_id uuid not null references public.supply_nodes(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,bucket_at timestamptz not null,bucket_granularity text not null check(bucket_granularity in('hour','day','week')),
 on_hand numeric not null default 0,available numeric not null default 0,reserved numeric not null default 0,committed numeric not null default 0,
 in_transit_in numeric not null default 0,in_transit_out numeric not null default 0,quarantined numeric not null default 0,expiring numeric not null default 0,
 projected_stock numeric not null default 0,days_of_cover numeric,shortage_risk text not null default 'low',excess_risk text not null default 'low',confidence text not null default 'low',
 source_versions jsonb not null default '{}',calculated_at timestamptz not null default now(),unique(organization_id,node_id,inventory_item_id,bucket_at,bucket_granularity,planning_run_id)
);
comment on table public.network_inventory_snapshots is 'Non-transactional planning/analytics read model. Never use as inventory balance or mutation source.';

create table public.supply_recommendations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,planning_run_id uuid references public.supply_planning_runs(id) on delete set null,
 inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,destination_node_id uuid not null references public.supply_nodes(id) on delete cascade,
 recommendation_type text not null check(recommendation_type in('purchase','transfer','production','rebalance','defer','no_action')),source_node_id uuid references public.supply_nodes(id) on delete set null,
 quantity numeric not null check(quantity>=0),required_by timestamptz not null,reason_codes text[] not null default '{}',explanation jsonb not null default '{}',confidence text not null check(confidence in('high','medium','low')),
 estimated_cost_cents bigint,estimated_lead_time_hours numeric,status text not null default 'proposed' check(status in('proposed','reviewed','approved','rejected','executed','expired')),
 input_fingerprint text not null,expires_at timestamptz not null,revalidation_snapshot jsonb,reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz,
 decision_reason text,execution_type text,execution_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.supply_scenarios(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,
 scenario_type text not null check(scenario_type in('base','high_demand','supplier_delay','central_outage','promotion','opening','weather_event','custom')),
 assumptions jsonb not null default '{}',status text not null default 'draft' check(status in('draft','ready','archived')),created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.supply_risk_events(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,node_id uuid references public.supply_nodes(id) on delete cascade,
 inventory_item_id uuid references public.inventory_items(id) on delete cascade,risk_type text not null check(risk_type in('projected_stockout','supplier_delay','production_shortfall','excess','expiry','transfer_delay','quality_hold','single_source_dependency')),
 severity text not null check(severity in('low','medium','high','critical')),status text not null default 'open' check(status in('open','monitoring','resolved','dismissed')),
 evidence jsonb not null default '{}',detected_at timestamptz not null default now(),resolved_at timestamptz,dedupe_key text not null,unique(organization_id,dedupe_key,status)
);
create table public.supply_service_level_snapshots(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,node_id uuid references public.supply_nodes(id) on delete cascade,
 source_node_id uuid references public.supply_nodes(id) on delete set null,period_start timestamptz not null,period_end timestamptz not null,
 service_level_type text not null check(service_level_type in('store_fill_rate','supplier_fill_rate','network_fill_rate','otif','transfer_on_time_rate')),
 requested_quantity numeric not null default 0,fulfilled_quantity numeric not null default 0,on_time_full_quantity numeric not null default 0,metric_value numeric,sample_size integer not null default 0,
 definition jsonb not null default '{}',calculated_at timestamptz not null default now()
);
create table public.supply_planning_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,planning_run_id uuid not null references public.supply_planning_runs(id) on delete cascade,
 partition_key text not null,priority smallint not null default 50 check(priority between 1 and 100),status text not null default 'queued' check(status in('queued','leased','completed','failed','dead_letter')),
 payload jsonb not null default '{}',attempts integer not null default 0,max_attempts integer not null default 3,available_at timestamptz not null default now(),leased_at timestamptz,leased_by text,last_error text,
 idempotency_key text not null,created_at timestamptz not null default now(),unique(organization_id,idempotency_key)
);
create table public.inventory_item_substitutions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,original_item_id uuid not null references public.inventory_items(id) on delete cascade,
 substitute_item_id uuid not null references public.inventory_items(id) on delete cascade,approval_scope text not null default 'recommendation_only' check(approval_scope in('recommendation_only','quality_approved','recipe_approved')),
 conversion_ratio numeric not null default 1 check(conversion_ratio>0),valid_from date not null default current_date,valid_until date,approved_by uuid references auth.users(id) on delete set null,active boolean not null default true,
 created_at timestamptz not null default now(),check(original_item_id<>substitute_item_id),check(valid_until is null or valid_until>=valid_from)
);
create table public.supply_audit_events(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,actor_user_id uuid references auth.users(id) on delete set null,
 action text not null,entity_type text not null,entity_id uuid,reason text,before_state jsonb,after_state jsonb,correlation_id uuid not null default gen_random_uuid(),created_at timestamptz not null default now()
);

-- Warehouse/data-platform read models. These are rebuilt from the official domain tables.
create table public.fact_network_inventory_snapshots(like public.network_inventory_snapshots including defaults);
create table public.fact_projected_inventory(like public.network_inventory_snapshots including defaults);
create table public.fact_supply_recommendations(like public.supply_recommendations including defaults);
create table public.fact_supply_service_levels(like public.supply_service_level_snapshots including defaults);
create table public.fact_supply_risk_events(like public.supply_risk_events including defaults);
create table public.fact_replenishment_actions(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,recommendation_id uuid,action_type text not null,quantity numeric not null default 0,occurred_at timestamptz not null default now(),metadata jsonb not null default '{}');
create table public.fact_lead_time_performance(id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,source_node_id uuid,destination_node_id uuid,observed_hours numeric not null,occurred_at timestamptz not null,dimensions jsonb not null default '{}');
create table public.dim_supply_node(id uuid primary key,organization_id uuid not null,node_type text not null,name text not null,active boolean not null,updated_at timestamptz not null default now());
create table public.dim_supply_link(id uuid primary key,organization_id uuid not null,source_node_id uuid not null,destination_node_id uuid not null,active boolean not null,updated_at timestamptz not null default now());
create table public.dim_supply_risk_type(id text primary key,name text not null);
create table public.dim_recommendation_type(id text primary key,name text not null);
create table public.dim_service_level_type(id text primary key,name text not null);

create index supply_nodes_org_type_idx on public.supply_nodes(organization_id,node_type,active);
create index supply_links_destination_idx on public.supply_links(organization_id,destination_node_id,priority) where active;
create index supply_links_source_idx on public.supply_links(source_node_id) where active;
create index lead_time_profiles_route_idx on public.lead_time_profiles(organization_id,source_node_id,destination_node_id) where active;
create index replenishment_policy_node_item_idx on public.replenishment_policies(organization_id,node_id,inventory_item_id) where active;
create index network_inventory_risk_idx on public.network_inventory_snapshots(organization_id,bucket_at,shortage_risk,excess_risk);
create index network_inventory_item_node_idx on public.network_inventory_snapshots(organization_id,inventory_item_id,node_id,bucket_at desc);
create index supply_recommendations_review_idx on public.supply_recommendations(organization_id,status,required_by,created_at desc);
create index supply_recommendations_expiry_idx on public.supply_recommendations(status,expires_at) where status in('proposed','reviewed','approved');
create index supply_risk_open_idx on public.supply_risk_events(organization_id,severity,detected_at desc) where status in('open','monitoring');
create index supply_jobs_due_idx on public.supply_planning_jobs(priority desc,available_at) where status in('queued','failed');
create index supply_audit_org_idx on public.supply_audit_events(organization_id,created_at desc);
create index substitutions_original_idx on public.inventory_item_substitutions(organization_id,original_item_id) where active;

do $$declare t text;begin foreach t in array array[
 'supply_nodes','transport_profiles','lead_time_profiles','supply_links','safety_stock_policies','replenishment_calendars','replenishment_policies','supply_planning_runs','network_inventory_snapshots','supply_recommendations','supply_scenarios','supply_risk_events','supply_service_level_snapshots','supply_planning_jobs','inventory_item_substitutions','supply_audit_events',
 'fact_network_inventory_snapshots','fact_projected_inventory','fact_supply_recommendations','fact_supply_service_levels','fact_supply_risk_events','fact_replenishment_actions','fact_lead_time_performance','dim_supply_node','dim_supply_link'
] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);execute format('grant select on public.%I to authenticated',t);execute format('create policy %I on public.%I for select to authenticated using((select private.analytics_org_allowed(organization_id,''supply_chain:view'')))',left('supply_select_'||t,63),t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',left('supply_service_'||t,63),t);end loop;end$$;

-- Taxonomies are global reference data and are intentionally service-only. Application APIs
-- return their safe labels after enforcing the caller's organization and permission scope.
do $$declare t text;begin foreach t in array array['dim_supply_risk_type','dim_recommendation_type','dim_service_level_type'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',left('supply_service_'||t,63),t);end loop;end$$;

insert into public.dim_supply_risk_type(id,name) values('projected_stockout','Ruptura projetada'),('supplier_delay','Atraso de fornecedor'),('production_shortfall','Déficit de produção'),('excess','Excesso'),('expiry','Validade'),('transfer_delay','Atraso de transferência'),('quality_hold','Bloqueio de qualidade'),('single_source_dependency','Dependência de fonte única') on conflict(id) do update set name=excluded.name;
insert into public.dim_recommendation_type(id,name) values('purchase','Compra'),('transfer','Transferência'),('production','Produção'),('rebalance','Rebalanceamento'),('defer','Adiar'),('no_action','Sem ação') on conflict(id) do update set name=excluded.name;
insert into public.dim_service_level_type(id,name) values('store_fill_rate','Fill rate da loja'),('supplier_fill_rate','Fill rate do fornecedor'),('network_fill_rate','Fill rate da rede'),('otif','OTIF'),('transfer_on_time_rate','Transferência no prazo') on conflict(id) do update set name=excluded.name;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,size_options,required_permissions,supported_scopes,data_source,refresh_strategy,configuration_schema,default_settings,route,display_safe,sensitive) values
('supply_risks','Riscos de Supply','Ruptura, validade e dependência de fonte.','inventory','alert_list','["medium","large"]','{supply_chain:view}','{store,network}','supply_chain:risks','5m','{}','{}','/painel/supply-chain?tab=riscos',true,false),
('stockout_forecast','Previsão de Ruptura','Itens e nós com ruptura projetada.','inventory','alert_list','["medium","large"]','{supply_chain:view}','{store,network}','supply_chain:stockouts','5m','{}','{}','/painel/supply-chain?tab=ruptura',true,false),
('excess_inventory','Estoque em Excesso','Capital e quantidade acima da faixa alvo.','inventory','metric_card','["small","medium"]','{supply_chain:view_cost}','{store,network}','supply_chain:excess','5m','{}','{}','/painel/supply-chain?tab=excesso',false,true),
('replenishment_recommendations','Recomendações de Reposição','Sugestões explicáveis aguardando revisão.','operations','status_list','["medium","large"]','{supply_chain:review_recommendations}','{store,network}','supply_chain:recommendations','5m','{}','{}','/painel/supply-chain?tab=recomendacoes',true,false),
('network_service_level','Nível de Serviço da Rede','Fill rate e OTIF por escopo.','operations','metric_card','["small","medium"]','{supply_chain:view_network}','{network}','supply_chain:service_level','5m','{}','{}','/painel/supply-chain?tab=analytics',true,false),
('expiring_stock','Estoque Vencendo','Lotes válidos com risco de expiração.','inventory','alert_list','["medium","large"]','{supply_chain:view}','{store,network}','supply_chain:expiry','5m','{}','{}','/painel/supply-chain?tab=excesso',true,false)
on conflict(id) do update set title=excluded.title,description=excluded.description,route=excluded.route;

insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,certified,sensitive,allowed_dimensions) values
('network_inventory_value','Network Inventory Value','Valor do estoque físico utilizável na rede.','sum(available * certified_unit_cost)','fact_network_inventory_snapshots','node/item/bucket','Supply Chain','hourly','cents','calculation',true,true,array['date','store','region','brand','product','supplier']),
('days_of_cover','Days of Cover','Cobertura pela demanda selecionada e confiança explícita.','available / nullif(daily_demand,0)','fact_projected_inventory','node/item/bucket','Supply Chain','hourly','days','calculation',true,false,array['date','store','region','brand','product']),
('projected_stockout_count','Projected Stockout Count','Nós e itens com saldo projetado negativo.','count where projected_stock < 0','fact_projected_inventory','node/item/bucket','Supply Chain','hourly','count','calculation',true,false,array['date','store','region','brand','product']),
('excess_inventory_value','Excess Inventory Value','Capital estimado acima da faixa alvo.','sum(excess_quantity * certified_unit_cost)','fact_network_inventory_snapshots','node/item/bucket','Supply Chain','hourly','cents','calculation',true,true,array['date','store','region','brand','product']),
('supply_fill_rate','Supply Fill Rate','Quantidade atendida sobre solicitada.','sum(fulfilled) / nullif(sum(requested),0)','fact_supply_service_levels','node/period','Supply Chain','hourly','percent','calculation',true,false,array['date','store','region','supplier']),
('supply_otif','OTIF','Quantidade completa recebida no prazo sobre solicitada.','sum(on_time_full) / nullif(sum(requested),0)','fact_supply_service_levels','route/period','Supply Chain','hourly','percent','calculation',true,false,array['date','store','region','supplier']),
('average_supply_lead_time','Average Lead Time','Mediana do lead time observado por rota.','median(observed_hours)','fact_lead_time_performance','route/period','Supply Chain','daily','hours','calculation',true,false,array['date','region','supplier'])
on conflict(metric_key) do update set name=excluded.name,description=excluded.description,formula=excluded.formula,source_of_truth=excluded.source_of_truth;

insert into public.report_dataset_registry(id,name,description,source,available_metrics,available_dimensions,available_filters,supported_time_granularity,required_permissions,realtime_or_analytical,sensitivity,column_policy) values
('network_inventory','Estoque da Rede','Físico, disponível, reservado, trânsito, quarentena, validade e projetado.','hybrid','{network_inventory_value,days_of_cover,excess_inventory_value}','{date,store,region,brand,product,supplier}','{date,store,region,brand,product,risk}','{hour,day,week}','{reports:view,supply_chain:view}','hybrid','restricted','{"cost":{"view_permission":"supply_chain:view_cost"}}'),
('projected_inventory','Estoque Projetado','Buckets confirmados, planejados e previstos sem misturar compromissos.','hybrid','{days_of_cover,projected_stockout_count}','{date,store,region,brand,product}','{date,store,region,product,risk}','{hour,day,week}','{reports:view,supply_chain:view}','hybrid','normal','{}'),
('supply_recommendations','Recomendações de Supply','Compras, transferências, produção e rebalanceamentos explicáveis.','operational','{projected_stockout_count}','{date,store,region,brand,product,supplier}','{date,store,region,product,recommendation_type,status}','{day,week,month}','{reports:view,supply_chain:view}','realtime','restricted','{"estimated_cost":{"view_permission":"supply_chain:view_cost"}}'),
('supply_service_levels','Nível de Serviço','Fill rate e OTIF por loja, fornecedor e rota.','warehouse','{supply_fill_rate,supply_otif}','{date,store,region,supplier}','{date,store,region,supplier}','{day,week,month}','{reports:view,supply_chain:view_network}','analytical','normal','{}'),
('lead_time_performance','Performance de Lead Time','Lead time observado, mediana e variabilidade por rota.','warehouse','{average_supply_lead_time}','{date,region,supplier}','{date,region,supplier}','{day,week,month}','{reports:view,supply_chain:view_network}','analytical','normal','{}')
on conflict(id) do update set name=excluded.name,description=excluded.description,available_metrics=excluded.available_metrics,available_dimensions=excluded.available_dimensions,required_permissions=excluded.required_permissions,schema_version=report_dataset_registry.schema_version+1,updated_at=now();

insert into public.report_templates(name,description,category,dataset_id,definition_json,system_template,read_only,required_permissions,widget_compatible) values
('Cobertura de Estoque da Rede','Cobertura por item e nó com confiança.','Supply Chain','network_inventory','{"metrics":["days_of_cover"],"dimensions":["store","product"]}',true,true,'{reports:view,supply_chain:view}',true),
('Rupturas Projetadas','Saldo projetado negativo por janela.','Supply Chain','projected_inventory','{"metrics":["projected_stockout_count"],"dimensions":["date","store","product"]}',true,true,'{reports:view,supply_chain:view}',true),
('Estoque em Excesso','Excesso e capital estimado.','Supply Chain','network_inventory','{"metrics":["excess_inventory_value"],"dimensions":["store","product"]}',true,true,'{reports:view,supply_chain:view_cost}',true),
('Recomendações de Reposição','Sugestões por destino e tipo.','Supply Chain','supply_recommendations','{"metrics":["projected_stockout_count"],"dimensions":["store","product"]}',true,true,'{reports:view,supply_chain:view}',true),
('Nível de Serviço por Loja','Fill rate e OTIF por unidade.','Supply Chain','supply_service_levels','{"metrics":["supply_fill_rate","supply_otif"],"dimensions":["store"]}',true,true,'{reports:view,supply_chain:view_network}',true),
('Performance de Lead Time','Mediana observada por fornecedor.','Supply Chain','lead_time_performance','{"metrics":["average_supply_lead_time"],"dimensions":["supplier"]}',true,true,'{reports:view,supply_chain:view_network}',true),
('Capital em Estoque','Valor disponível e excesso.','Financeiro','network_inventory','{"metrics":["network_inventory_value","excess_inventory_value"],"dimensions":["store","product"]}',true,true,'{reports:view,supply_chain:view_cost}',false)
on conflict do nothing;

insert into public.search_navigation_registry(id,title,route,keywords,module,required_permission,icon,position) values('supply-chain','Supply Chain','/painel/supply-chain',array['supply','estoque da rede','reposição','ruptura','excesso','redistribuição'],'supply_chain_planning','supply_chain:view','⌁',39) on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,required_permission=excluded.required_permission,position=excluded.position;
