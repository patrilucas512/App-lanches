-- Phase 10: controlled operational actions for the manager copilot.
-- The model can only propose typed payloads. All authorization, preview, confirmation,
-- revalidation, execution and undo happen inside these audited backend functions.

alter table public.plans
  add column if not exists copilot_actions_enabled boolean not null default true,
  add column if not exists playbooks_enabled boolean not null default true,
  add column if not exists temporary_operations_enabled boolean not null default true;

create table public.copilot_action_settings (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  approval_mode text not null default 'standard' check (approval_mode in ('conservative','standard')),
  common_action_limit integer not null default 10 check (common_action_limit between 1 and 100),
  confirmation_ttl_seconds integer not null default 300 check (confirmation_ttl_seconds between 60 and 900),
  undo_ttl_seconds integer not null default 600 check (undo_ttl_seconds between 60 and 3600),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.copilot_action_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in (
    'PRODUCT_SET_AVAILABILITY','CAMPAIGN_PAUSE','CAMPAIGN_RESUME',
    'STORE_TEMPORARILY_CLOSE','STORE_REOPEN','DELIVERY_TOGGLE',
    'UPDATE_DELIVERY_ESTIMATE','AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE',
    'ASSIGN_CONVERSATION','CHANGE_CONVERSATION_PRIORITY','QUEUE_ADJUST_CAPACITY'
  )),
  risk_level text not null check (risk_level in ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text not null default 'pending_confirmation' check (status in (
    'pending_confirmation','pending_approval','executed','cancelled','expired',
    'conflict','rejected','failed','undone','already_applied'
  )),
  target_type text not null,
  target_ids uuid[] not null default '{}',
  normalized_payload jsonb not null default '{}',
  preview jsonb not null default '{}',
  before_state jsonb not null default '{}',
  after_state jsonb,
  confirmation_token_hash text not null,
  confirmation_phrase text,
  confirmation_expires_at timestamptz not null,
  required_approvals smallint not null default 1 check (required_approvals between 1 and 2),
  confirmed_at timestamptz,
  executed_at timestamptz,
  undo_expires_at timestamptz,
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null,
  result jsonb,
  failure_reason text,
  idempotency_key text not null,
  source text not null default 'copilot' check (source='copilot'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id,idempotency_key)
);

create table public.copilot_action_approvals (
  action_id uuid not null references public.copilot_action_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected')),
  decided_at timestamptz not null default now(),
  primary key(action_id,user_id)
);

create table public.copilot_action_events (
  id bigint generated always as identity primary key,
  action_id uuid references public.copilot_action_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'action_requested','action_previewed','action_confirmed','action_executed',
    'action_failed','action_undone','action_rejected','action_cancelled','action_expired'
  )),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.copilot_temporary_operations (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.copilot_action_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  operation_type text not null,
  restore_state jsonb not null,
  restore_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','restored','cancelled','failed')),
  restored_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now()
);

create table public.copilot_rule_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  trigger_type text not null,
  condition jsonb not null default '{}',
  action_type text not null check (action_type in ('INTERNAL_ALERT_CREATE','PRODUCT_SET_AVAILABILITY','CAMPAIGN_PAUSE','CAMPAIGN_RESUME','STORE_TEMPORARILY_CLOSE','STORE_REOPEN','DELIVERY_TOGGLE','UPDATE_DELIVERY_ESTIMATE','AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE','ASSIGN_CONVERSATION','CHANGE_CONVERSATION_PRIORITY','QUEUE_ADJUST_CAPACITY')),
  action_payload jsonb not null default '{}',
  approval_mode text not null check (approval_mode in ('notify_only','require_approval','auto_low_risk')),
  check (approval_mode <> 'auto_low_risk' or action_type = 'INTERNAL_ALERT_CREATE'),
  enabled boolean not null default true,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index copilot_actions_scope_idx on public.copilot_action_requests(establishment_id,created_at desc);
create index copilot_actions_pending_idx on public.copilot_action_requests(establishment_id,status,confirmation_expires_at);
create index copilot_events_scope_idx on public.copilot_action_events(establishment_id,created_at desc);
create index copilot_temp_due_idx on public.copilot_temporary_operations(status,restore_at) where status='scheduled';
create index copilot_rules_scope_idx on public.copilot_rule_definitions(establishment_id,enabled);

alter table public.copilot_action_settings enable row level security;
alter table public.copilot_action_requests enable row level security;
alter table public.copilot_action_approvals enable row level security;
alter table public.copilot_action_events enable row level security;
alter table public.copilot_temporary_operations enable row level security;
alter table public.copilot_rule_definitions enable row level security;

