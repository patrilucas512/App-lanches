-- Existing Phase 10 functions were created before digest was schema-qualified.
-- Pin a trusted, non-writable schema so those stored bodies resolve pgcrypto safely.
alter function public.preview_copilot_action(uuid,text,jsonb) set search_path='extensions';
alter function public.confirm_copilot_action(uuid,uuid,text) set search_path='extensions';
