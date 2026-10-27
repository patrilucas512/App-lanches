-- Phase 51: secondary global search index and command palette. Operational tables remain source of truth.
create extension if not exists pg_trgm with schema extensions;
alter table public.plans
 add column if not exists global_search_enabled boolean not null default true,
 add column if not exists command_palette_enabled boolean not null default true,
 add column if not exists quick_actions_enabled boolean not null default true,
 add column if not exists saved_searches_enabled boolean not null default true,
 add column if not exists search_analytics_enabled boolean not null default true,
 add column if not exists network_search_enabled boolean not null default true;
alter table public.store_feature_flags
 add column if not exists global_search_enabled boolean not null default true,
 add column if not exists command_palette_enabled boolean not null default true,
 add column if not exists quick_actions_enabled boolean not null default true,
 add column if not exists saved_searches_enabled boolean not null default true,
 add column if not exists search_analytics_enabled boolean not null default true,
 add column if not exists network_search_enabled boolean not null default true;

create table public.search_index_settings(
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 active_version integer not null default 1 check(active_version>0), provider text not null default 'postgres' check(provider in('postgres','external_future')),
 indexing_enabled boolean not null default true, fallback_enabled boolean not null default true,
 max_query_ms integer not null default 800 check(max_query_ms between 100 and 3000), retention_days integer not null default 90 check(retention_days between 7 and 365),
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.search_documents(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid references public.establishments(id) on delete cascade, entity_type text not null check(entity_type in(
  'order','customer','product','category','table','tab','reservation','delivery','driver','employee','supplier','purchase_order','inventory_item','lot','asset','maintenance_work_order','contract','document','support_ticket','internal_project','internal_task','sales_opportunity','organization','store','campaign','workflow','configuration','report','user'
 )), entity_id text not null, title text not null, subtitle text, searchable_text text not null default '', searchable_normalized text not null default '',
 keywords text[] not null default '{}', route text not null check(route like '/%'), icon text, metadata jsonb not null default '{}',
 sensitivity text not null default 'normal' check(sensitivity in('normal','pii','confidential','restricted')), required_permission text,
 archived boolean not null default false, source_updated_at timestamptz, index_version integer not null default 1,
 fts tsvector generated always as (to_tsvector('simple',coalesce(searchable_normalized,''))) stored,
 updated_at timestamptz not null default now(), indexed_at timestamptz not null default now(), unique(organization_id,entity_type,entity_id)
);
comment on table public.search_documents is 'Secondary search index only. Source entities must be revalidated before actions.';
create table public.search_index_jobs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid references public.establishments(id) on delete cascade, entity_type text not null, entity_id text,
 operation text not null check(operation in('upsert','delete','reindex_type','reindex_store','reindex_tenant')),
 payload_hint jsonb not null default '{}', status text not null default 'pending' check(status in('pending','processing','completed','failed','dead_lettered')),
 priority smallint not null default 50 check(priority between 1 and 100), attempts integer not null default 0, max_attempts integer not null default 3 check(max_attempts between 1 and 10),
 available_at timestamptz not null default now(), leased_until timestamptz, last_error text, correlation_id text not null, idempotency_key text not null,
 created_at timestamptz not null default now(), completed_at timestamptz, unique(organization_id,idempotency_key)
);
create table public.search_index_failures(
 id uuid primary key default gen_random_uuid(), job_id uuid not null unique references public.search_index_jobs(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete cascade, entity_type text not null, entity_id text,
 error_code text not null, error_summary text not null, status text not null default 'open' check(status in('open','retrying','resolved','ignored')),
 created_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references auth.users(id)
);
create table public.user_recent_entities(
 organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 entity_type text not null, entity_id text not null, store_id uuid references public.establishments(id) on delete cascade,
 viewed_at timestamptz not null default now(), primary key(organization_id,user_id,entity_type,entity_id)
);
create table public.pinned_entities(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, entity_type text not null, entity_id text not null,
 store_id uuid references public.establishments(id) on delete cascade, label text, created_at timestamptz not null default now(),
 unique(organization_id,user_id,entity_type,entity_id)
);
create table public.saved_searches(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, name text not null check(length(btrim(name)) between 2 and 100),
 query_encrypted_or_normalized text not null default '', filters jsonb not null default '{}', scope_type text not null default 'store' check(scope_type in('store','organization')),
 store_id uuid references public.establishments(id) on delete cascade, pinned boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.search_query_events(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid references auth.users(id) on delete set null, store_id uuid references public.establishments(id) on delete set null,
 query_hash text not null, query_length integer not null check(query_length between 0 and 200), query_category text not null default 'general',
 result_count integer not null default 0, zero_result boolean generated always as (result_count=0) stored,
 selected_entity_type text, selected_result_position integer, latency_ms integer not null default 0,
 correlation_id text not null, created_at timestamptz not null default now(), check(query_hash ~ '^[a-f0-9]{64}$')
);
create table public.search_command_registry(
 id text primary key, title text not null, description text, keywords text[] not null default '{}',
 command_type text not null check(command_type in('navigation','create','operational_action','administrative_action')),
 route text, action_type text, required_permission text, risk_level text not null default 'low' check(risk_level in('low','medium','high','critical')),
 scope text not null default 'store' check(scope in('global','organization','store')), superadmin_only boolean not null default false,
 active boolean not null default true, position integer not null default 100, check((command_type='navigation' and route is not null) or (command_type<>'navigation' and action_type is not null))
);
create table public.search_navigation_registry(
 id text primary key, title text not null, route text not null check(route like '/%'), keywords text[] not null default '{}',
 module text not null, required_permission text, icon text, active boolean not null default true, position integer not null default 100, customer_visible boolean not null default true
);
create table public.user_recent_commands(
 organization_id uuid not null references public.organizations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 command_id text not null references public.search_command_registry(id) on delete cascade, used_at timestamptz not null default now(), usage_count integer not null default 1,
 primary key(organization_id,user_id,command_id)
);
create table public.search_action_requests(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid not null references public.establishments(id) on delete cascade, requested_by uuid not null references auth.users(id),
 command_id text not null references public.search_command_registry(id) on delete restrict, entity_type text, entity_id text,
 risk_level text not null check(risk_level in('medium','high','critical')), preview jsonb not null default '{}',
 action_request_id uuid references public.copilot_action_requests(id) on delete set null, approval_id uuid references public.internal_approvals(id) on delete set null,
 status text not null default 'pending_confirmation' check(status in('pending_confirmation','pending_approval','approved','rejected','executed','cancelled','failed')),
 confirmation_phrase text not null, idempotency_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,idempotency_key)
);
create table public.search_access_audit(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 store_id uuid references public.establishments(id) on delete set null, actor_user_id uuid references auth.users(id) on delete set null,
 entity_type text not null, entity_id text not null, access_type text not null check(access_type in('sensitive_result_opened','confidential_document_opened','quick_action_previewed','quick_action_confirmed')),
 reason text, correlation_id text not null, created_at timestamptz not null default now()
);
create table public.search_health_hourly(
 organization_id uuid not null references public.organizations(id) on delete cascade, bucket_at timestamptz not null,
 requests bigint not null default 0, zero_results bigint not null default 0, latency_ms_sum bigint not null default 0, latency_ms_p95 integer,
 indexed_documents bigint not null default 0, failed_jobs bigint not null default 0, max_index_lag_seconds integer not null default 0,
 command_executions bigint not null default 0, primary key(organization_id,bucket_at)
);

create index search_documents_scope_idx on public.search_documents(organization_id,store_id,entity_type,archived);
create index search_documents_entity_idx on public.search_documents(organization_id,entity_type,entity_id);
create index search_documents_fts_idx on public.search_documents using gin(fts);
create index search_documents_title_trgm_idx on public.search_documents using gin(searchable_normalized extensions.gin_trgm_ops);
create index search_documents_recency_idx on public.search_documents(organization_id,updated_at desc);
create index search_jobs_due_idx on public.search_index_jobs(status,priority desc,available_at) where status='pending';
create index search_recent_user_idx on public.user_recent_entities(user_id,viewed_at desc);
create index search_pins_user_idx on public.pinned_entities(user_id,created_at desc);
create index saved_searches_user_idx on public.saved_searches(user_id,updated_at desc);
create index search_query_org_created_idx on public.search_query_events(organization_id,created_at desc);
create index search_health_org_bucket_idx on public.search_health_hourly(organization_id,bucket_at desc);

insert into public.search_navigation_registry(id,title,route,keywords,module,icon,position) values
('dashboard','Dashboard','/painel',array['inicio','visao geral','principal'],'core','⌂',10),
('orders','Pedidos','/painel/pedidos',array['pedido','vendas','atrasados'],'orders','≡',20),
('kitchen','Cozinha','/cozinha',array['kds','preparo','comandas'],'kitchen','◆',30),
('delivery','Delivery','/painel/logistica',array['entrega','motoboy','rota'],'delivery','⌖',40),
('inventory','Estoque','/painel/estoque',array['inventario','insumo','lote'],'inventory','▤',50),
('customers','Clientes','/painel/crm',array['cliente','crm','contatos'],'crm','◇',60),
('marketing','Marketing','/painel/marketing-inteligencia',array['campanha','marketing'],'marketing','◎',70),
('procurement','Compras','/painel/compras',array['fornecedor','pedido de compra','po'],'procurement','◧',80),
('quality','Qualidade','/painel/qualidade',array['lote','nao conformidade'],'quality','✓',90),
('assets','Manutenção','/painel/ativos',array['ativo','os','equipamento','manutencao'],'assets','◇',100),
('documents','Documentos','/painel/documentos',array['contrato','licenca','documento'],'documents','▧',110),
('automation','Automações','/painel/automacao',array['workflow','automacao','regra'],'automation','⌁',120),
('settings','Configurações','/painel/configuracoes',array['configuracao','ajustes'],'settings','⚙',130),
('system-status','Status do sistema','/status',array['status','saude','observabilidade'],'observability','◉',140)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,icon=excluded.icon,position=excluded.position;

insert into public.search_command_registry(id,title,description,keywords,command_type,route,action_type,required_permission,risk_level,scope,position) values
('go-dashboard','Ir para Dashboard','Abrir visão geral',array['inicio','principal'],'navigation','/painel',null,'search:global','low','store',10),
('go-orders','Ver Pedidos','Abrir pedidos',array['pedido','vendas'],'navigation','/painel/pedidos',null,'search:global','low','store',20),
('go-kitchen','Ir para Cozinha','Abrir KDS',array['cozinha','preparo'],'navigation','/cozinha',null,'search:global','low','store',30),
('go-delivery','Ver Delivery','Abrir despacho',array['entrega','motoboy'],'navigation','/painel/logistica',null,'search:global','low','store',40),
('go-stock','Ver Estoque','Abrir estoque',array['estoque','inventario'],'navigation','/painel/estoque',null,'search:global','low','store',50),
('go-automation','Ver Automações','Abrir workflows',array['automacao','workflow'],'navigation','/painel/automacao',null,'search:global','low','store',60),
('go-settings','Abrir Configurações','Abrir configurações',array['configurar','ajustes'],'navigation','/painel/configuracoes',null,'search:global','low','store',70),
('create-task','Criar tarefa','Abrir formulário de tarefa',array['tarefa','follow up'],'create',null,'create_internal_task','commands:quick_create','medium','organization',80),
('create-customer','Criar cliente','Abrir cadastro de cliente',array['cliente','cadastro'],'create',null,'create_customer','commands:quick_create','medium','store',90),
('new-order','Novo pedido','Abrir caixa para pedido',array['pedido','venda'],'navigation','/painel/caixa',null,'commands:quick_create','low','store',100),
('mark-product-unavailable','Marcar produto indisponível','Solicitar alteração pelo ActionEngine',array['produto','indisponivel'],'operational_action',null,'PRODUCT_SET_AVAILABILITY','commands:operational_actions','high','store',110),
('reprint-order','Reimprimir pedido','Solicitar reimpressão auditada',array['pedido','imprimir','nota'],'operational_action',null,'REPRINT_ORDER','commands:operational_actions','high','store',120)
on conflict(id) do update set title=excluded.title,description=excluded.description,keywords=excluded.keywords,command_type=excluded.command_type,route=excluded.route,action_type=excluded.action_type,required_permission=excluded.required_permission,risk_level=excluded.risk_level,scope=excluded.scope,position=excluded.position;

do $$ declare t text; begin foreach t in array array[
 'search_index_settings','search_documents','search_index_jobs','search_index_failures','user_recent_entities','pinned_entities','saved_searches','search_query_events','search_command_registry','search_navigation_registry','user_recent_commands','search_action_requests','search_access_audit','search_health_hourly'
] loop execute format('alter table public.%I enable row level security',t);execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',t||'_service_only',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
