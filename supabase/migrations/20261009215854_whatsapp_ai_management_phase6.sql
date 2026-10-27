-- MasterApp WhatsApp Phase 6: tenant-scoped AI management, knowledge and analytics.
-- Structured MasterApp data remains authoritative; tenant content is complementary only.

create table public.ai_member_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default true,
  can_edit_personality boolean not null default false,
  can_edit_knowledge boolean not null default false,
  can_edit_rules boolean not null default false,
  can_publish boolean not null default false,
  can_view_metrics boolean not null default false,
  can_view_costs boolean not null default false,
  can_use_simulator boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(establishment_id,user_id)
);

create or replace function private.has_ai_permission(requested_establishment_id uuid, permission_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.establishment_members m
    where m.establishment_id=requested_establishment_id and m.user_id=(select auth.uid())
      and (m.role in ('owner','manager') or exists(
        select 1 from public.ai_member_permissions p
        where p.establishment_id=m.establishment_id and p.user_id=m.user_id and case permission_name
          when 'view' then p.can_view when 'edit_personality' then p.can_edit_personality
          when 'edit_knowledge' then p.can_edit_knowledge when 'edit_rules' then p.can_edit_rules
          when 'publish' then p.can_publish when 'view_metrics' then p.can_view_metrics
          when 'view_costs' then p.can_view_costs when 'simulator' then p.can_use_simulator else false end
      ))
  )
$$;
revoke all on function private.has_ai_permission(uuid,text) from public,anon,authenticated;

create table public.ai_config_versions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check(status in ('draft','published','archived')),
  attendant_name text not null default 'Maria' check(char_length(attendant_name) between 2 and 60),
  introduction text not null default 'Olá! Sou a atendente virtual. Como posso ajudar?',
  style text not null default 'friendly' check(style in ('professional','friendly','casual','direct','custom')),
  formality smallint not null default 45 check(formality between 0 and 100),
  response_length text not null default 'short' check(response_length in ('short','medium','detailed')),
  emoji_level text not null default 'few' check(emoji_level in ('none','few','moderate')),
  custom_tone text not null default '',
  fallback_message text not null default 'Não encontrei essa informação. Vou chamar uma pessoa da equipe para ajudar.',
  operating_instructions text not null default '',
  prohibited_behaviors text[] not null default '{}',
  handoff_rules jsonb not null default '{"customer_requests_human":true,"complaint":true,"refund":true,"payment_problem":true,"late_order":true,"wrong_order":true,"unknown":true,"irritated":true}'::jsonb,
  automation_schedule jsonb not null default '{"use_business_hours":true}'::jsonb,
  low_confidence_threshold numeric(4,3) not null default .650 check(low_confidence_threshold between .3 and .95),
  unknown_behavior text not null default 'handoff' check(unknown_behavior in ('clarify','handoff','fallback')),
  prompt_base_version text not null default 'masterapp-ai-v1',
  change_summary text,
  created_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique(establishment_id,version)
);
create unique index ai_config_one_draft_idx on public.ai_config_versions(establishment_id) where status='draft';
create unique index ai_config_one_published_idx on public.ai_config_versions(establishment_id) where status='published';

