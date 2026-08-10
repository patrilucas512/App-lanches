with selected as (
  select distinct on (establishment_id) id
  from public.printer_devices p
  where active and sector='kitchen'
    and not exists(select 1 from public.printer_devices d where d.establishment_id=p.establishment_id and d.active and d.sector='kitchen' and d.is_default)
  order by establishment_id,last_seen_at desc nulls last,created_at
)
update public.printer_devices p set is_default=true,updated_at=now() from selected s where p.id=s.id;

update public.printer_jobs j set
  target_device_id=(select p.id from public.printer_devices p where p.establishment_id=j.establishment_id and p.active and p.sector='kitchen' order by p.is_default desc,p.last_seen_at desc nulls last,p.created_at limit 1),
  status=case when j.status='processing' then 'queued' else j.status end,
  device_id=case when j.status='processing' then null else j.device_id end,
  claimed_at=case when j.status='processing' then null else j.claimed_at end
where j.target_device_id is null and j.status in ('queued','processing');

create or replace function public.get_printer_connector_status(requested_establishment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare selected public.printer_devices%rowtype;
begin
  if auth.uid() is null or not (private.has_role(requested_establishment_id,null) or private.is_financial_employee(requested_establishment_id)) then raise exception 'Acesso não autorizado.'; end if;
  select * into selected from public.printer_devices where establishment_id=requested_establishment_id and active and sector='kitchen' order by is_default desc,last_seen_at desc nulls last,created_at limit 1;
  if selected.id is null then return jsonb_build_object('configured',false,'online',false); end if;
  return jsonb_build_object('configured',true,'online',selected.last_seen_at>now()-interval '20 seconds','id',selected.id,'name',selected.name,'printer_name',selected.printer_name,'last_seen_at',selected.last_seen_at);
end $$;

create or replace function public.queue_printer_test(requested_establishment_id uuid,requested_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare device public.printer_devices%rowtype; saved public.printer_jobs%rowtype;
begin
  if auth.uid() is null or not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente o administrador pode testar a impressora.'; end if;
  select * into device from public.printer_devices where establishment_id=requested_establishment_id and active and sector='kitchen' order by is_default desc,last_seen_at desc nulls last,created_at limit 1;
  if device.id is null or device.last_seen_at<=now()-interval '20 seconds' then raise exception 'O Conector Mesa Viva está offline.'; end if;
  if length(coalesce(requested_text,'')) not between 10 and 4000 then raise exception 'Conteúdo do teste inválido.'; end if;
  insert into public.printer_jobs(establishment_id,target_device_id,requested_by,job_kind,payload) values(requested_establishment_id,device.id,auth.uid(),'test',jsonb_build_object('text',requested_text)) returning * into saved;
  return to_jsonb(saved);
end $$;

revoke all on function public.get_printer_connector_status(uuid) from public,anon;
revoke all on function public.queue_printer_test(uuid,text) from public,anon;
grant execute on function public.get_printer_connector_status(uuid) to authenticated;
grant execute on function public.queue_printer_test(uuid,text) to authenticated;
