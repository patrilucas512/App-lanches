create index if not exists printer_devices_created_by_idx on public.printer_devices(created_by);
create index if not exists printer_jobs_device_id_idx on public.printer_jobs(device_id);
create index if not exists printer_jobs_requested_by_idx on public.printer_jobs(requested_by);
