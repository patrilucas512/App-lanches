-- Phase 8 operational heartbeat: timeouts, SLA, capacity alerts and optional automatic closure.

create or replace function public.process_support_auto_close(requested_limit integer default 500)
returns integer language plpgsql security definer set search_path='' as $$
declare c record; processed integer:=0;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  for c in
    select cv.id,cv.establishment_id,cv.queue_id,cv.assigned_user_id,e.organization_id
    from public.whatsapp_conversations cv
    join public.support_settings s on s.establishment_id=cv.establishment_id
    join public.establishments e on e.id=cv.establishment_id
    where s.auto_close_hours is not null and cv.operational_status='waiting_customer'
      and cv.last_message_at<=now()-make_interval(hours=>s.auto_close_hours)
    order by cv.last_message_at for update of cv skip locked
    limit least(greatest(requested_limit,1),2000)
  loop
    update public.whatsapp_conversations set status='resolved',human_controlled=false,unread_count=0,operational_status='resolved',resolved_at=now(),final_responsible_user_id=c.assigned_user_id,pending_assignee_id=null,assignment_expires_at=null where id=c.id;
    update public.support_assignment_history set status='completed',ended_at=now(),reason=coalesce(reason,'Encerramento automático por inatividade') where id=(select id from public.support_assignment_history where conversation_id=c.id and to_user_id=c.assigned_user_id and status in ('accepted','direct') order by offered_at desc limit 1);
    insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,event_type,metadata) values(c.organization_id,c.establishment_id,c.id,c.queue_id,'conversation_resolved',jsonb_build_object('automatic',true,'reason','customer_inactivity'));
    insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(c.establishment_id,null,'support.conversation_auto_closed','whatsapp_conversation',c.id,jsonb_build_object('queue_id',c.queue_id));
    processed:=processed+1;
  end loop;
  return processed;
end $$;

create or replace function public.process_support_capacity_alerts()
returns jsonb language plpgsql security definer set search_path='' as $$
declare q record; waiting_count integer; available_count integer; threshold integer; created_count integer:=0;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  for q in
    select sq.id,sq.organization_id,sq.store_id,sq.name from public.support_queues sq where sq.status='active' and sq.store_id is not null
  loop
    select count(*) into waiting_count from public.whatsapp_conversations where queue_id=q.id and operational_status in ('queued','assignment_pending');
    select count(*) into available_count from public.support_queue_members qm join public.support_agent_presence ap on ap.organization_id=q.organization_id and ap.user_id=qm.user_id where qm.queue_id=q.id and qm.active and ap.status='available' and ap.last_seen_at>now()-interval '5 minutes';
    select overload_queue_threshold into threshold from public.support_settings where establishment_id=q.store_id;
    threshold:=coalesce(threshold,10);
    if waiting_count>=threshold then
      insert into public.support_alerts(organization_id,establishment_id,queue_id,alert_type,severity,message,dedupe_key) values(q.organization_id,q.store_id,q.id,'queue_overload','warning',waiting_count||' clientes aguardando na fila '||q.name||'.','overload:'||q.id) on conflict do nothing;
      created_count:=created_count+1;
    else
      update public.support_alerts set status='resolved',resolved_at=now() where dedupe_key='overload:'||q.id and status='open';
    end if;
    if waiting_count>0 and available_count=0 then
      insert into public.support_alerts(organization_id,establishment_id,queue_id,alert_type,severity,message,dedupe_key) values(q.organization_id,q.store_id,q.id,'queue_without_agent','critical','Fila '||q.name||' sem atendente disponível.','no-agent:'||q.id) on conflict do nothing;
      created_count:=created_count+1;
    else
      update public.support_alerts set status='resolved',resolved_at=now() where dedupe_key='no-agent:'||q.id and status='open';
    end if;
  end loop;
  return jsonb_build_object('alerts_created_or_kept',created_count);
end $$;

create or replace function public.process_support_operations(requested_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare timed_out integer; sla jsonb; auto_closed integer; capacity jsonb;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  timed_out:=public.process_support_assignment_timeouts(requested_limit);
  sla:=public.process_support_sla(requested_limit);
  auto_closed:=public.process_support_auto_close(requested_limit);
  capacity:=public.process_support_capacity_alerts();
  return jsonb_build_object('assignment_timeouts',timed_out,'sla',sla,'auto_closed',auto_closed,'capacity',capacity);
end $$;

revoke all on function public.process_support_auto_close(integer),public.process_support_capacity_alerts(),public.process_support_operations(integer) from public,anon,authenticated;
grant execute on function public.process_support_auto_close(integer),public.process_support_capacity_alerts(),public.process_support_operations(integer) to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='masterapp-support-operations';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('masterapp-support-operations','* * * * *','select public.process_support_operations(500)');
end $$;
