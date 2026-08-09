create or replace function public.register_printer_connector(
  requested_establishment_id uuid,
  requested_name text,
  requested_printer_name text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare raw_token text := encode(extensions.gen_random_bytes(32), 'hex'); saved public.printer_devices%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente o administrador pode instalar o conector.'; end if;
  insert into public.printer_devices(establishment_id,name,printer_name,token_hash,created_by)
  values(requested_establishment_id,btrim(requested_name),btrim(requested_printer_name),extensions.digest(raw_token,'sha256'),auth.uid()) returning * into saved;
  return jsonb_build_object('id',saved.id,'token',raw_token,'name',saved.name,'printer_name',saved.printer_name);
end $$;

create or replace function public.fetch_printer_jobs(requested_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare device public.printer_devices%rowtype; claimed public.printer_jobs%rowtype;
begin
  if length(coalesce(requested_token,'')) <> 64 then raise exception 'Conector inválido.'; end if;
  select * into device from public.printer_devices where token_hash=extensions.digest(requested_token,'sha256') and active for update;
  if device.id is null then raise exception 'Conector inválido ou desativado.'; end if;
  update public.printer_devices set last_seen_at=now(),updated_at=now() where id=device.id;
  update public.printer_jobs set status='queued',device_id=null,claimed_at=null where establishment_id=device.establishment_id and status='processing' and claimed_at < now()-interval '2 minutes';
  update public.printer_jobs set status='processing',device_id=device.id,claimed_at=now(),error_message=null
  where id=(select id from public.printer_jobs where establishment_id=device.establishment_id and status='queued' order by created_at limit 1 for update skip locked)
  returning * into claimed;
  if claimed.id is null then return jsonb_build_object('jobs','[]'::jsonb,'printer_name',device.printer_name); end if;
  return jsonb_build_object('jobs',jsonb_build_array(jsonb_build_object('id',claimed.id,'text',claimed.payload->>'text')),'printer_name',device.printer_name);
end $$;

create or replace function public.complete_printer_job(requested_token text,requested_job_id uuid,requested_success boolean,requested_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare device public.printer_devices%rowtype; saved public.printer_jobs%rowtype;
begin
  if length(coalesce(requested_token,'')) <> 64 then raise exception 'Conector inválido.'; end if;
  select * into device from public.printer_devices where token_hash=extensions.digest(requested_token,'sha256') and active;
  if device.id is null then raise exception 'Conector inválido ou desativado.'; end if;
  update public.printer_jobs set status=case when requested_success then 'printed' else 'failed' end,completed_at=now(),
    error_message=case when requested_success then null else left(coalesce(requested_error,'Falha na impressora.'),500) end
  where id=requested_job_id and device_id=device.id and status='processing' returning * into saved;
  if saved.id is null then raise exception 'Trabalho de impressão não encontrado.'; end if;
  return to_jsonb(saved);
end $$;

revoke all on function public.register_printer_connector(uuid,text,text) from public,anon;
revoke all on function public.fetch_printer_jobs(text) from public,authenticated;
revoke all on function public.complete_printer_job(text,uuid,boolean,text) from public,authenticated;
grant execute on function public.register_printer_connector(uuid,text,text) to authenticated;
grant execute on function public.fetch_printer_jobs(text) to anon;
grant execute on function public.complete_printer_job(text,uuid,boolean,text) to anon;
