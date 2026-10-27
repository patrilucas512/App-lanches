-- Phase 2: hybrid AI attendant. Phase 1 tables and human inbox remain authoritative.

alter table public.whatsapp_connections
  add column if not exists ai_outside_business_hours boolean not null default true,
  add column if not exists ai_attendant_name text not null default 'Atendente virtual',
  add column if not exists ai_welcome_message text not null default 'Olá! Sou o atendente virtual. Posso ajudar com cardápio, horários, entrega e andamento do pedido.',
  add column if not exists ai_fallback_message text not null default 'Não consegui confirmar essa informação com segurança. Vou chamar uma pessoa da equipe para ajudar você.',
  add column if not exists ai_rate_limit_per_minute integer not null default 8;

alter table public.whatsapp_connections
  drop constraint if exists whatsapp_connections_ai_attendant_name_check,
  add constraint whatsapp_connections_ai_attendant_name_check check (char_length(btrim(ai_attendant_name)) between 2 and 60),
  drop constraint if exists whatsapp_connections_ai_messages_check,
  add constraint whatsapp_connections_ai_messages_check check (char_length(ai_welcome_message) between 1 and 1000 and char_length(ai_fallback_message) between 1 and 1000),
  drop constraint if exists whatsapp_connections_ai_rate_limit_check,
  add constraint whatsapp_connections_ai_rate_limit_check check (ai_rate_limit_per_minute between 2 and 30);

alter table public.whatsapp_conversations
  add column if not exists last_automation_intent text,
  add column if not exists last_ai_response_at timestamptz;

alter table public.whatsapp_messages
  add column if not exists automation_generated boolean not null default false;

create table if not exists public.whatsapp_automation_events (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  event_type text not null check (event_type in ('classified','tool_called','answered','human_handoff','skipped','failed','rate_limited')),
  intent text,
  tool_name text,
  provider text,
  model text,
  success boolean not null default true,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_automation_events_tenant_created_idx
  on public.whatsapp_automation_events(establishment_id, created_at desc);
create index if not exists whatsapp_automation_events_conversation_idx
  on public.whatsapp_automation_events(conversation_id, created_at desc);
create index if not exists whatsapp_messages_rate_limit_idx
  on public.whatsapp_messages(establishment_id, contact_id, direction, message_timestamp desc);

alter table public.whatsapp_automation_events enable row level security;
create policy whatsapp_automation_events_read on public.whatsapp_automation_events
for select to authenticated using (private.has_whatsapp_permission(establishment_id,'configure'));
revoke all on table public.whatsapp_automation_events from public, anon, authenticated;
grant select on table public.whatsapp_automation_events to authenticated;

create or replace function public.configure_whatsapp_automation(
  requested_establishment_id uuid,
  requested_ai_enabled boolean,
  requested_automatic_replies_enabled boolean,
  requested_human_handoff_enabled boolean,
  requested_outside_hours_enabled boolean,
  requested_attendant_name text,
  requested_welcome_message text,
  requested_fallback_message text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.whatsapp_connections%rowtype;
begin
  if not private.has_whatsapp_permission(requested_establishment_id,'configure') then
    raise exception 'Sem permissão para configurar o atendente.';
  end if;
  update public.whatsapp_connections set
    ai_enabled=coalesce(requested_ai_enabled,false),
    automatic_replies_enabled=coalesce(requested_automatic_replies_enabled,false),
    human_handoff_enabled=coalesce(requested_human_handoff_enabled,true),
    ai_outside_business_hours=coalesce(requested_outside_hours_enabled,true),
    ai_attendant_name=left(btrim(coalesce(requested_attendant_name,'Atendente virtual')),60),
    ai_welcome_message=left(btrim(coalesce(requested_welcome_message,'')),1000),
    ai_fallback_message=left(btrim(coalesce(requested_fallback_message,'')),1000)
  where establishment_id=requested_establishment_id returning * into saved;
  if saved.id is null then raise exception 'Conecte o WhatsApp antes de configurar o atendente.'; end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(requested_establishment_id,(select auth.uid()),'whatsapp.automation_configured','whatsapp_connection',saved.id,
    jsonb_build_object('ai_enabled',saved.ai_enabled,'automatic_replies_enabled',saved.automatic_replies_enabled,'human_handoff_enabled',saved.human_handoff_enabled,'outside_hours',saved.ai_outside_business_hours));
  return jsonb_build_object(
    'ai_enabled',saved.ai_enabled,'automatic_replies_enabled',saved.automatic_replies_enabled,
    'human_handoff_enabled',saved.human_handoff_enabled,'ai_outside_business_hours',saved.ai_outside_business_hours,
    'ai_attendant_name',saved.ai_attendant_name,'ai_welcome_message',saved.ai_welcome_message,
    'ai_fallback_message',saved.ai_fallback_message
  );
end $$;

create or replace function public.return_whatsapp_to_automation(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare tenant_id uuid;
begin
  select establishment_id into tenant_id from public.whatsapp_conversations where id=requested_conversation_id;
  if tenant_id is null or not private.has_whatsapp_permission(tenant_id,'resolve') then
    raise exception 'Conversa não encontrada ou sem permissão.';
  end if;
  update public.whatsapp_conversations set assigned_user_id=null,human_controlled=false,status='open'
  where id=requested_conversation_id and establishment_id=tenant_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id)
  values(tenant_id,(select auth.uid()),'whatsapp.conversation_returned_to_ai','whatsapp_conversation',requested_conversation_id);
end $$;

create or replace function public.set_whatsapp_waiting_human(requested_conversation_id uuid, requested_intent text default 'human_handoff')
returns void language plpgsql security definer set search_path='' as $$
declare tenant_id uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select establishment_id into tenant_id from public.whatsapp_conversations where id=requested_conversation_id;
  if tenant_id is null then raise exception 'Conversa não encontrada.'; end if;
  update public.whatsapp_conversations set status='waiting',human_controlled=true,assigned_user_id=null,last_automation_intent=left(requested_intent,80)
  where id=requested_conversation_id and establishment_id=tenant_id;
  insert into public.audit_logs(establishment_id,action,entity_type,entity_id,metadata)
  values(tenant_id,'whatsapp.human_handoff_requested','whatsapp_conversation',requested_conversation_id,jsonb_build_object('intent',requested_intent));
end $$;

revoke all on function public.configure_whatsapp_automation(uuid,boolean,boolean,boolean,boolean,text,text,text), public.return_whatsapp_to_automation(uuid) from public,anon;
grant execute on function public.configure_whatsapp_automation(uuid,boolean,boolean,boolean,boolean,text,text,text), public.return_whatsapp_to_automation(uuid) to authenticated;
revoke all on function public.set_whatsapp_waiting_human(uuid,text) from public,anon,authenticated;
grant execute on function public.set_whatsapp_waiting_human(uuid,text) to service_role;
