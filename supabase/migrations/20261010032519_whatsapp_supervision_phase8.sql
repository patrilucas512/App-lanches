-- WhatsApp Phase 8: professional queues, assignment, SLA and supervision.
-- Existing conversations, members, permissions, CRM, AI and unit boundaries remain authoritative.

create table public.support_queues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 2 and 80),
  status text not null default 'active' check(status in ('active','paused','archived')),
  assignment_strategy text not null default 'least_load' check(assignment_strategy in ('least_load','round_robin','specialty','manual')),
  priority smallint not null default 100 check(priority between 1 and 999),
  sla_first_response_minutes integer not null default 5 check(sla_first_response_minutes between 1 and 10080),
  sla_resolution_minutes integer not null default 60 check(sla_resolution_minutes between 1 and 43200),
  sla_warning_percent smallint not null default 80 check(sla_warning_percent between 25 and 99),
  pause_sla_when text[] not null default array['waiting_customer','waiting_external'],
  auto_assignment_enabled boolean not null default true,
  require_acceptance boolean not null default false,
  acceptance_timeout_seconds integer not null default 60 check(acceptance_timeout_seconds between 15 and 600),
  centralized boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index support_queue_store_name_idx on public.support_queues(store_id,lower(name)) where store_id is not null and status<>'archived';
create unique index support_queue_org_name_idx on public.support_queues(organization_id,lower(name)) where store_id is null and status<>'archived';
create index support_queues_scope_idx on public.support_queues(organization_id,store_id,status,priority);

create table public.support_queue_members (
  queue_id uuid not null references public.support_queues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  max_concurrent_conversations integer not null default 5 check(max_concurrent_conversations between 1 and 100),
  assignment_weight smallint not null default 100 check(assignment_weight between 1 and 1000),
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(queue_id,user_id)
);
create index support_queue_members_agent_idx on public.support_queue_members(user_id,active,queue_id);

create table public.support_agent_presence (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid references public.establishments(id) on delete cascade,
  status text not null default 'offline' check(status in ('online','available','busy','away','offline','paused')),
  pause_reason text,
  available_since timestamptz,
  last_seen_at timestamptz not null default now(),
  shift_starts_at time, shift_ends_at time,
  timezone text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now(),
  primary key(organization_id,user_id)
);
create index support_agent_presence_available_idx on public.support_agent_presence(organization_id,store_id,status,last_seen_at desc);

create table public.support_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  advanced_queues_enabled boolean not null default false,
  default_assignment_strategy text not null default 'least_load' check(default_assignment_strategy in ('least_load','round_robin','specialty','manual')),
  reopen_window_hours integer not null default 24 check(reopen_window_hours between 1 and 720),
  auto_close_hours integer check(auto_close_hours between 1 and 720),
  send_close_message boolean not null default false,
  satisfaction_survey_enabled boolean not null default false,
  overload_queue_threshold integer not null default 10 check(overload_queue_threshold between 1 and 10000),
  sound_alerts_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_conversations
  add column queue_id uuid references public.support_queues(id) on delete set null,
  add column priority text not null default 'normal' check(priority in ('normal','high','urgent')),
  add column priority_source text,
  add column queued_at timestamptz,
  add column assigned_at timestamptz,
  add column pending_assignee_id uuid references auth.users(id) on delete set null,
  add column assignment_expires_at timestamptz,
  add column accepted_at timestamptz,
  add column first_response_at timestamptz,
  add column resolved_at timestamptz,
  add column operational_status text not null default 'ai' check(operational_status in ('ai','queued','assignment_pending','in_progress','waiting_customer','waiting_internal','waiting_external','resolved')),
  add column sla_paused_at timestamptz,
  add column sla_paused_seconds integer not null default 0,
  add column sla_warning_at timestamptz,
  add column sla_breached_at timestamptz,
  add column final_responsible_user_id uuid references auth.users(id) on delete set null,
  add column transfer_summary text;
create index whatsapp_conversations_queue_work_idx on public.whatsapp_conversations(queue_id,operational_status,priority,queued_at) where operational_status<>'resolved';
create index whatsapp_conversations_agent_work_idx on public.whatsapp_conversations(assigned_user_id,operational_status,last_message_at desc) where assigned_user_id is not null and operational_status<>'resolved';
create index whatsapp_conversations_sla_idx on public.whatsapp_conversations(establishment_id,queued_at) where operational_status in ('queued','assignment_pending','in_progress','waiting_internal');

create table public.support_conversation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  queue_id uuid references public.support_queues(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index support_events_conversation_idx on public.support_conversation_events(conversation_id,created_at desc,id desc);
create index support_events_reporting_idx on public.support_conversation_events(establishment_id,event_type,created_at desc);

create table public.support_assignment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  queue_id uuid references public.support_queues(id) on delete set null,
  from_user_id uuid references auth.users(id) on delete set null,
  to_user_id uuid references auth.users(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  status text not null check(status in ('offered','accepted','direct','declined','expired','transferred','completed')),
  reason text, offered_at timestamptz not null default now(), accepted_at timestamptz, ended_at timestamptz
);
create index support_assignment_history_idx on public.support_assignment_history(conversation_id,offered_at desc);
create index support_assignment_agent_idx on public.support_assignment_history(to_user_id,status,offered_at desc);

create table public.support_internal_notes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  content text not null check(char_length(btrim(content)) between 1 and 4000), mentioned_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index support_notes_conversation_idx on public.support_internal_notes(conversation_id,created_at desc);

create table public.support_quality_reviews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  agent_user_id uuid references auth.users(id) on delete set null, reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  rating text not null check(rating in ('excellent','adequate','needs_improvement')), comment text,
  ai_signals jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(conversation_id,reviewer_user_id)
);
create index support_quality_agent_idx on public.support_quality_reviews(establishment_id,agent_user_id,created_at desc);

create table public.support_satisfaction_ratings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  agent_user_id uuid references auth.users(id) on delete set null,
  rating smallint not null check(rating between 1 and 5), source text not null default 'whatsapp', comment text,
  created_at timestamptz not null default now(), unique(conversation_id)
);

