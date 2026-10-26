-- Phase 23 follow-up: the primary read policies already include superadmins
-- through private.onboarding_can, so separate permissive policies are redundant.
drop policy if exists onboarding_superadmin_catalog on public.onboarding_step_catalog;
drop policy if exists onboarding_superadmin_sessions on public.onboarding_sessions;

create index if not exists onboarding_sessions_user_idx on public.onboarding_sessions(user_id);
create index if not exists onboarding_steps_assigned_idx on public.onboarding_steps(assigned_to) where assigned_to is not null;
create index if not exists onboarding_steps_configured_idx on public.onboarding_steps(configured_by) where configured_by is not null;
create index if not exists onboarding_events_actor_idx on public.onboarding_events(actor_user_id) where actor_user_id is not null;
create index if not exists onboarding_permissions_user_idx on public.onboarding_member_permissions(user_id);
create index if not exists onboarding_recommendations_dismissed_idx on public.onboarding_recommendations(dismissed_by) where dismissed_by is not null;
create index if not exists migration_jobs_created_by_idx on public.migration_jobs(created_by);
create index if not exists migration_rows_target_idx on public.migration_rows(target_id) where target_id is not null;
create index if not exists onboarding_test_orders_created_by_idx on public.onboarding_test_orders(created_by);
create index if not exists products_migration_job_idx on public.products(migration_job_id) where migration_job_id is not null;
create index if not exists customers_migration_job_idx on public.customers(migration_job_id) where migration_job_id is not null;
create index if not exists inventory_items_migration_job_idx on public.inventory_items(migration_job_id) where migration_job_id is not null;
