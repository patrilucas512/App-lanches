-- Phase 62: central catalog governance over the existing operational catalog.
-- Existing public.products remains the operational source of truth.
-- quality: allow-nonconcurrent-index reason=new-empty-quality-tables
-- Existing product/category indexes require a reviewed maintenance window when this migration is authorized for production.
create schema if not exists catalog_private;
revoke all on schema catalog_private from public, anon, authenticated;

alter table public.products
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists master_product_id uuid references public.products(id) on delete set null,
  add column if not exists sku text,
  add column if not exists internal_code text,
  add column if not exists short_name text,
  add column if not exists product_type text not null default 'simple' check(product_type in('simple','variant_product','combo','bundle','service_item','custom')),
  add column if not exists lifecycle_status text not null default 'active' check(lifecycle_status in('draft','active','inactive','archived','discontinued')),
  add column if not exists tax_reference text,
  add column if not exists catalog_version integer not null default 1 check(catalog_version>0);
update public.products p set organization_id=e.organization_id from public.establishments e where p.establishment_id=e.id and p.organization_id is null;
alter table public.products alter column organization_id set not null;

alter table public.categories
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists parent_id uuid references public.categories(id) on delete set null,
  add column if not exists image_url text,
  add column if not exists catalog_version integer not null default 1 check(catalog_version>0);
update public.categories c set organization_id=e.organization_id from public.establishments e where c.establishment_id=e.id and c.organization_id is null;
alter table public.categories alter column organization_id set not null;

alter table public.product_variations
  add column if not exists code text,
  add column if not exists sku text,
  add column if not exists barcode text,
  add column if not exists dimension_type text not null default 'custom' check(dimension_type in('size','flavor','portion','custom')),
  add column if not exists explicit_price_cents integer check(explicit_price_cents is null or explicit_price_cents>=0),
  add column if not exists status text not null default 'active' check(status in('draft','active','inactive','archived'));

alter table public.addon_groups
  add column if not exists selection_type text not null default 'multiple' check(selection_type in('single','multiple')),
  add column if not exists status text not null default 'active' check(status in('draft','active','inactive','archived')),
  add column if not exists updated_at timestamptz not null default now();
alter table public.addons
  add column if not exists inventory_component_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists recipe_component jsonb,
  add column if not exists status text not null default 'active' check(status in('draft','active','inactive','archived')),
  add column if not exists updated_at timestamptz not null default now();
alter table public.product_addon_groups add column if not exists price_override_cents integer check(price_override_cents is null or price_override_cents>=0);

alter table public.order_items
  add column if not exists variant_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists discount_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists taxes_fees_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists catalog_version_hash text;
alter table public.table_order_items
  add column if not exists variant_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists discount_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists taxes_fees_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists catalog_version_hash text;

create table public.catalog_member_permissions(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
  permissions text[] not null default '{}',scope_type text not null default 'organization' check(scope_type in('organization','brand','region','cluster','store')),scope_id uuid,active boolean not null default true,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,user_id,scope_type,scope_id)
);
alter table public.catalog_member_permissions add constraint catalog_member_permissions_known_values check(permissions <@ array['catalog:view','catalog:create_product','catalog:edit_product','catalog:manage_categories','catalog:manage_modifiers','catalog:manage_combos','catalog:manage_prices','catalog:publish','catalog:schedule_publish','catalog:manage_governance','catalog:view_cost','catalog:manage_network','catalog:import','catalog:export']::text[]);

create table public.catalog_product_assignments(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,
  enabled boolean not null default true,local_name_override text,local_description_override text,local_price_override_cents integer check(local_price_override_cents is null or local_price_override_cents>=0),availability_profile_id uuid,
  local_status text not null default 'active' check(local_status in('draft','active','inactive','archived','discontinued')),override_policy text not null default 'partial' check(override_policy in('locked','partial','local_allowed')),
  overrides jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(product_id,store_id)
);

create table public.catalog_field_policies(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,scope_type text not null check(scope_type in('organization','brand','region','cluster','store','product')),scope_id uuid not null,
  field_name text not null,policy text not null check(policy in('inherit','locked','override_allowed','local_only')),allowed_override_scope text[] not null default '{}',created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,scope_type,scope_id,field_name)
);

create table public.catalog_product_categories(
  organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,category_id uuid not null references public.categories(id) on delete cascade,is_primary boolean not null default false,display_order integer not null default 0,primary key(product_id,category_id)
);

create table public.product_modifier_assignments(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,modifier_group_id uuid not null references public.addon_groups(id) on delete cascade,
  price_override_cents integer check(price_override_cents is null or price_override_cents>=0),min_select_override integer,max_select_override integer,display_order integer not null default 0,active boolean not null default true,
  check(min_select_override is null or min_select_override>=0),check(max_select_override is null or min_select_override is null or max_select_override>=min_select_override),unique(product_id,modifier_group_id)
);

