-- Phase 97C fix: a store created by signup/onboarding had no service_modes row until the owner opened the store
-- settings. The public menu then fell back to "open" with every option enabled, while place_public_order(_v2)
-- joins service_modes and refused every order with "Estabelecimento indisponível."
-- Every store with settings now gets the row the menu was already showing (same values as its fallback).

create or replace function private.ensure_default_service_mode() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.service_modes(establishment_id, counter_pickup_enabled, delivery_enabled, accepted_payment_methods)
  values (new.establishment_id, coalesce(new.pickup_enabled, true), coalesce(new.delivery_enabled, true),
    case when jsonb_typeof(new.payment_methods) = 'array' and jsonb_array_length(new.payment_methods) > 0 then new.payment_methods
      else '["pix","cash","credit_card","debit_card"]'::jsonb end)
  on conflict (establishment_id) do nothing;
  return new;
end $$;
revoke all on function private.ensure_default_service_mode() from public, anon, authenticated;

create trigger establishment_settings_default_service_mode after insert on public.establishment_settings
  for each row execute function private.ensure_default_service_mode();

insert into public.service_modes(establishment_id, counter_pickup_enabled, delivery_enabled, accepted_payment_methods)
select s.establishment_id, coalesce(s.pickup_enabled, true), coalesce(s.delivery_enabled, true),
  case when jsonb_typeof(s.payment_methods) = 'array' and jsonb_array_length(s.payment_methods) > 0 then s.payment_methods
    else '["pix","cash","credit_card","debit_card"]'::jsonb end
from public.establishment_settings s
where not exists (select 1 from public.service_modes m where m.establishment_id = s.establishment_id);
