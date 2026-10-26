-- MasterApp Phase 12: one omnichannel domain over the existing WhatsApp,
-- voice, CRM, queue, AI, cart, order and analytics foundations.

alter table public.plans
  add column if not exists web_chat_enabled boolean not null default false,
  add column if not exists omnichannel_inbox_enabled boolean not null default false,
  add column if not exists cross_channel_continuity_enabled boolean not null default false;

alter table public.store_feature_flags
  add column if not exists web_chat_enabled boolean not null default true,
  add column if not exists omnichannel_inbox_enabled boolean not null default true,
  add column if not exists cross_channel_continuity_enabled boolean not null default true;

alter table public.orders
  add column if not exists source_channel text,
  add column if not exists first_touch_channel text,
  add column if not exists last_touch_channel text,
  add column if not exists order_source_channel text;
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check(source in ('direct','qr','whatsapp','voice','web_chat'));
update public.orders set source_channel=case when source in ('whatsapp','voice','web_chat') then source else 'direct' end,
  first_touch_channel=case when source in ('whatsapp','voice','web_chat') then source else 'direct' end,
  last_touch_channel=case when source in ('whatsapp','voice','web_chat') then source else 'direct' end,
  order_source_channel=case when source in ('whatsapp','voice','web_chat') then source else 'direct' end
where source_channel is null;

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid references public.establishments(id) on delete cascade,
  channel_type text not null check(channel_type in ('whatsapp','voice','web_chat')),
  name text not null,
  enabled boolean not null default true,
  adapter_key text not null,
  configuration jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(establishment_id,channel_type)
);

insert into public.channels(organization_id,establishment_id,channel_type,name,adapter_key,enabled)
select organization_id,id,v.type,v.name,v.adapter,true from public.establishments
cross join (values ('whatsapp','WhatsApp','whatsapp'),('voice','Telefone','voice'),('web_chat','Chat do site','web_chat')) v(type,name,adapter)
on conflict(establishment_id,channel_type) do nothing;

create table public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  identity_type text not null check(identity_type in ('phone','whatsapp','email','web_session')),
  value_normalized text not null,
  verified boolean not null default false,
  is_primary boolean not null default false,
  verification_source text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,identity_type,value_normalized)
);
create index customer_identities_customer_idx on public.customer_identities(customer_id,identity_type);
create index customer_identities_store_idx on public.customer_identities(establishment_id,updated_at desc);

insert into public.customer_identities(customer_id,organization_id,establishment_id,identity_type,value_normalized,verified,is_primary,verification_source)
select c.id,e.organization_id,c.establishment_id,'phone',public.normalize_customer_phone(c.phone),true,true,'existing_customer'
from public.customers c join public.establishments e on e.id=c.establishment_id
where nullif(public.normalize_customer_phone(c.phone),'') is not null
on conflict(organization_id,identity_type,value_normalized) do nothing;

insert into public.customer_identities(customer_id,organization_id,establishment_id,identity_type,value_normalized,verified,is_primary,verification_source)
select wc.customer_id,e.organization_id,wc.establishment_id,'whatsapp',public.normalize_customer_phone(coalesce(wc.wa_id,wc.phone_number)),true,false,'meta_whatsapp'
from public.whatsapp_contacts wc join public.establishments e on e.id=wc.establishment_id
where wc.customer_id is not null and nullif(public.normalize_customer_phone(coalesce(wc.wa_id,wc.phone_number)),'') is not null
on conflict(organization_id,identity_type,value_normalized) do nothing;

create table public.identity_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  candidate_customer_id uuid not null references public.customers(id) on delete cascade,
  identity_type text not null, value_normalized text not null,
  confidence numeric(5,4) not null check(confidence between 0 and 1), reason text not null,
  status text not null default 'pending' check(status in ('pending','associated','kept_separate','expired')),
  reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz,
  created_at timestamptz not null default now(), unique(organization_id,identity_type,value_normalized,candidate_customer_id)
);

create table public.omnichannel_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  current_channel text not null check(current_channel in ('whatsapp','voice','web_chat')),
  first_touch_channel text not null check(first_touch_channel in ('whatsapp','voice','web_chat')),
  last_touch_channel text not null check(last_touch_channel in ('whatsapp','voice','web_chat')),
  status text not null default 'open' check(status in ('open','waiting','resolved')),
  operational_status text not null default 'ai' check(operational_status in ('ai','queued','assignment_pending','in_progress','waiting_customer','waiting_internal','waiting_external','resolved')),
  queue_id uuid references public.support_queues(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  priority text not null default 'normal' check(priority in ('normal','high','urgent')),
  human_controlled boolean not null default false,
  unread_count integer not null default 0 check(unread_count>=0),
  last_message_preview text, last_message_at timestamptz,
  queued_at timestamptz, first_response_at timestamptz, resolved_at timestamptz,
  sla_warning_at timestamptz, sla_breached_at timestamptz,
  active_order_id uuid references public.orders(id) on delete set null,
  whatsapp_conversation_id uuid unique references public.whatsapp_conversations(id) on delete cascade,
  voice_call_id uuid unique references public.voice_call_sessions(id) on delete cascade,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index omnichannel_conversations_inbox_idx on public.omnichannel_conversations(establishment_id,status,last_message_at desc);
create index omnichannel_conversations_customer_idx on public.omnichannel_conversations(customer_id,last_message_at desc);
create index omnichannel_conversations_queue_idx on public.omnichannel_conversations(queue_id,operational_status,priority,last_message_at desc);

create table public.channel_threads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.omnichannel_conversations(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  external_thread_id text not null,
  status text not null default 'open' check(status in ('open','waiting','closed')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(channel_id,external_thread_id)
);
create index channel_threads_conversation_idx on public.channel_threads(conversation_id,updated_at desc);

create table public.normalized_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  channel_thread_id uuid not null references public.channel_threads(id) on delete cascade,
  channel_type text not null check(channel_type in ('whatsapp','voice','web_chat')),
  channel_message_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid not null references public.omnichannel_conversations(id) on delete cascade,
  direction text not null check(direction in ('inbound','outbound','system')),
  message_type text not null default 'text' check(message_type in ('text','image','document','audio','video','location','call','event','card','buttons')),
  text_content text, media jsonb not null default '[]',
  status text not null default 'received' check(status in ('received','pending','sent','delivered','read','failed')),
  sent_by_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}', occurred_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(channel_id,channel_message_id)
);
create index normalized_messages_history_idx on public.normalized_messages(conversation_id,occurred_at,id);
create index normalized_messages_reporting_idx on public.normalized_messages(establishment_id,channel_type,occurred_at desc);

