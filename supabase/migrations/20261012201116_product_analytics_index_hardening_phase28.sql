-- Advisor hardening for new, initially small Phase 28 tables.
-- quality: allow-nonconcurrent-index reason=new-empty-quality-tables
create index if not exists cs_tasks_opportunity_idx on public.customer_success_tasks(opportunity_id) where opportunity_id is not null;
create index if not exists cs_tasks_owner_idx on public.customer_success_tasks(owner_user_id) where owner_user_id is not null;
create index if not exists growth_assigned_idx on public.growth_opportunities(assigned_to) where assigned_to is not null;
create index if not exists pa_queue_event_name_idx on public.product_event_ingestion_queue(event_name);
create index if not exists pa_queue_org_idx on public.product_event_ingestion_queue(organization_id);
create index if not exists pa_queue_store_idx on public.product_event_ingestion_queue(store_id) where store_id is not null;
create index if not exists pa_queue_user_idx on public.product_event_ingestion_queue(user_id) where user_id is not null;
create index if not exists experiment_assignment_user_idx on public.product_experiment_assignments(user_id) where user_id is not null;
create index if not exists experiment_assignment_variant_idx on public.product_experiment_assignments(variant_id);
create index if not exists experiment_metric_variant_idx on public.product_experiment_metrics(variant_id);
create index if not exists experiment_created_by_idx on public.product_experiments(created_by) where created_by is not null;
create index if not exists feature_configured_event_idx on public.product_feature_catalog(configured_event) where configured_event is not null;
create index if not exists feature_discovery_event_idx on public.product_feature_catalog(discovery_event) where discovery_event is not null;
create index if not exists feature_first_use_event_idx on public.product_feature_catalog(first_use_event) where first_use_event is not null;
create index if not exists feature_recurring_event_idx on public.product_feature_catalog(recurring_event) where recurring_event is not null;
create index if not exists funnel_created_by_idx on public.product_funnel_definitions(created_by) where created_by is not null;
create index if not exists lifecycle_campaign_created_by_idx on public.saas_lifecycle_campaigns(created_by) where created_by is not null;
create index if not exists lifecycle_delivery_org_idx on public.saas_lifecycle_deliveries(organization_id);
create index if not exists lifecycle_delivery_user_idx on public.saas_lifecycle_deliveries(user_id) where user_id is not null;
