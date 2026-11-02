-- usage_events holds two kinds of row since Phase 22: public menu events (event_type) and metering (meter_key).
-- event_type and establishment_id stayed required, so every metering insert failed, which blocked orders, WhatsApp messages and AI and voice usage through their triggers.
alter table public.usage_events alter column event_type drop not null,alter column establishment_id drop not null;
alter table public.usage_events add constraint usage_events_kind_check check((event_type is not null and establishment_id is not null) or(meter_key is not null and organization_id is not null));
