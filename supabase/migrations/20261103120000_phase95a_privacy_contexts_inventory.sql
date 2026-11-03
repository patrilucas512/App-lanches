-- Phase 95A: privacy contexts and the personal data map on top of Data Governance (Phase 76). Additive only; no second catalog.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

alter table public.plans add column if not exists privacy_operations_enabled boolean not null default false,add column if not exists privacy_dsr_portal_enabled boolean not null default false,add column if not exists privacy_retention_execution_enabled boolean not null default false,add column if not exists privacy_auto_anonymization_enabled boolean not null default false,add column if not exists privacy_ai_assistance_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists privacy_operations_enabled boolean not null default false,add column if not exists privacy_dsr_portal_enabled boolean not null default false,add column if not exists privacy_retention_execution_enabled boolean not null default false,add column if not exists privacy_auto_anonymization_enabled boolean not null default false,add column if not exists privacy_ai_assistance_enabled boolean not null default false;

-- Two kinds of controller. A tenant controls its customers', employees' and drivers' data (MasterApp is its processor);
-- MasterApp controls the data of its own SaaS customers. Every record below belongs to exactly one context.
create table public.privacy_contexts(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid references public.organizations(id) on delete cascade,
 kind text not null check(kind in('tenant_controller','platform_controller')),
 name text not null,dpo_user_id uuid references auth.users(id) on delete set null,dpo_contact text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((kind='tenant_controller')=(organization_id is not null)),
 unique(organization_id,kind));
create unique index privacy_contexts_platform_idx on public.privacy_contexts(kind) where kind='platform_controller';
create index privacy_contexts_dpo_idx on public.privacy_contexts(dpo_user_id) where dpo_user_id is not null;
insert into public.privacy_contexts(kind,name) values('platform_controller','MasterApp (controlador dos dados dos clientes do SaaS)');

create table public.privacy_member_permissions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 permission_key text not null check(permission_key like 'privacy:%'),active boolean not null default true,created_at timestamptz not null default now(),unique(organization_id,user_id,permission_key));
create index privacy_member_permissions_user_idx on public.privacy_member_permissions(user_id);

-- Deadlines and triggers are data the DPO configures. legal_review_status records whether that review happened.
create table public.privacy_settings(
 context_id uuid primary key references public.privacy_contexts(id) on delete cascade,
 dsr_deadline_days jsonb not null default '{"default":15}',dsr_alert_days_before integer not null default 3 check(dsr_alert_days_before between 0 and 60),
 require_lia_for_legitimate_interest boolean not null default true,
 dpia_triggers text[] not null default array['sensitive_data','driver_location_monitoring','ai_with_personal_data','marketing_profiling','new_sharing_integration'],
 incident_notification_deadline_days integer check(incident_notification_deadline_days is null or incident_notification_deadline_days>0),
 hold_review_days integer not null default 180 check(hold_review_days between 7 and 3650),export_link_hours integer not null default 24 check(export_link_hours between 1 and 168),
 require_current_consent_version boolean not null default false,retention_requires_approval boolean not null default true,self_approval_allowed boolean not null default false,
 legal_review_status text not null default 'pending' check(legal_review_status in('pending','reviewed')),
 updated_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now());
create index privacy_settings_updated_by_idx on public.privacy_settings(updated_by) where updated_by is not null;