create table public.support_alerts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete cascade, queue_id uuid references public.support_queues(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade, agent_user_id uuid references auth.users(id) on delete cascade,
  alert_type text not null, severity text not null check(severity in ('warning','critical')), message text not null,
  status text not null default 'open' check(status in ('open','acknowledged','resolved')), dedupe_key text not null,
  created_at timestamptz not null default now(), acknowledged_at timestamptz, resolved_at timestamptz
);
create unique index support_alerts_open_dedupe_idx on public.support_alerts(dedupe_key) where status='open';
create index support_alerts_scope_idx on public.support_alerts(organization_id,establishment_id,status,created_at desc);

alter table public.whatsapp_member_permissions
  add column can_view_queue boolean not null default false,
  add column can_transfer boolean not null default false,
  add column can_change_priority boolean not null default false,
  add column can_view_supervision boolean not null default false,
  add column can_monitor boolean not null default false,
  add column can_take_over boolean not null default false,
  add column can_configure_sla boolean not null default false,
  add column can_configure_queues boolean not null default false,
  add column can_view_productivity boolean not null default false,
  add column can_review_quality boolean not null default false;

create or replace function public.set_whatsapp_member_permissions(requested_establishment_id uuid, requested_user_id uuid, requested_permissions jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente administradores podem alterar permissões.'; end if;
  if not exists(select 1 from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id) then raise exception 'Funcionário não pertence ao estabelecimento.'; end if;
  insert into public.whatsapp_member_permissions(establishment_id,user_id,can_view,can_respond,can_claim,can_resolve,can_configure,can_view_queue,can_transfer,can_change_priority,can_view_supervision,can_monitor,can_take_over,can_configure_sla,can_configure_queues,can_view_productivity,can_review_quality)
  values(requested_establishment_id,requested_user_id,coalesce((requested_permissions->>'can_view')::boolean,false),coalesce((requested_permissions->>'can_respond')::boolean,false),coalesce((requested_permissions->>'can_claim')::boolean,false),coalesce((requested_permissions->>'can_resolve')::boolean,false),coalesce((requested_permissions->>'can_configure')::boolean,false),coalesce((requested_permissions->>'can_view_queue')::boolean,false),coalesce((requested_permissions->>'can_transfer')::boolean,false),coalesce((requested_permissions->>'can_change_priority')::boolean,false),coalesce((requested_permissions->>'can_view_supervision')::boolean,false),coalesce((requested_permissions->>'can_monitor')::boolean,false),coalesce((requested_permissions->>'can_take_over')::boolean,false),coalesce((requested_permissions->>'can_configure_sla')::boolean,false),coalesce((requested_permissions->>'can_configure_queues')::boolean,false),coalesce((requested_permissions->>'can_view_productivity')::boolean,false),coalesce((requested_permissions->>'can_review_quality')::boolean,false))
  on conflict(establishment_id,user_id) do update set can_view=excluded.can_view,can_respond=excluded.can_respond,can_claim=excluded.can_claim,can_resolve=excluded.can_resolve,can_configure=excluded.can_configure,can_view_queue=excluded.can_view_queue,can_transfer=excluded.can_transfer,can_change_priority=excluded.can_change_priority,can_view_supervision=excluded.can_view_supervision,can_monitor=excluded.can_monitor,can_take_over=excluded.can_take_over,can_configure_sla=excluded.can_configure_sla,can_configure_queues=excluded.can_configure_queues,can_view_productivity=excluded.can_view_productivity,can_review_quality=excluded.can_review_quality;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'whatsapp.permissions_updated','profile',requested_user_id,requested_permissions);
end $$;

create or replace function private.has_support_permission(target_establishment uuid, requested_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (
    private.has_role(target_establishment,array['owner','manager']::public.member_role[])
    or exists(select 1 from public.whatsapp_member_permissions p where p.establishment_id=target_establishment and p.user_id=(select auth.uid()) and
      case requested_permission when 'view_queue' then p.can_view_queue or p.can_view when 'attend' then p.can_respond
      when 'transfer' then p.can_transfer when 'priority' then p.can_change_priority when 'supervision' then p.can_view_supervision
      when 'monitor' then p.can_monitor when 'take_over' then p.can_take_over when 'configure_sla' then p.can_configure_sla
      when 'configure_queues' then p.can_configure_queues when 'productivity' then p.can_view_productivity
      when 'quality' then p.can_review_quality else false end)
  )
$$;
revoke all on function private.has_support_permission(uuid,text) from public,anon;
grant execute on function private.has_support_permission(uuid,text) to authenticated;

alter table public.support_queues enable row level security;
alter table public.support_queue_members enable row level security;
alter table public.support_agent_presence enable row level security;
alter table public.support_settings enable row level security;
alter table public.support_conversation_events enable row level security;
alter table public.support_assignment_history enable row level security;
alter table public.support_internal_notes enable row level security;
alter table public.support_quality_reviews enable row level security;
alter table public.support_satisfaction_ratings enable row level security;
alter table public.support_alerts enable row level security;

create policy support_queues_read on public.support_queues for select to authenticated using((store_id is not null and private.has_support_permission(store_id,'view_queue')) or private.has_organization_role(organization_id,array['owner','admin','supervisor']) or exists(select 1 from public.support_queue_members qm where qm.queue_id=id and qm.user_id=(select auth.uid()) and qm.active));
create policy support_queue_members_read on public.support_queue_members for select to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.support_queues q where q.id=queue_id and ((q.store_id is not null and private.has_support_permission(q.store_id,'supervision')) or private.has_organization_role(q.organization_id,array['owner','admin','supervisor']))));
create policy support_presence_read on public.support_agent_presence for select to authenticated using(user_id=(select auth.uid()) or (store_id is not null and private.has_support_permission(store_id,'supervision')) or private.has_organization_role(organization_id,array['owner','admin','supervisor']));
create policy support_settings_read on public.support_settings for select to authenticated using(private.has_support_permission(establishment_id,'view_queue'));
create policy support_events_read on public.support_conversation_events for select to authenticated using(private.has_support_permission(establishment_id,'view_queue'));
create policy support_assignments_read on public.support_assignment_history for select to authenticated using(to_user_id=(select auth.uid()) or from_user_id=(select auth.uid()) or private.has_support_permission(establishment_id,'supervision'));
create policy support_notes_read on public.support_internal_notes for select to authenticated using(private.has_support_permission(establishment_id,'view_queue'));
create policy support_quality_read on public.support_quality_reviews for select to authenticated using(agent_user_id=(select auth.uid()) or private.has_support_permission(establishment_id,'quality'));
create policy support_ratings_read on public.support_satisfaction_ratings for select to authenticated using(agent_user_id=(select auth.uid()) or private.has_support_permission(establishment_id,'productivity'));
create policy support_alerts_read on public.support_alerts for select to authenticated using((establishment_id is not null and private.has_support_permission(establishment_id,'supervision')) or private.has_organization_role(organization_id,array['owner','admin','supervisor']));

