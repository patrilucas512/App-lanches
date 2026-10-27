-- Phase 24 completion: automatic agent assignment with capacity and queue skills.
create or replace function private.assign_masterapp_support_ticket() returns trigger language plpgsql security definer set search_path='' as $$
declare strategy text; selected_agent uuid;
begin
 if new.assigned_to_user_id is not null or new.queue_id is null then return new; end if;
 select assignment_strategy into strategy from public.saas_support_queues where id=new.queue_id and active;
 if strategy is null or strategy='manual' then return new; end if;
 select a.user_id into selected_agent
 from public.saas_support_agents a join public.saas_support_agent_queues aq on aq.agent_user_id=a.user_id and aq.queue_id=new.queue_id
 where a.active and a.availability='available'
 and (select count(*) from public.support_tickets t where t.assigned_to_user_id=a.user_id and t.status not in('resolved','closed'))<a.max_tickets
 and (strategy<>'specialty' or new.category=any(a.skills))
 order by case when strategy='round_robin' then extract(epoch from coalesce(a.last_seen_at,'1970-01-01'::timestamptz)) else (select count(*) from public.support_tickets t where t.assigned_to_user_id=a.user_id and t.status not in('resolved','closed')) end,a.last_seen_at nulls first
 limit 1 for update of a skip locked;
 if selected_agent is not null then
  update public.support_tickets set assigned_to_user_id=selected_agent,assigned_to=selected_agent,status=case when status='open' then 'waiting_support' else status end,updated_at=now() where id=new.id;
  update public.saas_support_agents set last_seen_at=now() where user_id=selected_agent;
  insert into public.saas_support_notifications(organization_id,user_id,ticket_id,kind,title,body) values(new.organization_id,selected_agent,new.id,'ticket_assigned','Novo chamado atribuído',new.subject);
  insert into public.saas_support_audit_events(organization_id,ticket_id,actor_user_id,event_type,metadata) values(new.organization_id,new.id,null,'ticket_auto_assigned',jsonb_build_object('agent_user_id',selected_agent,'strategy',strategy,'queue_id',new.queue_id));
 end if;
 return new;
end$$;
revoke all on function private.assign_masterapp_support_ticket() from public,anon,authenticated;
drop trigger if exists support_ticket_auto_assignment on public.support_tickets;
create trigger support_ticket_auto_assignment after insert or update of queue_id on public.support_tickets for each row execute function private.assign_masterapp_support_ticket();
