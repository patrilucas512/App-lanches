-- MasterApp Phase 11: voice as an omnichannel transport over the existing AI,
-- conversational cart, order, CRM and support foundations.

alter table public.plans
  add column if not exists voice_ai_enabled boolean not null default false,
  add column if not exists voice_ordering_enabled boolean not null default false,
  add column if not exists voice_human_transfer_enabled boolean not null default false,
  add column if not exists voice_recording_enabled boolean not null default false,
  add column if not exists voice_callback_enabled boolean not null default false,
  add column if not exists max_concurrent_calls integer check(max_concurrent_calls is null or max_concurrent_calls between 1 and 1000),
  add column if not exists included_voice_minutes integer check(included_voice_minutes is null or included_voice_minutes >= 0);

alter table public.store_feature_flags
  add column if not exists voice_ai_enabled boolean not null default true,
  add column if not exists voice_ordering_enabled boolean not null default true,
  add column if not exists voice_human_transfer_enabled boolean not null default true,
  add column if not exists voice_recording_enabled boolean not null default false,
  add column if not exists voice_callback_enabled boolean not null default true;

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check(source in ('direct','qr','whatsapp','voice'));

create table public.voice_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  provider text not null default 'generic' check(provider in ('generic','twilio','vonage','telnyx')),
  provider_connection_id text,
  routing_mode text not null default 'store' check(routing_mode in ('store','central','shared','extension')),
  phone_number text,
  extension text,
  status text not null default 'draft' check(status in ('draft','connected','paused','error')),
  active boolean not null default false,
  attendant_name text not null default 'Maria',
  voice_name text not null default 'pt-BR-natural-female',
  language text not null default 'pt-BR',
  speech_speed numeric(4,2) not null default 1 check(speech_speed between .75 and 1.35),
  welcome_message text not null default 'Olá! Eu sou a atendente virtual. Como posso ajudar?',
  business_hours_only boolean not null default true,
  personalize_recognized_customers boolean not null default false,
  human_fallback_enabled boolean not null default true,
  transfer_destination text,
  recording_enabled boolean not null default false,
  transcript_enabled boolean not null default true,
  legal_recording_notice text,
  retention_days integer not null default 30 check(retention_days between 1 and 3650),
  max_concurrent_calls integer not null default 1 check(max_concurrent_calls between 1 and 1000),
  resume_window_minutes integer not null default 30 check(resume_window_minutes between 1 and 1440),
  webhook_secret_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,provider_connection_id)
);

create table public.voice_call_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  connection_id uuid not null references public.voice_connections(id) on delete cascade,
  provider_call_id text not null,
  customer_id uuid references public.customers(id) on delete set null,
  source_phone text not null,
  customer_name text,
  state text not null default 'greeting' check(state in ('queued','greeting','intent_detection','ordering','collecting_address','payment','confirmation','status_lookup','human_transfer','on_hold','completed','failed','abandoned')),
  result text check(result is null or result in ('ai_resolved','transferred','order_created','callback_requested','abandoned','failed','blocked')),
  queue_id uuid references public.support_queues(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  human_transferred boolean not null default false,
  recording_enabled boolean not null default false,
  transcript_enabled boolean not null default true,
  recording_storage_path text,
  summary text,
  last_intent text,
  last_confidence numeric(5,4),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  continuation_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id,provider_call_id)
);