revoke all on public.support_queues,public.support_queue_members,public.support_agent_presence,public.support_settings,public.support_conversation_events,public.support_assignment_history,public.support_internal_notes,public.support_quality_reviews,public.support_satisfaction_ratings,public.support_alerts from public,anon;
grant select on public.support_queues,public.support_queue_members,public.support_agent_presence,public.support_settings,public.support_conversation_events,public.support_assignment_history,public.support_internal_notes,public.support_quality_reviews,public.support_satisfaction_ratings,public.support_alerts to authenticated;

drop policy if exists whatsapp_conversations_read on public.whatsapp_conversations;
create policy whatsapp_conversations_read on public.whatsapp_conversations for select to authenticated using(
  private.has_role(establishment_id,array['owner','manager']::public.member_role[])
  or not coalesce((select advanced_queues_enabled from public.support_settings s where s.establishment_id=whatsapp_conversations.establishment_id),false) and private.has_whatsapp_permission(establishment_id,'view')
  or assigned_user_id=(select auth.uid()) or pending_assignee_id=(select auth.uid())
  or exists(select 1 from public.support_queue_members qm where qm.queue_id=whatsapp_conversations.queue_id and qm.user_id=(select auth.uid()) and qm.active)
);
drop policy if exists whatsapp_messages_read on public.whatsapp_messages;
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated using(
  exists(select 1 from public.whatsapp_conversations cv where cv.id=whatsapp_messages.conversation_id)
);

create or replace function public.ensure_default_support_queue(requested_establishment_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare org_id uuid; queue_record uuid;
begin
  select organization_id into org_id from public.establishments where id=requested_establishment_id;
  if org_id is null then raise exception 'Unidade não encontrada.'; end if;
  if current_user not in ('service_role','postgres') and not private.has_support_permission(requested_establishment_id,'view_queue') then raise exception 'Sem acesso à fila.'; end if;
  select id into queue_record from public.support_queues where store_id=requested_establishment_id and status='active' order by priority,id limit 1;
  if queue_record is null then
    insert into public.support_queues(organization_id,store_id,name,assignment_strategy,auto_assignment_enabled,created_by)
      values(org_id,requested_establishment_id,'Atendimento Geral','least_load',true,(select auth.uid())) returning id into queue_record;
    insert into public.support_queue_members(queue_id,user_id,max_concurrent_conversations)
      select queue_record,m.user_id,5 from public.establishment_members m where m.establishment_id=requested_establishment_id and m.status='active' and m.role in ('owner','manager','attendant') on conflict do nothing;
  end if;
  return queue_record;
end $$;

insert into public.support_settings(establishment_id) select id from public.establishments on conflict do nothing;
do $$ declare e record; qid uuid; begin for e in select id from public.establishments loop qid:=public.ensure_default_support_queue(e.id); end loop; end $$;

create or replace function private.try_assign_support_conversation(requested_conversation_id uuid, excluded_user_id uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; q public.support_queues%rowtype; candidate uuid; active_count integer; accepted boolean;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.id is null or c.queue_id is null then return false; end if;
  select * into q from public.support_queues where id=c.queue_id and status='active';
  if q.id is null or not q.auto_assignment_enabled or q.assignment_strategy='manual' then return false; end if;
  select qm.user_id,load.active_count into candidate,active_count
  from public.support_queue_members qm
  join public.support_agent_presence ap on ap.organization_id=q.organization_id and ap.user_id=qm.user_id and ap.status in ('available','busy') and ap.last_seen_at>now()-interval '5 minutes'
  cross join lateral(select count(*)::integer active_count from public.whatsapp_conversations cv where cv.assigned_user_id=qm.user_id and cv.operational_status in ('in_progress','waiting_customer','waiting_internal','waiting_external')) load
  where qm.queue_id=q.id and qm.active and (excluded_user_id is null or qm.user_id<>excluded_user_id)
    and (q.store_id is null or ap.store_id is null or ap.store_id=q.store_id)
    and (ap.shift_starts_at is null or ap.shift_ends_at is null or case when ap.shift_starts_at<=ap.shift_ends_at then localtime between ap.shift_starts_at and ap.shift_ends_at else localtime>=ap.shift_starts_at or localtime<=ap.shift_ends_at end)
    and load.active_count<qm.max_concurrent_conversations
  order by case when q.assignment_strategy='round_robin' then extract(epoch from coalesce(qm.last_assigned_at,'epoch'::timestamptz)) else load.active_count end asc,qm.assignment_weight desc,qm.user_id
  limit 1 for update of qm skip locked;
  if candidate is null then return false; end if;
  accepted:=not q.require_acceptance;
  update public.whatsapp_conversations set human_controlled=true,status=case when accepted then 'open' else 'waiting' end,
    assigned_user_id=case when accepted then candidate else null end,pending_assignee_id=case when accepted then null else candidate end,
    assigned_at=case when accepted then now() else assigned_at end,accepted_at=case when accepted then now() else null end,
    assignment_expires_at=case when accepted then null else now()+make_interval(secs=>q.acceptance_timeout_seconds) end,
    operational_status=case when accepted then 'in_progress' else 'assignment_pending' end where id=c.id;
  update public.support_queue_members set last_assigned_at=now(),updated_at=now() where queue_id=q.id and user_id=candidate;
  insert into public.support_assignment_history(organization_id,establishment_id,conversation_id,queue_id,to_user_id,status)
    values(q.organization_id,c.establishment_id,c.id,q.id,candidate,case when accepted then 'direct' else 'offered' end);
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type,metadata)
    values(q.organization_id,c.establishment_id,c.id,q.id,null,'conversation_assigned',jsonb_build_object('user_id',candidate,'acceptance_required',not accepted,'strategy',q.assignment_strategy));
  return true;
end $$;

create or replace function public.enqueue_support_conversation(requested_conversation_id uuid,requested_queue_id uuid default null,requested_priority text default 'normal',requested_source text default 'manual')
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; qid uuid; org_id uuid; assigned boolean;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.id is null then raise exception 'Conversa não encontrada.'; end if;
  if current_user not in ('service_role','postgres') and not private.has_support_permission(c.establishment_id,'attend') then raise exception 'Sem permissão para encaminhar atendimento.'; end if;
  if requested_priority not in ('normal','high','urgent') then raise exception 'Prioridade inválida.'; end if;
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  qid:=coalesce(requested_queue_id,public.ensure_default_support_queue(c.establishment_id));
  if not exists(select 1 from public.support_queues q where q.id=qid and q.organization_id=org_id and q.status='active' and (q.store_id is null or q.store_id=c.establishment_id)) then raise exception 'Fila inválida para esta conversa.'; end if;
  update public.whatsapp_conversations set queue_id=qid,priority=requested_priority,priority_source=requested_source,queued_at=now(),assigned_user_id=null,pending_assignee_id=null,assignment_expires_at=null,accepted_at=null,human_controlled=true,status='waiting',operational_status='queued',sla_warning_at=null,sla_breached_at=null where id=c.id;
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type,metadata)
    values(org_id,c.establishment_id,c.id,qid,(select auth.uid()),'conversation_queued',jsonb_build_object('priority',requested_priority,'source',requested_source));
  assigned:=private.try_assign_support_conversation(c.id,null);
  return jsonb_build_object('conversation_id',c.id,'queue_id',qid,'assigned',assigned);
