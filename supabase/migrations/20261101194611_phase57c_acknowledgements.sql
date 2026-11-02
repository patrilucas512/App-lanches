-- Phase 57C: acknowledgements stay in the Phase 46 table. The version says which text the person confirmed.
alter table public.network_announcement_acknowledgements add column version integer not null default 1,add column verification_passed boolean;
