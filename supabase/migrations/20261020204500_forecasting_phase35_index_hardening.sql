-- Phase 35 follow-up: indexes for every foreign-key and audit lookup path.
create index if not exists forecast_settings_updated_by_idx on public.forecast_settings(updated_by) where updated_by is not null;
create index if not exists forecast_models_store_idx on public.forecast_models(store_id) where store_id is not null;
create index if not exists forecast_training_model_idx on public.forecast_training_runs(model_id) where model_id is not null;
create index if not exists forecast_training_requested_by_idx on public.forecast_training_runs(requested_by) where requested_by is not null;
create index if not exists forecast_backtests_run_idx on public.forecast_backtests(training_run_id) where training_run_id is not null;
create index if not exists forecast_inventory_item_idx on public.forecast_inventory_requirements(inventory_item_id);
create index if not exists forecast_manual_events_scope_idx on public.forecast_manual_events(organization_id,store_id,starts_at);
create index if not exists forecast_manual_events_created_by_idx on public.forecast_manual_events(created_by);
create index if not exists forecast_adjustments_scope_idx on public.forecast_adjustments(organization_id,store_id,created_at desc);
create index if not exists forecast_adjustments_created_by_idx on public.forecast_adjustments(created_by);
create index if not exists forecast_recommendations_prediction_idx on public.forecast_recommendations(prediction_id) where prediction_id is not null;
create index if not exists forecast_recommendations_decided_by_idx on public.forecast_recommendations(decided_by) where decided_by is not null;
create index if not exists forecast_drift_model_idx on public.forecast_drift_events(model_id,created_at desc);
create index if not exists forecast_audit_actor_idx on public.forecast_audit_events(actor_user_id,created_at desc) where actor_user_id is not null;
