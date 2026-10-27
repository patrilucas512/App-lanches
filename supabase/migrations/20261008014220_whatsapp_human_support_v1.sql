-- Official WhatsApp Business Platform / Cloud API human support module.
-- Secrets live in Supabase Vault and are never exposed through table grants.

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  phone_number_id text not null,
  whatsapp_business_account_id text not null,
  display_phone_number text,
  verified_name text,
  status text not null default 'connected' check (status in ('connected','disconnected','error')),
  webhook_status text not null default 'pending' check (webhook_status in ('pending','verified','error')),
  access_token_secret_id uuid,
  app_secret_id uuid,
  verify_token_secret_id uuid,
  graph_api_version text not null default 'v23.0',
  ai_enabled boolean not null default false,
  automatic_replies_enabled boolean not null default false,
  human_handoff_enabled boolean not null default true,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_webhook_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id),
  unique (phone_number_id)
);

create table public.whatsapp_member_permissions (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_view boolean not null default false,
  can_respond boolean not null default false,
  can_claim boolean not null default false,
  can_resolve boolean not null default false,
  can_configure boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (establishment_id, user_id)
);

create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  wa_id text not null,
  phone_number text not null,
  name text,
  profile_name text,
  first_message_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, wa_id)
);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  status text not null default 'open' check (status in ('open','waiting','resolved')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_id uuid,
  last_message_preview text,
  last_message_at timestamptz,
  human_controlled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, contact_id),
  unique (id, establishment_id)
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  conversation_id uuid not null,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  whatsapp_message_id text,
  client_request_id uuid,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  content text,
  media_reference text,
  status text not null default 'received' check (status in ('received','pending','sent','delivered','read','failed')),
  sent_by_user_id uuid references auth.users(id) on delete set null,
  error_code text,
  error_message text,
  message_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, establishment_id) references public.whatsapp_conversations(id, establishment_id) on delete cascade,
  unique (establishment_id, whatsapp_message_id),
  unique (establishment_id, client_request_id)
);

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_last_message_fk foreign key (last_message_id) references public.whatsapp_messages(id) on delete set null;

create index whatsapp_permissions_user_idx on public.whatsapp_member_permissions (user_id, establishment_id);
create index whatsapp_contacts_recent_idx on public.whatsapp_contacts (establishment_id, last_message_at desc);
create index whatsapp_conversations_inbox_idx on public.whatsapp_conversations (establishment_id, status, last_message_at desc);
create index whatsapp_conversations_unread_idx on public.whatsapp_conversations (establishment_id, last_message_at desc) where unread_count > 0;
create index whatsapp_conversations_assignee_idx on public.whatsapp_conversations (establishment_id, assigned_user_id) where assigned_user_id is not null;
create index whatsapp_messages_history_idx on public.whatsapp_messages (establishment_id, conversation_id, message_timestamp, id);
create index whatsapp_messages_contact_idx on public.whatsapp_messages (establishment_id, contact_id, message_timestamp desc);

create trigger whatsapp_connections_touch before update on public.whatsapp_connections for each row execute function public.touch_updated_at();
create trigger whatsapp_member_permissions_touch before update on public.whatsapp_member_permissions for each row execute function public.touch_updated_at();
create trigger whatsapp_contacts_touch before update on public.whatsapp_contacts for each row execute function public.touch_updated_at();
create trigger whatsapp_conversations_touch before update on public.whatsapp_conversations for each row execute function public.touch_updated_at();
create trigger whatsapp_messages_touch before update on public.whatsapp_messages for each row execute function public.touch_updated_at();

