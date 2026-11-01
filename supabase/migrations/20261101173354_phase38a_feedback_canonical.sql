-- Phase 38A: crm_feedback becomes the canonical consumer feedback layer through additive columns. Existing readers and writers keep working.
-- SaaS feedback (customer_feedback, support_csat) and app_reviews stay out of this module.
-- quality: allow-nonconcurrent-index reason=new-empty-customer-experience-tables

alter table public.plans add column if not exists customer_experience_enabled boolean not null default false,add column if not exists cx_surveys_enabled boolean not null default false,add column if not exists cx_external_reviews_enabled boolean not null default false,add column if not exists cx_ai_sentiment_enabled boolean not null default false,add column if not exists cx_ai_response_drafts_enabled boolean not null default false,add column if not exists cx_service_recovery_enabled boolean not null default false;
alter table public.store_feature_flags add column if not exists customer_experience_enabled boolean not null default false,add column if not exists cx_surveys_enabled boolean not null default false,add column if not exists cx_external_reviews_enabled boolean not null default false,add column if not exists cx_ai_sentiment_enabled boolean not null default false,add column if not exists cx_ai_response_drafts_enabled boolean not null default false,add column if not exists cx_service_recovery_enabled boolean not null default false;

-- Anonymous (QR) and imported feedback have no customer or order. unique(order_id) stays, so the portal's on conflict keeps working and each order keeps one row.
alter table public.crm_feedback alter column customer_id drop not null,alter column order_id drop not null;
alter table public.crm_feedback
 add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
 add column if not exists channel text,
 add column if not exists source text check(source is null or source in('whatsapp','qr_table','customer_portal','receipt_link','kiosk','email','marketplace_import','google_import','staff_logged','other')),
 add column if not exists feedback_type text not null default 'star_rating' check(feedback_type in('nps','csat','ces','star_rating','item_rating','open_comment','complaint','compliment')),
 add column if not exists score numeric(4,1),
 add column if not exists scale text not null default '1-5' check(scale in('1-5','0-10','1-7')),
 add column if not exists item_ratings jsonb not null default '[]',
 add column if not exists dimension_ratings jsonb not null default '{}',
 add column if not exists language text not null default 'pt-BR',
 add column if not exists is_public boolean not null default false,
 add column if not exists consent_ref text,
 add column if not exists conversation_ref text,
 add column if not exists inbox_status text not null default 'new' check(inbox_status in('new','triaged','awaiting_response','responded','recovery_in_progress','resolved','escalated','closed')),
 add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
 add column if not exists response_due_at timestamptz,
 add column if not exists first_responded_at timestamptz,
 add column if not exists resolved_at timestamptz,
 add column if not exists updated_at timestamptz not null default now();
-- rating is read as 1 to 5 by CRM, Customer 360 and the attendant: other scales live only in score.
alter table public.crm_feedback add constraint crm_feedback_rating_scale_check check(rating is null or scale='1-5');
alter table public.crm_feedback add constraint crm_feedback_score_scale_check check(score is null or(scale='1-5' and score between 1 and 5) or(scale='0-10' and score between 0 and 10) or(scale='1-7' and score between 1 and 7));

update public.crm_feedback f set organization_id=e.organization_id,score=coalesce(f.score,f.rating),source=coalesce(f.source,case when f.whatsapp_contact_id is not null then 'whatsapp' else 'customer_portal' end) from public.establishments e where e.id=f.establishment_id and f.organization_id is null;

create index crm_feedback_inbox_idx on public.crm_feedback(organization_id,establishment_id,inbox_status,answered_at desc) where answered_at is not null;
create index crm_feedback_metrics_idx on public.crm_feedback(organization_id,establishment_id,feedback_type,answered_at) where answered_at is not null;
create index crm_feedback_customer_idx on public.crm_feedback(customer_id,created_at desc) where customer_id is not null;
create index crm_feedback_pending_idx on public.crm_feedback(establishment_id,customer_id,requested_at desc) where answered_at is null;
create index crm_feedback_contact_idx on public.crm_feedback(whatsapp_contact_id) where whatsapp_contact_id is not null;
create index crm_feedback_owner_idx on public.crm_feedback(owner_user_id) where owner_user_id is not null;

