-- Phase 52: unified operational notification inbox. Domain entities remain source of truth.
alter table public.plans
 add column if not exists notification_center_enabled boolean not null default true,
 add column if not exists team_inbox_enabled boolean not null default true,
 add column if not exists notification_escalation_enabled boolean not null default true,
 add column if not exists notification_digests_enabled boolean not null default true,
 add column if not exists notification_ai_summary_enabled boolean not null default false;
alter table public.store_feature_flags
 add column if not exists notification_center_enabled boolean not null default true,
 add column if not exists team_inbox_enabled boolean not null default true,
 add column if not exists notification_escalation_enabled boolean not null default true,
 add column if not exists notification_digests_enabled boolean not null default true,
 add column if not exists notification_ai_summary_enabled boolean not null default false;

create table public.notification_source_registry(
 id text primary key, event_type text not null unique, category text not null, source_type text not null,
 title_template text not null, summary_template text not null, priority_rules jsonb not null default '{}',
 allowed_actions jsonb not null default '[]', default_recipient_rules jsonb not null default '[]',
 dedup_strategy jsonb not null default '{}', grouping_strategy jsonb not null default '{}', expiration_strategy jsonb not null default '{}',
 sensitivity text not null default 'normal' check(sensitivity in('normal','sensitive','confidential')),
 active boolean not null default true, system_defined boolean not null default true, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notification_threads(
 id uuid primary key default gen_random_uuid(), domain text not null default 'tenant' check(domain in('tenant','platform')),
 organization_id uuid references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete cascade,
 subject_type text not null, subject_id text not null, title text not null, status text not null default 'open' check(status in('open','resolved','archived')),
 latest_event_at timestamptz not null default now(), created_at timestamptz not null default now(),
 unique(domain,organization_id,subject_type,subject_id), check((domain='tenant' and organization_id is not null) or domain='platform')
);
create table public.notification_groups(
 id uuid primary key default gen_random_uuid(), domain text not null default 'tenant' check(domain in('tenant','platform')),
 organization_id uuid references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete cascade,
 group_key text not null, category text not null, title text not null, summary text, priority text not null default 'medium' check(priority in('info','low','medium','high','critical')),
 item_count integer not null default 0, unresolved_count integer not null default 0, latest_event_at timestamptz not null default now(), metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(domain,organization_id,group_key), check((domain='tenant' and organization_id is not null) or domain='platform')
);
create table public.notification_inbox_items(
 id uuid primary key default gen_random_uuid(), domain text not null default 'tenant' check(domain in('tenant','platform')),
 organization_id uuid references public.organizations(id) on delete cascade, store_id uuid references public.establishments(id) on delete cascade,
 recipient_user_id uuid references auth.users(id) on delete cascade, recipient_role_id text, recipient_team_id uuid,
 source_type text not null, source_id text not null, event_type text not null, category text not null,
 title text not null, summary text, priority text not null default 'medium' check(priority in('info','low','medium','high','critical')),
 status text not null default 'unread' check(status in('unread','read','acknowledged','in_progress','snoozed','resolved','dismissed','expired')),
 requires_action boolean not null default false, action_deadline timestamptz, assigned_to uuid references auth.users(id) on delete set null,
 dedup_key text, group_key text, group_id uuid references public.notification_groups(id) on delete set null,
 notification_thread_id uuid references public.notification_threads(id) on delete set null, linked_task_id uuid references public.internal_tasks(id) on delete set null,
 route text check(route is null or route like '/%'), allowed_actions jsonb not null default '[]', metadata jsonb not null default '{}',
 occurrence_count integer not null default 1 check(occurrence_count>0), first_occurrence_at timestamptz not null default now(), last_occurrence_at timestamptz not null default now(),
 created_at timestamptz not null default now(), read_at timestamptz, acknowledged_at timestamptz, resolved_at timestamptz,
 snoozed_until timestamptz, expires_at timestamptz, dismissed_at timestamptz, archived_at timestamptz,
 check(recipient_user_id is not null or recipient_role_id is not null or recipient_team_id is not null),
 check((domain='tenant' and organization_id is not null) or domain='platform')
);
create unique index notification_inbox_active_dedup_idx on public.notification_inbox_items(domain,organization_id,coalesce(recipient_user_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(recipient_role_id,''),dedup_key) where dedup_key is not null and status not in('resolved','dismissed','expired');
create table public.notification_policies(
 id uuid primary key default gen_random_uuid(), domain text not null default 'tenant' check(domain in('tenant','platform')),
 organization_id uuid references public.organizations(id) on delete cascade, category text not null, event_type text not null,
 priority text not null check(priority in('info','low','medium','high','critical')), inbox_enabled boolean not null default true,
 mandatory boolean not null default false, configurable boolean not null default true, channel_rules jsonb not null default '{}', recipient_rules jsonb not null default '[]',
 grouping_rule jsonb not null default '{}', dedup_window_minutes integer not null default 60 check(dedup_window_minutes between 1 and 10080),
 escalation_rule jsonb not null default '{}', max_snooze_minutes integer check(max_snooze_minutes is null or max_snooze_minutes>=0),
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(domain,organization_id,event_type), check((domain='tenant' and organization_id is not null) or domain='platform')
);
create table public.notification_user_preferences(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, category text not null, inbox_enabled boolean not null default true,
 email_enabled boolean not null default false, push_enabled boolean not null default true, whatsapp_enabled boolean not null default false,
 digest_mode text not null default 'off' check(digest_mode in('off','daily','weekly','custom')), quiet_hours jsonb not null default '{}',
 priority_threshold text not null default 'low' check(priority_threshold in('info','low','medium','high','critical')),
 timezone text not null default 'America/Sao_Paulo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,user_id,category)
);
create table public.notification_deliveries(
 id uuid primary key default gen_random_uuid(), inbox_item_id uuid not null references public.notification_inbox_items(id) on delete cascade,
 organization_id uuid references public.organizations(id) on delete cascade, channel text not null check(channel in('in_app','email','push','whatsapp','sms_future')),
 recipient text not null, status text not null default 'queued' check(status in('queued','sending','sent','delivered','failed','suppressed','dead_lettered')),
 provider_message_id text, attempts integer not null default 0, max_attempts integer not null default 3, available_at timestamptz not null default now(),
 sent_at timestamptz, delivered_at timestamptz, error_code text, error_summary text, idempotency_key text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(channel,idempotency_key)
);
create table public.notification_delivery_failures(
 id uuid primary key default gen_random_uuid(), delivery_id uuid not null unique references public.notification_deliveries(id) on delete restrict,
 organization_id uuid references public.organizations(id) on delete cascade, error_code text not null, error_summary text not null,
 status text not null default 'open' check(status in('open','retrying','resolved','ignored')), created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.notification_digests(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, digest_type text not null check(digest_type in('daily','weekly','custom')),
 timezone text not null default 'America/Sao_Paulo', period_start timestamptz not null, period_end timestamptz not null,
 status text not null default 'queued' check(status in('queued','generated','sent','failed','suppressed')), summary jsonb not null default '{}',
 generated_at timestamptz, sent_at timestamptz, created_at timestamptz not null default now(), unique(organization_id,user_id,digest_type,period_start)
);
create table public.notification_escalation_history(
 id uuid primary key default gen_random_uuid(), inbox_item_id uuid not null references public.notification_inbox_items(id) on delete cascade,
 organization_id uuid references public.organizations(id) on delete cascade, escalation_level integer not null check(escalation_level between 1 and 5),
 rule_snapshot jsonb not null default '{}', from_user_id uuid references auth.users(id) on delete set null, to_user_id uuid references auth.users(id) on delete set null,
 to_role text, channel text not null default 'in_app', reason text not null, created_at timestamptz not null default now(),
 unique(inbox_item_id,escalation_level)
);
create table public.notification_templates(
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
 event_type text not null, channel text not null check(channel in('in_app','email','push','whatsapp')),
 locale text not null default 'pt-BR', subject text not null, body text not null, variable_schema jsonb not null default '{}',
 version integer not null default 1, system_defined boolean not null default true, active boolean not null default true,
 created_at timestamptz not null default now(), unique(organization_id,event_type,channel,locale,version),
 check(position('<script' in lower(body))=0 and position('javascript:' in lower(body))=0)
);
create table public.notification_saved_views(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, name text not null, filters jsonb not null default '{}', pinned boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notification_audit_events(
 id bigint generated always as identity primary key, domain text not null default 'tenant', organization_id uuid references public.organizations(id) on delete cascade,
 inbox_item_id uuid references public.notification_inbox_items(id) on delete set null, actor_user_id uuid references auth.users(id) on delete set null,
 action text not null, reason text, before_state jsonb, after_state jsonb, correlation_id text not null, created_at timestamptz not null default now()
);
create table public.notification_analytics_hourly(
 organization_id uuid not null references public.organizations(id) on delete cascade, bucket_at timestamptz not null,
 category text not null, priority text not null, created_count bigint not null default 0, critical_count bigint not null default 0,
 acknowledged_count bigint not null default 0, resolved_count bigint not null default 0, dismissed_count bigint not null default 0,
 snoozed_count bigint not null default 0, escalated_count bigint not null default 0, delivery_sent bigint not null default 0,
 delivery_failed bigint not null default 0, acknowledge_seconds_sum bigint not null default 0, resolution_seconds_sum bigint not null default 0,
 primary key(organization_id,bucket_at,category,priority)
);

create index notification_inbox_recipient_idx on public.notification_inbox_items(organization_id,recipient_user_id,status,created_at desc);
create index notification_inbox_store_idx on public.notification_inbox_items(organization_id,store_id,status,priority,created_at desc);
create index notification_inbox_assignee_idx on public.notification_inbox_items(organization_id,assigned_to,status,action_deadline);
create index notification_inbox_category_idx on public.notification_inbox_items(organization_id,category,status,created_at desc);
create index notification_inbox_attention_idx on public.notification_inbox_items(organization_id,requires_action,priority,status,created_at desc) where status not in('resolved','dismissed','expired');
create index notification_delivery_queue_idx on public.notification_deliveries(status,available_at) where status in('queued','failed');
create index notification_escalation_item_idx on public.notification_escalation_history(inbox_item_id,created_at desc);
create index notification_audit_org_idx on public.notification_audit_events(organization_id,created_at desc);

insert into public.notification_source_registry(id,event_type,category,source_type,title_template,summary_template,priority_rules,allowed_actions,default_recipient_rules,dedup_strategy,grouping_strategy,expiration_strategy) values
('orders-delay','order.delayed','orders','order','Pedido {{order_number}} atrasado','{{minutes_overdue}} min acima da meta','{"default":"high"}','["open","acknowledge","assign","snooze"]','["store_manager"]','{"key":"event:source:recipient","window_minutes":60}','{"key":"orders.delayed:store","critical_individual":true}','{"requires_source_resolution":true}'),
('payment-failed','payment.failed','payments','payment_transaction','Pagamento com falha','Falha no pagamento {{reference}}','{"default":"high"}','["open","acknowledge","assign"]','["store_manager"]','{"key":"event:source:recipient","window_minutes":30}','{}','{"requires_source_resolution":true}'),
('inventory-low','inventory.low','inventory','inventory_item','Estoque baixo: {{item_name}}','Saldo abaixo do limite configurado','{"default":"medium"}','["open","acknowledge","assign","snooze"]','["store_manager"]','{"key":"event:source:recipient","window_minutes":240}','{"key":"inventory.low:store"}','{"requires_source_resolution":true}'),
('approval-pending','approval.pending','approvals','internal_approval','Aprovação pendente','{{approval_type}} aguarda decisão segura','{"default":"high"}','["open"]','["approver"]','{"key":"event:source:recipient","window_minutes":1440}','{}','{"requires_source_resolution":true}'),
('security-critical','security.critical','security','security_event','Alerta crítico de segurança','Abra a Central de Segurança para revisar','{"default":"critical","mandatory":true}','["open","acknowledge","assign"]','["organization_owner","security_manager"]','{"key":"event:source:recipient","window_minutes":15}','{}','{"requires_source_resolution":true}'),
('automation-message','automation.notification','automation','automation_execution','Notificação da automação','Mensagem emitida por template aprovado','{"default":"medium"}','["open","acknowledge","snooze"]','["configured_resolver"]','{"key":"workflow:source:recipient","window_minutes":60}','{}','{"expires_hours":168}'),
('executive-attention','executive.attention','executive','executive_attention_item','Item de atenção executiva','Risco priorizado pelo Centro de Comando','{"default":"high"}','["open","acknowledge","assign"]','["organization_owner"]','{"key":"event:source:recipient","window_minutes":60}','{}','{"requires_source_resolution":true}')
on conflict(event_type) do update set title_template=excluded.title_template,summary_template=excluded.summary_template,priority_rules=excluded.priority_rules,allowed_actions=excluded.allowed_actions,default_recipient_rules=excluded.default_recipient_rules,dedup_strategy=excluded.dedup_strategy,grouping_strategy=excluded.grouping_strategy,expiration_strategy=excluded.expiration_strategy,updated_at=now();

insert into public.search_navigation_registry(id,title,route,keywords,module,icon,position,customer_visible) values
('notifications','Central de Notificações','/painel/notificacoes',array['alertas','inbox','aprovacoes','criticos'],'notifications','🔔',15,true)
on conflict(id) do update set title=excluded.title,route=excluded.route,keywords=excluded.keywords,module=excluded.module,icon=excluded.icon,position=excluded.position;
insert into public.search_command_registry(id,title,description,keywords,command_type,route,required_permission,risk_level,scope,position) values
('go-critical-notifications','Ver notificações críticas','Abrir itens críticos',array['alertas','criticos','atencao'],'navigation','/painel/notificacoes?tab=critical','search:global','low','store',14),
('go-pending-approvals','Ver aprovações pendentes','Abrir aprovações',array['aprovar','aprovacoes'],'navigation','/painel/notificacoes?tab=approvals','search:global','low','store',15)
on conflict(id) do update set title=excluded.title,description=excluded.description,keywords=excluded.keywords,route=excluded.route,required_permission=excluded.required_permission,risk_level=excluded.risk_level,scope=excluded.scope,position=excluded.position;

do $$ declare t text; begin foreach t in array array[
 'notification_source_registry','notification_threads','notification_groups','notification_inbox_items','notification_policies','notification_user_preferences','notification_deliveries','notification_delivery_failures','notification_digests','notification_escalation_history','notification_templates','notification_saved_views','notification_audit_events','notification_analytics_hourly'
] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
grant select on public.notification_inbox_items,public.notification_groups,public.notification_threads to authenticated;
create policy notification_items_current_scope on public.notification_inbox_items for select to authenticated using(
 recipient_user_id=(select auth.uid()) or
 (domain='platform' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_superadmin)) or
 (organization_id in(select om.organization_id from public.organization_members om where om.user_id=(select auth.uid()) and om.active) and
  (store_id is null or store_id in(select em.establishment_id from public.establishment_members em where em.user_id=(select auth.uid()) and em.status='active') or
   exists(select 1 from public.organization_members om where om.organization_id=notification_inbox_items.organization_id and om.user_id=(select auth.uid()) and om.active and om.all_stores)))
);
create policy notification_groups_current_scope on public.notification_groups for select to authenticated using(organization_id in(select om.organization_id from public.organization_members om where om.user_id=(select auth.uid()) and om.active));
create policy notification_threads_current_scope on public.notification_threads for select to authenticated using(organization_id in(select om.organization_id from public.organization_members om where om.user_id=(select auth.uid()) and om.active));

do $$ begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notification_inbox_items') then alter publication supabase_realtime add table public.notification_inbox_items;end if;end $$;

-- Legacy internal_notifications remains available; the unified inbox references it instead of duplicating its source entity.
insert into public.notification_inbox_items(domain,organization_id,recipient_user_id,source_type,source_id,event_type,category,title,summary,priority,status,requires_action,dedup_key,created_at,read_at,metadata)
select 'platform',null,n.recipient_user_id,'internal_notification',n.id::text,'legacy.internal_notification','system',n.title,n.body,'info',case when n.read_at is null then 'unread' else 'read' end,false,'legacy:'||n.id,n.created_at,n.read_at,jsonb_build_object('legacy_entity_type',n.entity_type,'legacy_entity_id',n.entity_id)
from public.internal_notifications n on conflict do nothing;

create or replace function private.sync_internal_notification_to_inbox() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.notification_inbox_items(domain,organization_id,recipient_user_id,source_type,source_id,event_type,category,title,summary,priority,status,requires_action,dedup_key,created_at,read_at,metadata)
 values('platform',null,new.recipient_user_id,'internal_notification',new.id::text,case when new.notification_type='automation' then 'automation.notification' else 'legacy.internal_notification' end,case when new.notification_type='automation' then 'automation' else 'system' end,new.title,new.body,case when new.notification_type in('security','critical') then 'critical' else 'info' end,case when new.read_at is null then 'unread' else 'read' end,false,'legacy:'||new.id,new.created_at,new.read_at,jsonb_build_object('legacy_entity_type',new.entity_type,'legacy_entity_id',new.entity_id))
 on conflict do nothing;
 return new;
end $$;
drop trigger if exists internal_notifications_unified_inbox on public.internal_notifications;
create trigger internal_notifications_unified_inbox after insert on public.internal_notifications for each row execute function private.sync_internal_notification_to_inbox();

create view public.fact_notifications with(security_invoker=true) as select id,organization_id,store_id,category,priority,status,requires_action,occurrence_count,created_at,read_at,acknowledged_at,resolved_at from public.notification_inbox_items;
create view public.fact_notification_deliveries with(security_invoker=true) as select id,organization_id,inbox_item_id,channel,status,attempts,created_at,sent_at,delivered_at from public.notification_deliveries;
create view public.fact_notification_escalations with(security_invoker=true) as select id,organization_id,inbox_item_id,escalation_level,channel,created_at from public.notification_escalation_history;
create view public.fact_notification_actions with(security_invoker=true) as select id,organization_id,inbox_item_id,action,created_at from public.notification_audit_events;
revoke all on public.fact_notifications,public.fact_notification_deliveries,public.fact_notification_escalations,public.fact_notification_actions from public,anon,authenticated;
grant select on public.fact_notifications,public.fact_notification_deliveries,public.fact_notification_escalations,public.fact_notification_actions to service_role;