create or replace function private.has_whatsapp_permission(target_establishment uuid, requested_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(target_establishment, array['owner','manager']::public.member_role[])
    or exists (
      select 1 from public.whatsapp_member_permissions p
      where p.establishment_id=target_establishment and p.user_id=(select auth.uid())
        and case requested_permission
          when 'view' then p.can_view
          when 'respond' then p.can_respond
          when 'claim' then p.can_claim
          when 'resolve' then p.can_resolve
          when 'configure' then p.can_configure
          else false
        end
    )
$$;

revoke all on function private.has_whatsapp_permission(uuid,text) from public,anon;
grant execute on function private.has_whatsapp_permission(uuid,text) to authenticated;

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_member_permissions enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

create policy whatsapp_connections_read on public.whatsapp_connections for select to authenticated
using (private.has_whatsapp_permission(establishment_id,'view'));
create policy whatsapp_permissions_read on public.whatsapp_member_permissions for select to authenticated
using (user_id=(select auth.uid()) or private.has_role(establishment_id,array['owner','manager']::public.member_role[]));
create policy whatsapp_contacts_read on public.whatsapp_contacts for select to authenticated
using (private.has_whatsapp_permission(establishment_id,'view'));
create policy whatsapp_conversations_read on public.whatsapp_conversations for select to authenticated
using (private.has_whatsapp_permission(establishment_id,'view'));
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated
using (private.has_whatsapp_permission(establishment_id,'view'));

revoke all on table public.whatsapp_connections, public.whatsapp_member_permissions, public.whatsapp_contacts, public.whatsapp_conversations, public.whatsapp_messages from anon;
grant select on table public.whatsapp_connections, public.whatsapp_member_permissions, public.whatsapp_contacts, public.whatsapp_conversations, public.whatsapp_messages to authenticated;

create or replace function public.configure_whatsapp_connection(
  requested_establishment_id uuid,
  requested_phone_number_id text,
  requested_waba_id text,
  requested_display_phone text,
  requested_verified_name text,
  requested_access_token text default null,
  requested_app_secret text default null,
  requested_verify_token text default null,
  requested_graph_api_version text default 'v23.0'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved public.whatsapp_connections%rowtype;
  access_id uuid; app_id uuid; verify_id uuid;
begin
  if not private.has_whatsapp_permission(requested_establishment_id,'configure') then raise exception 'Sem permissão para configurar o WhatsApp.'; end if;
  if nullif(btrim(requested_phone_number_id),'') is null or nullif(btrim(requested_waba_id),'') is null then raise exception 'Informe o Phone Number ID e o WhatsApp Business Account ID.'; end if;
  select * into saved from public.whatsapp_connections where establishment_id=requested_establishment_id for update;
  access_id:=saved.access_token_secret_id; app_id:=saved.app_secret_id; verify_id:=saved.verify_token_secret_id;
  if nullif(btrim(requested_access_token),'') is not null then
    if access_id is null then select vault.create_secret(requested_access_token,'masterapp-whatsapp-'||requested_establishment_id||'-access') into access_id;
    else perform vault.update_secret(access_id,requested_access_token); end if;
  end if;
  if nullif(btrim(requested_app_secret),'') is not null then
    if app_id is null then select vault.create_secret(requested_app_secret,'masterapp-whatsapp-'||requested_establishment_id||'-app') into app_id;
    else perform vault.update_secret(app_id,requested_app_secret); end if;
  end if;
  if nullif(btrim(requested_verify_token),'') is not null then
    if verify_id is null then select vault.create_secret(requested_verify_token,'masterapp-whatsapp-'||requested_establishment_id||'-verify') into verify_id;
    else perform vault.update_secret(verify_id,requested_verify_token); end if;
  end if;
  if access_id is null or app_id is null or verify_id is null then raise exception 'Informe Access Token, App Secret e Verify Token.'; end if;
  insert into public.whatsapp_connections(establishment_id,phone_number_id,whatsapp_business_account_id,display_phone_number,verified_name,status,webhook_status,access_token_secret_id,app_secret_id,verify_token_secret_id,graph_api_version,connected_at,disconnected_at,last_error)
  values(requested_establishment_id,btrim(requested_phone_number_id),btrim(requested_waba_id),nullif(btrim(requested_display_phone),''),nullif(btrim(requested_verified_name),''),'connected','pending',access_id,app_id,verify_id,coalesce(nullif(btrim(requested_graph_api_version),''),'v23.0'),now(),null,null)
  on conflict(establishment_id) do update set phone_number_id=excluded.phone_number_id,whatsapp_business_account_id=excluded.whatsapp_business_account_id,display_phone_number=excluded.display_phone_number,verified_name=excluded.verified_name,status='connected',access_token_secret_id=excluded.access_token_secret_id,app_secret_id=excluded.app_secret_id,verify_token_secret_id=excluded.verify_token_secret_id,graph_api_version=excluded.graph_api_version,connected_at=coalesce(public.whatsapp_connections.connected_at,now()),disconnected_at=null,last_error=null
  returning * into saved;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'whatsapp.connection_configured','whatsapp_connection',saved.id,jsonb_build_object('phone_number_id',saved.phone_number_id,'waba_id',saved.whatsapp_business_account_id));
  return jsonb_build_object('id',saved.id,'status',saved.status,'webhook_status',saved.webhook_status,'phone_number_id',saved.phone_number_id,'whatsapp_business_account_id',saved.whatsapp_business_account_id,'display_phone_number',saved.display_phone_number,'verified_name',saved.verified_name,'connected_at',saved.connected_at,'configured',true);
end $$;

create or replace function public.disconnect_whatsapp_connection(requested_establishment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare connection_id uuid;
begin
  if not private.has_whatsapp_permission(requested_establishment_id,'configure') then raise exception 'Sem permissão para desconectar o WhatsApp.'; end if;
  update public.whatsapp_connections set status='disconnected',disconnected_at=now() where establishment_id=requested_establishment_id returning id into connection_id;
  if connection_id is not null then insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id) values(requested_establishment_id,(select auth.uid()),'whatsapp.connection_disconnected','whatsapp_connection',connection_id); end if;
end $$;

create or replace function public.get_whatsapp_connection_secret(requested_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_connections%rowtype; access_token text; app_secret text; verify_token text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into c from public.whatsapp_connections where id=requested_connection_id;
  if c.id is null then raise exception 'Conexão não encontrada.'; end if;
  select decrypted_secret into access_token from vault.decrypted_secrets where id=c.access_token_secret_id;
  select decrypted_secret into app_secret from vault.decrypted_secrets where id=c.app_secret_id;
  select decrypted_secret into verify_token from vault.decrypted_secrets where id=c.verify_token_secret_id;
  return jsonb_build_object('access_token',access_token,'app_secret',app_secret,'verify_token',verify_token);
end $$;

create or replace function public.set_whatsapp_member_permissions(requested_establishment_id uuid, requested_user_id uuid, requested_permissions jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(requested_establishment_id,array['owner','manager']::public.member_role[]) then raise exception 'Somente administradores podem alterar permissões.'; end if;
  if not exists(select 1 from public.establishment_members where establishment_id=requested_establishment_id and user_id=requested_user_id) then raise exception 'Funcionário não pertence ao estabelecimento.'; end if;
  insert into public.whatsapp_member_permissions(establishment_id,user_id,can_view,can_respond,can_claim,can_resolve,can_configure)
  values(requested_establishment_id,requested_user_id,coalesce((requested_permissions->>'can_view')::boolean,false),coalesce((requested_permissions->>'can_respond')::boolean,false),coalesce((requested_permissions->>'can_claim')::boolean,false),coalesce((requested_permissions->>'can_resolve')::boolean,false),coalesce((requested_permissions->>'can_configure')::boolean,false))
  on conflict(establishment_id,user_id) do update set can_view=excluded.can_view,can_respond=excluded.can_respond,can_claim=excluded.can_claim,can_resolve=excluded.can_resolve,can_configure=excluded.can_configure;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'whatsapp.permissions_updated','profile',requested_user_id,requested_permissions);
end $$;

create or replace function public.claim_whatsapp_conversation(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare tenant_id uuid;
begin
  select establishment_id into tenant_id from public.whatsapp_conversations where id=requested_conversation_id;
  if tenant_id is null or not private.has_whatsapp_permission(tenant_id,'claim') then raise exception 'Conversa não encontrada ou sem permissão.'; end if;
  update public.whatsapp_conversations set assigned_user_id=(select auth.uid()),human_controlled=true,status='open' where id=requested_conversation_id and establishment_id=tenant_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id) values(tenant_id,(select auth.uid()),'whatsapp.conversation_claimed','whatsapp_conversation',requested_conversation_id);
end $$;

create or replace function public.resolve_whatsapp_conversation(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare tenant_id uuid;
begin
  select establishment_id into tenant_id from public.whatsapp_conversations where id=requested_conversation_id;
  if tenant_id is null or not private.has_whatsapp_permission(tenant_id,'resolve') then raise exception 'Conversa não encontrada ou sem permissão.'; end if;
  update public.whatsapp_conversations set status='resolved',human_controlled=false,unread_count=0 where id=requested_conversation_id and establishment_id=tenant_id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id) values(tenant_id,(select auth.uid()),'whatsapp.conversation_resolved','whatsapp_conversation',requested_conversation_id);
end $$;

create or replace function public.mark_whatsapp_conversation_read(requested_conversation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare tenant_id uuid;
begin
  select establishment_id into tenant_id from public.whatsapp_conversations where id=requested_conversation_id;
  if tenant_id is null or not private.has_whatsapp_permission(tenant_id,'view') then raise exception 'Conversa não encontrada ou sem permissão.'; end if;
  update public.whatsapp_conversations set unread_count=0 where id=requested_conversation_id and establishment_id=tenant_id;
end $$;

create or replace function public.process_whatsapp_inbound_message(requested_connection_id uuid, requested_message_id text, requested_wa_id text, requested_profile_name text, requested_content text, requested_message_type text, requested_timestamp timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_connections%rowtype; contact_id uuid; conversation_id uuid; inserted_message_id uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select * into c from public.whatsapp_connections where id=requested_connection_id and status='connected';
  if c.id is null then raise exception 'Conexão ativa não encontrada.'; end if;
  insert into public.whatsapp_contacts(establishment_id,wa_id,phone_number,name,profile_name,first_message_at,last_message_at)
  values(c.establishment_id,requested_wa_id,requested_wa_id,nullif(btrim(requested_profile_name),''),nullif(btrim(requested_profile_name),''),requested_timestamp,requested_timestamp)
  on conflict(establishment_id,wa_id) do update set name=coalesce(excluded.name,public.whatsapp_contacts.name),profile_name=coalesce(excluded.profile_name,public.whatsapp_contacts.profile_name),last_message_at=greatest(public.whatsapp_contacts.last_message_at,excluded.last_message_at)
  returning id into contact_id;
  insert into public.whatsapp_conversations(establishment_id,contact_id,status,last_message_at)
  values(c.establishment_id,contact_id,'open',requested_timestamp)
  on conflict(establishment_id,contact_id) do update set status=case when public.whatsapp_conversations.status='resolved' then 'open' else public.whatsapp_conversations.status end,last_message_at=greatest(public.whatsapp_conversations.last_message_at,excluded.last_message_at)
  returning id into conversation_id;
  insert into public.whatsapp_messages(establishment_id,conversation_id,contact_id,whatsapp_message_id,direction,message_type,content,status,message_timestamp)
  values(c.establishment_id,conversation_id,contact_id,requested_message_id,'inbound',coalesce(nullif(requested_message_type,''),'text'),requested_content,'received',requested_timestamp)
  on conflict(establishment_id,whatsapp_message_id) do nothing returning id into inserted_message_id;
  if inserted_message_id is not null then
    update public.whatsapp_conversations set unread_count=unread_count+1,last_message_id=inserted_message_id,last_message_preview=left(coalesce(requested_content,'['||requested_message_type||']'),180),last_message_at=requested_timestamp where id=conversation_id and establishment_id=c.establishment_id;
  end if;
  update public.whatsapp_connections set last_webhook_at=now(),webhook_status='verified',last_error=null where id=c.id;
  return inserted_message_id;
end $$;

create or replace function public.update_whatsapp_message_status(requested_connection_id uuid, requested_message_id text, requested_status text, requested_error_code text default null, requested_error_message text default null)
returns void language plpgsql security definer set search_path='' as $$
declare tenant_id uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao servidor.'; end if;
  select establishment_id into tenant_id from public.whatsapp_connections where id=requested_connection_id;
  if tenant_id is null or requested_status not in ('sent','delivered','read','failed') then raise exception 'Evento de status inválido.'; end if;
  update public.whatsapp_messages set
    status=case
      when requested_status='failed' then 'failed'
      when status='failed' then status
      when array_position(array['pending','sent','delivered','read'],requested_status) >= array_position(array['pending','sent','delivered','read'],status) then requested_status
      else status end,
    error_code=coalesce(requested_error_code,error_code),error_message=left(coalesce(requested_error_message,error_message),500)
  where establishment_id=tenant_id and whatsapp_message_id=requested_message_id;
  update public.whatsapp_connections set last_webhook_at=now(),webhook_status='verified' where id=requested_connection_id;
end $$;

revoke all on function public.configure_whatsapp_connection(uuid,text,text,text,text,text,text,text,text), public.disconnect_whatsapp_connection(uuid), public.set_whatsapp_member_permissions(uuid,uuid,jsonb), public.claim_whatsapp_conversation(uuid), public.resolve_whatsapp_conversation(uuid), public.mark_whatsapp_conversation_read(uuid) from public,anon;
grant execute on function public.configure_whatsapp_connection(uuid,text,text,text,text,text,text,text,text), public.disconnect_whatsapp_connection(uuid), public.set_whatsapp_member_permissions(uuid,uuid,jsonb), public.claim_whatsapp_conversation(uuid), public.resolve_whatsapp_conversation(uuid), public.mark_whatsapp_conversation_read(uuid) to authenticated;
revoke all on function public.get_whatsapp_connection_secret(uuid), public.process_whatsapp_inbound_message(uuid,text,text,text,text,text,timestamptz), public.update_whatsapp_message_status(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.get_whatsapp_connection_secret(uuid), public.process_whatsapp_inbound_message(uuid,text,text,text,text,text,timestamptz), public.update_whatsapp_message_status(uuid,text,text,text,text) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='whatsapp_conversations') then alter publication supabase_realtime add table public.whatsapp_conversations; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='whatsapp_messages') then alter publication supabase_realtime add table public.whatsapp_messages; end if;
  end if;
end $$;
