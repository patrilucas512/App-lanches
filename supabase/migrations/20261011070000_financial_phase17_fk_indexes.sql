-- Phase 17 follow-up: cover every foreign key used by the managerial finance module.
-- These indexes keep tenant, store, approval, supplier and ledger lookups predictable
-- as the number of financial entries grows.

create index if not exists financial_action_previews_organization_idx
  on public.financial_action_previews (organization_id);
create index if not exists financial_action_previews_requested_by_idx
  on public.financial_action_previews (requested_by);
create index if not exists financial_action_previews_store_idx
  on public.financial_action_previews (store_id);

create index if not exists financial_attachments_created_by_idx
  on public.financial_attachments (created_by_user_id);
create index if not exists financial_attachments_organization_idx
  on public.financial_attachments (organization_id);

create index if not exists financial_audit_events_actor_idx
  on public.financial_audit_events (actor_user_id);
create index if not exists financial_audit_events_store_idx
  on public.financial_audit_events (store_id);

create index if not exists financial_budgets_category_idx
  on public.financial_budgets (category_id);
create index if not exists financial_budgets_created_by_idx
  on public.financial_budgets (created_by_user_id);
create index if not exists financial_budgets_store_idx
  on public.financial_budgets (store_id);

create index if not exists financial_cost_centers_store_idx
  on public.financial_cost_centers (store_id);

create index if not exists financial_entries_approved_by_idx
  on public.financial_entries (approved_by_user_id);
create index if not exists financial_entries_category_idx
  on public.financial_entries (category_id);
create index if not exists financial_entries_cost_center_idx
  on public.financial_entries (cost_center_id);
create index if not exists financial_entries_created_by_idx
  on public.financial_entries (created_by_user_id);
create index if not exists financial_entries_parent_idx
  on public.financial_entries (parent_entry_id);
create index if not exists financial_entries_store_idx
  on public.financial_entries (store_id);

create index if not exists financial_entry_payments_created_by_idx
  on public.financial_entry_payments (created_by_user_id);
create index if not exists financial_entry_payments_entry_idx
  on public.financial_entry_payments (entry_id);
create index if not exists financial_entry_payments_store_idx
  on public.financial_entry_payments (store_id);

create index if not exists financial_member_permissions_user_idx
  on public.financial_member_permissions (user_id);

create index if not exists financial_reconciliations_order_idx
  on public.financial_reconciliations (order_id);
create index if not exists financial_reconciliations_resolved_by_idx
  on public.financial_reconciliations (resolved_by);
create index if not exists financial_reconciliations_store_idx
  on public.financial_reconciliations (store_id);

create index if not exists financial_recurring_expenses_category_idx
  on public.financial_recurring_expenses (category_id);
create index if not exists financial_recurring_expenses_cost_center_idx
  on public.financial_recurring_expenses (cost_center_id);
create index if not exists financial_recurring_expenses_created_by_idx
  on public.financial_recurring_expenses (created_by_user_id);
create index if not exists financial_recurring_expenses_organization_idx
  on public.financial_recurring_expenses (organization_id);
create index if not exists financial_recurring_expenses_store_idx
  on public.financial_recurring_expenses (store_id);