create table public.product_combos(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null unique references public.products(id) on delete cascade,combo_kind text not null default 'combo' check(combo_kind in('combo','bundle')),
  pricing_rule jsonb not null default '{"type":"product_price"}',status text not null default 'draft' check(status in('draft','active','inactive','archived')),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.combo_components(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,combo_id uuid not null references public.product_combos(id) on delete cascade,component_type text not null check(component_type in('product','category','variant','modifier_group')),source_id uuid not null,
  min_select integer not null default 1 check(min_select>=0),max_select integer not null default 1 check(max_select>=min_select),required boolean not null default true,price_adjustment_rule jsonb not null default '{}',display_order integer not null default 0
);

create table public.product_attribute_registry(
  id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id) on delete cascade,attribute_key text not null,display_name text not null,attribute_type text not null default 'dietary' check(attribute_type in('dietary','allergen_explicit','marketing','operational','custom')),
  customer_visible boolean not null default false,active boolean not null default true,created_at timestamptz not null default now(),unique(organization_id,attribute_key)
);
create table public.product_attributes(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,attribute_id uuid not null references public.product_attribute_registry(id) on delete cascade,
  value jsonb not null default 'true',source text not null check(source in('manual','supplier','recipe','verified_internal')),customer_visible boolean not null default false,verified_at timestamptz,verified_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(product_id,attribute_id)
);

create table public.catalog_product_media(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,storage_bucket text not null default 'product-images',storage_path text not null,
  variant_type text not null check(variant_type in('primary','gallery','square','landscape','mobile_crop')),mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp','image/avif')),size_bytes bigint not null check(size_bytes>0 and size_bytes<=12582912),width integer check(width>0),height integer check(height>0),alt_text text,display_order integer not null default 0,created_at timestamptz not null default now(),unique(product_id,storage_path)
);
create table public.product_localizations(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,locale text not null default 'pt-BR',name text not null,description text,short_name text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(product_id,locale)
);

create table public.price_books(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,scope_type text not null check(scope_type in('organization','brand','region','store')),scope_id uuid,currency text not null default 'BRL',status text not null default 'draft' check(status in('draft','active','inactive','archived')),
  effective_from timestamptz not null default now(),effective_until timestamptz,version integer not null default 1 check(version>0),created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(effective_until is null or effective_until>effective_from)
);
create table public.price_book_items(
  id uuid primary key default gen_random_uuid(),price_book_id uuid not null references public.price_books(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,variant_id uuid references public.product_variations(id) on delete cascade,
  channel text check(channel in('dine_in','waiter','qr','delivery','pickup','kiosk','whatsapp','web','third_party')),fulfillment_method text check(fulfillment_method in('delivery','pickup','dine_in') or fulfillment_method is null),price_cents integer not null check(price_cents>=0),compare_at_price_cents integer check(compare_at_price_cents is null or compare_at_price_cents>=price_cents),cost_reference_cents integer check(cost_reference_cents is null or cost_reference_cents>=0),effective_from timestamptz,effective_until timestamptz,created_at timestamptz not null default now(),unique(price_book_id,product_id,variant_id,channel,fulfillment_method,effective_from),check(effective_until is null or effective_from is null or effective_until>effective_from)
);

create table public.catalog_availability_profiles(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,days_of_week smallint[] not null default '{0,1,2,3,4,5,6}',time_windows jsonb not null default '[]',channel_scope text[] not null default '{}',fulfillment_scope text[] not null default '{}',start_date date,end_date date,timezone text not null default 'America/Sao_Paulo',stock_policy text not null default 'manual_control' check(stock_policy in('warn_only','auto_disable','manual_control')),active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_date is null or start_date is null or end_date>=start_date)
);
alter table public.catalog_product_assignments add constraint catalog_assignment_availability_fk foreign key(availability_profile_id) references public.catalog_availability_profiles(id) on delete set null;
create table public.product_channel_availability(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,channel text not null check(channel in('dine_in','waiter','qr','delivery','pickup','kiosk','whatsapp','web','third_party')),fulfillment_method text not null default 'all' check(fulfillment_method in('all','delivery','pickup','dine_in')),enabled boolean not null default true,availability_profile_id uuid references public.catalog_availability_profiles(id) on delete set null,temporary_block_until timestamptz,temporary_block_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(product_id,store_id,channel,fulfillment_method)
);

