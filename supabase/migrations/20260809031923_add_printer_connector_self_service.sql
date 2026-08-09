create or replace function public.activate_printer_connector(
  requested_token text,
  requested_printer_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.printer_devices%rowtype;
begin
  if length(coalesce(requested_token,'')) <> 64 then raise exception 'Conector inválido.'; end if;
  if length(btrim(coalesce(requested_printer_name,''))) not between 2 and 160 then raise exception 'Impressora inválida.'; end if;

  update public.printer_devices
  set printer_name=btrim(requested_printer_name),last_seen_at=now(),updated_at=now()
  where token_hash=extensions.digest(requested_token,'sha256') and active
  returning * into saved;

  if saved.id is null then raise exception 'Conector inválido ou desativado.'; end if;
  return jsonb_build_object('configured',true,'online',true,'printer_name',saved.printer_name);
end
$$;

create or replace function public.queue_printer_test(
  requested_establishment_id uuid,
  requested_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.printer_jobs%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then
    raise exception 'Somente o administrador pode testar a impressora.';
  end if;
  if length(coalesce(requested_text,'')) not between 10 and 4000 then raise exception 'Conteúdo do teste inválido.'; end if;
  if not exists (
    select 1 from public.printer_devices
    where establishment_id=requested_establishment_id and active and last_seen_at > now()-interval '20 seconds'
  ) then
    raise exception 'O Conector Mesa Viva está offline.';
  end if;

  insert into public.printer_jobs(establishment_id,requested_by,job_kind,payload)
  values(requested_establishment_id,auth.uid(),'test',jsonb_build_object('text',requested_text))
  returning * into saved;
  return to_jsonb(saved);
end
$$;

revoke all on function public.activate_printer_connector(text,text) from public,authenticated;
revoke all on function public.queue_printer_test(uuid,text) from public,anon;
grant execute on function public.activate_printer_connector(text,text) to anon;
grant execute on function public.queue_printer_test(uuid,text) to authenticated;