end $$;

create or replace function public.set_support_agent_presence(requested_organization_id uuid,requested_store_id uuid,requested_status text,requested_pause_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); saved public.support_agent_presence%rowtype;
begin
  if actor is null or requested_status not in ('online','available','busy','away','offline','paused') then raise exception 'Presença inválida.'; end if;
  if not private.has_store_access(requested_store_id) or not exists(select 1 from public.establishments where id=requested_store_id and organization_id=requested_organization_id) then raise exception 'Unidade não autorizada.'; end if;
  insert into public.support_agent_presence(organization_id,user_id,store_id,status,pause_reason,available_since,last_seen_at)
    values(requested_organization_id,actor,requested_store_id,requested_status,case when requested_status='paused' then nullif(btrim(requested_pause_reason),'') else null end,case when requested_status='available' then now() else null end,now())
  on conflict(organization_id,user_id) do update set store_id=excluded.store_id,status=excluded.status,pause_reason=excluded.pause_reason,available_since=case when excluded.status='available' then coalesce(public.support_agent_presence.available_since,now()) else null end,last_seen_at=now(),updated_at=now() returning * into saved;
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,actor_id,event_type,metadata)
    values(requested_organization_id,requested_store_id,null,actor,'agent_status_changed',jsonb_build_object('status',requested_status,'pause_reason',saved.pause_reason));
  return jsonb_build_object('status',saved.status,'pause_reason',saved.pause_reason,'last_seen_at',saved.last_seen_at);
end $$;

create or replace function public.accept_support_assignment(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; actor uuid:=(select auth.uid()); org_id uuid;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.pending_assignee_id<>actor or c.assignment_expires_at<=now() then raise exception 'Oferta expirada ou destinada a outro atendente.'; end if;
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  update public.whatsapp_conversations set assigned_user_id=actor,pending_assignee_id=null,assignment_expires_at=null,assigned_at=now(),accepted_at=now(),status='open',human_controlled=true,operational_status='in_progress' where id=c.id;
  update public.support_assignment_history set status='accepted',accepted_at=now() where id=(select id from public.support_assignment_history where conversation_id=c.id and to_user_id=actor and status='offered' order by offered_at desc limit 1);
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type) values(org_id,c.establishment_id,c.id,c.queue_id,actor,'conversation_accepted');
end $$;

