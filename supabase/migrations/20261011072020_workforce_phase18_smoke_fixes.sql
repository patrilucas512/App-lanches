-- Follow-up found by the Phase 18 transactional smoke test.
create or replace function public.workforce_publish_schedule(requested_establishment_id uuid,requested_start date,requested_end date) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid;v integer;snap jsonb;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 if not private.workforce_can_access(org,requested_establishment_id,'publish') then raise exception 'Sem permissão para publicar escala'; end if;
 select coalesce(max(version),0)+1 into v from public.schedule_publications where store_id=requested_establishment_id and period_start=requested_start and period_end=requested_end;
 update public.work_shifts set publication_status='published',version=v,updated_by=auth.uid(),updated_at=now() where store_id=requested_establishment_id and shift_date between requested_start and requested_end and status<>'cancelled';
 select coalesce(jsonb_agg(to_jsonb(w) order by w.starts_at),'[]'::jsonb) into snap from public.work_shifts w where w.store_id=requested_establishment_id and w.shift_date between requested_start and requested_end and w.publication_status='published';
 insert into public.schedule_publications(organization_id,store_id,period_start,period_end,version,snapshot,published_by) values(org,requested_establishment_id,requested_start,requested_end,v,snap,auth.uid());
 insert into public.workforce_notifications(organization_id,employee_id,kind,title,body) select distinct org,employee_id,'schedule_published','Escala publicada','Sua escala foi publicada ou atualizada.' from public.work_shifts where store_id=requested_establishment_id and shift_date between requested_start and requested_end;
 perform private.workforce_audit(org,requested_establishment_id,'schedule_published','schedule_publication',null,null,jsonb_build_object('version',v,'start',requested_start,'end',requested_end));
 return jsonb_build_object('version',v,'shifts',snap);
end$$;
