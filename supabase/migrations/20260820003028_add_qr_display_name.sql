alter table public.qr_code_settings
  add column if not exists display_name text;

alter table public.qr_code_settings
  drop constraint if exists qr_settings_display_name_length;

alter table public.qr_code_settings
  add constraint qr_settings_display_name_length
  check (display_name is null or char_length(trim(display_name)) between 2 and 80);