create or replace function public.process_support_assignment_timeouts(requested_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare c record; processed integer:=0; expired_user uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  for c in select id,establishment_id,queue_id,pending_assignee_id from public.whatsapp_conversations where operational_status='assignment_pending' and assignment_expires_at<=now() order by assignment_expires_at for update skip locked limit least(greatest(requested_limit,1),500) loop
    expired_user:=c.pending_assignee_id;
    update public.whatsapp_conversations set pending_assignee_id=null,assignment_expires_at=null,operational_status='queued' where id=c.id;
    update public.support_assignment_history set status='expired',ended_at=now() where id=(select id from public.support_assignment_history where conversation_id=c.id and to_user_id=expired_user and status='offered' order by offered_at desc limit 1);
    perform private.try_assign_support_conversation(c.id,expired_user); processed:=processed+1;
  end loop; return processed;
end $$;

create or replace function public.transfer_support_conversation(requested_conversation_id uuid,requested_queue_id uuid,requested_user_id uuid default null,requested_reason text default null,requested_summary text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; q public.support_queues%rowtype; actor uuid:=(select auth.uid()); org_id uuid;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.id is null or not private.has_support_permission(c.establishment_id,'transfer') then raise exception 'Sem permissão para transferir.'; end if;
  select * into q from public.support_queues where id=requested_queue_id and status='active';
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  if q.id is null or q.organization_id<>org_id or (q.store_id is not null and q.store_id<>c.establishment_id) then raise exception 'Fila de destino inválida.'; end if;
  if requested_user_id is not null and not exists(select 1 from public.support_queue_members where queue_id=q.id and user_id=requested_user_id and active) then raise exception 'Atendente não pertence à fila.'; end if;
  insert into public.support_assignment_history(organization_id,establishment_id,conversation_id,queue_id,from_user_id,to_user_id,assigned_by,status,reason)
    values(org_id,c.establishment_id,c.id,q.id,c.assigned_user_id,requested_user_id,actor,'transferred',nullif(btrim(requested_reason),''));
  update public.whatsapp_conversations set queue_id=q.id,assigned_user_id=requested_user_id,pending_assignee_id=null,assignment_expires_at=null,assigned_at=case when requested_user_id is null then null else now() end,accepted_at=case when requested_user_id is null then null else now() end,operational_status=case when requested_user_id is null then 'queued' else 'in_progress' end,status=case when requested_user_id is null then 'waiting' else 'open' end,human_controlled=true,transfer_summary=nullif(btrim(requested_summary),'') where id=c.id;
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type,metadata) values(org_id,c.establishment_id,c.id,q.id,actor,'conversation_transferred',jsonb_build_object('from_user_id',c.assigned_user_id,'to_user_id',requested_user_id,'reason',requested_reason,'summary',requested_summary));
  if requested_user_id is null then perform private.try_assign_support_conversation(c.id,c.assigned_user_id); end if;
end $$;

create or replace function public.add_support_internal_note(requested_conversation_id uuid,requested_content text,requested_mentions uuid[] default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; org_id uuid; saved_id uuid;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id;
  if c.id is null or not private.has_support_permission(c.establishment_id,'attend') then raise exception 'Sem permissão para anotar.'; end if;
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  if nullif(btrim(requested_content),'') is null then raise exception 'Nota vazia.'; end if;
  insert into public.support_internal_notes(organization_id,establishment_id,conversation_id,author_id,content,mentioned_user_ids) values(org_id,c.establishment_id,c.id,(select auth.uid()),btrim(requested_content),coalesce(requested_mentions,'{}')) returning id into saved_id;
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type,metadata) values(org_id,c.establishment_id,c.id,c.queue_id,(select auth.uid()),'internal_note_added',jsonb_build_object('note_id',saved_id,'mentions',requested_mentions));
  return saved_id;
end $$;

create or replace function public.update_support_conversation(requested_conversation_id uuid,requested_priority text default null,requested_operational_status text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; org_id uuid;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.id is null then raise exception 'Conversa não encontrada.'; end if;
  if requested_priority is not null and (requested_priority not in ('normal','high','urgent') or not private.has_support_permission(c.establishment_id,'priority')) then raise exception 'Prioridade inválida ou não autorizada.'; end if;
  if requested_operational_status is not null and (requested_operational_status not in ('in_progress','waiting_customer','waiting_internal','waiting_external') or not private.has_support_permission(c.establishment_id,'attend')) then raise exception 'Status inválido ou não autorizado.'; end if;
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  update public.whatsapp_conversations set priority=coalesce(requested_priority,priority),priority_source=case when requested_priority is null then priority_source else 'human' end,operational_status=coalesce(requested_operational_status,operational_status),sla_paused_at=case when requested_operational_status in ('waiting_customer','waiting_external') then coalesce(sla_paused_at,now()) else null end where id=c.id;
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type,metadata) values(org_id,c.establishment_id,c.id,c.queue_id,(select auth.uid()),case when requested_priority is not null then 'conversation_priority_changed' else 'conversation_status_changed' end,jsonb_build_object('priority',requested_priority,'status',requested_operational_status));
end $$;

create or replace function public.record_support_human_response(requested_conversation_id uuid,requested_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; org_id uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.id is null or c.assigned_user_id<>requested_user_id then return; end if;
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  if c.first_response_at is null then update public.whatsapp_conversations set first_response_at=now(),operational_status='in_progress' where id=c.id; insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type) values(org_id,c.establishment_id,c.id,c.queue_id,requested_user_id,'conversation_first_response'); end if;
end $$;

create or replace function public.process_support_sla(requested_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; warnings integer:=0; breaches integer:=0; elapsed_seconds numeric; first_limit numeric; resolution_limit numeric;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  for c in select cv.*,q.sla_first_response_minutes,q.sla_resolution_minutes,q.sla_warning_percent,e.organization_id from public.whatsapp_conversations cv join public.support_queues q on q.id=cv.queue_id join public.establishments e on e.id=cv.establishment_id where cv.queued_at is not null and cv.operational_status in ('queued','assignment_pending','in_progress','waiting_internal') order by cv.queued_at for update of cv skip locked limit least(greatest(requested_limit,1),2000) loop
    elapsed_seconds:=extract(epoch from(now()-c.queued_at))-c.sla_paused_seconds;
    first_limit:=c.sla_first_response_minutes*60; resolution_limit:=c.sla_resolution_minutes*60;
    if c.first_response_at is null and elapsed_seconds>=first_limit and c.sla_breached_at is null then
      update public.whatsapp_conversations set sla_breached_at=now() where id=c.id;
      insert into public.support_alerts(organization_id,establishment_id,queue_id,conversation_id,alert_type,severity,message,dedupe_key) values(c.organization_id,c.establishment_id,c.queue_id,c.id,'first_response_sla','critical','SLA de primeira resposta ultrapassado.','sla:first:'||c.id) on conflict do nothing; breaches:=breaches+1;
      insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,event_type) values(c.organization_id,c.establishment_id,c.id,c.queue_id,'conversation_sla_breached');
    elsif c.first_response_at is null and elapsed_seconds>=first_limit*c.sla_warning_percent/100 and c.sla_warning_at is null then
      update public.whatsapp_conversations set sla_warning_at=now() where id=c.id;
      insert into public.support_alerts(organization_id,establishment_id,queue_id,conversation_id,alert_type,severity,message,dedupe_key) values(c.organization_id,c.establishment_id,c.queue_id,c.id,'first_response_sla','warning','SLA de primeira resposta próximo do limite.','sla:warning:'||c.id) on conflict do nothing; warnings:=warnings+1;
      insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,event_type) values(c.organization_id,c.establishment_id,c.id,c.queue_id,'conversation_sla_warning');
    elsif elapsed_seconds>=resolution_limit and c.sla_breached_at is null then
      update public.whatsapp_conversations set sla_breached_at=now() where id=c.id;
      insert into public.support_alerts(organization_id,establishment_id,queue_id,conversation_id,alert_type,severity,message,dedupe_key) values(c.organization_id,c.establishment_id,c.queue_id,c.id,'resolution_sla','critical','SLA de resolução ultrapassado.','sla:resolution:'||c.id) on conflict do nothing; breaches:=breaches+1;
    end if;
  end loop; return jsonb_build_object('warnings',warnings,'breaches',breaches);
end $$;