create table public.voice_call_events (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  call_session_id uuid not null references public.voice_call_sessions(id) on delete cascade,
  provider_event_id text,
  event_type text not null,
  state_from text,
  state_to text,
  confidence numeric(5,4),
  latency_ms integer check(latency_ms is null or latency_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Provider idempotency is scoped to the call.
create unique index voice_call_events_provider_idempotency_idx on public.voice_call_events(call_session_id,provider_event_id) where provider_event_id is not null;

create table public.voice_transcript_segments (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  call_session_id uuid not null references public.voice_call_sessions(id) on delete cascade,
  speaker text not null check(speaker in ('customer','ai','human','system')),
  redacted_text text not null,
  confidence numeric(5,4),
  started_ms integer check(started_ms is null or started_ms >= 0),
  ended_ms integer check(ended_ms is null or ended_ms >= 0),
  sensitive_content_detected boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.voice_callbacks (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  call_session_id uuid references public.voice_call_sessions(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  queue_id uuid references public.support_queues(id) on delete set null,
  phone text not null,
  reason text not null,
  status text not null default 'requested' check(status in ('requested','assigned','completed','cancelled')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.voice_cost_usage (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  call_session_id uuid not null references public.voice_call_sessions(id) on delete cascade,
  provider text not null,
  telephony_seconds integer not null default 0 check(telephony_seconds >= 0),
  stt_seconds integer not null default 0 check(stt_seconds >= 0),
  tts_characters integer not null default 0 check(tts_characters >= 0),
  ai_input_tokens integer not null default 0 check(ai_input_tokens >= 0),
  ai_output_tokens integer not null default 0 check(ai_output_tokens >= 0),
  estimated_cost_cents integer not null default 0 check(estimated_cost_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.voice_blocklist (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  normalized_phone text not null,
  reason text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(establishment_id,normalized_phone)
);

create table public.voice_member_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default false,
  can_answer boolean not null default false,
  can_transfer boolean not null default false,
  can_listen_recording boolean not null default false,
  can_view_transcript boolean not null default false,
  can_configure_voice boolean not null default false,
  can_configure_numbers boolean not null default false,
  can_view_metrics boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(establishment_id,user_id)
);

-- Generalize the existing conversational cart for channels while preserving all
-- current WhatsApp integrations and names for backward compatibility.
alter table public.whatsapp_carts
  add column if not exists channel_type text not null default 'whatsapp' check(channel_type in ('whatsapp','voice','web_chat','manual')),
  add column if not exists voice_call_id uuid references public.voice_call_sessions(id) on delete cascade,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists confirmation_event_id text;
alter table public.whatsapp_carts alter column connection_id drop not null;
alter table public.whatsapp_carts alter column conversation_id drop not null;
alter table public.whatsapp_carts alter column contact_id drop not null;
alter table public.whatsapp_carts drop constraint if exists whatsapp_carts_channel_identity_check;
alter table public.whatsapp_carts add constraint whatsapp_carts_channel_identity_check check(
  (channel_type='whatsapp' and connection_id is not null and conversation_id is not null and contact_id is not null and voice_call_id is null)
  or (channel_type='voice' and voice_call_id is not null and connection_id is null and conversation_id is null and contact_id is null)
  or channel_type in ('web_chat','manual')
);
alter table public.whatsapp_cart_events alter column conversation_id drop not null;
create unique index whatsapp_carts_one_open_voice_idx on public.whatsapp_carts(voice_call_id) where channel_type='voice' and status in ('active','awaiting_information','awaiting_confirmation');

create table public.voice_order_links (
  order_id uuid primary key references public.orders(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  call_session_id uuid not null references public.voice_call_sessions(id) on delete cascade,
  cart_id uuid not null unique references public.whatsapp_carts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index voice_connections_store_status_idx on public.voice_connections(establishment_id,status);
create index voice_calls_store_started_idx on public.voice_call_sessions(establishment_id,started_at desc);
create index voice_calls_queue_state_idx on public.voice_call_sessions(establishment_id,state,started_at) where state in ('queued','human_transfer','on_hold');
create index voice_calls_phone_idx on public.voice_call_sessions(establishment_id,source_phone,started_at desc);
create index voice_transcripts_call_idx on public.voice_transcript_segments(call_session_id,created_at);
create index voice_callbacks_queue_idx on public.voice_callbacks(establishment_id,status,requested_at);
create index voice_costs_store_created_idx on public.voice_cost_usage(establishment_id,created_at desc);

do $$ declare t text; begin
  foreach t in array array['voice_connections','voice_call_sessions','voice_call_events','voice_transcript_segments','voice_callbacks','voice_cost_usage','voice_blocklist','voice_member_permissions','voice_order_links'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create or replace function private.can_voice(requested_establishment_id uuid, requested_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[])
    or exists(select 1 from public.voice_member_permissions p where p.establishment_id=requested_establishment_id and p.user_id=(select auth.uid()) and case requested_permission
      when 'view' then p.can_view when 'answer' then p.can_answer when 'transfer' then p.can_transfer
      when 'recording' then p.can_listen_recording when 'transcript' then p.can_view_transcript
      when 'configure' then p.can_configure_voice when 'numbers' then p.can_configure_numbers
      when 'metrics' then p.can_view_metrics else false end);
$$;
revoke all on function private.can_voice(uuid,text) from public,anon,authenticated;
grant execute on function private.can_voice(uuid,text) to authenticated;

create policy voice_connections_read on public.voice_connections for select to authenticated using(private.can_voice(establishment_id,'view'));
create policy voice_calls_read on public.voice_call_sessions for select to authenticated using(private.can_voice(establishment_id,'view'));
create policy voice_events_read on public.voice_call_events for select to authenticated using(private.can_voice(establishment_id,'view'));
create policy voice_transcripts_read on public.voice_transcript_segments for select to authenticated using(private.can_voice(establishment_id,'transcript'));
create policy voice_callbacks_read on public.voice_callbacks for select to authenticated using(private.can_voice(establishment_id,'view'));
create policy voice_costs_read on public.voice_cost_usage for select to authenticated using(private.can_voice(establishment_id,'metrics'));
create policy voice_blocklist_read on public.voice_blocklist for select to authenticated using(private.can_voice(establishment_id,'configure'));
create policy voice_permissions_read on public.voice_member_permissions for select to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[]) or user_id=(select auth.uid()));
create policy voice_order_links_read on public.voice_order_links for select to authenticated using(private.can_voice(establishment_id,'view'));

revoke all on public.voice_connections,public.voice_call_sessions,public.voice_call_events,public.voice_transcript_segments,public.voice_callbacks,public.voice_cost_usage,public.voice_blocklist,public.voice_member_permissions,public.voice_order_links from public,anon,authenticated;
grant select on public.voice_connections,public.voice_call_sessions,public.voice_call_events,public.voice_callbacks,public.voice_order_links to authenticated;
grant select on public.voice_transcript_segments to authenticated;
grant select on public.voice_cost_usage to authenticated;
grant select on public.voice_blocklist,public.voice_member_permissions to authenticated;
grant select,insert,update,delete on public.voice_connections,public.voice_call_sessions,public.voice_call_events,public.voice_transcript_segments,public.voice_callbacks,public.voice_cost_usage,public.voice_blocklist,public.voice_member_permissions,public.voice_order_links to service_role;
grant usage,select on all sequences in schema public to service_role;

create or replace function public.configure_voice_connection(requested_establishment_id uuid, requested_patch jsonb)
returns public.voice_connections language plpgsql security definer set search_path='' as $$
declare result public.voice_connections%rowtype; plan_record public.plans%rowtype;
begin
  if not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Acesso negado.'; end if;
  select p.* into plan_record from public.subscriptions s join public.plans p on p.id=s.plan_id where s.establishment_id=requested_establishment_id and s.status in ('active','trialing') order by s.created_at desc limit 1;
  if plan_record.id is not null and not plan_record.voice_ai_enabled then raise exception 'Atendimento por voz não está incluído no plano.'; end if;
  insert into public.voice_connections(establishment_id,organization_id,provider,provider_connection_id,routing_mode,phone_number,extension,status,active,attendant_name,voice_name,language,speech_speed,welcome_message,business_hours_only,personalize_recognized_customers,human_fallback_enabled,transfer_destination,recording_enabled,transcript_enabled,legal_recording_notice,retention_days,max_concurrent_calls,resume_window_minutes)
  select requested_establishment_id,e.organization_id,coalesce(requested_patch->>'provider','generic'),nullif(requested_patch->>'provider_connection_id',''),coalesce(requested_patch->>'routing_mode','store'),nullif(requested_patch->>'phone_number',''),nullif(requested_patch->>'extension',''),coalesce(nullif(requested_patch->>'status',''),'draft'),coalesce((requested_patch->>'active')::boolean,false),coalesce(nullif(requested_patch->>'attendant_name',''),'Maria'),coalesce(nullif(requested_patch->>'voice_name',''),'pt-BR-natural-female'),coalesce(nullif(requested_patch->>'language',''),'pt-BR'),coalesce((requested_patch->>'speech_speed')::numeric,1),coalesce(nullif(requested_patch->>'welcome_message',''),'Olá! Eu sou a atendente virtual. Como posso ajudar?'),coalesce((requested_patch->>'business_hours_only')::boolean,true),coalesce((requested_patch->>'personalize_recognized_customers')::boolean,false),coalesce((requested_patch->>'human_fallback_enabled')::boolean,true),nullif(requested_patch->>'transfer_destination',''),coalesce((requested_patch->>'recording_enabled')::boolean,false),coalesce((requested_patch->>'transcript_enabled')::boolean,true),nullif(requested_patch->>'legal_recording_notice',''),coalesce((requested_patch->>'retention_days')::integer,30),least(coalesce(plan_record.max_concurrent_calls,1000),coalesce((requested_patch->>'max_concurrent_calls')::integer,1)),coalesce((requested_patch->>'resume_window_minutes')::integer,30)
  from public.establishments e where e.id=requested_establishment_id
  on conflict(establishment_id) do update set provider=excluded.provider,provider_connection_id=excluded.provider_connection_id,routing_mode=excluded.routing_mode,phone_number=excluded.phone_number,extension=excluded.extension,status=excluded.status,active=excluded.active,attendant_name=excluded.attendant_name,voice_name=excluded.voice_name,language=excluded.language,speech_speed=excluded.speech_speed,welcome_message=excluded.welcome_message,business_hours_only=excluded.business_hours_only,personalize_recognized_customers=excluded.personalize_recognized_customers,human_fallback_enabled=excluded.human_fallback_enabled,transfer_destination=excluded.transfer_destination,recording_enabled=excluded.recording_enabled,transcript_enabled=excluded.transcript_enabled,legal_recording_notice=excluded.legal_recording_notice,retention_days=excluded.retention_days,max_concurrent_calls=excluded.max_concurrent_calls,resume_window_minutes=excluded.resume_window_minutes,updated_at=now()
  returning * into result;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'voice.connection_configured','voice_connection',result.id,jsonb_build_object('active',result.active,'provider',result.provider));
  return result;
end $$;
create unique index voice_connections_one_store_idx on public.voice_connections(establishment_id);
revoke all on function public.configure_voice_connection(uuid,jsonb) from public,anon;
grant execute on function public.configure_voice_connection(uuid,jsonb) to authenticated;

create or replace function public.get_voice_dashboard(requested_establishment_id uuid, requested_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.can_voice(requested_establishment_id,'metrics') then raise exception 'Acesso negado.'; end if;
  select jsonb_build_object(
    'calls_today',count(*) filter(where c.started_at>=date_trunc('day',now())),
    'ai_resolved',count(*) filter(where c.result='ai_resolved'),
    'transferred',count(*) filter(where c.human_transferred),
    'orders',count(*) filter(where c.order_id is not null),
    'revenue_cents',coalesce(sum(o.total_cents) filter(where c.order_id is not null),0),
    'average_duration_seconds',coalesce(round(avg(extract(epoch from(coalesce(c.ended_at,now())-c.started_at)))::numeric),0),
    'current_queue',count(*) filter(where c.state in ('queued','human_transfer','on_hold')),
    'abandoned',count(*) filter(where c.result='abandoned'),
    'estimated_cost_cents',coalesce((select sum(v.estimated_cost_cents) from public.voice_cost_usage v where v.establishment_id=requested_establishment_id and v.created_at>=now()-make_interval(days=>greatest(1,least(requested_days,365)))),0)
  ) into result from public.voice_call_sessions c left join public.orders o on o.id=c.order_id and o.establishment_id=c.establishment_id
  where c.establishment_id=requested_establishment_id and c.started_at>=now()-make_interval(days=>greatest(1,least(requested_days,365)));
  return coalesce(result,'{}'::jsonb);
end $$;
revoke all on function public.get_voice_dashboard(uuid,integer) from public,anon;
grant execute on function public.get_voice_dashboard(uuid,integer) to authenticated;

create or replace function public.request_voice_callback(requested_establishment_id uuid, requested_call_id uuid, requested_phone text, requested_reason text, requested_queue_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare callback_id uuid;
begin
  if not private.can_voice(requested_establishment_id,'answer') and not private.can_voice(requested_establishment_id,'view') then raise exception 'Acesso negado.'; end if;
  if requested_call_id is not null and not exists(select 1 from public.voice_call_sessions where id=requested_call_id and establishment_id=requested_establishment_id) then raise exception 'Ligação inválida.'; end if;
  insert into public.voice_callbacks(establishment_id,call_session_id,customer_id,queue_id,phone,reason)
  select requested_establishment_id,requested_call_id,c.customer_id,requested_queue_id,regexp_replace(requested_phone,'\D','','g'),left(requested_reason,500) from public.voice_call_sessions c where c.id=requested_call_id
  returning id into callback_id;
  return callback_id;
end $$;
revoke all on function public.request_voice_callback(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.request_voice_callback(uuid,uuid,text,text,uuid) to authenticated,service_role;

-- Service-role-only cart conversion. It uses the official public order service,
-- validates live catalog data and remains idempotent through converted_order_id.
create or replace function public.finalize_voice_cart(requested_cart_id uuid, requested_confirmation_event_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cart public.whatsapp_carts%rowtype; line record; store_slug text; requested_items jsonb:='[]'::jsonb; official jsonb; order_row public.orders%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('conversation-cart:'||requested_cart_id::text,0));
  select * into cart from public.whatsapp_carts where id=requested_cart_id and channel_type='voice' for update;
  if not found then raise exception 'Carrinho de voz não encontrado.'; end if;
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
  update public.orders set source='voice' where id=order_row.id;
  update public.whatsapp_carts set status='converted',state='completed',confirmation_event_id=requested_confirmation_event_id,converted_order_id=order_row.id,updated_at=now() where id=cart.id;
  insert into public.voice_order_links(order_id,establishment_id,call_session_id,cart_id) values(order_row.id,cart.establishment_id,cart.voice_call_id,cart.id) on conflict do nothing;
  update public.voice_call_sessions set order_id=order_row.id,result='order_created',state='completed',updated_at=now() where id=cart.voice_call_id and establishment_id=cart.establishment_id;
  insert into public.voice_call_events(establishment_id,call_session_id,event_type,state_from,state_to,metadata) values(cart.establishment_id,cart.voice_call_id,'call_order_created','confirmation','completed',jsonb_build_object('order_id',order_row.id,'order_number',order_row.order_number));
  return jsonb_build_object('order_id',order_row.id,'order_number',order_row.order_number,'tracking_token',order_row.tracking_token,'total_cents',order_row.total_cents,'idempotent',false);
end $$;
revoke all on function public.finalize_voice_cart(uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_voice_cart(uuid,text) to service_role;

-- Expose voice activity in the existing CRM 360 payload without creating a CRM.
create or replace function public.get_customer_voice_timeline(requested_establishment_id uuid, requested_customer_id uuid, requested_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_store_access(requested_establishment_id) then raise exception 'Acesso negado.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'channel','voice','started_at',c.started_at,'ended_at',c.ended_at,'result',c.result,'summary',c.summary,'order_id',c.order_id) order by c.started_at desc) from (select * from public.voice_call_sessions where establishment_id=requested_establishment_id and customer_id=requested_customer_id order by started_at desc limit least(greatest(requested_limit,1),200)) c),'[]'::jsonb);
end $$;
revoke all on function public.get_customer_voice_timeline(uuid,uuid,integer) from public,anon;
grant execute on function public.get_customer_voice_timeline(uuid,uuid,integer) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='voice_call_sessions') then alter publication supabase_realtime add table public.voice_call_sessions; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='voice_callbacks') then alter publication supabase_realtime add table public.voice_callbacks; end if;
end $$;