create table public.omnichannel_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid references public.omnichannel_conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  channel_type text, event_type text not null, actor_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index omnichannel_events_timeline_idx on public.omnichannel_events(establishment_id,customer_id,created_at desc);

create table public.web_chat_widget_configs (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  public_key uuid not null default gen_random_uuid() unique,
  enabled boolean not null default false,
  display_name text not null default 'Atendimento', logo_url text,
  position text not null default 'right' check(position in ('left','right')),
  initial_message text not null default 'Olá! Como posso ajudar?', accent_color text not null default '#ff2828',
  attendant_name text not null default 'Atendente virtual',
  allowed_domains text[] not null default '{}', ai_outside_hours boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.web_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  widget_public_key uuid not null references public.web_chat_widget_configs(public_key) on delete cascade,
  anonymous_session_id uuid not null default gen_random_uuid(),
  token_hash text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid not null references public.omnichannel_conversations(id) on delete cascade,
  channel_thread_id uuid not null references public.channel_threads(id) on delete cascade,
  origin text not null, status text not null default 'active' check(status in ('active','closed','blocked')),
  last_seen_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '30 days'),
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index web_chat_sessions_store_active_idx on public.web_chat_sessions(establishment_id,status,last_seen_at desc);

create table public.web_chat_rate_limits (
  session_id uuid not null references public.web_chat_sessions(id) on delete cascade,
  window_started_at timestamptz not null,
  message_count integer not null default 0,
  blocked_until timestamptz,
  primary key(session_id,window_started_at)
);