create table public.menu_collections(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,description text,status text not null default 'draft' check(status in('draft','active','inactive','archived')),created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.menu_versions(
  id uuid primary key default gen_random_uuid(),menu_id uuid not null references public.menu_collections(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,version integer not null,status text not null default 'draft' check(status in('draft','validated','published','superseded','rolled_back')),version_hash text,validation_result jsonb not null default '{}',created_by uuid references auth.users(id),created_at timestamptz not null default now(),published_at timestamptz,unique(menu_id,version)
);
create table public.menu_items(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,menu_version_id uuid not null references public.menu_versions(id) on delete cascade,item_type text not null check(item_type in('category','product','promotional_section','collection')),source_id uuid not null,parent_item_id uuid references public.menu_items(id) on delete cascade,display_order integer not null default 0,content_override jsonb not null default '{}',active boolean not null default true,unique(menu_version_id,item_type,source_id,parent_item_id)
);
create table public.menu_assignments(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,menu_id uuid not null references public.menu_collections(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,channel text not null check(channel in('dine_in','waiter','qr','delivery','pickup','kiosk','whatsapp','web','third_party')),availability_profile_id uuid references public.catalog_availability_profiles(id) on delete set null,active_version_id uuid references public.menu_versions(id) on delete set null,active boolean not null default true,created_at timestamptz not null default now(),unique(menu_id,store_id,channel)
);

create table public.catalog_changesets(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null,description text,status text not null default 'draft' check(status in('draft','review','approved','publishing','published','partially_failed','rolled_back','archived')),scope_type text not null default 'store' check(scope_type in('organization','brand','region','cluster','store')),scope_id uuid,scheduled_for timestamptz,approval_request_id uuid,two_person_rule boolean not null default false,
  validation_summary jsonb not null default '{}',preview_summary jsonb not null default '{}',created_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),published_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz,check(not two_person_rule or approved_by is null or approved_by<>created_by)
);
create table public.catalog_changeset_items(
  id uuid primary key default gen_random_uuid(),changeset_id uuid not null references public.catalog_changesets(id) on delete cascade,organization_id uuid not null references public.organizations(id) on delete cascade,entity_type text not null check(entity_type in('product','category','variant','modifier_group','modifier_option','combo','price','availability','menu','image','channel_assignment','field_policy')),entity_id uuid,operation text not null check(operation in('create','update','archive','disable','enable','move','schedule','rollback')),before_state jsonb not null default '{}',after_state jsonb not null default '{}',target_store_ids uuid[] not null default '{}',requires_action_engine boolean not null default false,action_approval_id uuid,created_by uuid references auth.users(id),created_at timestamptz not null default now()
);
create table public.catalog_product_versions(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,product_id uuid not null references public.products(id) on delete restrict,version integer not null,snapshot jsonb not null,field_diff jsonb not null default '[]',changeset_id uuid references public.catalog_changesets(id) on delete set null,created_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(product_id,version)
);

create table public.catalog_distribution_jobs(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,changeset_id uuid not null references public.catalog_changesets(id) on delete restrict,target_scope text not null check(target_scope in('brand','region','cluster','stores_selected')),target_ids uuid[] not null default '{}',conflict_policy text not null default 'preserve_local' check(conflict_policy in('preserve_local','overwrite_allowed_fields','require_review')),status text not null default 'pending' check(status in('pending','processing','completed','partially_failed','failed','rolled_back')),idempotency_key text not null,error_count integer not null default 0,started_at timestamptz,completed_at timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(organization_id,idempotency_key)
);
create table public.catalog_distribution_waves(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,distribution_job_id uuid not null references public.catalog_distribution_jobs(id) on delete cascade,wave_number integer not null check(wave_number>0),store_ids uuid[] not null default '{}',percentage numeric(5,2) check(percentage between 0 and 100),status text not null default 'pending' check(status in('pending','processing','completed','failed','rolled_back')),scheduled_for timestamptz,started_at timestamptz,completed_at timestamptz,unique(distribution_job_id,wave_number)
);
create table public.catalog_distribution_results(
  id uuid primary key default gen_random_uuid(),distribution_job_id uuid not null references public.catalog_distribution_jobs(id) on delete cascade,wave_id uuid references public.catalog_distribution_waves(id) on delete set null,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,status text not null default 'pending' check(status in('pending','applied','skipped','conflict','failed','rolled_back')),conflicts jsonb not null default '[]',error_message text,attempt_count integer not null default 0,next_attempt_at timestamptz not null default now(),applied_version_hash text,started_at timestamptz,completed_at timestamptz,unique(distribution_job_id,store_id)
);

create table public.catalog_templates(
  id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id) on delete cascade,name text not null,template_type text not null check(template_type in('hamburger','pizza','acai','beverage','executive_meal','combo','addon','custom')),definition jsonb not null default '{}',system_template boolean not null default false,active boolean not null default true,created_by uuid references auth.users(id),created_at timestamptz not null default now()
);
create table public.catalog_import_jobs(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,format text not null check(format in('csv','xlsx')),mode text not null check(mode in('create_only','update_existing','create_and_update')),status text not null default 'uploaded' check(status in('uploaded','mapping','validated','previewed','importing','completed','failed','cancelled')),storage_path text not null,column_mapping jsonb not null default '{}',preview_summary jsonb not null default '{}',created_by uuid references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz
);
create table public.catalog_import_rows(
  id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,import_job_id uuid not null references public.catalog_import_jobs(id) on delete cascade,row_number integer not null,identifier_type text,identifier_value text,raw_data jsonb not null,sanitized_data jsonb not null,validation_errors jsonb not null default '[]',duplicate_candidate_ids uuid[] not null default '{}',status text not null default 'pending' check(status in('pending','valid','invalid','imported','skipped')),unique(import_job_id,row_number)
);
create table public.catalog_validation_results(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,changeset_id uuid references public.catalog_changesets(id) on delete cascade,entity_type text not null,entity_id uuid,severity text not null check(severity in('error','warning','info')),rule_code text not null,message text not null,metadata jsonb not null default '{}',resolved_at timestamptz,created_at timestamptz not null default now()
);

create table public.published_catalog_read_models(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,channel text not null check(channel in('dine_in','waiter','qr','delivery','pickup','kiosk','whatsapp','web','third_party')),menu_id uuid references public.menu_collections(id) on delete set null,menu_version_id uuid references public.menu_versions(id) on delete set null,version_hash text not null,payload jsonb not null,product_count integer not null default 0,status text not null default 'published' check(status in('publishing','published','superseded','failed')),generated_at timestamptz not null default now(),published_at timestamptz not null default now(),superseded_at timestamptz,unique(store_id,channel,version_hash)
);
create table public.catalog_publish_jobs(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,changeset_id uuid references public.catalog_changesets(id) on delete restrict,distribution_job_id uuid references public.catalog_distribution_jobs(id) on delete set null,store_id uuid references public.establishments(id) on delete cascade,job_type text not null check(job_type in('validate_changeset','publish_changeset','materialize_store','distribute_store','rollback_wave','scheduled_publish')),status text not null default 'pending' check(status in('pending','processing','completed','retrying','dead_letter')),priority integer not null default 50,attempts integer not null default 0,max_attempts integer not null default 5,available_at timestamptz not null default now(),locked_at timestamptz,locked_by text,payload jsonb not null default '{}',result jsonb,error_message text,idempotency_key text not null,created_at timestamptz not null default now(),completed_at timestamptz,unique(organization_id,idempotency_key)
);
create table public.catalog_outbox(
  id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,event_type text not null check(event_type in('catalog.product.created','catalog.product.updated','catalog.price.changed','catalog.availability.changed','catalog.changeset.published','catalog.distribution.failed')),aggregate_type text not null,aggregate_id uuid,payload jsonb not null default '{}',idempotency_key text not null,status text not null default 'pending' check(status in('pending','processing','published','failed')),attempt_count integer not null default 0,available_at timestamptz not null default now(),published_at timestamptz,created_at timestamptz not null default now(),unique(organization_id,idempotency_key)
);
create table public.catalog_audit_events(
  id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete set null,actor_user_id uuid references auth.users(id) on delete set null,event_type text not null,entity_type text not null,entity_id uuid,reason text,before_state jsonb,after_state jsonb,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);

-- Existing product is registered once and assigned to its current store; no duplicate product row is created.
insert into public.catalog_product_assignments(organization_id,product_id,store_id,enabled,local_status,override_policy)
select p.organization_id,p.id,p.establishment_id,p.active,case when p.active then 'active' else 'inactive' end,'local_allowed' from public.products p
on conflict(product_id,store_id) do nothing;
insert into public.catalog_product_categories(organization_id,product_id,category_id,is_primary)
select p.organization_id,p.id,p.category_id,true from public.products p where p.category_id is not null
on conflict(product_id,category_id) do update set is_primary=true;

create index products_org_status_idx on public.products(organization_id,lifecycle_status,updated_at desc);
create unique index products_org_sku_uq on public.products(organization_id,lower(sku)) where sku is not null and lifecycle_status not in('archived','discontinued');
create index products_master_idx on public.products(master_product_id) where master_product_id is not null;
create index categories_org_parent_idx on public.categories(organization_id,parent_id,sort_order);
create index catalog_assignment_store_idx on public.catalog_product_assignments(organization_id,store_id,enabled,local_status);
create index catalog_field_policy_scope_idx on public.catalog_field_policies(organization_id,scope_type,scope_id);
create index catalog_product_categories_category_idx on public.catalog_product_categories(category_id,display_order);
create index modifier_assignment_group_idx on public.product_modifier_assignments(modifier_group_id);
create index combo_components_combo_idx on public.combo_components(combo_id,display_order);
create index product_attributes_product_idx on public.product_attributes(product_id);
create index catalog_media_product_idx on public.catalog_product_media(product_id,variant_type,display_order);
create index price_books_scope_idx on public.price_books(organization_id,scope_type,scope_id,status,effective_from desc);
create index price_book_items_resolution_idx on public.price_book_items(organization_id,product_id,channel,fulfillment_method,effective_from desc);
create index product_channel_resolution_idx on public.product_channel_availability(organization_id,product_id,store_id,channel,enabled);
create index menu_assignment_store_channel_idx on public.menu_assignments(organization_id,store_id,channel,active);
create index changeset_status_idx on public.catalog_changesets(organization_id,status,updated_at desc);
create index changeset_items_changeset_idx on public.catalog_changeset_items(changeset_id,entity_type);
create index product_versions_product_idx on public.catalog_product_versions(product_id,version desc);
create index distribution_results_retry_idx on public.catalog_distribution_results(status,next_attempt_at) where status in('pending','failed');
create index catalog_import_rows_job_status_idx on public.catalog_import_rows(import_job_id,status,row_number);
create index catalog_validation_changeset_idx on public.catalog_validation_results(changeset_id,severity,created_at);
create unique index published_catalog_current_uq on public.published_catalog_read_models(store_id,channel) where status='published';
create index published_catalog_lookup_idx on public.published_catalog_read_models(store_id,channel,published_at desc) where status='published';
create index catalog_publish_jobs_claim_idx on public.catalog_publish_jobs(status,priority desc,available_at) where status in('pending','retrying');
create index catalog_outbox_claim_idx on public.catalog_outbox(status,available_at,id) where status in('pending','failed');
create index catalog_audit_scope_idx on public.catalog_audit_events(organization_id,store_id,created_at desc);

create or replace function catalog_private.can_access(target_org uuid,requested_permission text default 'catalog:view') returns boolean language sql stable security definer set search_path='' as $$
  select private.is_superadmin()
  or exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=(select auth.uid()) and m.active and m.role in('owner','admin','manager'))
  or exists(select 1 from public.catalog_member_permissions p where p.organization_id=target_org and p.user_id=(select auth.uid()) and p.active and (requested_permission=any(p.permissions) or 'catalog:*'=any(p.permissions)))
  or (requested_permission='catalog:view' and exists(select 1 from public.establishment_members em join public.establishments e on e.id=em.establishment_id where e.organization_id=target_org and em.user_id=(select auth.uid()) and em.status='active'))
