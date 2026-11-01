-- Fase 82: Digital Twin Operacional. Todas as saídas são simulações isoladas.
-- quality: allow-nonconcurrent-index reason=new-empty-phase82-tables
create table if not exists public.digital_twin_snapshots(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, snapshot_time timestamptz not null, status text not null default 'building' check(status in('building','ready','stale','failed','archived')),
 source_versions jsonb not null default '{}'::jsonb, data_quality jsonb not null default '{}'::jsonb, payload_ref text, payload_hash text not null,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(organization_id,payload_hash)
);
create table if not exists public.digital_twin_topology_nodes(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, snapshot_id uuid not null references public.digital_twin_snapshots(id) on delete cascade,
 source_entity_id uuid, node_type text not null check(node_type in('store','central_kitchen','warehouse','supplier','distribution_center','transport_hub')),
 label text not null, attributes jsonb not null default '{}'::jsonb, unique(snapshot_id,node_type,source_entity_id)
);
create table if not exists public.digital_twin_topology_edges(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, snapshot_id uuid not null references public.digital_twin_snapshots(id) on delete cascade,
 from_node_id uuid not null references public.digital_twin_topology_nodes(id) on delete cascade, to_node_id uuid not null references public.digital_twin_topology_nodes(id) on delete cascade,
 edge_type text not null check(edge_type in('supply','transfer','transport','production_dependency')), attributes jsonb not null default '{}'::jsonb, unique(snapshot_id,from_node_id,to_node_id,edge_type)
);
create table if not exists public.digital_twin_scenarios(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, snapshot_id uuid not null references public.digital_twin_snapshots(id),
 ibp_scenario_ref uuid, name text not null, description text, scenario_type text not null check(scenario_type in('demand_shock','supply_disruption','capacity_loss','cost_change','expansion','closure','promotion','logistics_disruption','workforce_shortage','custom')),
 context_type text not null default 'tenant_operations' check(context_type in('tenant_operations','masterapp_platform')), status text not null default 'draft' check(status in('draft','ready','running','completed','failed','cancelled')),
 current_version integer not null default 1 check(current_version>0), owner uuid references auth.users(id), created_by uuid references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.digital_twin_assumptions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, scenario_id uuid not null references public.digital_twin_scenarios(id) on delete cascade,
 scenario_version integer not null check(scenario_version>0), key text not null, scope jsonb not null default '{}'::jsonb, value_type text not null check(value_type in('number','boolean','string','range')),
 baseline_value jsonb not null, scenario_value jsonb not null, effective_from timestamptz, effective_until timestamptz, confidence text not null check(confidence in('high','medium','low')),
 source text not null, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), check(effective_until is null or effective_from is null or effective_until>=effective_from)
);
create table if not exists public.digital_twin_runs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, scenario_id uuid not null references public.digital_twin_scenarios(id),
 scenario_version integer not null, snapshot_id uuid not null references public.digital_twin_snapshots(id), engine_version text not null, run_hash text not null,
 status text not null default 'queued' check(status in('queued','preparing','running','completed','partial','failed','cancelled')),
 model_versions jsonb not null default '{}'::jsonb, warnings jsonb not null default '[]'::jsonb, error_summary text, seed bigint,
 started_at timestamptz, completed_at timestamptz, runtime_ms bigint, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(organization_id,run_hash)
);
create table if not exists public.digital_twin_run_steps(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, run_id uuid not null references public.digital_twin_runs(id) on delete cascade,
 adapter text not null, sequence integer not null, status text not null check(status in('queued','running','completed','partial','failed','cancelled')),
 started_at timestamptz, completed_at timestamptz, inputs_hash text not null, outputs_ref text, warning_count integer not null default 0, unique(run_id,adapter)
);
create table if not exists public.digital_twin_results(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, run_id uuid not null references public.digital_twin_runs(id) on delete cascade,
 scenario_id uuid not null references public.digital_twin_scenarios(id), result_type text not null check(result_type in('revenue','demand','inventory','stockout','production','capacity','capacity_gap','labor','labor_gap','logistics','transport_cost','cost','margin','service_level','risk')),
 scope jsonb not null default '{}'::jsonb, period text not null, baseline_value numeric, simulated_value numeric, delta numeric, unit text not null,
 confidence text not null check(confidence in('high','medium','low')), result_quality text not null check(result_quality in('deterministic','model_based','estimated','incomplete')),
 source_engine text not null, source_version text not null, created_at timestamptz not null default now()
);
create table if not exists public.digital_twin_constraints(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, run_id uuid not null references public.digital_twin_runs(id) on delete cascade,
 constraint_type text not null check(constraint_type in('demand','inventory','supplier','production','capacity','labor','warehouse','transport','finance','policy')),
 severity text not null check(severity in('low','medium','high','critical')), scope jsonb not null default '{}'::jsonb, gap numeric, starts_at timestamptz,
 evidence jsonb not null default '{}'::jsonb, impact_level text not null default 'modeled' check(impact_level in('direct','modeled','inferred')), confidence text not null check(confidence in('high','medium','low')), created_at timestamptz not null default now()
);
create table if not exists public.digital_twin_recommendations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, run_id uuid not null references public.digital_twin_runs(id) on delete cascade,
 action_type text not null, estimated_impact jsonb not null default '{}'::jsonb, estimated_cost numeric, lead_time text, risks jsonb not null default '[]'::jsonb,
 confidence text not null check(confidence in('high','medium','low')), source text not null, status text not null default 'draft' check(status in('draft','review','published_as_draft','discarded')),
 action_intent_id uuid, published_by uuid references auth.users(id), published_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.digital_twin_comparisons(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null,
 run_ids uuid[] not null check(cardinality(run_ids) between 2 and 10), tradeoff_matrix jsonb not null default '[]'::jsonb, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.digital_twin_stress_tests(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, snapshot_id uuid not null references public.digital_twin_snapshots(id),
 factors jsonb not null, parameter_sweep jsonb, status text not null default 'draft' check(status in('draft','queued','running','completed','partial','failed','cancelled')), run_ids uuid[] not null default '{}', created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.digital_twin_templates(
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade, template_key text not null, name text not null,
 scenario_type text not null, assumptions jsonb not null default '[]'::jsonb, locked boolean not null default false, active boolean not null default true, version integer not null default 1, created_at timestamptz not null default now(), unique nulls not distinct(organization_id,template_key,version)
);
create table if not exists public.digital_twin_audit_events(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, actor_id uuid references auth.users(id),
 event_type text not null, entity_type text not null, entity_id uuid, reason text, before_state jsonb, after_state jsonb, created_at timestamptz not null default now()
);
create table if not exists public.digital_twin_settings(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade unique,
 max_scenarios_per_day integer not null default 25 check(max_scenarios_per_day between 1 and 500), max_nodes integer not null default 1000 check(max_nodes between 1 and 100000),
 max_horizon_days integer not null default 365 check(max_horizon_days between 1 and 730), max_assumptions integer not null default 12 check(max_assumptions between 1 and 50), max_sweep_values integer not null default 20 check(max_sweep_values between 1 and 100),
 raw_retention_days integer not null default 90 check(raw_retention_days between 7 and 730), partial_adapter_policy text not null default 'allow_with_warning' check(partial_adapter_policy in('allow_with_warning','fail')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists digital_twin_snapshots_org_time_idx on public.digital_twin_snapshots(organization_id,snapshot_time desc);
create index if not exists digital_twin_scenarios_org_status_idx on public.digital_twin_scenarios(organization_id,status,created_at desc);
create index if not exists digital_twin_runs_org_status_idx on public.digital_twin_runs(organization_id,status,created_at desc);
create index if not exists digital_twin_results_run_type_idx on public.digital_twin_results(run_id,result_type);
create index if not exists digital_twin_constraints_run_severity_idx on public.digital_twin_constraints(run_id,severity);

do $$ declare t text; begin foreach t in array array['digital_twin_snapshots','digital_twin_topology_nodes','digital_twin_topology_edges','digital_twin_scenarios','digital_twin_assumptions','digital_twin_runs','digital_twin_run_steps','digital_twin_results','digital_twin_constraints','digital_twin_recommendations','digital_twin_comparisons','digital_twin_stress_tests','digital_twin_templates','digital_twin_audit_events','digital_twin_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',left('digital_twin_service_'||t,63),t);
end loop; end $$;

insert into public.digital_twin_templates(organization_id,template_key,name,scenario_type,assumptions,locked) values
(null,'demand_10','Demanda +10%','demand_shock','[{"key":"demand_multiplier","value":1.1}]',true),
(null,'demand_20','Demanda +20%','demand_shock','[{"key":"demand_multiplier","value":1.2}]',true),
(null,'supplier_3d','Fornecedor atrasado 3 dias','supply_disruption','[{"key":"supplier_delay","value":3}]',true),
(null,'central_outage','Parada da cozinha central','capacity_loss','[{"key":"capacity_multiplier","value":0}]',true),
(null,'workforce_20','Equipe -20%','workforce_shortage','[{"key":"worker_availability","value":0.8}]',true),
(null,'capacity_30','Capacidade -30%','capacity_loss','[{"key":"capacity_multiplier","value":0.7}]',true),
(null,'transport_delay','Atraso de transporte','logistics_disruption','[{"key":"route_delay","value":120}]',true)
on conflict do nothing;

comment on table public.digital_twin_snapshots is 'Snapshot derivado, imutável e reproduzível; não copia toda a operação.';
comment on table public.digital_twin_results is 'Resultados simulados. Nunca misturar com fatos/realizados.';
comment on table public.digital_twin_recommendations is 'Recomendação draft; conversão exige ActionEngine e aprovação explícita.';