create table public.ai_knowledge_items (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  config_version_id uuid not null references public.ai_config_versions(id) on delete cascade,
  title text not null check(char_length(title) between 2 and 140), category text not null default 'Informações gerais',
  content text not null check(char_length(content) between 2 and 8000), status text not null default 'active' check(status in ('active','inactive')),
  created_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index ai_knowledge_tenant_version_idx on public.ai_knowledge_items(establishment_id,config_version_id,status);

create table public.ai_faqs (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  config_version_id uuid not null references public.ai_config_versions(id) on delete cascade,
  question text not null check(char_length(question) between 2 and 500), answer text not null check(char_length(answer) between 2 and 4000),
  variations text[] not null default '{}', category text not null default 'Informações gerais', status text not null default 'active' check(status in ('active','inactive')),
  created_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index ai_faqs_tenant_version_idx on public.ai_faqs(establishment_id,config_version_id,status);

create table public.ai_custom_rules (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  config_version_id uuid not null references public.ai_config_versions(id) on delete cascade,
  name text not null check(char_length(name) between 2 and 140),
  rule_type text not null check(rule_type in ('TRANSFER_TO_HUMAN','BLOCK_ACTION','ASK_CONFIRMATION','INFORMATION')),
  condition_field text not null check(condition_field in ('order_total','order_status','intent','message_contains','quantity','confidence')),
  operator text not null check(operator in ('gt','gte','lt','lte','eq','contains','in')),
  condition_value jsonb not null, action text not null check(action in ('handoff','block_cancel','block_reservation','confirm','inform')),
  response_text text not null default '', priority smallint not null default 100 check(priority between 1 and 999), enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index ai_rules_tenant_version_idx on public.ai_custom_rules(establishment_id,config_version_id,enabled,priority);

create table public.ai_learning_suggestions (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  normalized_topic text not null, sample_question text not null, occurrences integer not null default 1,
  reason text not null check(reason in ('fallback','handoff','low_confidence','missing_information','tool_error')),
  status text not null default 'pending' check(status in ('pending','accepted','dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  unique(establishment_id,normalized_topic,status)
);
create index ai_learning_tenant_status_idx on public.ai_learning_suggestions(establishment_id,status,occurrences desc);

create table public.ai_conversation_analysis (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  category text not null default 'unknown' check(category in ('order','menu','hours','delivery','payment','complaint','promotion','information','human_support','unknown')),
  resolution text not null default 'open' check(resolution in ('open','ai_resolved','human_resolved','transferred','unresolved')),
  confidence numeric(4,3), generated_order_id uuid references public.orders(id) on delete set null,
  generated_sale_cents integer not null default 0, fallback_count integer not null default 0, tool_error_count integer not null default 0,
  average_response_ms integer, satisfaction smallint check(satisfaction between 1 and 5), active_config_version_id uuid references public.ai_config_versions(id) on delete set null,
  prompt_base_version text, updated_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(establishment_id,conversation_id)
);

create table public.ai_usage_events (
  id bigint generated always as identity primary key, establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  event_type text not null check(event_type in ('ai_message_processed','ai_tool_called','ai_fallback','ai_handoff','ai_order_created','ai_sale_completed','ai_unknown_question','ai_error','ai_simulation')),
  provider text, model text, input_tokens integer check(input_tokens>=0), output_tokens integer check(output_tokens>=0), estimated_cost_micros bigint check(estimated_cost_micros>=0),
  latency_ms integer check(latency_ms>=0), config_version_id uuid references public.ai_config_versions(id) on delete set null,
  prompt_base_version text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index ai_usage_tenant_created_idx on public.ai_usage_events(establishment_id,created_at desc);

create table public.ai_plan_entitlements (
  plan_id uuid primary key references public.plans(id) on delete cascade,
  ai_enabled boolean not null default true, ai_ordering_enabled boolean not null default true,
  advanced_knowledge_enabled boolean not null default true, ai_crm_enabled boolean not null default true,
  max_ai_conversations_month integer, max_ai_messages_month integer, max_ai_automations integer, max_ai_campaigns_month integer, max_knowledge_items integer,
  quota_behavior text not null default 'human_handoff' check(quota_behavior in ('human_handoff','notify','basic_fallback')), updated_at timestamptz not null default now()
);

create table public.ai_alerts (
  id uuid primary key default gen_random_uuid(), establishment_id uuid not null references public.establishments(id) on delete cascade,
  alert_type text not null check(alert_type in ('failure_spike','whatsapp_disconnected','unanswered_questions','quota_warning','provider_unavailable')),
  severity text not null default 'warning' check(severity in ('info','warning','critical')), message text not null,
  acknowledged_at timestamptz, acknowledged_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

create table public.ai_retention_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  conversation_history_days integer not null default 365 check(conversation_history_days between 30 and 3650),
  technical_log_days integer not null default 90 check(technical_log_days between 7 and 730),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_automation_events add column if not exists input_tokens integer, add column if not exists output_tokens integer,
  add column if not exists estimated_cost_micros bigint, add column if not exists config_version_id uuid references public.ai_config_versions(id) on delete set null,
  add column if not exists prompt_base_version text;

create or replace function private.assert_safe_ai_text(value text)
returns void language plpgsql immutable set search_path='' as $$
begin
  if coalesce(value,'') ~* '(service[_ -]?role|access[_ -]?token|database password|ignore (all|as) (previous|prior)|bypass.*(payment|tenant|permission)|show.*all customers|you are administrator)' then
    raise exception 'A configuração contém instrução proibida pela segurança do MasterApp';
  end if;
end $$;
revoke all on function private.assert_safe_ai_text(text) from public,anon,authenticated;

create or replace function private.validate_ai_content()
returns trigger language plpgsql set search_path='' as $$
begin
  perform private.assert_safe_ai_text(coalesce(to_jsonb(new)->>'content','')||' '||coalesce(to_jsonb(new)->>'answer','')||' '||coalesce(to_jsonb(new)->>'response_text',''));
  if exists(select 1 from public.ai_config_versions v where v.id=new.config_version_id and v.establishment_id<>new.establishment_id) then raise exception 'Versão pertence a outro estabelecimento'; end if;
  return new;
end $$;
revoke all on function private.validate_ai_content() from public,anon,authenticated;
create trigger ai_knowledge_validate before insert or update on public.ai_knowledge_items for each row execute function private.validate_ai_content();
create trigger ai_faq_validate before insert or update on public.ai_faqs for each row execute function private.validate_ai_content();
create trigger ai_rule_validate before insert or update on public.ai_custom_rules for each row execute function private.validate_ai_content();

create or replace function private.audit_ai_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare tenant uuid:=coalesce(new.establishment_id,old.establishment_id); entity uuid:=coalesce(new.id,old.id); verb text;
begin
  verb:=case when tg_op='INSERT' then 'created' when tg_op='UPDATE' then 'updated' else 'removed' end;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(tenant,(select auth.uid()),'ai.'||tg_table_name||'.'||verb,tg_table_name,entity,jsonb_build_object('operation',tg_op));
  return coalesce(new,old);
end $$;
revoke all on function private.audit_ai_change() from public,anon,authenticated;
create trigger ai_knowledge_audit after insert or update or delete on public.ai_knowledge_items for each row execute function private.audit_ai_change();
create trigger ai_faq_audit after insert or update or delete on public.ai_faqs for each row execute function private.audit_ai_change();
create trigger ai_rule_audit after insert or update or delete on public.ai_custom_rules for each row execute function private.audit_ai_change();

create or replace function public.create_ai_config_draft(requested_establishment_id uuid)
returns public.ai_config_versions language plpgsql security definer set search_path='' as $$
declare active public.ai_config_versions%rowtype; saved public.ai_config_versions%rowtype; next_version integer;
begin
  if not private.has_ai_permission(requested_establishment_id,'edit_personality') then raise exception 'Sem permissão para editar a atendente'; end if;
  select * into saved from public.ai_config_versions where establishment_id=requested_establishment_id and status='draft'; if found then return saved; end if;
  select * into active from public.ai_config_versions where establishment_id=requested_establishment_id and status='published';
  select coalesce(max(version),0)+1 into next_version from public.ai_config_versions where establishment_id=requested_establishment_id;
  insert into public.ai_config_versions(establishment_id,version,status,attendant_name,introduction,style,formality,response_length,emoji_level,custom_tone,fallback_message,operating_instructions,prohibited_behaviors,handoff_rules,automation_schedule,low_confidence_threshold,unknown_behavior,prompt_base_version,created_by,change_summary)
  values(requested_establishment_id,next_version,'draft',coalesce(active.attendant_name,'Maria'),coalesce(active.introduction,'Olá! Sou a atendente virtual. Como posso ajudar?'),coalesce(active.style,'friendly'),coalesce(active.formality,45),coalesce(active.response_length,'short'),coalesce(active.emoji_level,'few'),coalesce(active.custom_tone,''),coalesce(active.fallback_message,'Não encontrei essa informação.'),coalesce(active.operating_instructions,''),coalesce(active.prohibited_behaviors,'{}'),coalesce(active.handoff_rules,'{}'),coalesce(active.automation_schedule,'{}'),coalesce(active.low_confidence_threshold,.650),coalesce(active.unknown_behavior,'handoff'),coalesce(active.prompt_base_version,'masterapp-ai-v1'),(select auth.uid()),'Rascunho criado') returning * into saved;
  if active.id is not null then
    insert into public.ai_knowledge_items(establishment_id,config_version_id,title,category,content,status,created_by) select requested_establishment_id,saved.id,title,category,content,status,(select auth.uid()) from public.ai_knowledge_items where config_version_id=active.id;
    insert into public.ai_faqs(establishment_id,config_version_id,question,answer,variations,category,status,created_by) select requested_establishment_id,saved.id,question,answer,variations,category,status,(select auth.uid()) from public.ai_faqs where config_version_id=active.id;
    insert into public.ai_custom_rules(establishment_id,config_version_id,name,rule_type,condition_field,operator,condition_value,action,response_text,priority,enabled,created_by) select requested_establishment_id,saved.id,name,rule_type,condition_field,operator,condition_value,action,response_text,priority,enabled,(select auth.uid()) from public.ai_custom_rules where config_version_id=active.id;
  end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'ai.draft_created','ai_config_version',saved.id,jsonb_build_object('version',saved.version));
  return saved;
end $$;

create or replace function public.publish_ai_config(requested_establishment_id uuid, requested_config_id uuid, requested_summary text default null)
returns public.ai_config_versions language plpgsql security definer set search_path='' as $$
declare saved public.ai_config_versions%rowtype;
begin
  if not private.has_ai_permission(requested_establishment_id,'publish') then raise exception 'Sem permissão para publicar'; end if;
  select * into saved from public.ai_config_versions where id=requested_config_id and establishment_id=requested_establishment_id and status='draft';
  if saved.id is null then raise exception 'Rascunho não encontrado'; end if;
  perform private.assert_safe_ai_text(saved.custom_tone||' '||saved.operating_instructions||' '||array_to_string(saved.prohibited_behaviors,' '));
  update public.ai_config_versions set status='archived' where establishment_id=requested_establishment_id and status='published';
  update public.ai_config_versions set status='published',published_at=now(),published_by=(select auth.uid()),change_summary=left(coalesce(requested_summary,change_summary,'Configuração publicada'),500) where id=saved.id returning * into saved;
  update public.whatsapp_connections set ai_attendant_name=saved.attendant_name,ai_welcome_message=saved.introduction,ai_fallback_message=saved.fallback_message,updated_at=now() where establishment_id=requested_establishment_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'ai.config_published','ai_config_version',saved.id,jsonb_build_object('version',saved.version));
  return saved;
end $$;

create or replace function public.rollback_ai_config(requested_establishment_id uuid, requested_version integer)
returns public.ai_config_versions language plpgsql security definer set search_path='' as $$
declare source public.ai_config_versions%rowtype; draft public.ai_config_versions%rowtype;
begin
  if not private.has_ai_permission(requested_establishment_id,'publish') then raise exception 'Sem permissão para rollback'; end if;
  select * into source from public.ai_config_versions where establishment_id=requested_establishment_id and version=requested_version and status in ('archived','published');
  if source.id is null then raise exception 'Versão não encontrada'; end if;
  delete from public.ai_config_versions where establishment_id=requested_establishment_id and status='draft';
  select * into draft from public.create_ai_config_draft(requested_establishment_id);
  update public.ai_config_versions set attendant_name=source.attendant_name,introduction=source.introduction,style=source.style,formality=source.formality,response_length=source.response_length,emoji_level=source.emoji_level,custom_tone=source.custom_tone,fallback_message=source.fallback_message,operating_instructions=source.operating_instructions,prohibited_behaviors=source.prohibited_behaviors,handoff_rules=source.handoff_rules,automation_schedule=source.automation_schedule,low_confidence_threshold=source.low_confidence_threshold,unknown_behavior=source.unknown_behavior,change_summary='Rollback da v'||source.version where id=draft.id returning * into draft;
  delete from public.ai_knowledge_items where config_version_id=draft.id; delete from public.ai_faqs where config_version_id=draft.id; delete from public.ai_custom_rules where config_version_id=draft.id;
  insert into public.ai_knowledge_items(establishment_id,config_version_id,title,category,content,status,created_by) select requested_establishment_id,draft.id,title,category,content,status,(select auth.uid()) from public.ai_knowledge_items where config_version_id=source.id;
  insert into public.ai_faqs(establishment_id,config_version_id,question,answer,variations,category,status,created_by) select requested_establishment_id,draft.id,question,answer,variations,category,status,(select auth.uid()) from public.ai_faqs where config_version_id=source.id;
  insert into public.ai_custom_rules(establishment_id,config_version_id,name,rule_type,condition_field,operator,condition_value,action,response_text,priority,enabled,created_by) select requested_establishment_id,draft.id,name,rule_type,condition_field,operator,condition_value,action,response_text,priority,enabled,(select auth.uid()) from public.ai_custom_rules where config_version_id=source.id;
  return public.publish_ai_config(requested_establishment_id,draft.id,'Rollback da v'||source.version);
end $$;

create or replace function public.set_ai_member_permissions(requested_establishment_id uuid, requested_user_id uuid, requested_permissions jsonb)
returns public.ai_member_permissions language plpgsql security definer set search_path='' as $$
declare saved public.ai_member_permissions;
begin
  if not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Sem permissão'; end if;
  if not exists(select 1 from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id) then raise exception 'Membro inválido'; end if;
  insert into public.ai_member_permissions(establishment_id,user_id,can_view,can_edit_personality,can_edit_knowledge,can_edit_rules,can_publish,can_view_metrics,can_view_costs,can_use_simulator)
  values(requested_establishment_id,requested_user_id,coalesce((requested_permissions->>'can_view')::boolean,true),coalesce((requested_permissions->>'can_edit_personality')::boolean,false),coalesce((requested_permissions->>'can_edit_knowledge')::boolean,false),coalesce((requested_permissions->>'can_edit_rules')::boolean,false),coalesce((requested_permissions->>'can_publish')::boolean,false),coalesce((requested_permissions->>'can_view_metrics')::boolean,false),coalesce((requested_permissions->>'can_view_costs')::boolean,false),coalesce((requested_permissions->>'can_use_simulator')::boolean,false))
  on conflict(establishment_id,user_id) do update set can_view=excluded.can_view,can_edit_personality=excluded.can_edit_personality,can_edit_knowledge=excluded.can_edit_knowledge,can_edit_rules=excluded.can_edit_rules,can_publish=excluded.can_publish,can_view_metrics=excluded.can_view_metrics,can_view_costs=excluded.can_view_costs,can_use_simulator=excluded.can_use_simulator,updated_at=now() returning * into saved;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'ai.permissions_updated','profile',requested_user_id,requested_permissions);
  return saved;
end $$;

create or replace function public.get_ai_dashboard(requested_establishment_id uuid, requested_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz:=now()-make_interval(days=>least(greatest(requested_days,1),366)); result jsonb;
begin
  if not private.has_ai_permission(requested_establishment_id,'view') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'messages',count(*) filter(where event_type='ai_message_processed'),
    'resolved',count(*) filter(where event_type='ai_message_processed' and coalesce(metadata->>'resolution','')='ai_resolved'),
    'handoffs',count(*) filter(where event_type='ai_handoff'),'fallbacks',count(*) filter(where event_type='ai_fallback'),
    'errors',count(*) filter(where event_type='ai_error'),'orders',count(*) filter(where event_type='ai_order_created'),
    'sales',count(*) filter(where event_type='ai_sale_completed'),'revenue_cents',coalesce(sum((metadata->>'revenue_cents')::bigint) filter(where event_type='ai_sale_completed'),0),
    'average_response_ms',coalesce(round(avg(latency_ms) filter(where event_type='ai_message_processed')),0),
    'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'estimated_cost_micros',coalesce(sum(estimated_cost_micros),0)
  ) into result from public.ai_usage_events where establishment_id=requested_establishment_id and created_at>=start_at;
  return coalesce(result,'{}'::jsonb);
end $$;

revoke all on function public.create_ai_config_draft(uuid),public.publish_ai_config(uuid,uuid,text),public.rollback_ai_config(uuid,integer),public.set_ai_member_permissions(uuid,uuid,jsonb),public.get_ai_dashboard(uuid,integer) from public,anon;
grant execute on function public.create_ai_config_draft(uuid),public.publish_ai_config(uuid,uuid,text),public.rollback_ai_config(uuid,integer),public.set_ai_member_permissions(uuid,uuid,jsonb),public.get_ai_dashboard(uuid,integer) to authenticated;

create or replace function private.track_ai_order_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare config public.ai_config_versions%rowtype;
begin
  select * into config from public.ai_config_versions where establishment_id=new.establishment_id and status='published';
  insert into public.ai_usage_events(establishment_id,conversation_id,event_type,config_version_id,prompt_base_version,metadata)
  values(new.establishment_id,new.conversation_id,'ai_order_created',config.id,config.prompt_base_version,jsonb_build_object('order_id',new.order_id,'cart_id',new.cart_id));
  insert into public.ai_conversation_analysis(establishment_id,conversation_id,category,resolution,generated_order_id,active_config_version_id,prompt_base_version)
  values(new.establishment_id,new.conversation_id,'order','ai_resolved',new.order_id,config.id,config.prompt_base_version)
  on conflict(establishment_id,conversation_id) do update set category='order',generated_order_id=excluded.generated_order_id,active_config_version_id=excluded.active_config_version_id,prompt_base_version=excluded.prompt_base_version,updated_at=now();
  return new;
end $$;
revoke all on function private.track_ai_order_link() from public,anon,authenticated;
create trigger whatsapp_order_link_ai_attribution after insert on public.whatsapp_order_links for each row execute function private.track_ai_order_link();

create or replace function private.track_ai_completed_sale()
returns trigger language plpgsql security definer set search_path='' as $$
declare link record; config public.ai_config_versions%rowtype;
begin
  if new.status::text='completed' and old.status::text is distinct from new.status::text then
    select * into link from public.whatsapp_order_links where order_id=new.id and establishment_id=new.establishment_id limit 1;
    if link.conversation_id is not null then
      select * into config from public.ai_config_versions where establishment_id=new.establishment_id and status='published';
      insert into public.ai_usage_events(establishment_id,conversation_id,event_type,config_version_id,prompt_base_version,metadata)
      values(new.establishment_id,link.conversation_id,'ai_sale_completed',config.id,config.prompt_base_version,jsonb_build_object('order_id',new.id,'revenue_cents',new.total_cents));
      update public.ai_conversation_analysis set generated_sale_cents=new.total_cents,resolution='ai_resolved',updated_at=now() where establishment_id=new.establishment_id and conversation_id=link.conversation_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.track_ai_completed_sale() from public,anon,authenticated;
create trigger orders_ai_sale_attribution after update of status on public.orders for each row execute function private.track_ai_completed_sale();

do $$ declare t text; begin foreach t in array array['ai_member_permissions','ai_config_versions','ai_knowledge_items','ai_faqs','ai_custom_rules','ai_learning_suggestions','ai_conversation_analysis','ai_usage_events','ai_plan_entitlements','ai_alerts','ai_retention_settings'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy ai_permissions_read on public.ai_member_permissions for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_permissions_owner_write on public.ai_member_permissions for all to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy ai_config_read on public.ai_config_versions for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_config_write on public.ai_config_versions for update to authenticated using(private.has_ai_permission(establishment_id,'edit_personality') and status='draft') with check(private.has_ai_permission(establishment_id,'edit_personality') and status='draft');
create policy ai_knowledge_read on public.ai_knowledge_items for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_knowledge_write on public.ai_knowledge_items for all to authenticated using(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft')) with check(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_faq_read on public.ai_faqs for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_faq_write on public.ai_faqs for all to authenticated using(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft')) with check(private.has_ai_permission(establishment_id,'edit_knowledge') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_rules_read on public.ai_custom_rules for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_rules_write on public.ai_custom_rules for all to authenticated using(private.has_ai_permission(establishment_id,'edit_rules') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft')) with check(private.has_ai_permission(establishment_id,'edit_rules') and exists(select 1 from public.ai_config_versions v where v.id=config_version_id and v.status='draft'));
create policy ai_learning_read on public.ai_learning_suggestions for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_learning_write on public.ai_learning_suggestions for update to authenticated using(private.has_ai_permission(establishment_id,'edit_knowledge')) with check(private.has_ai_permission(establishment_id,'edit_knowledge'));
create policy ai_analysis_read on public.ai_conversation_analysis for select to authenticated using(private.has_ai_permission(establishment_id,'view_metrics'));
create policy ai_usage_read on public.ai_usage_events for select to authenticated using(private.has_ai_permission(establishment_id,'view_metrics'));
create policy ai_entitlements_superadmin_read on public.ai_plan_entitlements for select to authenticated using(true);
create policy ai_alerts_read on public.ai_alerts for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_alerts_update on public.ai_alerts for update to authenticated using(private.has_ai_permission(establishment_id,'view')) with check(private.has_ai_permission(establishment_id,'view'));
create policy ai_retention_read on public.ai_retention_settings for select to authenticated using(private.has_ai_permission(establishment_id,'view'));
create policy ai_retention_write on public.ai_retention_settings for all to authenticated using(private.has_role(establishment_id,array['owner','manager']::public.member_role[])) with check(private.has_role(establishment_id,array['owner','manager']::public.member_role[]));

revoke all on public.ai_member_permissions,public.ai_config_versions,public.ai_knowledge_items,public.ai_faqs,public.ai_custom_rules,public.ai_learning_suggestions,public.ai_conversation_analysis,public.ai_usage_events,public.ai_plan_entitlements,public.ai_alerts,public.ai_retention_settings from public,anon;
grant select on public.ai_member_permissions,public.ai_config_versions,public.ai_knowledge_items,public.ai_faqs,public.ai_custom_rules,public.ai_learning_suggestions,public.ai_conversation_analysis,public.ai_usage_events,public.ai_plan_entitlements,public.ai_alerts,public.ai_retention_settings to authenticated;
grant insert,update,delete on public.ai_knowledge_items,public.ai_faqs,public.ai_custom_rules to authenticated;
grant update on public.ai_config_versions,public.ai_learning_suggestions,public.ai_alerts to authenticated;
grant insert,update on public.ai_retention_settings to authenticated;
grant usage,select on sequence public.ai_usage_events_id_seq to authenticated;

insert into public.ai_config_versions(establishment_id,version,status,attendant_name,introduction,fallback_message,published_at,change_summary)
select e.id,1,'published',coalesce(c.ai_attendant_name,'Maria'),coalesce(c.ai_welcome_message,'Olá! Sou a atendente virtual. Como posso ajudar?'),coalesce(c.ai_fallback_message,'Não encontrei essa informação.'),now(),'Configuração inicial importada da atendente existente'
from public.establishments e left join lateral(select * from public.whatsapp_connections wc where wc.establishment_id=e.id order by wc.updated_at desc limit 1)c on true
where not exists(select 1 from public.ai_config_versions v where v.establishment_id=e.id);

insert into public.ai_plan_entitlements(plan_id,ai_enabled,ai_ordering_enabled,advanced_knowledge_enabled,ai_crm_enabled)
select id,true,true,true,true from public.plans on conflict(plan_id) do nothing;

insert into public.ai_retention_settings(establishment_id) select id from public.establishments on conflict(establishment_id) do nothing;