create or replace function private.copilot_action_role(requested_establishment_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce(
    (select em.role::text from public.establishment_members em
      where em.establishment_id=requested_establishment_id and em.user_id=(select auth.uid())
        and coalesce(em.status,'active')='active' limit 1),
    (select om.role from public.organization_members om join public.establishments e on e.organization_id=om.organization_id
      where e.id=requested_establishment_id and om.user_id=(select auth.uid()) and om.active limit 1)
  )
$$;

create or replace function private.copilot_action_allowed(requested_establishment_id uuid,requested_action_type text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare role_name text; plan_enabled boolean;
begin
  if (select auth.uid()) is null then return false; end if;
  role_name:=private.copilot_action_role(requested_establishment_id);
  select coalesce(p.copilot_actions_enabled,false) into plan_enabled
    from public.subscriptions s join public.plans p on p.id=s.plan_id
    where s.establishment_id=requested_establishment_id and s.status in ('trialing','active') limit 1;
  if not coalesce(plan_enabled,false) then return false; end if;
  if requested_action_type='PRODUCT_SET_AVAILABILITY' then return role_name in ('owner','manager','admin','catalog_editor'); end if;
  if requested_action_type in ('CHANGE_CONVERSATION_PRIORITY','ASSIGN_CONVERSATION','QUEUE_ADJUST_CAPACITY') then
    return role_name in ('owner','manager','admin') or private.has_support_permission(requested_establishment_id,'transfer');
  end if;
  return role_name in ('owner','manager','admin');
end $$;

create policy copilot_action_settings_read on public.copilot_action_settings for select to authenticated
  using(private.copilot_action_role(establishment_id) is not null);
create policy copilot_action_requests_read on public.copilot_action_requests for select to authenticated
  using(private.copilot_action_role(establishment_id) is not null);
create policy copilot_action_approvals_read on public.copilot_action_approvals for select to authenticated
  using(exists(select 1 from public.copilot_action_requests r where r.id=action_id and private.copilot_action_role(r.establishment_id) is not null));
create policy copilot_action_events_read on public.copilot_action_events for select to authenticated
  using(private.copilot_action_role(establishment_id) is not null);
create policy copilot_temp_operations_read on public.copilot_temporary_operations for select to authenticated
  using(private.copilot_action_role(establishment_id) is not null);
create policy copilot_rules_read on public.copilot_rule_definitions for select to authenticated
  using(private.copilot_action_role(establishment_id) is not null);

create or replace function private.copilot_event(requested_action_id uuid,requested_event text,requested_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare r public.copilot_action_requests%rowtype;
begin
  select * into r from public.copilot_action_requests where id=requested_action_id;
  if r.id is not null then
    insert into public.copilot_action_events(action_id,organization_id,establishment_id,actor_id,event_type,metadata)
    values(r.id,r.organization_id,r.establishment_id,(select auth.uid()),requested_event,coalesce(requested_metadata,'{}'));
  end if;
end $$;

create or replace function public.preview_copilot_action(requested_establishment_id uuid,requested_action_type text,requested_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); org_id uuid; settings public.copilot_action_settings%rowtype;
  raw_token uuid:=gen_random_uuid(); saved public.copilot_action_requests%rowtype; before_data jsonb; preview_data jsonb;
  normalized jsonb:=coalesce(requested_payload,'{}'); ids uuid[]:='{}'; target_kind text; risk text:='MEDIUM';
  ttl integer; affected integer:=0; phrase text; required smallint:=1; idem text; duration_minutes integer;
  target_name text; target_uuid uuid; new_bool boolean; new_int integer;
begin
  if actor is null then raise exception 'Sessão expirada.'; end if;
  select organization_id into org_id from public.establishments where id=requested_establishment_id and unit_status<>'inactive';
  if org_id is null then raise exception 'Unidade não encontrada.'; end if;
  if requested_action_type not in ('PRODUCT_SET_AVAILABILITY','CAMPAIGN_PAUSE','CAMPAIGN_RESUME','STORE_TEMPORARILY_CLOSE','STORE_REOPEN','DELIVERY_TOGGLE','UPDATE_DELIVERY_ESTIMATE','AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE','ASSIGN_CONVERSATION','CHANGE_CONVERSATION_PRIORITY','QUEUE_ADJUST_CAPACITY') then
    raise exception 'Esta ação é proibida para o Copiloto.';
  end if;
  if not private.copilot_action_allowed(requested_establishment_id,requested_action_type) then
    raise exception 'Você não possui permissão ou seu plano não inclui ações do Copiloto.';
  end if;
  insert into public.copilot_action_settings(establishment_id) values(requested_establishment_id) on conflict do nothing;
  select * into settings from public.copilot_action_settings where establishment_id=requested_establishment_id;
  ttl:=settings.confirmation_ttl_seconds;

  if requested_action_type='PRODUCT_SET_AVAILABILITY' then
    target_kind:='product'; new_bool:=coalesce((normalized->>'new_value')::boolean,false);
    if jsonb_typeof(normalized->'target_ids')='array' then
      select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(normalized->'target_ids');
    elsif nullif(normalized->>'target_id','') is not null then ids:=array[(normalized->>'target_id')::uuid];
    else
      target_name:=nullif(btrim(normalized->>'target_name'),'');
      select array_agg(id) into ids from public.products where establishment_id=requested_establishment_id and lower(name)=lower(target_name);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'updated_at',updated_at) order by id),'[]'),count(*)
      into before_data,affected from public.products where establishment_id=requested_establishment_id and id=any(coalesce(ids,'{}'));
    if affected=0 then raise exception 'Produto não encontrado nesta unidade.'; end if;
    if affected>100 then raise exception 'Limite máximo de 100 produtos por ação.'; end if;
    if affected=1 and (before_data->0->>'active')::boolean=new_bool then
      preview_data:=jsonb_build_object('title','Nenhuma alteração necessária','impact','O produto já está no estado solicitado.','affected_count',1,'already_applied',true);
    else preview_data:=jsonb_build_object('title',case when new_bool then 'Disponibilizar produto' else 'Marcar produto como indisponível' end,'impact',case when new_bool then 'O produto voltará a aparecer para novos pedidos.' else 'O produto deixará de aparecer como disponível para novos pedidos.' end,'affected_count',affected,'items',before_data); end if;
    if affected>settings.common_action_limit then risk:='HIGH'; phrase:='CONFIRMAR ALTERAÇÃO EM '||affected||' PRODUTOS'; end if;
    normalized:=normalized||jsonb_build_object('target_ids',to_jsonb(ids),'new_value',new_bool);
  elsif requested_action_type in ('CAMPAIGN_PAUSE','CAMPAIGN_RESUME') then
    target_kind:='campaign'; target_uuid:=nullif(normalized->>'target_id','')::uuid; target_name:=nullif(btrim(normalized->>'target_name'),'');
    select id into target_uuid from public.crm_campaigns where establishment_id=requested_establishment_id and (id=target_uuid or (target_uuid is null and lower(name)=lower(target_name))) order by created_at desc limit 1;
    select jsonb_build_object('id',id,'name',name,'status',status,'remaining',greatest(estimated_recipients-sent_count,0),'updated_at',updated_at) into before_data from public.crm_campaigns where id=target_uuid and establishment_id=requested_establishment_id;
    if before_data is null then raise exception 'Campanha não encontrada nesta unidade.'; end if;
    ids:=array[target_uuid];
    preview_data:=jsonb_build_object('title',case when requested_action_type='CAMPAIGN_PAUSE' then 'Pausar campanha' else 'Retomar campanha' end,'impact',case when requested_action_type='CAMPAIGN_PAUSE' then 'Novos envios serão interrompidos; mensagens já enviadas não serão recolhidas.' else 'A campanha voltará à fila de envio aprovada.' end,'affected_count',1,'items',jsonb_build_array(before_data));
    normalized:=normalized||jsonb_build_object('target_id',target_uuid);
  elsif requested_action_type in ('STORE_TEMPORARILY_CLOSE','STORE_REOPEN') then
    target_kind:='store'; risk:='HIGH'; ids:=array[requested_establishment_id];
    select jsonb_build_object('id',e.id,'name',e.name,'active',e.active,'unit_status',e.unit_status,'store_open',coalesce(sm.store_open,true),'updated_at',e.updated_at) into before_data from public.establishments e left join public.service_modes sm on sm.establishment_id=e.id where e.id=requested_establishment_id;
    duration_minutes:=coalesce((normalized->>'duration_minutes')::integer,60);
    if requested_action_type='STORE_TEMPORARILY_CLOSE' and (duration_minutes<5 or duration_minutes>1440) then raise exception 'O fechamento temporário deve durar entre 5 minutos e 24 horas.'; end if;
    preview_data:=jsonb_build_object('title',case when requested_action_type='STORE_REOPEN' then 'Reabrir unidade' else 'Fechar unidade temporariamente' end,'impact',case when requested_action_type='STORE_REOPEN' then 'A unidade voltará a aceitar novos pedidos.' else 'A unidade ficará indisponível para novos pedidos até '||to_char(now()+make_interval(mins=>duration_minutes),'HH24:MI')||'. A reabertura será automática.' end,'affected_count',1,'items',jsonb_build_array(before_data));
    normalized:=normalized||jsonb_build_object('duration_minutes',duration_minutes);
  elsif requested_action_type in ('DELIVERY_TOGGLE','UPDATE_DELIVERY_ESTIMATE') then
    target_kind:='delivery_settings'; ids:=array[requested_establishment_id];
    select jsonb_build_object('delivery_enabled',delivery_enabled,'estimated_minutes',estimated_minutes,'updated_at',updated_at) into before_data from public.establishment_settings where establishment_id=requested_establishment_id;
    if requested_action_type='DELIVERY_TOGGLE' then
      new_bool:=coalesce((normalized->>'new_value')::boolean,false); normalized:=normalized||jsonb_build_object('new_value',new_bool);
      preview_data:=jsonb_build_object('title',case when new_bool then 'Reativar delivery' else 'Pausar delivery' end,'impact',case when new_bool then 'Pedidos de entrega voltarão a ser aceitos.' else 'Novos pedidos de entrega serão interrompidos; pedidos atuais continuam visíveis.' end,'affected_count',1);
    else
      new_int:=(normalized->>'estimated_minutes')::integer; if new_int<15 or new_int>180 then raise exception 'A previsão deve ficar entre 15 e 180 minutos.'; end if;
      preview_data:=jsonb_build_object('title','Atualizar prazo de entrega','impact','A previsão exibida ao cliente mudará de '||coalesce(before_data->>'estimated_minutes','não definida')||' para '||new_int||' minutos.','affected_count',1); normalized:=normalized||jsonb_build_object('estimated_minutes',new_int);
    end if;
  elsif requested_action_type in ('AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE') then
    target_kind:='whatsapp_connection';
    select id into target_uuid from public.whatsapp_connections where establishment_id=requested_establishment_id limit 1;
    if target_uuid is null then raise exception 'Conexão do WhatsApp não configurada.'; end if;
    ids:=array[target_uuid];
    select jsonb_build_object('id',id,'ai_enabled',ai_enabled,'automatic_replies_enabled',automatic_replies_enabled,'cart_recovery_enabled',cart_recovery_enabled,'updated_at',updated_at) into before_data from public.whatsapp_connections where id=target_uuid;
    new_bool:=coalesce((normalized->>'new_value')::boolean,false); normalized:=normalized||jsonb_build_object('new_value',new_bool,'target_id',target_uuid);
    preview_data:=jsonb_build_object('title',case when requested_action_type='AI_TOGGLE' then case when new_bool then 'Ativar atendente IA' else 'Colocar atendimento em modo humano' end else case when new_bool then 'Ativar automação do WhatsApp' else 'Pausar automação do WhatsApp' end end,'impact','A mudança afeta somente novas respostas; conversas e histórico serão preservados.','affected_count',1);
  elsif requested_action_type='CHANGE_CONVERSATION_PRIORITY' then
    target_kind:='conversation'; target_uuid:=(normalized->>'target_id')::uuid;
    if normalized->>'priority' not in ('normal','high','urgent') then raise exception 'Prioridade inválida.'; end if;
    select jsonb_build_object('id',id,'priority',priority,'updated_at',updated_at) into before_data from public.whatsapp_conversations where id=target_uuid and establishment_id=requested_establishment_id;
    if before_data is null then raise exception 'Conversa não encontrada nesta unidade.'; end if;
    ids:=array[target_uuid]; preview_data:=jsonb_build_object('title','Alterar prioridade da conversa','impact','A conversa será reposicionada na fila sem alterar mensagens ou responsável.','affected_count',1);
  elsif requested_action_type='ASSIGN_CONVERSATION' then
    target_kind:='conversation'; target_uuid:=(normalized->>'target_id')::uuid;
    if not exists(select 1 from public.whatsapp_conversations where id=target_uuid and establishment_id=requested_establishment_id) then raise exception 'Conversa não encontrada nesta unidade.'; end if;
    if not exists(select 1 from public.establishment_members where establishment_id=requested_establishment_id and user_id=(normalized->>'user_id')::uuid and status='active') then raise exception 'Funcionário não pertence à unidade.'; end if;
    select jsonb_build_object('id',id,'assigned_user_id',assigned_user_id,'queue_id',queue_id,'updated_at',updated_at) into before_data from public.whatsapp_conversations where id=target_uuid;
    ids:=array[target_uuid]; preview_data:=jsonb_build_object('title','Redistribuir conversa','impact','A responsabilidade da conversa será transferida para o funcionário selecionado.','affected_count',1);
  else
    target_kind:='support_settings'; new_int:=(normalized->>'capacity')::integer;
    if new_int<1 or new_int>100 then raise exception 'A capacidade deve ficar entre 1 e 100.'; end if;
    insert into public.support_settings(establishment_id) values(requested_establishment_id) on conflict do nothing;
    select jsonb_build_object('overload_queue_threshold',overload_queue_threshold,'updated_at',updated_at) into before_data from public.support_settings where establishment_id=requested_establishment_id;
    ids:=array[requested_establishment_id]; preview_data:=jsonb_build_object('title','Ajustar capacidade da fila','impact','O alerta de sobrecarga passará a considerar '||new_int||' conversas aguardando.','affected_count',1);
  end if;

  if risk='HIGH' and settings.approval_mode='conservative' then required:=2; end if;
  if phrase is null and risk='HIGH' then phrase:='CONFIRMAR ALTERAÇÃO'; end if;
  idem:=encode(extensions.digest(actor::text||requested_establishment_id::text||requested_action_type||normalized::text||date_trunc('minute',now())::text,'sha256'),'hex');
  insert into public.copilot_action_requests(organization_id,establishment_id,requested_by,action_type,risk_level,target_type,target_ids,normalized_payload,preview,before_state,confirmation_token_hash,confirmation_phrase,confirmation_expires_at,required_approvals,idempotency_key,status)
  values(org_id,requested_establishment_id,actor,requested_action_type,risk,target_kind,coalesce(ids,'{}'),normalized,preview_data,before_data,encode(extensions.digest(raw_token::text,'sha256'),'hex'),phrase,now()+make_interval(secs=>ttl),required,idem,case when coalesce((preview_data->>'already_applied')::boolean,false) then 'already_applied' else 'pending_confirmation' end)
  on conflict(establishment_id,idempotency_key) do update set updated_at=now()
  returning * into saved;
  perform private.copilot_event(saved.id,'action_requested',jsonb_build_object('action_type',requested_action_type,'risk',risk));
  perform private.copilot_event(saved.id,'action_previewed',preview_data);
  return jsonb_build_object('id',saved.id,'action_type',saved.action_type,'risk_level',saved.risk_level,'status',saved.status,'preview',saved.preview,'confirmation_token',case when saved.confirmation_token_hash=encode(extensions.digest(raw_token::text,'sha256'),'hex') then raw_token else null end,'confirmation_phrase',saved.confirmation_phrase,'expires_at',saved.confirmation_expires_at,'required_approvals',saved.required_approvals,'undo_supported',requested_action_type not in ('STORE_TEMPORARILY_CLOSE','STORE_REOPEN','ASSIGN_CONVERSATION'));