$$;
revoke all on function catalog_private.can_access(uuid,text) from public,anon;
grant execute on function catalog_private.can_access(uuid,text) to authenticated;

create or replace function catalog_private.validate_category_depth() returns trigger language plpgsql security definer set search_path='' as $$
declare depth_count integer:=0;cursor_id uuid:=new.parent_id;
begin
  while cursor_id is not null loop
    if cursor_id=new.id then raise exception 'Ciclo de categoria não permitido';end if;
    depth_count:=depth_count+1;if depth_count>=3 then raise exception 'Profundidade máxima de categoria excedida';end if;
    select parent_id into cursor_id from public.categories where id=cursor_id and organization_id=new.organization_id;
  end loop;return new;
end $$;
drop trigger if exists categories_depth_guard on public.categories;
create trigger categories_depth_guard before insert or update of parent_id on public.categories for each row execute function catalog_private.validate_category_depth();

create or replace function public.claim_catalog_publish_jobs(requested_worker text,requested_limit integer default 10) returns setof public.catalog_publish_jobs language sql security definer set search_path='' as $$
  update public.catalog_publish_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),locked_by=requested_worker
  where j.id in(select id from public.catalog_publish_jobs where status in('pending','retrying') and available_at<=now() order by priority desc,available_at,id limit greatest(1,least(requested_limit,50)) for update skip locked)
  returning j.*