create or replace function public.get_support_supervision_dashboard(requested_establishment_id uuid,requested_period_days integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_support_permission(requested_establishment_id,'supervision') then raise exception 'Sem permissão para visualizar a supervisão.'; end if;
  select jsonb_build_object(
    'totals',jsonb_build_object(
      'waiting',count(*) filter(where cv.operational_status in ('queued','assignment_pending')),
      'active',count(*) filter(where cv.operational_status in ('in_progress','waiting_customer','waiting_internal','waiting_external')),
      'ai',count(*) filter(where cv.operational_status='ai'),
      'late',count(*) filter(where cv.sla_breached_at is not null and cv.resolved_at is null),
      'resolved_today',count(*) filter(where cv.resolved_at>=current_date),
      'available_agents',(select count(*) from public.support_agent_presence ap where ap.store_id=requested_establishment_id and ap.status='available' and ap.last_seen_at>now()-interval '5 minutes')),
    'queues',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'strategy',q.assignment_strategy,'waiting',(select count(*) from public.whatsapp_conversations x where x.queue_id=q.id and x.operational_status in ('queued','assignment_pending')),'active',(select count(*) from public.whatsapp_conversations x where x.queue_id=q.id and x.operational_status in ('in_progress','waiting_customer','waiting_internal','waiting_external')),'agents',(select count(*) from public.support_queue_members qm where qm.queue_id=q.id and qm.active)) order by q.priority,q.name),'[]'::jsonb) from public.support_queues q where q.status='active' and (q.store_id=requested_establishment_id or q.store_id is null and q.organization_id=(select organization_id from public.establishments where id=requested_establishment_id))),
    'agents',(select coalesce(jsonb_agg(jsonb_build_object('user_id',ap.user_id,'name',coalesce(p.full_name,'Atendente'),'status',ap.status,'pause_reason',ap.pause_reason,'active_conversations',(select count(*) from public.whatsapp_conversations x where x.assigned_user_id=ap.user_id and x.operational_status in ('in_progress','waiting_customer','waiting_internal','waiting_external')),'resolved',(select count(*) from public.support_assignment_history ah where ah.to_user_id=ap.user_id and ah.status='completed' and ah.ended_at>=now()-make_interval(days=>least(greatest(requested_period_days,1),30)))) order by p.full_name),'[]'::jsonb) from public.support_agent_presence ap left join public.profiles p on p.id=ap.user_id where ap.organization_id=(select organization_id from public.establishments where id=requested_establishment_id) and (ap.store_id=requested_establishment_id or ap.store_id is null)),
    'alerts',(select coalesce(jsonb_agg(a order by a.created_at desc),'[]'::jsonb) from (select id,alert_type,severity,message,conversation_id,queue_id,created_at from public.support_alerts where establishment_id=requested_establishment_id and status='open' order by created_at desc limit 30)a),
    'conversations',(select coalesce(jsonb_agg(c order by c.last_message_at desc),'[]'::jsonb) from (select cv.id,cv.status,cv.operational_status,cv.priority,cv.queue_id,cv.assigned_user_id,cv.pending_assignee_id,cv.queued_at,cv.first_response_at,cv.resolved_at,cv.sla_warning_at,cv.sla_breached_at,cv.last_message_preview,cv.last_message_at,wc.name,wc.profile_name,wc.phone_number from public.whatsapp_conversations cv join public.whatsapp_contacts wc on wc.id=cv.contact_id where cv.establishment_id=requested_establishment_id order by cv.last_message_at desc limit 100)c)
  ) into result from public.whatsapp_conversations cv where cv.establishment_id=requested_establishment_id;
  return result;
end $$;