create table public.cx_member_permissions(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,permission_key text not null check(permission_key like 'cx:%'),active boolean not null default true,granted_at timestamptz not null default now(),unique(organization_id,user_id,permission_key));
create index cx_member_permissions_user_idx on public.cx_member_permissions(user_id);

create table public.cx_settings(organization_id uuid primary key references public.organizations(id) on delete cascade,minimum_sample integer not null default 10 check(minimum_sample>=1),survey_requires_opt_in boolean not null default true,max_survey_frequency_days integer not null default 30 check(max_survey_frequency_days>=0),quiet_start_hour integer not null default 21 check(quiet_start_hour between 0 and 23),quiet_end_hour integer not null default 9 check(quiet_end_hour between 0 and 23),response_sla_hours integer not null default 48 check(response_sla_hours>0),recovery_due_hours integer not null default 24 check(recovery_due_hours>0),auto_publish_simple boolean not null default false,compensation_limit_cents integer not null default 0 check(compensation_limit_cents>=0),public_review_links jsonb not null default '{}',topic_taxonomy jsonb not null default '[]',nps_drop_points integer not null default 15 check(nps_drop_points>0),retention_days integer check(retention_days is null or retention_days>0),updated_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now());
create index cx_settings_updated_by_idx on public.cx_settings(updated_by) where updated_by is not null;

create table public.cx_jobs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,job_type text not null check(job_type in('analyze_feedback','sync_external','sla_scan')),priority integer not null default 50,status text not null default 'queued' check(status in('queued','running','completed','failed','dead_letter')),payload jsonb not null default '{}',idempotency_key text not null,attempt_count integer not null default 0,max_attempts integer not null default 5,available_at timestamptz not null default now(),lease_expires_at timestamptz,error_message text,created_at timestamptz not null default now(),completed_at timestamptz,unique(organization_id,idempotency_key));
create index cx_jobs_queue_idx on public.cx_jobs(status,priority desc,available_at,lease_expires_at);

create table public.cx_audit_events(id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete set null,actor_id uuid references auth.users(id) on delete set null,actor_type text not null default 'user' check(actor_type in('user','system','customer')),action text not null,resource_type text not null,resource_id text,reason text,safe_metadata jsonb not null default '{}',created_at timestamptz not null default now());
create index cx_audit_events_lookup_idx on public.cx_audit_events(organization_id,created_at desc);
create index cx_audit_events_store_idx on public.cx_audit_events(store_id) where store_id is not null;
create index cx_audit_events_actor_idx on public.cx_audit_events(actor_id) where actor_id is not null;
create function public.prevent_cx_history_rewrite() returns trigger language plpgsql set search_path=public as $$begin raise exception 'CX_HISTORY_IMMUTABLE';end$$;
create trigger cx_audit_immutable before update or delete on public.cx_audit_events for each row execute function public.prevent_cx_history_rewrite();
revoke all on function public.prevent_cx_history_rewrite() from public,anon,authenticated;grant execute on function public.prevent_cx_history_rewrite() to service_role;