$$;
revoke all on function public.claim_catalog_publish_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_catalog_publish_jobs(text,integer) to service_role;

create or replace function public.get_published_catalog(requested_slug text,requested_channel text default 'web') returns jsonb language sql stable security definer set search_path='' as $$
  select r.payload from public.published_catalog_read_models r join public.establishments e on e.id=r.store_id
  where e.slug=requested_slug and e.active and r.channel=requested_channel and r.status='published' order by r.published_at desc limit 1
$$;
revoke all on function public.get_published_catalog(text,text) from public;
grant execute on function public.get_published_catalog(text,text) to anon,authenticated;

create or replace function public.publish_catalog_read_model(requested_org uuid,requested_store uuid,requested_channel text,requested_menu uuid,requested_menu_version uuid,requested_hash text,requested_payload jsonb) returns public.published_catalog_read_models language plpgsql security definer set search_path='' as $$
declare result public.published_catalog_read_models;
begin
  if requested_channel not in('dine_in','waiter','qr','delivery','pickup','kiosk','whatsapp','web','third_party') then raise exception 'Canal inválido';end if;
  if not exists(select 1 from public.establishments e where e.id=requested_store and e.organization_id=requested_org and e.active) then raise exception 'Unidade inválida';end if;
  if requested_payload is null or not jsonb_path_exists(requested_payload,'$.categories[*].products[*]') then raise exception 'Catálogo vazio não pode substituir a última versão válida';end if;
  perform pg_advisory_xact_lock(hashtext(requested_store::text||':'||requested_channel));
  update public.published_catalog_read_models set status='superseded',superseded_at=now() where store_id=requested_store and channel=requested_channel and status='published';
  insert into public.published_catalog_read_models(organization_id,store_id,channel,menu_id,menu_version_id,version_hash,payload,product_count,status)
  values(requested_org,requested_store,requested_channel,requested_menu,requested_menu_version,requested_hash,requested_payload,(select count(*) from jsonb_path_query(requested_payload,'$.categories[*].products[*]')),'published') returning * into result;
  return result;