create or replace function public.get_support_productivity(requested_establishment_id uuid,requested_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_support_permission(requested_establishment_id,'productivity') then raise exception 'Sem permissão para produtividade.'; end if;
  return (select coalesce(jsonb_agg(x order by x.resolved desc,x.agent_name),'[]'::jsonb) from (
    select ah.to_user_id,coalesce(p.full_name,'Atendente') agent_name,count(distinct ah.conversation_id) received,
      count(distinct ah.conversation_id) filter(where ah.status='completed') resolved,
      count(*) filter(where ah.status='transferred') transfers,
      round(avg(extract(epoch from(cv.first_response_at-cv.queued_at))/60) filter(where cv.first_response_at is not null),1) avg_first_response_minutes,
      round(avg(extract(epoch from(cv.resolved_at-cv.queued_at))/60) filter(where cv.resolved_at is not null),1) avg_resolution_minutes,
      count(distinct cv.id) filter(where cv.sla_breached_at is null and cv.resolved_at is not null) sla_met,
      count(distinct cv.id) filter(where cv.sla_breached_at is not null) sla_breached,
      round(avg(sr.rating),2) satisfaction,round(avg(case qr.rating when 'excellent' then 3 when 'adequate' then 2 else 1 end),2) quality_score
    from public.support_assignment_history ah join public.whatsapp_conversations cv on cv.id=ah.conversation_id left join public.profiles p on p.id=ah.to_user_id left join public.support_satisfaction_ratings sr on sr.conversation_id=cv.id left join public.support_quality_reviews qr on qr.conversation_id=cv.id and qr.agent_user_id=ah.to_user_id
    where ah.establishment_id=requested_establishment_id and ah.offered_at>=now()-make_interval(days=>least(greatest(requested_days,1),30)) and ah.to_user_id is not null group by ah.to_user_id,p.full_name
  )x);
end $$;

create or replace function public.review_support_conversation(requested_conversation_id uuid,requested_rating text,requested_comment text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; org_id uuid; saved_id uuid;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id;
  if c.id is null or not private.has_support_permission(c.establishment_id,'quality') or requested_rating not in ('excellent','adequate','needs_improvement') then raise exception 'Avaliação inválida ou não autorizada.'; end if;
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  insert into public.support_quality_reviews(organization_id,establishment_id,conversation_id,agent_user_id,reviewer_user_id,rating,comment) values(org_id,c.establishment_id,c.id,c.final_responsible_user_id,(select auth.uid()),requested_rating,nullif(btrim(requested_comment),'')) on conflict(conversation_id,reviewer_user_id) do update set rating=excluded.rating,comment=excluded.comment,updated_at=now() returning id into saved_id;
  return saved_id;
end $$;

create or replace function public.configure_support_queue(requested_establishment_id uuid,requested_queue_id uuid,requested_name text,requested_strategy text,requested_first_sla integer,requested_resolution_sla integer,requested_auto_assignment boolean,requested_require_acceptance boolean,requested_acceptance_timeout integer,requested_centralized boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare org_id uuid; saved_id uuid;
begin
  if not private.has_support_permission(requested_establishment_id,'configure_queues') then raise exception 'Sem permissão para configurar filas.'; end if;
  if requested_strategy not in ('least_load','round_robin','specialty','manual') then raise exception 'Estratégia inválida.'; end if;
  select organization_id into org_id from public.establishments where id=requested_establishment_id;
  if requested_queue_id is null then
    insert into public.support_queues(organization_id,store_id,name,assignment_strategy,sla_first_response_minutes,sla_resolution_minutes,auto_assignment_enabled,require_acceptance,acceptance_timeout_seconds,centralized,created_by)
      values(org_id,case when requested_centralized then null else requested_establishment_id end,btrim(requested_name),requested_strategy,requested_first_sla,requested_resolution_sla,requested_auto_assignment,requested_require_acceptance,requested_acceptance_timeout,requested_centralized,(select auth.uid())) returning id into saved_id;
  else
    update public.support_queues set name=btrim(requested_name),assignment_strategy=requested_strategy,sla_first_response_minutes=requested_first_sla,sla_resolution_minutes=requested_resolution_sla,auto_assignment_enabled=requested_auto_assignment,require_acceptance=requested_require_acceptance,acceptance_timeout_seconds=requested_acceptance_timeout,updated_at=now() where id=requested_queue_id and store_id=requested_establishment_id returning id into saved_id;
  end if;
  if saved_id is null then raise exception 'Fila não encontrada.'; end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'support.queue_configured','support_queue',saved_id,jsonb_build_object('strategy',requested_strategy,'first_sla',requested_first_sla,'resolution_sla',requested_resolution_sla));
  return saved_id;
end $$;

create or replace function public.configure_support_agent_shift(requested_establishment_id uuid,requested_user_id uuid,requested_shift_start time,requested_shift_end time,requested_timezone text default 'America/Sao_Paulo')
returns void language plpgsql security definer set search_path='' as $$
declare org_id uuid;
begin
  if (select auth.uid())<>requested_user_id and not private.has_support_permission(requested_establishment_id,'configure_queues') then raise exception 'Sem permissão para configurar o turno.'; end if;
  select organization_id into org_id from public.establishments where id=requested_establishment_id;
  if not exists(select 1 from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id and status='active') then raise exception 'Funcionário não pertence à unidade.'; end if;
  insert into public.support_agent_presence(organization_id,user_id,store_id,status,shift_starts_at,shift_ends_at,timezone)
    values(org_id,requested_user_id,requested_establishment_id,'offline',requested_shift_start,requested_shift_end,coalesce(nullif(requested_timezone,''),'America/Sao_Paulo'))
  on conflict(organization_id,user_id) do update set store_id=excluded.store_id,shift_starts_at=excluded.shift_starts_at,shift_ends_at=excluded.shift_ends_at,timezone=excluded.timezone,updated_at=now();
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'support.agent_shift_updated','profile',requested_user_id,jsonb_build_object('starts_at',requested_shift_start,'ends_at',requested_shift_end,'timezone',requested_timezone));
end $$;

create or replace function public.set_support_queue_member(requested_establishment_id uuid,requested_queue_id uuid,requested_user_id uuid,requested_active boolean,requested_max_concurrent integer default 5)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_support_permission(requested_establishment_id,'configure_queues') then raise exception 'Sem permissão para configurar a equipe da fila.'; end if;
  if not exists(select 1 from public.support_queues where id=requested_queue_id and (store_id=requested_establishment_id or store_id is null and organization_id=(select organization_id from public.establishments where id=requested_establishment_id))) then raise exception 'Fila inválida.'; end if;
  if not exists(select 1 from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id and status='active') then raise exception 'Funcionário não pertence à unidade.'; end if;
  insert into public.support_queue_members(queue_id,user_id,active,max_concurrent_conversations) values(requested_queue_id,requested_user_id,requested_active,requested_max_concurrent) on conflict(queue_id,user_id) do update set active=excluded.active,max_concurrent_conversations=excluded.max_concurrent_conversations,updated_at=now();
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'support.queue_member_updated','profile',requested_user_id,jsonb_build_object('queue_id',requested_queue_id,'active',requested_active,'max_concurrent',requested_max_concurrent));
end $$;

create or replace function public.configure_support_settings(requested_establishment_id uuid,requested_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_support_permission(requested_establishment_id,'configure_sla') then raise exception 'Sem permissão para configurar atendimento.'; end if;
  insert into public.support_settings(establishment_id,advanced_queues_enabled,default_assignment_strategy,reopen_window_hours,auto_close_hours,send_close_message,satisfaction_survey_enabled,overload_queue_threshold,sound_alerts_enabled)
  values(requested_establishment_id,coalesce((requested_settings->>'advanced_queues_enabled')::boolean,false),coalesce(nullif(requested_settings->>'default_assignment_strategy',''),'least_load'),coalesce((requested_settings->>'reopen_window_hours')::integer,24),nullif(requested_settings->>'auto_close_hours','')::integer,coalesce((requested_settings->>'send_close_message')::boolean,false),coalesce((requested_settings->>'satisfaction_survey_enabled')::boolean,false),coalesce((requested_settings->>'overload_queue_threshold')::integer,10),coalesce((requested_settings->>'sound_alerts_enabled')::boolean,true))
  on conflict(establishment_id) do update set advanced_queues_enabled=excluded.advanced_queues_enabled,default_assignment_strategy=excluded.default_assignment_strategy,reopen_window_hours=excluded.reopen_window_hours,auto_close_hours=excluded.auto_close_hours,send_close_message=excluded.send_close_message,satisfaction_survey_enabled=excluded.satisfaction_survey_enabled,overload_queue_threshold=excluded.overload_queue_threshold,sound_alerts_enabled=excluded.sound_alerts_enabled,updated_at=now();
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'support.settings_updated','establishment',requested_establishment_id,requested_settings-'secret');
end $$;

create or replace function public.claim_whatsapp_conversation(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; actor uuid:=(select auth.uid()); org_id uuid; qid uuid;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.id is null or not private.has_whatsapp_permission(c.establishment_id,'claim') then raise exception 'Conversa não encontrada ou sem permissão.'; end if;
  qid:=coalesce(c.queue_id,public.ensure_default_support_queue(c.establishment_id)); select organization_id into org_id from public.establishments where id=c.establishment_id;
  update public.whatsapp_conversations set queue_id=qid,assigned_user_id=actor,pending_assignee_id=null,assignment_expires_at=null,human_controlled=true,status='open',operational_status='in_progress',queued_at=coalesce(queued_at,now()),assigned_at=now(),accepted_at=now() where id=c.id;
  insert into public.support_assignment_history(organization_id,establishment_id,conversation_id,queue_id,to_user_id,assigned_by,status) values(org_id,c.establishment_id,c.id,qid,actor,actor,'direct');
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type) values(org_id,c.establishment_id,c.id,qid,actor,'conversation_assigned');
end $$;