end $$;

create or replace function private.execute_copilot_action(requested_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.copilot_action_requests%rowtype; current_state jsonb; after_data jsonb; new_bool boolean; new_int integer; restore_at timestamptz;
begin
  select * into r from public.copilot_action_requests where id=requested_action_id for update;
  if r.status='executed' then return jsonb_build_object('status','executed','message','Esta ação já foi executada.','action_id',r.id); end if;
  if r.status not in ('pending_confirmation','pending_approval') then raise exception 'Ação não está disponível para execução.'; end if;
  if r.action_type='PRODUCT_SET_AVAILABILITY' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'updated_at',updated_at) order by id),'[]') into current_state from public.products where establishment_id=r.establishment_id and id=any(r.target_ids);
  elsif r.action_type in ('CAMPAIGN_PAUSE','CAMPAIGN_RESUME') then
    select jsonb_build_object('id',id,'name',name,'status',status,'remaining',greatest(estimated_recipients-sent_count,0),'updated_at',updated_at) into current_state from public.crm_campaigns where id=r.target_ids[1] and establishment_id=r.establishment_id for update;
  elsif r.action_type in ('STORE_TEMPORARILY_CLOSE','STORE_REOPEN') then
    select jsonb_build_object('id',e.id,'name',e.name,'active',e.active,'unit_status',e.unit_status,'store_open',coalesce(sm.store_open,true),'updated_at',e.updated_at) into current_state from public.establishments e left join public.service_modes sm on sm.establishment_id=e.id where e.id=r.establishment_id for update of e;
  elsif r.action_type in ('DELIVERY_TOGGLE','UPDATE_DELIVERY_ESTIMATE') then
    select jsonb_build_object('delivery_enabled',delivery_enabled,'estimated_minutes',estimated_minutes,'updated_at',updated_at) into current_state from public.establishment_settings where establishment_id=r.establishment_id for update;
  elsif r.action_type in ('AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE') then
    select jsonb_build_object('id',id,'ai_enabled',ai_enabled,'automatic_replies_enabled',automatic_replies_enabled,'cart_recovery_enabled',cart_recovery_enabled,'updated_at',updated_at) into current_state from public.whatsapp_connections where id=r.target_ids[1] for update;
  elsif r.action_type in ('CHANGE_CONVERSATION_PRIORITY','ASSIGN_CONVERSATION') then
    select case when r.action_type='CHANGE_CONVERSATION_PRIORITY' then jsonb_build_object('id',id,'priority',priority,'updated_at',updated_at) else jsonb_build_object('id',id,'assigned_user_id',assigned_user_id,'queue_id',queue_id,'updated_at',updated_at) end into current_state from public.whatsapp_conversations where id=r.target_ids[1] and establishment_id=r.establishment_id for update;
  else
    select jsonb_build_object('overload_queue_threshold',overload_queue_threshold,'updated_at',updated_at) into current_state from public.support_settings where establishment_id=r.establishment_id for update;
  end if;
  if current_state is distinct from r.before_state then
    update public.copilot_action_requests set status='conflict',failure_reason='A configuração mudou desde a confirmação.',updated_at=now() where id=r.id;
    perform private.copilot_event(r.id,'action_failed',jsonb_build_object('reason','version_conflict'));
    return jsonb_build_object('status','conflict','message','A configuração mudou desde a confirmação. Revise novamente.','action_id',r.id);
  end if;

  new_bool:=coalesce((r.normalized_payload->>'new_value')::boolean,false);
  if r.action_type='PRODUCT_SET_AVAILABILITY' then
    update public.products set active=new_bool,updated_at=now() where establishment_id=r.establishment_id and id=any(r.target_ids);
    select jsonb_agg(jsonb_build_object('id',id,'active',active,'updated_at',updated_at) order by id) into after_data from public.products where id=any(r.target_ids);
  elsif r.action_type='CAMPAIGN_PAUSE' then
    if current_state->>'status' not in ('scheduled','processing') then raise exception 'A campanha não pode mais ser pausada.'; end if;
    update public.crm_campaigns set status='paused',updated_at=now() where id=r.target_ids[1]; select jsonb_build_object('status',status,'updated_at',updated_at) into after_data from public.crm_campaigns where id=r.target_ids[1];
  elsif r.action_type='CAMPAIGN_RESUME' then
    if current_state->>'status'<>'paused' then raise exception 'A campanha não está pausada.'; end if;
    update public.crm_campaigns set status=case when scheduled_at>now() then 'scheduled' else 'processing' end,updated_at=now() where id=r.target_ids[1]; select jsonb_build_object('status',status,'updated_at',updated_at) into after_data from public.crm_campaigns where id=r.target_ids[1];
  elsif r.action_type='STORE_TEMPORARILY_CLOSE' then
    perform public.set_organization_store_status(r.establishment_id,'temporarily_closed'); restore_at:=now()+make_interval(mins=>(r.normalized_payload->>'duration_minutes')::integer);
    insert into public.copilot_temporary_operations(action_id,organization_id,establishment_id,operation_type,restore_state,restore_at) values(r.id,r.organization_id,r.establishment_id,'STORE_REOPEN',r.before_state,restore_at);
    after_data:=jsonb_build_object('unit_status','temporarily_closed','restore_at',restore_at);
  elsif r.action_type='STORE_REOPEN' then
    perform public.set_organization_store_status(r.establishment_id,'active'); after_data:=jsonb_build_object('unit_status','active');
    update public.copilot_temporary_operations set status='cancelled' where establishment_id=r.establishment_id and status='scheduled';
  elsif r.action_type='DELIVERY_TOGGLE' then
    update public.establishment_settings set delivery_enabled=new_bool,updated_at=now() where establishment_id=r.establishment_id; after_data:=jsonb_build_object('delivery_enabled',new_bool);
  elsif r.action_type='UPDATE_DELIVERY_ESTIMATE' then
    new_int:=(r.normalized_payload->>'estimated_minutes')::integer; update public.establishment_settings set estimated_minutes=new_int,updated_at=now() where establishment_id=r.establishment_id; after_data:=jsonb_build_object('estimated_minutes',new_int);
  elsif r.action_type='AI_TOGGLE' then
    update public.whatsapp_connections set ai_enabled=new_bool,automatic_replies_enabled=new_bool,updated_at=now() where id=r.target_ids[1]; after_data:=jsonb_build_object('ai_enabled',new_bool,'automatic_replies_enabled',new_bool);
  elsif r.action_type='WHATSAPP_AUTOMATION_TOGGLE' then
    update public.whatsapp_connections set cart_recovery_enabled=new_bool,updated_at=now() where id=r.target_ids[1]; after_data:=jsonb_build_object('cart_recovery_enabled',new_bool);
  elsif r.action_type='CHANGE_CONVERSATION_PRIORITY' then
    update public.whatsapp_conversations set priority=r.normalized_payload->>'priority',priority_source='manual',updated_at=now() where id=r.target_ids[1]; after_data:=jsonb_build_object('priority',r.normalized_payload->>'priority');
  elsif r.action_type='ASSIGN_CONVERSATION' then
    perform public.transfer_support_conversation(r.target_ids[1],null,(r.normalized_payload->>'user_id')::uuid,'Copiloto do Gestor',coalesce(r.normalized_payload->>'summary','Redistribuição aprovada pelo gestor.')); after_data:=jsonb_build_object('assigned_user_id',r.normalized_payload->>'user_id');
  else
    new_int:=(r.normalized_payload->>'capacity')::integer; update public.support_settings set overload_queue_threshold=new_int,updated_at=now() where establishment_id=r.establishment_id; after_data:=jsonb_build_object('overload_queue_threshold',new_int);
  end if;
  update public.copilot_action_requests set status='executed',after_state=after_data,executed_at=now(),undo_expires_at=case when action_type in ('STORE_TEMPORARILY_CLOSE','STORE_REOPEN','ASSIGN_CONVERSATION') then null else now()+(select make_interval(secs=>undo_ttl_seconds) from public.copilot_action_settings where establishment_id=r.establishment_id) end,result=jsonb_build_object('success',true),updated_at=now() where id=r.id returning * into r;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(r.establishment_id,(select auth.uid()),'copilot.action_executed',r.target_type,coalesce(r.target_ids[1],r.establishment_id),jsonb_build_object('action_id',r.id,'action_type',r.action_type,'before',r.before_state,'after',r.after_state,'source','copilot'));
  perform private.copilot_event(r.id,'action_executed',jsonb_build_object('result',r.after_state));
  return jsonb_build_object('status','executed','message','Alteração concluída com segurança.','action_id',r.id,'result',r.after_state,'undo_expires_at',r.undo_expires_at);