create table public.channel_continuities (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid not null references public.omnichannel_conversations(id) on delete cascade,
  from_channel text not null, to_channel text not null,
  status text not null default 'requested' check(status in ('requested','authorized','completed','declined','expired')),
  consented_at timestamptz, continuation_token_hash text unique, expires_at timestamptz,
  cart_id uuid references public.whatsapp_carts(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.customer_merge_audit (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  source_customer_id uuid not null references public.customers(id) on delete restrict,
  target_customer_id uuid not null references public.customers(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  preview jsonb not null, rollback_snapshot jsonb not null,
  status text not null default 'merged' check(status in ('merged','reverted')),
  created_at timestamptz not null default now(), reverted_at timestamptz
);

create table public.omnichannel_member_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default false, can_reply_web_chat boolean not null default false,
  can_reply_whatsapp boolean not null default false, can_answer_voice boolean not null default false,
  can_merge_customers boolean not null default false, can_configure_widget boolean not null default false,
  can_view_analytics boolean not null default false, updated_at timestamptz not null default now(),
  primary key(establishment_id,user_id)
);

create table public.omnichannel_quick_replies (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  title text not null, body text not null, channel_types text[] not null default array['whatsapp','web_chat','voice'],
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.support_queues
  add column if not exists channel_types text[] not null default array['whatsapp','voice','web_chat'],
  add column if not exists channel_sla jsonb not null default '{"whatsapp":5,"web_chat":1,"voice":0}';
alter table public.support_queue_members
  add column if not exists channel_skills text[] not null default array['whatsapp','web_chat'],
  add column if not exists max_concurrent_chats integer not null default 5 check(max_concurrent_chats between 1 and 100),
  add column if not exists max_concurrent_calls integer not null default 1 check(max_concurrent_calls between 1 and 10);

alter table public.whatsapp_carts add column if not exists web_chat_session_id uuid references public.web_chat_sessions(id) on delete cascade;
create unique index if not exists whatsapp_carts_one_open_web_chat_idx on public.whatsapp_carts(web_chat_session_id)
  where channel_type='web_chat' and status in ('active','awaiting_information','awaiting_confirmation');

-- Backfill canonical conversations without changing legacy primary keys.
insert into public.omnichannel_conversations(organization_id,establishment_id,customer_id,current_channel,first_touch_channel,last_touch_channel,status,operational_status,queue_id,assigned_user_id,priority,human_controlled,unread_count,last_message_preview,last_message_at,queued_at,first_response_at,resolved_at,sla_warning_at,sla_breached_at,whatsapp_conversation_id,created_at,updated_at)
select e.organization_id,w.establishment_id,wc.customer_id,'whatsapp','whatsapp','whatsapp',w.status,w.operational_status,w.queue_id,w.assigned_user_id,w.priority,w.human_controlled,w.unread_count,w.last_message_preview,w.last_message_at,w.queued_at,w.first_response_at,w.resolved_at,w.sla_warning_at,w.sla_breached_at,w.id,w.created_at,w.updated_at
from public.whatsapp_conversations w join public.establishments e on e.id=w.establishment_id join public.whatsapp_contacts wc on wc.id=w.contact_id
on conflict(whatsapp_conversation_id) do nothing;

insert into public.channel_threads(conversation_id,channel_id,organization_id,establishment_id,external_thread_id,status,created_at,updated_at)
select oc.id,ch.id,oc.organization_id,oc.establishment_id,oc.whatsapp_conversation_id::text,case when oc.status='resolved' then 'closed' when oc.status='waiting' then 'waiting' else 'open' end,oc.created_at,oc.updated_at
from public.omnichannel_conversations oc join public.channels ch on ch.establishment_id=oc.establishment_id and ch.channel_type='whatsapp'
where oc.whatsapp_conversation_id is not null on conflict(channel_id,external_thread_id) do nothing;

insert into public.normalized_messages(channel_id,channel_thread_id,channel_type,channel_message_id,organization_id,establishment_id,customer_id,conversation_id,direction,message_type,text_content,media,status,sent_by_user_id,metadata,occurred_at,created_at)
select ct.channel_id,ct.id,'whatsapp',coalesce(wm.whatsapp_message_id,wm.id::text),oc.organization_id,wm.establishment_id,oc.customer_id,oc.id,wm.direction,
case when wm.message_type in ('text','image','document','audio','video','location') then wm.message_type else 'event' end,wm.content,
case when wm.media_reference is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('reference',wm.media_reference,'type',wm.message_type)) end,
wm.status,wm.sent_by_user_id,jsonb_build_object('legacy_message_id',wm.id),wm.message_timestamp,wm.created_at
from public.whatsapp_messages wm join public.omnichannel_conversations oc on oc.whatsapp_conversation_id=wm.conversation_id
join public.channel_threads ct on ct.conversation_id=oc.id and ct.external_thread_id=wm.conversation_id::text
on conflict(channel_id,channel_message_id) do nothing;

insert into public.omnichannel_conversations(organization_id,establishment_id,customer_id,current_channel,first_touch_channel,last_touch_channel,status,operational_status,queue_id,assigned_user_id,priority,human_controlled,last_message_preview,last_message_at,voice_call_id,created_at,updated_at)
select coalesce(v.organization_id,e.organization_id),v.establishment_id,v.customer_id,'voice','voice','voice',case when v.ended_at is null then 'open' else 'resolved' end,
case when v.state in ('human_transfer','on_hold','queued') then 'queued' when v.ended_at is null then 'ai' else 'resolved' end,v.queue_id,v.assigned_user_id,
case when v.state='human_transfer' then 'high' else 'normal' end,v.human_transferred,coalesce(v.summary,'Ligação telefônica'),v.started_at,v.id,v.created_at,v.updated_at
from public.voice_call_sessions v join public.establishments e on e.id=v.establishment_id
on conflict(voice_call_id) do nothing;

insert into public.channel_threads(conversation_id,channel_id,organization_id,establishment_id,external_thread_id,status,created_at,updated_at)
select oc.id,ch.id,oc.organization_id,oc.establishment_id,oc.voice_call_id::text,case when oc.status='resolved' then 'closed' else 'open' end,oc.created_at,oc.updated_at
from public.omnichannel_conversations oc join public.channels ch on ch.establishment_id=oc.establishment_id and ch.channel_type='voice'
where oc.voice_call_id is not null on conflict(channel_id,external_thread_id) do nothing;

create or replace function private.has_omnichannel_permission(target_establishment uuid, requested_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role(target_establishment,array['owner','manager']::public.member_role[]) or exists(
    select 1 from public.omnichannel_member_permissions p where p.establishment_id=target_establishment and p.user_id=(select auth.uid()) and
    case requested_permission when 'view' then p.can_view when 'web_chat' then p.can_reply_web_chat when 'whatsapp' then p.can_reply_whatsapp
      when 'voice' then p.can_answer_voice when 'merge' then p.can_merge_customers when 'configure_widget' then p.can_configure_widget
      when 'analytics' then p.can_view_analytics else false end)
$$;

create or replace function private.widget_origin_allowed(allowed text[], requested_origin text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(cardinality(allowed),0)=0 or lower(regexp_replace(regexp_replace(requested_origin,'^https?://','','i'),'[:/].*$',''))=any(allowed)
$$;

create or replace function public.start_web_chat_session(requested_public_key uuid,requested_origin text,requested_existing_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.web_chat_widget_configs%rowtype; existing public.web_chat_sessions%rowtype; conv public.omnichannel_conversations%rowtype;
  thread public.channel_threads%rowtype; raw_token text; channel_row public.channels%rowtype;
begin
  select * into cfg from public.web_chat_widget_configs where public_key=requested_public_key and enabled;
  if cfg.establishment_id is null or not private.widget_origin_allowed(cfg.allowed_domains,requested_origin) then raise exception 'Widget indisponível para esta origem.'; end if;
  if requested_existing_token is not null then
    select * into existing from public.web_chat_sessions where widget_public_key=requested_public_key and token_hash=encode(extensions.digest(requested_existing_token,'sha256'),'hex') and status='active' and expires_at>now();
    if existing.id is not null then update public.web_chat_sessions set last_seen_at=now() where id=existing.id; return jsonb_build_object('session_id',existing.id,'conversation_id',existing.conversation_id,'token',requested_existing_token,'restored',true,'config',to_jsonb(cfg)-'organization_id'); end if;
  end if;
  select * into channel_row from public.channels where establishment_id=cfg.establishment_id and channel_type='web_chat' and enabled;
  if channel_row.id is null then raise exception 'Canal de chat indisponível.'; end if;
  insert into public.omnichannel_conversations(organization_id,establishment_id,current_channel,first_touch_channel,last_touch_channel,last_message_preview,last_message_at)
  values(cfg.organization_id,cfg.establishment_id,'web_chat','web_chat','web_chat',cfg.initial_message,now()) returning * into conv;
  insert into public.channel_threads(conversation_id,channel_id,organization_id,establishment_id,external_thread_id)
  values(conv.id,channel_row.id,cfg.organization_id,cfg.establishment_id,gen_random_uuid()::text) returning * into thread;
  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.web_chat_sessions(organization_id,establishment_id,widget_public_key,token_hash,conversation_id,channel_thread_id,origin)
  values(cfg.organization_id,cfg.establishment_id,requested_public_key,encode(extensions.digest(raw_token,'sha256'),'hex'),conv.id,thread.id,requested_origin) returning * into existing;
  insert into public.normalized_messages(channel_id,channel_thread_id,channel_type,channel_message_id,organization_id,establishment_id,conversation_id,direction,message_type,text_content,status,metadata)
  values(channel_row.id,thread.id,'web_chat','welcome:'||existing.id,cfg.organization_id,cfg.establishment_id,conv.id,'outbound','text',cfg.initial_message,'sent',jsonb_build_object('automation',true));
  return jsonb_build_object('session_id',existing.id,'conversation_id',conv.id,'token',raw_token,'restored',false,'config',to_jsonb(cfg)-'organization_id');
end $$;

create or replace function public.post_web_chat_message(requested_public_key uuid,requested_token text,requested_origin text,requested_message_id text,requested_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.web_chat_sessions%rowtype; cfg public.web_chat_widget_configs%rowtype; ch uuid; saved public.normalized_messages%rowtype; window_start timestamptz:=date_trunc('minute',now()); current_count integer;
begin
  if char_length(btrim(requested_text)) not between 1 and 4096 or char_length(requested_message_id)>160 then raise exception 'Mensagem inválida.'; end if;
  select ws.* into s from public.web_chat_sessions ws where ws.widget_public_key=requested_public_key and ws.token_hash=encode(extensions.digest(requested_token,'sha256'),'hex') and ws.status='active' and ws.expires_at>now();
  select * into cfg from public.web_chat_widget_configs where public_key=requested_public_key and enabled;
  if s.id is null or cfg.establishment_id is null or s.establishment_id<>cfg.establishment_id or not private.widget_origin_allowed(cfg.allowed_domains,requested_origin) then raise exception 'Sessão inválida.'; end if;
  insert into public.web_chat_rate_limits(session_id,window_started_at,message_count) values(s.id,window_start,1)
  on conflict(session_id,window_started_at) do update set message_count=public.web_chat_rate_limits.message_count+1 returning message_count into current_count;
  if current_count>20 then update public.web_chat_rate_limits set blocked_until=now()+interval '5 minutes' where session_id=s.id and window_started_at=window_start; raise exception 'Limite temporário atingido.'; end if;
  select channel_id into ch from public.channel_threads where id=s.channel_thread_id;
  insert into public.normalized_messages(channel_id,channel_thread_id,channel_type,channel_message_id,organization_id,establishment_id,customer_id,conversation_id,direction,message_type,text_content,status,metadata)
  values(ch,s.channel_thread_id,'web_chat',requested_message_id,s.organization_id,s.establishment_id,s.customer_id,s.conversation_id,'inbound','text',btrim(requested_text),'received',jsonb_build_object('anonymous_session_id',s.anonymous_session_id))
  on conflict(channel_id,channel_message_id) do update set channel_message_id=excluded.channel_message_id returning * into saved;
  update public.omnichannel_conversations set current_channel='web_chat',last_touch_channel='web_chat',status='open',unread_count=unread_count+1,last_message_preview=left(btrim(requested_text),240),last_message_at=now(),updated_at=now() where id=s.conversation_id;
  update public.web_chat_sessions set last_seen_at=now() where id=s.id;
  return jsonb_build_object('message_id',saved.id,'conversation_id',s.conversation_id,'idempotent',saved.created_at<now()-interval '1 second');
end $$;

create or replace function public.get_web_chat_history(requested_public_key uuid,requested_token text,requested_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.web_chat_sessions%rowtype; cfg public.web_chat_widget_configs%rowtype;
begin
  select * into s from public.web_chat_sessions where widget_public_key=requested_public_key and token_hash=encode(extensions.digest(requested_token,'sha256'),'hex') and status='active' and expires_at>now();
  select * into cfg from public.web_chat_widget_configs where public_key=requested_public_key and enabled;
  if s.id is null or cfg.establishment_id is null or not private.widget_origin_allowed(cfg.allowed_domains,requested_origin) then raise exception 'Sessão inválida.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'type',m.message_type,'text',m.text_content,'media',m.media,'status',m.status,'timestamp',m.occurred_at) order by m.occurred_at,m.id) from public.normalized_messages m where m.conversation_id=s.conversation_id),'[]');
end $$;

create or replace function public.list_omnichannel_inbox(requested_establishment_id uuid,requested_limit integer default 200)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.has_omnichannel_permission(requested_establishment_id,'view') then raise exception 'Sem permissão para visualizar a caixa de entrada.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'customer_id',c.customer_id,'customer_name',coalesce(cu.name,'Visitante'),'customer_phone',cu.phone,'current_channel',c.current_channel,'channels',(select coalesce(jsonb_agg(distinct ch.channel_type),'[]') from public.channel_threads ct join public.channels ch on ch.id=ct.channel_id where ct.conversation_id=c.id),'status',c.status,'operational_status',c.operational_status,'queue_id',c.queue_id,'assigned_user_id',c.assigned_user_id,'priority',c.priority,'human_controlled',c.human_controlled,'unread_count',c.unread_count,'last_message_preview',c.last_message_preview,'last_message_at',c.last_message_at,'sla_breached_at',c.sla_breached_at,'active_order_id',c.active_order_id) order by c.last_message_at desc nulls last) from (select * from public.omnichannel_conversations where establishment_id=requested_establishment_id order by last_message_at desc nulls last limit least(greatest(requested_limit,1),500)) c left join public.customers cu on cu.id=c.customer_id),'[]');
end $$;

create or replace function public.get_omnichannel_conversation(requested_establishment_id uuid,requested_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.omnichannel_conversations%rowtype;
begin
  if not private.has_omnichannel_permission(requested_establishment_id,'view') then raise exception 'Sem permissão.'; end if;
  select * into c from public.omnichannel_conversations where id=requested_conversation_id and establishment_id=requested_establishment_id;
  if c.id is null then raise exception 'Conversa não encontrada.'; end if;
  return jsonb_build_object('conversation',to_jsonb(c),'customer',(select to_jsonb(x) from public.customers x where x.id=c.customer_id),
    'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.occurred_at,m.id) from public.normalized_messages m where m.conversation_id=c.id),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.omnichannel_events e where e.conversation_id=c.id),'[]'),
    'orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.orders o where o.customer_id=c.customer_id and o.establishment_id=c.establishment_id limit 20),'[]'));
end $$;

create or replace function public.send_web_chat_staff_message(requested_conversation_id uuid,requested_text text,requested_client_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.omnichannel_conversations%rowtype; ct public.channel_threads%rowtype; message_id uuid;
begin
  select * into c from public.omnichannel_conversations where id=requested_conversation_id for update;
  if c.id is null or not private.has_omnichannel_permission(c.establishment_id,'web_chat') then raise exception 'Sem permissão para responder.'; end if;
  select * into ct from public.channel_threads where conversation_id=c.id and channel_id=(select id from public.channels where establishment_id=c.establishment_id and channel_type='web_chat') order by updated_at desc limit 1;
  if ct.id is null then raise exception 'Thread do site não encontrada.'; end if;
  insert into public.normalized_messages(channel_id,channel_thread_id,channel_type,channel_message_id,organization_id,establishment_id,customer_id,conversation_id,direction,message_type,text_content,status,sent_by_user_id)
  values(ct.channel_id,ct.id,'web_chat',requested_client_id,c.organization_id,c.establishment_id,c.customer_id,c.id,'outbound','text',left(btrim(requested_text),4096),'sent',(select auth.uid()))
  on conflict(channel_id,channel_message_id) do update set channel_message_id=excluded.channel_message_id returning id into message_id;
  update public.omnichannel_conversations set human_controlled=true,assigned_user_id=coalesce(assigned_user_id,(select auth.uid())),operational_status='in_progress',first_response_at=coalesce(first_response_at,now()),last_message_preview=left(btrim(requested_text),240),last_message_at=now(),updated_at=now() where id=c.id;
  insert into public.omnichannel_events(organization_id,establishment_id,conversation_id,customer_id,channel_type,event_type,actor_id,metadata) values(c.organization_id,c.establishment_id,c.id,c.customer_id,'web_chat','human_response',(select auth.uid()),jsonb_build_object('message_id',message_id));
  return message_id;
end $$;

create or replace function public.resolve_omnichannel_conversation(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.omnichannel_conversations%rowtype;
begin
  select * into c from public.omnichannel_conversations where id=requested_conversation_id for update;
  if c.id is null or not private.has_omnichannel_permission(c.establishment_id,'view') then raise exception 'Sem permissão.'; end if;
  update public.omnichannel_conversations set status='resolved',operational_status='resolved',resolved_at=now(),unread_count=0,updated_at=now() where id=c.id;
  insert into public.omnichannel_events(organization_id,establishment_id,conversation_id,customer_id,channel_type,event_type,actor_id) values(c.organization_id,c.establishment_id,c.id,c.customer_id,c.current_channel,'conversation_resolved',(select auth.uid()));
end $$;

create or replace function public.claim_omnichannel_conversation(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.omnichannel_conversations%rowtype;
begin
  select * into c from public.omnichannel_conversations where id=requested_conversation_id for update;
  if c.id is null or not private.has_omnichannel_permission(c.establishment_id,'view') then raise exception 'Sem permissão.'; end if;
  update public.omnichannel_conversations set assigned_user_id=(select auth.uid()),human_controlled=true,status='open',operational_status='in_progress',queued_at=coalesce(queued_at,now()),updated_at=now() where id=c.id;
  insert into public.omnichannel_events(organization_id,establishment_id,conversation_id,customer_id,channel_type,event_type,actor_id) values(c.organization_id,c.establishment_id,c.id,c.customer_id,c.current_channel,'human_takeover',(select auth.uid()));
end $$;

create or replace function public.return_omnichannel_to_ai(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.omnichannel_conversations%rowtype;
begin
  select * into c from public.omnichannel_conversations where id=requested_conversation_id for update;
  if c.id is null or not private.has_omnichannel_permission(c.establishment_id,'view') then raise exception 'Sem permissão.'; end if;
  update public.omnichannel_conversations set assigned_user_id=null,human_controlled=false,status='open',operational_status='ai',updated_at=now() where id=c.id;
  insert into public.omnichannel_events(organization_id,establishment_id,conversation_id,customer_id,channel_type,event_type,actor_id) values(c.organization_id,c.establishment_id,c.id,c.customer_id,c.current_channel,'returned_to_ai',(select auth.uid()));
end $$;

create or replace function public.get_customer_omnichannel_timeline(requested_establishment_id uuid,requested_customer_id uuid,requested_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.has_omnichannel_permission(requested_establishment_id,'view') and not private.has_crm_permission(requested_establishment_id,'view') then raise exception 'Sem permissão.'; end if;
  return coalesce((select jsonb_agg(x.item order by x.at desc) from (
    select m.occurred_at at,jsonb_build_object('id',m.id,'type','message','channel',m.channel_type,'direction',m.direction,'text',m.text_content,'at',m.occurred_at) item from public.normalized_messages m where m.establishment_id=requested_establishment_id and m.customer_id=requested_customer_id
    union all select o.created_at,jsonb_build_object('id',o.id,'type','order','channel',coalesce(o.order_source_channel,o.source),'order_number',o.order_number,'status',o.status,'total_cents',o.total_cents,'at',o.created_at) from public.orders o where o.establishment_id=requested_establishment_id and o.customer_id=requested_customer_id
    union all select e.created_at,jsonb_build_object('id',e.id,'type','event','channel',e.channel_type,'event_type',e.event_type,'metadata',e.metadata,'at',e.created_at) from public.omnichannel_events e where e.establishment_id=requested_establishment_id and e.customer_id=requested_customer_id
    order by 1 desc limit least(greatest(requested_limit,1),500)) x),'[]');
end $$;

create or replace function public.get_omnichannel_analytics(requested_establishment_id uuid,requested_days integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare since_at timestamptz:=now()-make_interval(days=>least(greatest(requested_days,1),365));
begin
  if not private.has_omnichannel_permission(requested_establishment_id,'analytics') then raise exception 'Sem permissão para analytics.'; end if;
  return jsonb_build_object('channels',coalesce((select jsonb_agg(x) from (select c.first_touch_channel channel,count(*) conversations,count(*) filter(where c.status='resolved') resolved,round(avg(extract(epoch from(c.first_response_at-c.created_at))/60)::numeric,2) avg_first_response_minutes from public.omnichannel_conversations c where c.establishment_id=requested_establishment_id and c.created_at>=since_at group by c.first_touch_channel) x),'[]'),
    'orders',coalesce((select jsonb_agg(x) from (select coalesce(o.order_source_channel,o.source,'direct') channel,count(*) orders,coalesce(sum(o.total_cents),0) revenue_cents from public.orders o where o.establishment_id=requested_establishment_id and o.created_at>=since_at group by coalesce(o.order_source_channel,o.source,'direct')) x),'[]'),
    'journeys',coalesce((select jsonb_agg(x) from (select c.first_touch_channel||' → '||c.last_touch_channel journey,count(*) total from public.omnichannel_conversations c where c.establishment_id=requested_establishment_id and c.created_at>=since_at group by 1) x),'[]'));
end $$;

create or replace function public.create_channel_continuity(requested_conversation_id uuid,requested_to_channel text,requested_consent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.omnichannel_conversations%rowtype; cart_id uuid; raw_token text; saved_id uuid;
begin
  if current_user not in ('service_role','postgres') or not requested_consent or requested_to_channel not in ('whatsapp','voice','web_chat') then raise exception 'Continuidade não autorizada.'; end if;
  select * into c from public.omnichannel_conversations where id=requested_conversation_id for update;
  if c.id is null or c.current_channel=requested_to_channel then raise exception 'Continuidade inválida.'; end if;
  select id into cart_id from public.whatsapp_carts where establishment_id=c.establishment_id and status in ('active','awaiting_information','awaiting_confirmation') and (web_chat_session_id in (select id from public.web_chat_sessions where conversation_id=c.id) or voice_call_id=c.voice_call_id or conversation_id=c.whatsapp_conversation_id) order by updated_at desc limit 1;
  raw_token:=encode(extensions.gen_random_bytes(24),'hex');
  insert into public.channel_continuities(organization_id,establishment_id,customer_id,conversation_id,from_channel,to_channel,status,consented_at,continuation_token_hash,expires_at,cart_id)
  values(c.organization_id,c.establishment_id,c.customer_id,c.id,c.current_channel,requested_to_channel,'authorized',now(),encode(extensions.digest(raw_token,'sha256'),'hex'),now()+interval '30 minutes',cart_id) returning id into saved_id;
  insert into public.omnichannel_events(organization_id,establishment_id,conversation_id,customer_id,channel_type,event_type,metadata) values(c.organization_id,c.establishment_id,c.id,c.customer_id,c.current_channel,'cross_channel_continuity_authorized',jsonb_build_object('to_channel',requested_to_channel,'continuity_id',saved_id,'cart_id',cart_id));
  return jsonb_build_object('continuity_id',saved_id,'token',raw_token,'expires_at',now()+interval '30 minutes');
end $$;

create or replace function public.complete_channel_continuity(requested_token text,requested_channel_thread_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.channel_continuities%rowtype; thread public.channel_threads%rowtype;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito.'; end if;
  select * into c from public.channel_continuities where continuation_token_hash=encode(extensions.digest(requested_token,'sha256'),'hex') and status='authorized' and expires_at>now() for update;
  select * into thread from public.channel_threads where id=requested_channel_thread_id;
  if c.id is null or thread.id is null or thread.establishment_id<>c.establishment_id then raise exception 'Continuidade expirada ou inválida.'; end if;
  update public.channel_threads set conversation_id=c.conversation_id,updated_at=now() where id=thread.id;
  update public.channel_continuities set status='completed',updated_at=now() where id=c.id;
  update public.omnichannel_conversations set current_channel=c.to_channel,last_touch_channel=c.to_channel,updated_at=now() where id=c.conversation_id;
  insert into public.omnichannel_events(organization_id,establishment_id,conversation_id,customer_id,channel_type,event_type,metadata) values(c.organization_id,c.establishment_id,c.conversation_id,c.customer_id,c.to_channel,'cross_channel_continuity_completed',jsonb_build_object('continuity_id',c.id,'cart_id',c.cart_id));
  return c.conversation_id;
end $$;

create or replace function public.preview_customer_merge(requested_establishment_id uuid,requested_source_customer_id uuid,requested_target_customer_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if requested_source_customer_id=requested_target_customer_id or not private.has_omnichannel_permission(requested_establishment_id,'merge') then raise exception 'Mesclagem inválida ou não autorizada.'; end if;
  if not exists(select 1 from public.customers where id=requested_source_customer_id and establishment_id=requested_establishment_id) or not exists(select 1 from public.customers where id=requested_target_customer_id and establishment_id=requested_establishment_id) then raise exception 'Clientes inválidos.'; end if;
  return jsonb_build_object('source',(select to_jsonb(c) from public.customers c where id=requested_source_customer_id),'target',(select to_jsonb(c) from public.customers c where id=requested_target_customer_id),
    'orders',(select count(*) from public.orders where customer_id=requested_source_customer_id),'conversations',(select count(*) from public.omnichannel_conversations where customer_id=requested_source_customer_id),'identities',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.customer_identities i where customer_id=requested_source_customer_id));
end $$;

create or replace function public.merge_customers_omnichannel(requested_establishment_id uuid,requested_source_customer_id uuid,requested_target_customer_id uuid,requested_confirm boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare preview jsonb; saved_id uuid; org uuid; snapshot jsonb;
begin
  if not requested_confirm then raise exception 'Confirmação obrigatória.'; end if;
  preview:=public.preview_customer_merge(requested_establishment_id,requested_source_customer_id,requested_target_customer_id);
  select organization_id into org from public.establishments where id=requested_establishment_id;
  snapshot:=jsonb_build_object('order_ids',(select coalesce(jsonb_agg(id),'[]') from public.orders where customer_id=requested_source_customer_id),'conversation_ids',(select coalesce(jsonb_agg(id),'[]') from public.omnichannel_conversations where customer_id=requested_source_customer_id),'identity_ids',(select coalesce(jsonb_agg(id),'[]') from public.customer_identities where customer_id=requested_source_customer_id));
  update public.orders set customer_id=requested_target_customer_id where establishment_id=requested_establishment_id and customer_id=requested_source_customer_id;
  update public.omnichannel_conversations set customer_id=requested_target_customer_id where establishment_id=requested_establishment_id and customer_id=requested_source_customer_id;
  update public.customer_identities set customer_id=requested_target_customer_id,updated_at=now() where establishment_id=requested_establishment_id and customer_id=requested_source_customer_id;
  insert into public.customer_merge_audit(organization_id,establishment_id,source_customer_id,target_customer_id,actor_id,preview,rollback_snapshot) values(org,requested_establishment_id,requested_source_customer_id,requested_target_customer_id,(select auth.uid()),preview,snapshot) returning id into saved_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'omnichannel.customer_merged','customer_merge',saved_id,preview);
  return saved_id;
end $$;

create or replace function public.unmerge_customers_omnichannel(requested_merge_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.customer_merge_audit%rowtype;
begin
  select * into a from public.customer_merge_audit where id=requested_merge_id and status='merged' for update;
  if a.id is null or not private.has_omnichannel_permission(a.establishment_id,'merge') then raise exception 'Merge inválido ou não autorizado.'; end if;
  update public.orders set customer_id=a.source_customer_id where id in (select jsonb_array_elements_text(a.rollback_snapshot->'order_ids')::uuid) and customer_id=a.target_customer_id;
  update public.omnichannel_conversations set customer_id=a.source_customer_id where id in (select jsonb_array_elements_text(a.rollback_snapshot->'conversation_ids')::uuid) and customer_id=a.target_customer_id;
  update public.customer_identities set customer_id=a.source_customer_id,updated_at=now() where id in (select jsonb_array_elements_text(a.rollback_snapshot->'identity_ids')::uuid) and customer_id=a.target_customer_id;
  update public.customer_merge_audit set status='reverted',reverted_at=now() where id=a.id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(a.establishment_id,(select auth.uid()),'omnichannel.customer_unmerged','customer_merge',a.id,'{}');
end $$;

-- Keep public schema inaccessible unless a role is explicitly granted, and use
-- RLS for every authenticated table.
do $$ declare t text; begin
  foreach t in array array['channels','customer_identities','identity_match_suggestions','omnichannel_conversations','channel_threads','normalized_messages','omnichannel_events','web_chat_widget_configs','web_chat_sessions','web_chat_rate_limits','channel_continuities','customer_merge_audit','omnichannel_member_permissions','omnichannel_quick_replies'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create policy channels_read on public.channels for select to authenticated using(private.has_store_access(establishment_id));
create policy identities_read on public.customer_identities for select to authenticated using(private.has_omnichannel_permission(establishment_id,'view') or private.has_crm_permission(establishment_id,'view'));
create policy identity_suggestions_read on public.identity_match_suggestions for select to authenticated using(private.has_omnichannel_permission(establishment_id,'merge'));
create policy omnichannel_conversations_read on public.omnichannel_conversations for select to authenticated using(private.has_omnichannel_permission(establishment_id,'view'));
create policy channel_threads_read on public.channel_threads for select to authenticated using(private.has_omnichannel_permission(establishment_id,'view'));
create policy normalized_messages_read on public.normalized_messages for select to authenticated using(private.has_omnichannel_permission(establishment_id,'view'));
create policy omnichannel_events_read on public.omnichannel_events for select to authenticated using(private.has_omnichannel_permission(establishment_id,'view'));
create policy widget_configs_read on public.web_chat_widget_configs for select to authenticated using(private.has_store_access(establishment_id));
create policy widget_configs_write on public.web_chat_widget_configs for all to authenticated using(private.has_omnichannel_permission(establishment_id,'configure_widget')) with check(private.has_omnichannel_permission(establishment_id,'configure_widget'));
create policy continuities_read on public.channel_continuities for select to authenticated using(private.has_omnichannel_permission(establishment_id,'view'));
create policy merge_audit_read on public.customer_merge_audit for select to authenticated using(private.has_omnichannel_permission(establishment_id,'merge'));
create policy omnichannel_permissions_read on public.omnichannel_member_permissions for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]) or user_id=(select auth.uid()));
create policy quick_replies_team on public.omnichannel_quick_replies for all to authenticated using(private.has_omnichannel_permission(establishment_id,'view')) with check(private.has_omnichannel_permission(establishment_id,'view'));

revoke all on public.channels,public.customer_identities,public.identity_match_suggestions,public.omnichannel_conversations,public.channel_threads,public.normalized_messages,public.omnichannel_events,public.web_chat_widget_configs,public.web_chat_sessions,public.web_chat_rate_limits,public.channel_continuities,public.customer_merge_audit,public.omnichannel_member_permissions,public.omnichannel_quick_replies from public,anon,authenticated;
grant select on public.channels,public.customer_identities,public.identity_match_suggestions,public.omnichannel_conversations,public.channel_threads,public.normalized_messages,public.omnichannel_events,public.web_chat_widget_configs,public.channel_continuities,public.customer_merge_audit,public.omnichannel_member_permissions to authenticated;
grant select,insert,update,delete on public.web_chat_widget_configs,public.omnichannel_quick_replies to authenticated;
grant select,insert,update,delete on public.channels,public.customer_identities,public.identity_match_suggestions,public.omnichannel_conversations,public.channel_threads,public.normalized_messages,public.omnichannel_events,public.web_chat_widget_configs,public.web_chat_sessions,public.web_chat_rate_limits,public.channel_continuities,public.customer_merge_audit,public.omnichannel_member_permissions,public.omnichannel_quick_replies to service_role;

revoke all on function private.has_omnichannel_permission(uuid,text),private.widget_origin_allowed(text[],text) from public,anon;
grant execute on function private.has_omnichannel_permission(uuid,text) to authenticated;
revoke all on function public.start_web_chat_session(uuid,text,text),public.post_web_chat_message(uuid,text,text,text,text),public.get_web_chat_history(uuid,text,text) from public;
grant execute on function public.start_web_chat_session(uuid,text,text),public.post_web_chat_message(uuid,text,text,text,text),public.get_web_chat_history(uuid,text,text) to anon,authenticated,service_role;
revoke all on function public.list_omnichannel_inbox(uuid,integer),public.get_omnichannel_conversation(uuid,uuid),public.send_web_chat_staff_message(uuid,text,text),public.resolve_omnichannel_conversation(uuid),public.claim_omnichannel_conversation(uuid),public.return_omnichannel_to_ai(uuid),public.get_customer_omnichannel_timeline(uuid,uuid,integer),public.get_omnichannel_analytics(uuid,integer),public.preview_customer_merge(uuid,uuid,uuid),public.merge_customers_omnichannel(uuid,uuid,uuid,boolean),public.unmerge_customers_omnichannel(uuid) from public,anon;
grant execute on function public.list_omnichannel_inbox(uuid,integer),public.get_omnichannel_conversation(uuid,uuid),public.send_web_chat_staff_message(uuid,text,text),public.resolve_omnichannel_conversation(uuid),public.claim_omnichannel_conversation(uuid),public.return_omnichannel_to_ai(uuid),public.get_customer_omnichannel_timeline(uuid,uuid,integer),public.get_omnichannel_analytics(uuid,integer),public.preview_customer_merge(uuid,uuid,uuid),public.merge_customers_omnichannel(uuid,uuid,uuid,boolean),public.unmerge_customers_omnichannel(uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='normalized_messages') then alter publication supabase_realtime add table public.normalized_messages; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='omnichannel_conversations') then alter publication supabase_realtime add table public.omnichannel_conversations; end if;
end $$;

create or replace function public.finalize_web_chat_cart(requested_cart_id uuid,requested_confirmation_event_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cart public.whatsapp_carts%rowtype; line record; store_slug text; requested_items jsonb:='[]'; official jsonb; order_row public.orders%rowtype; conv_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('conversation-cart:'||requested_cart_id::text,0));
  select * into cart from public.whatsapp_carts where id=requested_cart_id and channel_type='web_chat' for update;
  if not found then raise exception 'Carrinho do chat não encontrado.'; end if;
  if cart.converted_order_id is not null then select * into order_row from public.orders where id=cart.converted_order_id; return jsonb_build_object('order_id',order_row.id,'order_number',order_row.order_number,'tracking_token',order_row.tracking_token,'total_cents',order_row.total_cents,'idempotent',true); end if;
  if cart.state<>'final_confirmation' or cart.status<>'awaiting_confirmation' or nullif(requested_confirmation_event_id,'') is null then raise exception 'Confirmação explícita obrigatória.'; end if;
  select slug into store_slug from public.establishments where id=cart.establishment_id;
  for line in select ci.*,p.active product_active from public.whatsapp_cart_items ci join public.products p on p.id=ci.product_id and p.establishment_id=ci.establishment_id where ci.cart_id=cart.id and ci.establishment_id=cart.establishment_id order by ci.created_at loop
    if not line.product_active then raise exception 'Produto indisponível: %',line.product_name; end if;
    requested_items:=requested_items||jsonb_build_array(jsonb_build_object('product_id',line.product_id,'quantity',line.quantity,'addons',line.selected_addons,'removed_ingredients',line.removed_ingredients,'notes',line.notes));
  end loop;
  if jsonb_array_length(requested_items)=0 then raise exception 'Carrinho vazio.'; end if;
  official:=public.place_public_order_v2(store_slug,cart.customer_name,cart.customer_phone,cart.fulfillment_type,requested_items,null,null,'direct',cart.payment_method,cart.cash_received_cents,cart.delivery_address);
  select * into order_row from public.orders where id=(official->>'order_id')::uuid for update;
  select conversation_id into conv_id from public.web_chat_sessions where id=cart.web_chat_session_id;
  update public.orders set source='web_chat',source_channel='web_chat',first_touch_channel='web_chat',last_touch_channel='web_chat',order_source_channel='web_chat' where id=order_row.id;
  update public.whatsapp_carts set status='converted',state='completed',confirmation_event_id=requested_confirmation_event_id,converted_order_id=order_row.id,updated_at=now() where id=cart.id;
  update public.omnichannel_conversations set customer_id=coalesce(customer_id,order_row.customer_id),active_order_id=order_row.id,last_touch_channel='web_chat',updated_at=now() where id=conv_id;
  insert into public.omnichannel_events(organization_id,establishment_id,conversation_id,customer_id,channel_type,event_type,order_id,metadata)
  select organization_id,establishment_id,id,coalesce(customer_id,order_row.customer_id),'web_chat','order_created',order_row.id,jsonb_build_object('order_number',order_row.order_number) from public.omnichannel_conversations where id=conv_id;
  return jsonb_build_object('order_id',order_row.id,'order_number',order_row.order_number,'tracking_token',order_row.tracking_token,'total_cents',order_row.total_cents,'idempotent',false);
end $$;
revoke all on function public.finalize_web_chat_cart(uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_web_chat_cart(uuid,text) to service_role;
revoke all on function public.create_channel_continuity(uuid,text,boolean),public.complete_channel_continuity(text,uuid) from public,anon,authenticated;
grant execute on function public.create_channel_continuity(uuid,text,boolean),public.complete_channel_continuity(text,uuid) to service_role;
