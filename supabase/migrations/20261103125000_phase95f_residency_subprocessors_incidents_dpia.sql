-- Phase 95F: data residency, subprocessors as vendors with a privacy profile (Phase 92), privacy incidents as a type of
-- incident (Phase 59) and impact assessments (RIPD/DPIA). No second vendor or incident table.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

-- Where data actually is, as the infrastructure states it. Nothing here promises a residency the providers do not guarantee.
create table public.privacy_data_locations(
 id uuid primary key default gen_random_uuid(),context_id uuid references public.privacy_contexts(id) on delete cascade,
 component text not null,provider text not null,region text,data_categories text[] not null default '{}',
 international boolean not null default false,transfer_mechanism text,guarantee text not null default 'stated_by_provider' check(guarantee in('contractual','stated_by_provider','unknown')),
 vendor_id uuid references public.vendor_profiles(id) on delete set null,notes text,verified_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index privacy_data_locations_context_idx on public.privacy_data_locations(context_id) where context_id is not null;
create index privacy_data_locations_vendor_idx on public.privacy_data_locations(vendor_id) where vendor_id is not null;
-- Platform rows (no context) describe what MasterApp runs on. Regions not confirmed in writing stay 'unknown'.
insert into public.privacy_data_locations(component,provider,region,data_categories,international,guarantee,notes) values
 ('Banco de dados e arquivos','Supabase','sa-east-1 (São Paulo)',array['identification','contact','address','order_history','communication'],false,'stated_by_provider','Região do projeto de produção. Confirmar contrato e DPA com o jurídico.'),
 ('Backups do banco','Supabase',null,array['identification','contact','address','order_history'],false,'unknown','Exclusão em backup acontece pela expiração natural do backup (Fase 25). Região dos backups a confirmar.'),
 ('Hospedagem do app','Vercel',null,array['device_technical'],true,'unknown','Funções e logs podem rodar fora do Brasil. Confirmar regiões e mecanismo de transferência.'),
 ('Mensagens de WhatsApp','Meta (WhatsApp Cloud API)',null,array['contact','communication'],true,'unknown','Confirmar mecanismo de transferência com o jurídico.'),
 ('Assistentes de IA','Provedores de IA (Fase 80)',null,array['communication'],true,'unknown','Depende do modelo configurado em AI Governance.'),
 ('Pagamentos','Gateways de pagamento',null,array['payment_reference'],false,'unknown','Só referências de pagamento; o app não guarda o cartão.');

-- A subprocessor is a vendor that receives personal data. The vendor stays in Phase 92; this is its privacy side.
create table public.vendor_privacy_profiles(
 id uuid primary key default gen_random_uuid(),vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,context_id uuid references public.privacy_contexts(id) on delete cascade,
 data_categories text[] not null default '{}',purpose text not null,location text,international_transfer boolean not null default false,transfer_mechanism text,
 dpa_contract_id uuid references public.contracts(id) on delete set null,dpa_reference text,last_reviewed_at timestamptz,review_due_at timestamptz,
 status text not null default 'active' check(status in('active','suspended','ended')),created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(vendor_id,context_id));
create index vendor_privacy_profiles_context_idx on public.vendor_privacy_profiles(context_id) where context_id is not null;
create index vendor_privacy_profiles_contract_idx on public.vendor_privacy_profiles(dpa_contract_id) where dpa_contract_id is not null;
create index vendor_privacy_profiles_created_by_idx on public.vendor_privacy_profiles(created_by) where created_by is not null;

-- Privacy incidents are operational incidents with category 'privacy'. The assessment and the notification decision live here.
alter table public.operational_incidents drop constraint operational_incidents_category_check;
alter table public.operational_incidents add constraint operational_incidents_category_check check(category in('system','payments','hardware','network','kitchen','delivery','inventory','supplier','quality','maintenance','security','workforce','store_operations','integration','release','privacy','other'));
insert into public.dim_incident_category values('privacy','Privacidade') on conflict do nothing;

create table public.privacy_incident_assessments(
 id uuid primary key default gen_random_uuid(),incident_id uuid not null references public.operational_incidents(id) on delete cascade,context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 source text not null default 'manual' check(source in('manual','soc','incident')),soc_alert_ref text,
 involves_personal_data text not null default 'unknown' check(involves_personal_data in('unknown','yes','no')),data_categories text[] not null default '{}',
 subjects_estimate integer check(subjects_estimate is null or subjects_estimate>=0),risk_level text check(risk_level in('low','medium','high','critical')),
 containment_summary text,detected_at timestamptz not null default now(),notification_due_at timestamptz,
 -- The decision to notify the ANPD and the subjects is always a person's, recorded with who decided and why.
 anpd_decision text not null default 'pending' check(anpd_decision in('pending','notify','do_not_notify')),subjects_decision text not null default 'pending' check(subjects_decision in('pending','notify','do_not_notify')),
 decision_reason text,decided_by uuid references auth.users(id) on delete set null,decided_at timestamptz,
 anpd_draft text,subjects_draft text,anpd_notified_at timestamptz,subjects_notified_at timestamptz,evidence jsonb not null default '[]',lessons_learned text,
 status text not null default 'assessing' check(status in('assessing','contained','decided','notified','closed')),
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(incident_id),
 check((anpd_decision='pending' and subjects_decision='pending') or decided_by is not null));
create index privacy_incident_assessments_context_idx on public.privacy_incident_assessments(context_id,status);
create index privacy_incident_assessments_decided_by_idx on public.privacy_incident_assessments(decided_by) where decided_by is not null;
create index privacy_incident_assessments_created_by_idx on public.privacy_incident_assessments(created_by) where created_by is not null;

create table public.privacy_impact_assessments(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,activity_id uuid references public.processing_activities(id) on delete set null,
 title text not null,description text,triggers text[] not null default '{}',necessity_proportionality text,risks jsonb not null default '[]',measures jsonb not null default '[]',
 residual_risk text check(residual_risk in('low','medium','high','critical')),dpo_opinion text,dpo_user_id uuid references auth.users(id) on delete set null,dpo_signed_at timestamptz,
 status text not null default 'draft' check(status in('draft','in_review','approved','rejected','needs_update')),version integer not null default 1,next_review_at timestamptz,
 change_request_id uuid references public.change_requests(id) on delete set null,created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(status<>'approved' or (dpo_opinion is not null and dpo_user_id is not null)));
create index privacy_impact_assessments_context_idx on public.privacy_impact_assessments(context_id,status);
create index privacy_impact_assessments_activity_idx on public.privacy_impact_assessments(activity_id) where activity_id is not null;
create index privacy_impact_assessments_dpo_idx on public.privacy_impact_assessments(dpo_user_id) where dpo_user_id is not null;
create index privacy_impact_assessments_change_idx on public.privacy_impact_assessments(change_request_id) where change_request_id is not null;
create index privacy_impact_assessments_created_by_idx on public.privacy_impact_assessments(created_by) where created_by is not null;

do $$declare t text;begin foreach t in array array['privacy_data_locations','vendor_privacy_profiles','privacy_incident_assessments','privacy_impact_assessments'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