-- Where personal data lives, by table and column. Rows without context describe the product schema and apply to every tenant;
-- a context may add its own. data_asset_field_id links to the Phase 76 catalog when the tenant has catalogued that field.
create table public.personal_data_map(
 id uuid primary key default gen_random_uuid(),context_id uuid references public.privacy_contexts(id) on delete cascade,
 domain text not null,table_name text not null,column_name text not null,
 data_category text not null check(data_category in('identification','contact','address','location','payment_reference','order_history','preferences','communication','voice','image','employee','driver','health_allergy','device_technical')),
 subject_category text not null check(subject_category in('end_customer','lead','employee','driver','supplier_contact','saas_customer','saas_user')),
 sensitive boolean not null default false,classification text not null default 'personal_data',owner_service text not null,adapter_key text,
 legal_retention text check(legal_retention is null or legal_retention in('fiscal','financial','contracts','audit')),
 data_asset_field_id uuid references public.data_asset_fields(id) on delete set null,
 status text not null default 'active' check(status in('active','deprecated')),notes text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index personal_data_map_key_idx on public.personal_data_map(coalesce(context_id,'00000000-0000-0000-0000-000000000000'::uuid),table_name,column_name);
create index personal_data_map_context_idx on public.personal_data_map(context_id) where context_id is not null;
create index personal_data_map_field_idx on public.personal_data_map(data_asset_field_id) where data_asset_field_id is not null;

-- The product schema as found in the Phase 95 diagnosis. adapter_key names the domain service that locates, exports and
-- deletes the field; legal_retention marks records the law may require to keep.
insert into public.personal_data_map(domain,table_name,column_name,data_category,subject_category,sensitive,owner_service,adapter_key,legal_retention) values
 ('customers','customers','name','identification','end_customer',false,'Customer 360 (60)','customers',null),
 ('customers','customers','phone','contact','end_customer',false,'Customer 360 (60)','customers',null),
 ('customers','customers','email','contact','end_customer',false,'Customer 360 (60)','customers',null),
 ('customers','customers','birth_date','identification','end_customer',false,'Customer 360 (60)','customers',null),
 ('customers','customers','birthday','identification','end_customer',false,'CRM (5)','customers',null),
 ('customers','customers','crm_notes','communication','end_customer',false,'CRM (5)','customers',null),
 ('customers','organization_customers','name','identification','end_customer',false,'Master Data (75)','customers',null),
 ('customers','organization_customers','normalized_phone','contact','end_customer',false,'Master Data (75)','customers',null),
 ('customers','organization_customers','email','contact','end_customer',false,'Master Data (75)','customers',null),
 ('customers','customer_addresses','street','address','end_customer',false,'Portal do Cliente (13)','customers',null),
 ('customers','customer_addresses','number','address','end_customer',false,'Portal do Cliente (13)','customers',null),
 ('customers','customer_addresses','complement','address','end_customer',false,'Portal do Cliente (13)','customers',null),
 ('customers','customer_addresses','postal_code','address','end_customer',false,'Portal do Cliente (13)','customers',null),
 ('customers','customer_addresses','reference','address','end_customer',false,'Portal do Cliente (13)','customers',null),
 ('customers','customer360_notes','content','communication','end_customer',false,'Customer 360 (60)','customers',null),
 ('customers','customer360_preferences','value','health_allergy','end_customer',true,'Customer 360 (60)','customers',null),
 ('orders','orders','customer_name','identification','end_customer',false,'Pedidos','orders',null),
 ('orders','orders','customer_phone','contact','end_customer',false,'Pedidos','orders',null),
 ('orders','orders','delivery_address','address','end_customer',false,'Pedidos','orders',null),
 ('orders','orders','notes','order_history','end_customer',false,'Pedidos','orders',null),
 ('delivery','delivery_destinations','recipient_name','identification','end_customer',false,'Delivery','delivery',null),
 ('delivery','delivery_destinations','recipient_phone','contact','end_customer',false,'Delivery','delivery',null),
 ('delivery','delivery_destinations','street','address','end_customer',false,'Delivery','delivery',null),
 ('delivery','delivery_destinations','latitude','location','end_customer',false,'Delivery','delivery',null),
 ('delivery','delivery_destinations','longitude','location','end_customer',false,'Delivery','delivery',null),
 ('whatsapp','whatsapp_contacts','phone_number','contact','end_customer',false,'WhatsApp (1)','whatsapp',null),
 ('whatsapp','whatsapp_contacts','profile_name','identification','end_customer',false,'WhatsApp (1)','whatsapp',null),
 ('whatsapp','whatsapp_messages','content','communication','end_customer',false,'WhatsApp (1)','whatsapp',null),
 ('voice','voice_call_sessions','source_phone','contact','end_customer',false,'Voz (11)','voice',null),
 ('voice','voice_call_sessions','recording_storage_path','voice','end_customer',true,'Voz (11)','voice',null),
 ('voice','voice_transcript_segments','redacted_text','voice','end_customer',false,'Voz (11)','voice',null),
 ('reservations','reservations','customer_name','identification','end_customer',false,'Reservas (15)','reservations',null),
 ('reservations','reservations','customer_phone','contact','end_customer',false,'Reservas (15)','reservations',null),
 ('reservations','waitlist_entries','customer_name','identification','end_customer',false,'Reservas (15)','reservations',null),
 ('reservations','waitlist_entries','customer_phone','contact','end_customer',false,'Reservas (15)','reservations',null),
 ('customer_experience','cx_risk_signals','signal_type','health_allergy','end_customer',true,'Customer Experience (38)','customer_experience',null),
 ('fiscal','fiscal_documents','customer_id','identification','end_customer',false,'Fiscal (19)','fiscal','fiscal'),
 ('financial','order_payment_transactions','pix_key','payment_reference','end_customer',false,'Financeiro (17)','financial','financial'),
 ('workforce','custom_staff_members','name','employee','employee',false,'Workforce (18)','workforce',null),
 ('workforce','custom_staff_members','phone','employee','employee',false,'Workforce (18)','workforce',null),
 ('workforce','custom_staff_members','photo_url','image','employee',false,'Workforce (18)','workforce',null),
 ('workforce','employee_documents','storage_path','employee','employee',true,'Workforce (18)','workforce',null),
 ('drivers','driver_profiles','phone','driver','driver',false,'Delivery','drivers',null),
 ('drivers','driver_profiles','cpf_hash','driver','driver',false,'Delivery','drivers',null),
 ('drivers','driver_locations','latitude','location','driver',false,'Delivery','drivers',null),
 ('drivers','driver_locations','longitude','location','driver',false,'Delivery','drivers',null),
 ('saas','billing_contacts','name','identification','saas_customer',false,'SaaS Billing (22)','saas',null),
 ('saas','billing_contacts','email','contact','saas_customer',false,'SaaS Billing (22)','saas',null),
 ('saas','billing_contacts','tax_document','identification','saas_customer',false,'SaaS Billing (22)','saas','fiscal'),
 ('leads','sales_leads','contact_name','identification','lead',false,'Sales CRM (29)','leads',null),
 ('leads','sales_leads','email','contact','lead',false,'Sales CRM (29)','leads',null),
 ('leads','sales_leads','phone','contact','lead',false,'Sales CRM (29)','leads',null),
 ('security','superadmin_audit_logs','ip_address','device_technical','saas_user',false,'Segurança (25)','audit','audit');

-- Personal-looking columns found without a map entry. They are data quality findings, resolved by mapping or dismissing.
create table public.privacy_inventory_findings(
 id uuid primary key default gen_random_uuid(),context_id uuid references public.privacy_contexts(id) on delete cascade,
 table_name text not null,column_name text not null,source text not null default 'schema_scan',status text not null default 'open' check(status in('open','mapped','dismissed')),
 resolution_reason text,resolved_by uuid references auth.users(id) on delete set null,resolved_at timestamptz,created_at timestamptz not null default now());
create unique index privacy_inventory_findings_open_idx on public.privacy_inventory_findings(coalesce(context_id,'00000000-0000-0000-0000-000000000000'::uuid),table_name,column_name) where status='open';
create index privacy_inventory_findings_resolved_by_idx on public.privacy_inventory_findings(resolved_by) where resolved_by is not null;

create table public.privacy_audit_events(
 id bigint generated always as identity primary key,context_id uuid not null references public.privacy_contexts(id) on delete cascade,organization_id uuid references public.organizations(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,actor_type text not null default 'user',action text not null,resource_type text not null,resource_id text,reason text,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create index privacy_audit_events_lookup_idx on public.privacy_audit_events(context_id,created_at desc);
create index privacy_audit_events_org_idx on public.privacy_audit_events(organization_id) where organization_id is not null;
create index privacy_audit_events_actor_idx on public.privacy_audit_events(actor_id) where actor_id is not null;

-- History is never rewritten by hand. Cascades and "set null" from a removed customer or user still pass, so deleting a
-- subject never gets stuck on its own audit trail (which keeps only references, not the removed values).
create function public.prevent_privacy_history_rewrite() returns trigger language plpgsql set search_path=public as $$begin if pg_trigger_depth()>1 then return case when tg_op='DELETE' then old else new end;end if;raise exception 'PRIVACY_HISTORY_IMMUTABLE';end$$;
create trigger privacy_audit_immutable before update or delete on public.privacy_audit_events for each row execute function public.prevent_privacy_history_rewrite();
revoke all on function public.prevent_privacy_history_rewrite() from public,anon,authenticated;grant execute on function public.prevent_privacy_history_rewrite() to service_role;

do $$declare t text;begin foreach t in array array['privacy_contexts','privacy_member_permissions','privacy_settings','personal_data_map','privacy_inventory_findings','privacy_audit_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
