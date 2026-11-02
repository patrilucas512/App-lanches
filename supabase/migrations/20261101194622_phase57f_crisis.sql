-- Phase 57F: an incident, a continuity plan or a recall finds what was said about it through related_refs.
-- quality: allow-nonconcurrent-index reason=new-empty-comms-tables
create index network_announcements_related_refs_idx on public.network_announcements using gin(related_refs jsonb_path_ops);
create index network_announcements_crisis_idx on public.network_announcements(organization_id,status,published_at desc) where announcement_type in('crisis','recall_food_safety');