create or replace function public.resolve_whatsapp_conversation(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; org_id uuid;
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id for update;
  if c.id is null or not private.has_whatsapp_permission(c.establishment_id,'resolve') then raise exception 'Conversa não encontrada ou sem permissão.'; end if;
  select organization_id into org_id from public.establishments where id=c.establishment_id;
  update public.whatsapp_conversations set status='resolved',human_controlled=false,unread_count=0,operational_status='resolved',resolved_at=now(),final_responsible_user_id=assigned_user_id,pending_assignee_id=null,assignment_expires_at=null where id=c.id;
  update public.support_assignment_history set status='completed',ended_at=now() where id=(select id from public.support_assignment_history where conversation_id=c.id and to_user_id=c.assigned_user_id and status in ('accepted','direct') order by offered_at desc limit 1);
  update public.support_alerts set status='resolved',resolved_at=now() where conversation_id=c.id and status='open';
  insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type) values(org_id,c.establishment_id,c.id,c.queue_id,(select auth.uid()),'conversation_resolved');
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(c.establishment_id,(select auth.uid()),'whatsapp.conversation_resolved','whatsapp_conversation',c.id,jsonb_build_object('queue_id',c.queue_id,'responsible_user_id',c.assigned_user_id));
end $$;

create or replace function public.set_whatsapp_waiting_human(requested_conversation_id uuid,requested_intent text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; selected_priority text:='normal';
begin
  select * into c from public.whatsapp_conversations where id=requested_conversation_id;
  if c.id is null then raise exception 'Conversa não encontrada.'; end if;
  if current_user not in ('service_role','postgres') and not private.has_whatsapp_permission(c.establishment_id,'respond') then raise exception 'Sem permissão.'; end if;
  if lower(coalesce(requested_intent,'')) ~ '(pagamento|atras|incorret|reclama|vip)' then selected_priority:='high'; end if;
  update public.whatsapp_conversations set last_automation_intent=left(requested_intent,80) where id=c.id;
  perform public.enqueue_support_conversation(c.id,null,selected_priority,'ai_rule');
end $$;

create or replace function public.support_message_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations%rowtype; settings public.support_settings%rowtype; org_id uuid;
begin
  select * into c from public.whatsapp_conversations where id=new.conversation_id for update;
  select * into settings from public.support_settings where establishment_id=new.establishment_id;
  select organization_id into org_id from public.establishments where id=new.establishment_id;
  if new.direction='outbound' and new.sent_by_user_id is not null and c.assigned_user_id=new.sent_by_user_id and c.first_response_at is null then
    update public.whatsapp_conversations set first_response_at=new.message_timestamp,operational_status='in_progress' where id=c.id;
    insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,actor_id,event_type) values(org_id,c.establishment_id,c.id,c.queue_id,new.sent_by_user_id,'conversation_first_response');
  elsif new.direction='inbound' and c.resolved_at is not null then
    update public.whatsapp_conversations set resolved_at=null,first_response_at=null,assigned_user_id=null,final_responsible_user_id=null,status='waiting',human_controlled=true,operational_status='queued',queued_at=now(),sla_warning_at=null,sla_breached_at=null where id=c.id;
    insert into public.support_conversation_events(organization_id,establishment_id,conversation_id,queue_id,event_type,metadata) values(org_id,c.establishment_id,c.id,c.queue_id,'conversation_reopened',jsonb_build_object('within_window',new.message_timestamp<=c.resolved_at+make_interval(hours=>coalesce(settings.reopen_window_hours,24))));
    perform public.enqueue_support_conversation(c.id,c.queue_id,c.priority,'reopen');
  end if;
  return new;
end $$;
drop trigger if exists support_message_lifecycle_trigger on public.whatsapp_messages;
create trigger support_message_lifecycle_trigger after insert on public.whatsapp_messages for each row execute function public.support_message_lifecycle();

revoke all on function public.ensure_default_support_queue(uuid),public.enqueue_support_conversation(uuid,uuid,text,text),public.set_support_agent_presence(uuid,uuid,text,text),public.accept_support_assignment(uuid),public.process_support_assignment_timeouts(integer),public.transfer_support_conversation(uuid,uuid,uuid,text,text),public.add_support_internal_note(uuid,text,uuid[]),public.update_support_conversation(uuid,text,text),public.record_support_human_response(uuid,uuid),public.process_support_sla(integer),public.get_support_supervision_dashboard(uuid,integer),public.get_support_productivity(uuid,integer),public.review_support_conversation(uuid,text,text) from public,anon;
revoke all on function public.configure_support_queue(uuid,uuid,text,text,integer,integer,boolean,boolean,integer,boolean),public.set_support_queue_member(uuid,uuid,uuid,boolean,integer),public.configure_support_settings(uuid,jsonb),public.configure_support_agent_shift(uuid,uuid,time,time,text) from public,anon;
revoke all on function private.try_assign_support_conversation(uuid,uuid),public.support_message_lifecycle() from public,anon;
grant execute on function public.ensure_default_support_queue(uuid),public.enqueue_support_conversation(uuid,uuid,text,text),public.set_support_agent_presence(uuid,uuid,text,text),public.accept_support_assignment(uuid),public.transfer_support_conversation(uuid,uuid,uuid,text,text),public.add_support_internal_note(uuid,text,uuid[]),public.update_support_conversation(uuid,text,text),public.get_support_supervision_dashboard(uuid,integer),public.get_support_productivity(uuid,integer),public.review_support_conversation(uuid,text,text) to authenticated;
grant execute on function public.configure_support_queue(uuid,uuid,text,text,integer,integer,boolean,boolean,integer,boolean),public.set_support_queue_member(uuid,uuid,uuid,boolean,integer),public.configure_support_settings(uuid,jsonb),public.configure_support_agent_shift(uuid,uuid,time,time,text) to authenticated;
grant execute on function public.process_support_assignment_timeouts(integer),public.record_support_human_response(uuid,uuid),public.process_support_sla(integer) to service_role;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_agent_presence') then alter publication supabase_realtime add table public.support_agent_presence; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_alerts') then alter publication supabase_realtime add table public.support_alerts; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_internal_notes') then alter publication supabase_realtime add table public.support_internal_notes; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_conversation_events') then alter publication supabase_realtime add table public.support_conversation_events; end if;
end $$;
