-- Phase 79: cover remaining foreign keys used by the Policy Engine.
create index if not exists policy_changeset_items_previous_version_idx
  on public.policy_changeset_items(previous_version_id);

create index if not exists policy_changesets_approved_by_idx
  on public.policy_changesets(approved_by);

create index if not exists policy_changesets_created_by_idx
  on public.policy_changesets(created_by);

create index if not exists policy_changesets_published_by_idx
  on public.policy_changesets(published_by);

create index if not exists policy_condition_groups_parent_idx
  on public.policy_condition_groups(parent_group_id);

create index if not exists policy_exceptions_created_by_idx
  on public.policy_exceptions(created_by);

create index if not exists policy_exceptions_policy_idx
  on public.policy_exceptions(policy_id);

create index if not exists policy_exceptions_revoked_by_idx
  on public.policy_exceptions(revoked_by);

create index if not exists policy_settings_updated_by_idx
  on public.policy_settings(updated_by);