exception when others then
  update public.copilot_action_requests set status='failed',failure_reason=left(sqlerrm,1000),updated_at=now() where id=requested_action_id;
  perform private.copilot_event(requested_action_id,'action_failed',jsonb_build_object('reason',left(sqlerrm,300)));
  raise;
end $$;

create or replace function public.confirm_copilot_action(requested_action_id uuid,requested_confirmation_token uuid,requested_confirmation_text text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.copilot_action_requests%rowtype; approvals integer; actor uuid:=(select auth.uid());
begin
  select * into r from public.copilot_action_requests where id=requested_action_id for update;
  if actor is null or r.id is null or not private.copilot_action_allowed(r.establishment_id,r.action_type) then raise exception 'Ação não encontrada ou não autorizada.'; end if;
  if r.status='executed' then return jsonb_build_object('status','executed','message','Esta ação já foi executada.','action_id',r.id); end if;
  if r.confirmation_expires_at<=now() then update public.copilot_action_requests set status='expired',updated_at=now() where id=r.id; perform private.copilot_event(r.id,'action_expired'); return jsonb_build_object('status','expired','message','Essa confirmação expirou. Verifique a situação novamente.'); end if;
  if r.confirmation_token_hash<>encode(extensions.digest(requested_confirmation_token::text,'sha256'),'hex') then raise exception 'Confirmação inválida para esta ação.'; end if;
  if r.confirmation_phrase is not null and coalesce(requested_confirmation_text,'')<>r.confirmation_phrase then raise exception 'Use a confirmação reforçada exibida na prévia.'; end if;
  insert into public.copilot_action_approvals(action_id,user_id,decision) values(r.id,actor,'approved') on conflict(action_id,user_id) do update set decision='approved',decided_at=now();
  select count(*) into approvals from public.copilot_action_approvals where action_id=r.id and decision='approved';
  update public.copilot_action_requests set confirmed_at=coalesce(confirmed_at,now()),status=case when approvals>=required_approvals then 'pending_confirmation' else 'pending_approval' end,updated_at=now() where id=r.id;
  perform private.copilot_event(r.id,'action_confirmed',jsonb_build_object('approval_count',approvals,'required',r.required_approvals));
  if approvals<r.required_approvals then return jsonb_build_object('status','pending_approval','message','Primeira aprovação registrada. Aguardando outro responsável autorizado.','approval_count',approvals,'required_approvals',r.required_approvals); end if;
  begin
    return private.execute_copilot_action(r.id);
  exception when others then
    update public.copilot_action_requests set status='failed',failure_reason=left(sqlerrm,1000),updated_at=now() where id=r.id;
    perform private.copilot_event(r.id,'action_failed',jsonb_build_object('reason',left(sqlerrm,300)));
    return jsonb_build_object('status','failed','message','A alteração não foi concluída. Nada foi executado.','action_id',r.id);
  end;
end $$;

create or replace function public.cancel_copilot_action(requested_action_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.copilot_action_requests%rowtype;
begin
  select * into r from public.copilot_action_requests where id=requested_action_id for update;
  if r.id is null or (select auth.uid())<>r.requested_by then raise exception 'Ação não encontrada.'; end if;
  if r.status not in ('pending_confirmation','pending_approval') then raise exception 'Ação não pode mais ser cancelada.'; end if;
  update public.copilot_action_requests set status='cancelled',updated_at=now() where id=r.id; perform private.copilot_event(r.id,'action_cancelled');
end $$;

create or replace function public.undo_copilot_action(requested_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.copilot_action_requests%rowtype; item jsonb;
begin
  select * into r from public.copilot_action_requests where id=requested_action_id for update;
  if r.id is null or not private.copilot_action_allowed(r.establishment_id,r.action_type) then raise exception 'Ação não encontrada ou não autorizada.'; end if;
  if r.status<>'executed' or r.undo_expires_at is null or r.undo_expires_at<=now() then raise exception 'Esta ação não pode mais ser desfeita.'; end if;
  if r.action_type='PRODUCT_SET_AVAILABILITY' then
    for item in select * from jsonb_array_elements(r.before_state) loop update public.products set active=(item->>'active')::boolean,updated_at=now() where id=(item->>'id')::uuid and establishment_id=r.establishment_id; end loop;
  elsif r.action_type in ('CAMPAIGN_PAUSE','CAMPAIGN_RESUME') then update public.crm_campaigns set status=r.before_state->>'status',updated_at=now() where id=r.target_ids[1] and establishment_id=r.establishment_id;
  elsif r.action_type='DELIVERY_TOGGLE' then update public.establishment_settings set delivery_enabled=(r.before_state->>'delivery_enabled')::boolean,updated_at=now() where establishment_id=r.establishment_id;
  elsif r.action_type='UPDATE_DELIVERY_ESTIMATE' then update public.establishment_settings set estimated_minutes=nullif(r.before_state->>'estimated_minutes','')::integer,updated_at=now() where establishment_id=r.establishment_id;
  elsif r.action_type in ('AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE') then update public.whatsapp_connections set ai_enabled=coalesce((r.before_state->>'ai_enabled')::boolean,ai_enabled),automatic_replies_enabled=coalesce((r.before_state->>'automatic_replies_enabled')::boolean,automatic_replies_enabled),cart_recovery_enabled=coalesce((r.before_state->>'cart_recovery_enabled')::boolean,cart_recovery_enabled),updated_at=now() where id=r.target_ids[1];
  elsif r.action_type='CHANGE_CONVERSATION_PRIORITY' then update public.whatsapp_conversations set priority=r.before_state->>'priority',updated_at=now() where id=r.target_ids[1] and establishment_id=r.establishment_id;
  elsif r.action_type='QUEUE_ADJUST_CAPACITY' then update public.support_settings set overload_queue_threshold=(r.before_state->>'overload_queue_threshold')::integer,updated_at=now() where establishment_id=r.establishment_id;
  else raise exception 'Desfazer não é seguro para esta ação.'; end if;
  update public.copilot_action_requests set status='undone',undone_at=now(),undone_by=(select auth.uid()),updated_at=now() where id=r.id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(r.establishment_id,(select auth.uid()),'copilot.action_undone',r.target_type,coalesce(r.target_ids[1],r.establishment_id),jsonb_build_object('action_id',r.id,'restored',r.before_state));
  perform private.copilot_event(r.id,'action_undone',jsonb_build_object('restored',r.before_state));
  return jsonb_build_object('status','undone','message','A alteração foi desfeita com segurança.','action_id',r.id);
end $$;

create or replace function public.list_copilot_actions(requested_establishment_id uuid,requested_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if private.copilot_action_role(requested_establishment_id) is null then raise exception 'Sem permissão.'; end if;
  return jsonb_build_object(
    'actions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,action_type,risk_level,status,preview,required_approvals,confirmed_at,executed_at,undo_expires_at,created_at from public.copilot_action_requests where establishment_id=requested_establishment_id order by created_at desc limit least(greatest(requested_limit,1),100))x),'[]'),
    'temporary',coalesce((select jsonb_agg(to_jsonb(t) order by t.restore_at) from public.copilot_temporary_operations t where t.establishment_id=requested_establishment_id and t.status='scheduled'),'[]'),
    'metrics',(select jsonb_build_object('suggested',count(*),'confirmed',count(*) filter(where confirmed_at is not null),'executed',count(*) filter(where status in ('executed','undone')),'cancelled',count(*) filter(where status='cancelled'),'failed',count(*) filter(where status in ('failed','conflict')),'undone',count(*) filter(where status='undone'),'average_confirmation_seconds',round(avg(extract(epoch from(confirmed_at-created_at))) filter(where confirmed_at is not null))) from public.copilot_action_requests where establishment_id=requested_establishment_id)
  );
end $$;

create or replace function public.process_due_copilot_temporary_operations(requested_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare op public.copilot_temporary_operations%rowtype; processed integer:=0;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao scheduler.'; end if;
  for op in select * from public.copilot_temporary_operations where status='scheduled' and restore_at<=now() order by restore_at for update skip locked limit least(greatest(requested_limit,1),500) loop
    begin
      update public.establishments set active=coalesce((op.restore_state->>'active')::boolean,true),unit_status=coalesce(op.restore_state->>'unit_status','active'),updated_at=now() where id=op.establishment_id;
      update public.service_modes set store_open=coalesce((op.restore_state->>'store_open')::boolean,true),updated_at=now() where establishment_id=op.establishment_id;
      update public.copilot_temporary_operations set status='restored',restored_at=now() where id=op.id;
      insert into public.copilot_action_events(action_id,organization_id,establishment_id,event_type,metadata) values(op.action_id,op.organization_id,op.establishment_id,'action_executed',jsonb_build_object('automatic_restore',true)); processed:=processed+1;
    exception when others then update public.copilot_temporary_operations set status='failed',failure_reason=left(sqlerrm,1000) where id=op.id; end;
  end loop;
  return processed;
end $$;

create or replace function public.configure_copilot_action_settings(requested_establishment_id uuid,requested_mode text,requested_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.copilot_action_settings%rowtype;
begin
  if private.copilot_action_role(requested_establishment_id) not in ('owner','manager','admin') then raise exception 'Sem permissão.'; end if;
  if requested_mode not in ('conservative','standard') then raise exception 'Modo inválido.'; end if;
  insert into public.copilot_action_settings(establishment_id,approval_mode,common_action_limit,updated_by) values(requested_establishment_id,requested_mode,least(greatest(requested_limit,1),100),(select auth.uid())) on conflict(establishment_id) do update set approval_mode=excluded.approval_mode,common_action_limit=excluded.common_action_limit,updated_by=excluded.updated_by,updated_at=now() returning * into saved;
  return to_jsonb(saved)-'updated_by';
end $$;

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') and not exists(select 1 from cron.job where jobname='masterapp-copilot-temporary-operations') then
    perform cron.schedule('masterapp-copilot-temporary-operations','* * * * *','select public.process_due_copilot_temporary_operations(100)');
  end if;
end $$;

revoke all on table public.copilot_action_settings,public.copilot_action_requests,public.copilot_action_approvals,public.copilot_action_events,public.copilot_temporary_operations,public.copilot_rule_definitions from anon,authenticated;
grant select on table public.copilot_action_settings,public.copilot_action_requests,public.copilot_action_approvals,public.copilot_action_events,public.copilot_temporary_operations,public.copilot_rule_definitions to service_role;
revoke all on function public.preview_copilot_action(uuid,text,jsonb),public.confirm_copilot_action(uuid,uuid,text),public.cancel_copilot_action(uuid),public.undo_copilot_action(uuid),public.list_copilot_actions(uuid,integer),public.configure_copilot_action_settings(uuid,text,integer),public.process_due_copilot_temporary_operations(integer) from public,anon;
revoke all on function public.process_due_copilot_temporary_operations(integer) from authenticated;
revoke all on function private.copilot_action_role(uuid),private.copilot_action_allowed(uuid,text),private.copilot_event(uuid,text,jsonb),private.execute_copilot_action(uuid) from public,anon,authenticated;
grant execute on function public.preview_copilot_action(uuid,text,jsonb),public.confirm_copilot_action(uuid,uuid,text),public.cancel_copilot_action(uuid),public.undo_copilot_action(uuid),public.list_copilot_actions(uuid,integer),public.configure_copilot_action_settings(uuid,text,integer) to authenticated;
grant execute on function public.process_due_copilot_temporary_operations(integer) to service_role;