end $$;
revoke all on function public.publish_catalog_read_model(uuid,uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_catalog_read_model(uuid,uuid,text,uuid,uuid,text,jsonb) to service_role;

create table public.fact_catalog_product_changes(organization_id uuid not null,store_id uuid,product_id uuid not null,changeset_id uuid,change_type text not null,changed_at timestamptz not null,data_as_of timestamptz not null,primary key(organization_id,product_id,changed_at,change_type));
create table public.fact_catalog_price_changes(organization_id uuid not null,store_id uuid,product_id uuid not null,old_price_cents integer,new_price_cents integer,changed_at timestamptz not null,data_as_of timestamptz not null,primary key(organization_id,product_id,changed_at));
create table public.fact_catalog_availability_changes(organization_id uuid not null,store_id uuid,product_id uuid not null,channel text,available boolean not null,reason text,changed_at timestamptz not null,data_as_of timestamptz not null,primary key(organization_id,product_id,changed_at,channel));
create table public.fact_catalog_distribution(organization_id uuid not null,job_id uuid not null,store_id uuid not null,status text not null,error_count integer not null default 0,completed_at timestamptz,data_as_of timestamptz not null,primary key(organization_id,job_id,store_id));
create table public.fact_product_channel_availability(organization_id uuid not null,store_id uuid not null,product_id uuid not null,channel text not null,available boolean not null,reason text,data_as_of timestamptz not null,primary key(organization_id,store_id,product_id,channel));
create table public.dim_product(id uuid primary key,organization_id uuid not null,name text not null,sku text,product_type text,status text,valid_from timestamptz not null,valid_until timestamptz);
create table public.dim_category(id uuid primary key,organization_id uuid not null,parent_id uuid,name text not null,status text not null);
create table public.dim_catalog_status(code text primary key,label text not null);
create table public.dim_channel(code text primary key,label text not null);
create table public.dim_price_book(id uuid primary key,organization_id uuid not null,name text not null,scope_type text not null,status text not null);
insert into public.dim_catalog_status values('draft','Rascunho'),('active','Ativo'),('inactive','Inativo'),('archived','Arquivado'),('discontinued','Descontinuado') on conflict do nothing;
insert into public.dim_channel values('dine_in','Salão'),('waiter','Garçom'),('qr','QR Code'),('delivery','Delivery'),('pickup','Retirada'),('kiosk','Totem'),('whatsapp','WhatsApp'),('web','Web'),('third_party','Terceiros') on conflict do nothing;

alter table public.plans add column if not exists central_catalog_enabled boolean not null default true,add column if not exists catalog_governance_enabled boolean not null default true,add column if not exists catalog_changesets_enabled boolean not null default true,add column if not exists catalog_scheduled_publish_enabled boolean not null default true,add column if not exists catalog_ai_assistant_enabled boolean not null default true;
alter table public.store_feature_flags add column if not exists central_catalog_enabled boolean not null default true,add column if not exists catalog_governance_enabled boolean not null default true,add column if not exists catalog_changesets_enabled boolean not null default true,add column if not exists catalog_scheduled_publish_enabled boolean not null default true,add column if not exists catalog_ai_assistant_enabled boolean not null default true;

insert into public.product_attribute_registry(organization_id,attribute_key,display_name,attribute_type,customer_visible,active) values
(null,'spicy','Picante','dietary',true,true),(null,'vegetarian','Vegetariano','dietary',true,true),(null,'vegan','Vegano','dietary',true,true),(null,'contains_nuts_explicit','Contém castanhas (informação declarada)','allergen_explicit',true,true),(null,'gluten_information_explicit','Informação declarada sobre glúten','allergen_explicit',true,true),(null,'lactose_information_explicit','Informação declarada sobre lactose','allergen_explicit',true,true) on conflict(organization_id,attribute_key) do nothing;
insert into public.catalog_templates(name,template_type,definition,system_template) values
('Hambúrguer','hamburger','{"expected_fields":["name","description","price","image"],"modifier_patterns":["ponto_da_carne","adicionais"]}',true),('Pizza','pizza','{"variant_dimension":"size","modifier_patterns":["sabores","borda"]}',true),('Açaí','acai','{"variant_dimension":"portion","modifier_patterns":["complementos"]}',true),('Bebida','beverage','{"variant_dimension":"size"}',true),('Prato Executivo','executive_meal','{"modifier_patterns":["acompanhamentos"]}',true),('Combo','combo','{"component_pattern":["principal","acompanhamento","bebida"]}',true),('Adicional','addon','{"product_type":"simple"}',true);

insert into public.automation_event_registry(event_name,schema_version,module,description,payload_schema,allowed_fields,sensitivity) values
('catalog.product_created',1,'catalog_management','Produto operacional criado','{}','{product_id,store_id,organization_id}','normal'),('catalog.price_changed',1,'catalog_management','Preço publicado alterado','{}','{product_id,store_id,old_price_cents,new_price_cents}','sensitive'),('catalog.product_unavailable',1,'catalog_management','Produto ficou indisponível','{}','{product_id,store_id,channel,reason}','normal'),('catalog.changeset_published',1,'catalog_management','Changeset publicado','{}','{changeset_id,store_ids,version_hash}','normal'),('catalog.distribution_failed',1,'catalog_management','Distribuição falhou ou ficou parcial','{}','{distribution_job_id,store_id,error_code}','sensitive') on conflict do nothing;
insert into public.automation_action_registry(action_type,module,description,input_schema,required_permission,risk_level,idempotency_supported,action_engine_required) values
('catalog_notify_manager','catalog_management','Notificar gestor sobre evento de catálogo','{}','catalog:view','low',true,false),('catalog_create_task','catalog_management','Criar tarefa oficial para revisão','{}','catalog:view','low',true,false),('catalog_create_approval_request','catalog_management','Criar solicitação de aprovação','{}','catalog:publish','high',true,true),('catalog_create_attention_item','catalog_management','Criar item de atenção','{}','catalog:view','low',true,false) on conflict do nothing;

insert into public.workspace_widget_registry(id,title,description,category,widget_type,required_permissions,supported_scopes,data_source,refresh_strategy,route,display_safe,sensitive) values
('catalog_health','Saúde do Catálogo','Pendências transparentes de conteúdo e configuração.','catalog','status_list','{catalog:view}','{store,network}','catalog_quality','5m','/painel/catalogo-central?tab=health',true,false),('catalog_unavailable_products','Produtos Indisponíveis','Produtos indisponíveis e motivo interno.','catalog','alert_list','{catalog:view}','{store,network}','catalog_availability','1m','/painel/catalogo-central?tab=availability',false,false),('catalog_pending_changes','Mudanças Pendentes','Changesets aguardando revisão ou publicação.','catalog','metric_card','{catalog:view}','{store,network}','catalog_changesets','1m','/painel/catalogo-central?tab=changesets',true,false),('catalog_scheduled_prices','Preços Programados','Alterações futuras aprovadas.','catalog','timeline','{catalog:manage_prices}','{store,network}','catalog_prices','5m','/painel/catalogo-central?tab=pricing',false,true) on conflict(id) do nothing;

insert into public.report_dataset_registry(id,name,description,source,available_metrics,available_dimensions,available_filters,supported_time_granularity,required_permissions,realtime_or_analytical,sensitivity,column_policy) values
('catalog_products','Catalog Products','Produtos operacionais com metadados governados.','hybrid','{active_product_count,products_without_image,products_without_recipe}','{store,brand,region,product,category,status}','{store,brand,region,category,status}','{day,week,month}','{reports:view,catalog:view}','hybrid','normal','{}'),('catalog_prices','Catalog Prices','Preço efetivo e histórico por escopo.','hybrid','{price_change_count}','{store,brand,region,product,channel,price_book}','{period,store,product,channel}','{day,week,month}','{reports:view,catalog:manage_prices}','hybrid','financial','{}'),('catalog_availability','Catalog Availability','Disponibilidade efetiva por canal.','operational','{unavailable_product_count}','{store,product,category,channel,reason}','{store,channel,reason}','{hour,day,week}','{reports:view,catalog:view}','realtime','normal','{}'),('catalog_distribution','Catalog Distribution','Resultado de publicação por unidade.','hybrid','{distribution_success_rate,catalog_publish_failure_rate}','{store,brand,region,changeset,status}','{period,store,status}','{day,week,month}','{reports:view,catalog:manage_network}','hybrid','normal','{}'),('catalog_quality','Catalog Quality','Checklist de qualidade sem score opaco.','warehouse','{products_without_image,products_without_recipe}','{store,product,category,rule}','{store,rule,severity}','{day,week,month}','{reports:view,catalog:view}','analytical','normal','{}') on conflict(id) do update set updated_at=now();
insert into public.report_templates(name,description,category,dataset_id,definition_json,system_template,read_only,required_permissions,widget_compatible) values
('Produtos Ativos','Produtos operacionais ativos.','catalog','catalog_products','{"filters":{"status":"active"}}',true,true,'{reports:view,catalog:view}',true),('Produtos sem Imagem','Pendências de imagem.','catalog','catalog_quality','{"rule":"missing_image"}',true,true,'{reports:view,catalog:view}',true),('Produtos Indisponíveis','Disponibilidade por motivo.','catalog','catalog_availability','{"available":false}',true,true,'{reports:view,catalog:view}',true),('Preços por Unidade','Preço efetivo por escopo e canal.','catalog','catalog_prices','{"groupBy":["store","product","channel"]}',true,true,'{reports:view,catalog:manage_prices}',false),('Alterações de Catálogo','Changesets e itens alterados.','catalog','catalog_products','{"type":"change_log"}',true,true,'{reports:view,catalog:view}',false),('Distribuição por Loja','Resultado de publicação por loja.','catalog','catalog_distribution','{"groupBy":["store","status"]}',true,true,'{reports:view,catalog:manage_network}',true),('Produtos sem Receita','Produtos que exigem receita conforme política.','catalog','catalog_quality','{"rule":"missing_recipe"}',true,true,'{reports:view,catalog:view}',true),('Combos e Margem','Combos com custo e margem quando conhecidos.','catalog','catalog_products','{"product_type":"combo","include_margin_if_permitted":true}',true,true,'{reports:view,menu_profitability:view}',false);

alter table public.search_documents drop constraint if exists search_documents_entity_type_check;
alter table public.search_documents add constraint search_documents_entity_type_check check(entity_type in('order','customer','product','category','table','tab','reservation','delivery','driver','employee','supplier','purchase_order','inventory_item','lot','asset','maintenance_work_order','contract','document','support_ticket','internal_project','internal_task','sales_opportunity','organization','store','campaign','workflow','configuration','report','user','operational_incident','customer360_profile','customer_journey','catalog_modifier','catalog_combo','catalog_changeset'));
insert into public.search_command_registry(id,title,description,keywords,command_type,route,action_type,required_permission,risk_level,scope,position) values
('catalog-new-product','Novo produto','Abrir cadastro governado de produto','{produto,novo,catalogo}','navigation','/painel/catalogo-central?new=product',null,'catalog:create_product','low','store',90),('catalog-publish','Publicar catálogo','Abrir changesets prontos para publicação','{publicar,catalogo,changeset}','navigation','/painel/catalogo-central?tab=changesets',null,'catalog:publish','high','store',91) on conflict(id) do nothing;

-- Semantic metrics are transparent calculations, not opaque scores.
insert into public.analytics_metric_catalog(metric_key,name,description,formula,source_of_truth,grain,owner_label,refresh_frequency,unit,evidence_class,sensitive,allowed_dimensions) values
('active_product_count','Active Product Count','Produtos ativos no catálogo publicado.','count distinct product_id where status=active','dim_product','organização/loja','Catálogo','hourly','count','calculation',false,'{store,brand,region,category}'),('unavailable_product_count','Unavailable Product Count','Produtos indisponíveis por canal.','count where available=false','fact_product_channel_availability','loja/canal','Catálogo','5m','count','calculation',false,'{store,channel,reason}'),('catalog_change_count','Catalog Change Count','Itens alterados em changesets.','count changeset_item_id','fact_catalog_product_changes','changeset','Catálogo','hourly','count','calculation',false,'{date,store,product}'),('price_change_count','Price Change Count','Alterações de preço publicadas.','count price change','fact_catalog_price_changes','produto/loja','Pricing','hourly','count','calculation',true,'{date,store,product}'),('distribution_success_rate','Distribution Success Rate','Lojas aplicadas sobre lojas processadas.','applied/processed','fact_catalog_distribution','job','Catálogo','5m','percent','calculation',false,'{date,store,status}'),('products_without_image','Products Without Image','Produtos sem mídia primária.','count missing primary image','catalog_quality','loja','Catálogo','hourly','count','calculation',false,'{store,category}'),('products_without_recipe','Products Without Recipe','Produtos sem receita quando exigida.','count required recipe missing','catalog_quality','loja','Catálogo','hourly','count','calculation',false,'{store,category}'),('catalog_publish_failure_rate','Catalog Publish Failure Rate','Falhas sobre tentativas de publicação.','failed/publish attempts','fact_catalog_distribution','período','Catálogo','5m','percent','calculation',false,'{date,store}') on conflict(metric_key) do update set updated_at=now();

do $$ declare t text;begin foreach t in array array[
  'catalog_member_permissions','catalog_product_assignments','catalog_field_policies','catalog_product_categories','product_modifier_assignments','product_combos','combo_components','product_attribute_registry','product_attributes','catalog_product_media','product_localizations','price_books','price_book_items','catalog_availability_profiles','product_channel_availability','menu_collections','menu_versions','menu_items','menu_assignments','catalog_changesets','catalog_changeset_items','catalog_product_versions','catalog_distribution_jobs','catalog_distribution_waves','catalog_distribution_results','catalog_templates','catalog_import_jobs','catalog_import_rows','catalog_validation_results','published_catalog_read_models','catalog_publish_jobs','catalog_outbox','catalog_audit_events','fact_catalog_product_changes','fact_catalog_price_changes','fact_catalog_availability_changes','fact_catalog_distribution','fact_product_channel_availability','dim_product','dim_category','dim_catalog_status','dim_channel','dim_price_book'
] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for all to service_role using(true) with check(true)',left(t||'_service_only',63),t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
end loop;end $$;

-- Explicit Data API grants: authenticated reads are still restricted by tenant-aware RLS.
do $$ declare t text;begin foreach t in array array['catalog_product_assignments','catalog_field_policies','catalog_product_categories','product_modifier_assignments','product_combos','combo_components','product_attribute_registry','product_attributes','catalog_product_media','product_localizations','price_books','price_book_items','catalog_availability_profiles','product_channel_availability','menu_collections','menu_versions','menu_items','menu_assignments','catalog_changesets','catalog_changeset_items','catalog_product_versions','catalog_distribution_jobs','catalog_distribution_waves','catalog_distribution_results','catalog_templates','catalog_validation_results','published_catalog_read_models'] loop
  execute format('create policy %I on public.%I for select to authenticated using((select catalog_private.can_access(organization_id,''catalog:view'')))',left(t||'_tenant_read',63),t);
  execute format('grant select on public.%I to authenticated',t);
end loop;end $$;

comment on table public.catalog_product_assignments is 'Master product assignment and local overrides; public.products remains source of truth.';
comment on table public.published_catalog_read_models is 'Last known valid published customer catalog; drafts never appear here.';
comment on column public.product_attributes.source is 'Allergen and dietary information is explicit and never medically inferred.';
comment on column public.order_items.catalog_version_hash is 'Commercial catalog snapshot reference; historical items keep their own name, price, addons and fees.';
notify pgrst,'reload schema';