create function private.cx_flag_enabled(requested_store_id uuid,requested_flag text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare store_value boolean; plan_value boolean;
begin
 if requested_flag not in('customer_experience_enabled','cx_surveys_enabled','cx_external_reviews_enabled','cx_ai_sentiment_enabled','cx_ai_response_drafts_enabled','cx_service_recovery_enabled') then return false; end if;
 execute format('select %I from public.store_feature_flags where establishment_id=$1',requested_flag) into store_value using requested_store_id;
 execute format('select p.%I from public.subscriptions s join public.plans p on p.id=s.plan_id where s.establishment_id=$1 and s.status in(''active'',''trialing'',''past_due'') order by s.created_at desc limit 1',requested_flag) into plan_value using requested_store_id;
 return coalesce(store_value,false) or coalesce(plan_value,false);
end$$;
revoke all on function private.cx_flag_enabled(uuid,text) from public,anon,authenticated;

-- Legacy writers (portal, attendant, post_sale automation) send only rating and comment: this fills the canonical columns for them.
create function private.crm_feedback_normalize() returns trigger language plpgsql security definer set search_path='' as $$
declare sla integer;
begin
 if new.organization_id is null then select organization_id into new.organization_id from public.establishments where id=new.establishment_id; end if;
 if new.source is null then new.source:=case when new.whatsapp_contact_id is not null then 'whatsapp' when new.answered_at is not null then 'customer_portal' else 'other' end; end if;
 if new.channel is null then new.channel:=new.source; end if;
 if tg_op='UPDATE' and new.source='other' and new.answered_at is not null and old.answered_at is null and new.whatsapp_contact_id is null then new.source:='customer_portal';new.channel:='customer_portal'; end if;
 -- A pending NPS row can still be answered by a legacy writer, which only knows the 1 to 5 rating: the answer defines the scale.
 if new.rating is not null and(tg_op='INSERT' or new.rating is distinct from old.rating) then
  if new.scale<>'1-5' then new.scale:='1-5';new.feedback_type:='star_rating'; end if;
  new.score:=new.rating;
 end if;
 if new.answered_at is not null and new.response_due_at is null and(new.is_public or new.needs_human_attention) then
  select response_sla_hours into sla from public.cx_settings where organization_id=new.organization_id;
  new.response_due_at:=new.answered_at+make_interval(hours=>coalesce(sla,48));
 end if;
 new.updated_at:=now();
 return new;
end$$;
revoke all on function private.crm_feedback_normalize() from public,anon,authenticated;
create trigger crm_feedback_normalize before insert or update on public.crm_feedback for each row execute function private.crm_feedback_normalize();

-- Runs inside the writer's transaction, so any failure here is swallowed: analysis is never allowed to block an order or a conversation.
create function private.crm_feedback_enqueue_analysis() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.answered_at is null or new.organization_id is null then return null; end if;
 if tg_op='UPDATE' and old.answered_at is not null and new.comment is not distinct from old.comment and new.score is not distinct from old.score then return null; end if;
 begin
  if private.cx_flag_enabled(new.establishment_id,'customer_experience_enabled') then
   insert into public.cx_jobs(organization_id,job_type,priority,payload,idempotency_key) values(new.organization_id,'analyze_feedback',70,jsonb_build_object('feedback_id',new.id),'analyze:'||new.id||':'||md5(coalesce(new.comment,'')||coalesce(new.score::text,''))) on conflict(organization_id,idempotency_key) do nothing;
  end if;
 exception when others then null;
 end;
 return null;
end$$;
revoke all on function private.crm_feedback_enqueue_analysis() from public,anon,authenticated;
create trigger crm_feedback_enqueue_analysis after insert or update on public.crm_feedback for each row execute function private.crm_feedback_enqueue_analysis();

insert into public.feature_definitions(feature_key,name,description,category,value_type,default_value,safe_default,client_safe,owner_label,lifecycle_status,created_at,updated_at) values
('customer_experience_enabled','Experiência & Reputação','Ativa a caixa de avaliações e os indicadores de reputação.','customers','boolean','false','false',false,'Customer Experience','active',now(),now()),
('cx_surveys_enabled','Pesquisas de experiência','Ativa pesquisas NPS, CSAT e CES depois do atendimento.','customers','boolean','false','false',false,'Customer Experience','active',now(),now()),
('cx_external_reviews_enabled','Avaliações externas','Ativa a importação por integração oficial.','customers','boolean','false','false',false,'Customer Experience','active',now(),now()),
('cx_ai_sentiment_enabled','Sentimento por IA','Ativa a análise por IA governada, somada às regras explicáveis.','customers','boolean','false','false',false,'Customer Experience','active',now(),now()),
('cx_ai_response_drafts_enabled','Rascunhos por IA','Ativa sugestões de resposta por IA, sempre com aprovação humana.','customers','boolean','false','false',false,'Customer Experience','active',now(),now()),
('cx_service_recovery_enabled','Recuperação de clientes','Ativa os casos de recuperação de clientes insatisfeitos.','customers','boolean','false','false',false,'Customer Experience','active',now(),now())
on conflict(feature_key) do update set name=excluded.name,description=excluded.description,updated_at=now();

do $$declare t text;begin foreach t in array array['cx_member_permissions','cx_settings','cx_jobs','cx_audit_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
