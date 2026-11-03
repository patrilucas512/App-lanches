-- Phase 95C: one canonical consent registry. Existing consent stores (customers.marketing_status, whatsapp_contacts,
-- crm_consent_events, customer_notification_preferences) keep working: every write to them is mirrored here, and every
-- canonical change goes back to them through privacy_record_consent, so the SQL senders keep reading the right value.
-- quality: allow-nonconcurrent-index reason=new-empty-privacy-tables

create table public.consent_purposes(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 purpose_key text not null check(purpose_key ~ '^[a-z0-9_]{3,60}$'),label text not null,description text,
 kind text not null default 'marketing' check(kind in('marketing','survey','ai','profiling','other')),channels text[] not null default array['any'],
 current_version integer not null default 1 check(current_version>0),requires_reacceptance boolean not null default false,active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(context_id,purpose_key));

create table public.consent_text_versions(
 id uuid primary key default gen_random_uuid(),purpose_id uuid not null references public.consent_purposes(id) on delete cascade,context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 version integer not null check(version>0),body text not null,material boolean not null default false,legal_review_status text not null default 'pending' check(legal_review_status in('pending','reviewed')),
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),unique(purpose_id,version));
create index consent_text_versions_context_idx on public.consent_text_versions(context_id);
create index consent_text_versions_created_by_idx on public.consent_text_versions(created_by) where created_by is not null;
create trigger consent_text_versions_immutable before update or delete on public.consent_text_versions for each row execute function public.prevent_privacy_history_rewrite();

-- Append-only: each change is a new row, and the current state is the latest row per subject, purpose and channel.
create table public.consent_records(
 id uuid primary key default gen_random_uuid(),context_id uuid not null references public.privacy_contexts(id) on delete cascade,
 organization_id uuid references public.organizations(id) on delete cascade,establishment_id uuid references public.establishments(id) on delete set null,
 customer_id uuid references public.customers(id) on delete set null,organization_customer_id uuid references public.organization_customers(id) on delete set null,
 whatsapp_contact_id uuid references public.whatsapp_contacts(id) on delete set null,subject_ref text not null,
 purpose_key text not null,channel text not null default 'any',status text not null check(status in('granted','revoked','expired')),
 text_version integer,recorded_at timestamptz not null default now(),expires_at timestamptz,revoked_at timestamptz,
 origin text not null,source_ref text,evidence jsonb not null default '{}',legacy_source text,legacy_id text,
 actor_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create index consent_records_lookup_idx on public.consent_records(context_id,subject_ref,purpose_key,channel,recorded_at desc);
create index consent_records_customer_idx on public.consent_records(customer_id,purpose_key,recorded_at desc) where customer_id is not null;
create index consent_records_org_customer_idx on public.consent_records(organization_customer_id) where organization_customer_id is not null;
create index consent_records_contact_idx on public.consent_records(whatsapp_contact_id) where whatsapp_contact_id is not null;
create index consent_records_establishment_idx on public.consent_records(establishment_id) where establishment_id is not null;
create index consent_records_org_idx on public.consent_records(organization_id) where organization_id is not null;
create index consent_records_actor_idx on public.consent_records(actor_id) where actor_id is not null;
create unique index consent_records_legacy_idx on public.consent_records(legacy_source,legacy_id) where legacy_id is not null;
create trigger consent_records_immutable before update or delete on public.consent_records for each row execute function public.prevent_privacy_history_rewrite();

create view public.consent_current with(security_invoker=true) as
 select distinct on(context_id,subject_ref,purpose_key,channel) * from public.consent_records order by context_id,subject_ref,purpose_key,channel,recorded_at desc,created_at desc;

create function private.privacy_tenant_context(requested_establishment_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid; ctx uuid;
begin
 select organization_id into org from public.establishments where id=requested_establishment_id;
 if org is null then return null; end if;
 insert into public.privacy_contexts(organization_id,kind,name) values(org,'tenant_controller','Controlador (estabelecimento)') on conflict(organization_id,kind) do nothing;
 select id into ctx from public.privacy_contexts where organization_id=org and kind='tenant_controller';
 return ctx;
end $$;
revoke all on function private.privacy_tenant_context(uuid) from public,anon,authenticated;

-- Mirror of the legacy writers. A change that already came from the canonical registry carries privacy_record_id and is skipped.
create function public.privacy_mirror_crm_consent() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx uuid; org uuid; ocid uuid;
begin
 if new.evidence ? 'privacy_record_id' then return new; end if;
 ctx:=private.privacy_tenant_context(new.establishment_id); if ctx is null then return new; end if;
 select e.organization_id,c.organization_customer_id into org,ocid from public.establishments e left join public.customers c on c.id=new.customer_id where e.id=new.establishment_id;
 insert into public.consent_records(context_id,organization_id,establishment_id,customer_id,organization_customer_id,whatsapp_contact_id,subject_ref,purpose_key,channel,status,recorded_at,revoked_at,origin,evidence,legacy_source,legacy_id,actor_id)
 values(ctx,org,new.establishment_id,new.customer_id,ocid,new.whatsapp_contact_id,coalesce(ocid::text,new.customer_id::text,'contact:'||new.whatsapp_contact_id::text),'marketing_'||coalesce(nullif(new.channel,''),'whatsapp'),coalesce(nullif(new.channel,''),'whatsapp'),
  case new.status when 'opted_in' then 'granted' else 'revoked' end,new.created_at,case when new.status='opted_out' then new.created_at end,'legacy:'||new.origin,new.evidence,'crm_consent_events',new.id::text,new.actor_id)
 on conflict do nothing;
 return new;
end $$;
create trigger crm_consent_events_privacy_mirror after insert on public.crm_consent_events for each row execute function public.privacy_mirror_crm_consent();

create function public.privacy_mirror_preferences() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx uuid; est uuid;
begin
 if coalesce(current_setting('masterapp.privacy_sync',true),'')='on' then return new; end if;
 select establishment_id into est from public.customers where id=new.customer_id; ctx:=private.privacy_tenant_context(est); if ctx is null then return new; end if;
 if tg_op='INSERT' or new.whatsapp_marketing is distinct from old.whatsapp_marketing then
  insert into public.consent_records(context_id,organization_id,establishment_id,customer_id,organization_customer_id,subject_ref,purpose_key,channel,status,revoked_at,origin,legacy_source,legacy_id)
  values(ctx,new.organization_id,est,new.customer_id,new.organization_customer_id,coalesce(new.organization_customer_id::text,new.customer_id::text),'marketing_whatsapp','whatsapp',case when new.whatsapp_marketing then 'granted' else 'revoked' end,case when not new.whatsapp_marketing then now() end,'legacy:customer_portal_preferences','customer_notification_preferences',null);
 end if;
 if tg_op='INSERT' or new.email_marketing is distinct from old.email_marketing then
  insert into public.consent_records(context_id,organization_id,establishment_id,customer_id,organization_customer_id,subject_ref,purpose_key,channel,status,revoked_at,origin,legacy_source,legacy_id)
  values(ctx,new.organization_id,est,new.customer_id,new.organization_customer_id,coalesce(new.organization_customer_id::text,new.customer_id::text),'marketing_email','email',case when new.email_marketing then 'granted' else 'revoked' end,case when not new.email_marketing then now() end,'legacy:customer_portal_preferences','customer_notification_preferences',null);
 end if;
 return new;
end $$;
create trigger customer_notification_preferences_privacy_mirror after insert or update on public.customer_notification_preferences for each row execute function public.privacy_mirror_preferences();
revoke all on function public.privacy_mirror_crm_consent() from public,anon,authenticated;
revoke all on function public.privacy_mirror_preferences() from public,anon,authenticated;

-- The one way the module writes consent. It records the canonical row and, for marketing purposes, updates the legacy
-- columns in the same transaction, so revocation reaches the SQL senders (campaigns, outbox) immediately.
create function public.privacy_record_consent(requested_context_id uuid,requested_establishment_id uuid,requested_customer_id uuid,requested_subject_ref text,requested_purpose text,requested_channel text,requested_status text,requested_text_version integer,requested_origin text,requested_source_ref text,requested_evidence jsonb,requested_actor uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; org uuid; ocid uuid; legacy text;
begin
 if auth.role()<>'service_role' then raise exception 'Operação interna.'; end if;
 if requested_status not in('granted','revoked') then raise exception 'CONSENT_STATUS_INVALID'; end if;
 select organization_id into org from public.privacy_contexts where id=requested_context_id;
 if requested_customer_id is not null then
  select c.organization_customer_id into ocid from public.customers c join public.establishments e on e.id=c.establishment_id where c.id=requested_customer_id and e.organization_id=org;
  if not found then raise exception 'SUBJECT_NOT_IN_CONTEXT'; end if;
 end if;
 perform set_config('masterapp.privacy_sync','on',true);
 insert into public.consent_records(context_id,organization_id,establishment_id,customer_id,organization_customer_id,subject_ref,purpose_key,channel,status,text_version,revoked_at,origin,source_ref,evidence,actor_id)
 values(requested_context_id,org,requested_establishment_id,requested_customer_id,ocid,requested_subject_ref,requested_purpose,coalesce(requested_channel,'any'),requested_status,requested_text_version,case when requested_status='revoked' then now() end,requested_origin,requested_source_ref,coalesce(requested_evidence,'{}'::jsonb),requested_actor)
 returning id into rid;
 if requested_customer_id is not null and requested_purpose in('marketing_whatsapp','marketing_email') then
  legacy:=case requested_status when 'granted' then 'opted_in' else 'opted_out' end;
  if requested_purpose='marketing_whatsapp' then
   update public.customers set marketing_status=legacy,marketing_consent_at=now() where id=requested_customer_id;
   update public.whatsapp_contacts set marketing_status=legacy,marketing_consent_at=now(),marketing_opt_out=(legacy='opted_out') where customer_id=requested_customer_id;
   update public.customer_notification_preferences set whatsapp_marketing=(legacy='opted_in'),updated_at=now() where customer_id=requested_customer_id;
  else
   update public.customer_notification_preferences set email_marketing=(legacy='opted_in'),updated_at=now() where customer_id=requested_customer_id;
  end if;
  insert into public.crm_consent_events(establishment_id,customer_id,status,origin,channel,actor_id,evidence)
  select c.establishment_id,c.id,legacy,'other',case requested_purpose when 'marketing_email' then 'email' else 'whatsapp' end,requested_actor,jsonb_build_object('privacy_record_id',rid,'origin',requested_origin) from public.customers c where c.id=requested_customer_id;
 end if;
 return rid;
end $$;
revoke all on function public.privacy_record_consent(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.privacy_record_consent(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb,uuid) to service_role;

-- Baseline: today's state becomes the first canonical row, marked as imported so nobody mistakes it for a fresh consent.
insert into public.privacy_contexts(organization_id,kind,name)
 select distinct e.organization_id,'tenant_controller','Controlador (estabelecimento)' from public.customers c join public.establishments e on e.id=c.establishment_id where e.organization_id is not null and c.marketing_status in('opted_in','opted_out')
 on conflict(organization_id,kind) do nothing;
insert into public.consent_records(context_id,organization_id,establishment_id,customer_id,organization_customer_id,whatsapp_contact_id,subject_ref,purpose_key,channel,status,recorded_at,revoked_at,origin,evidence,legacy_source,legacy_id,actor_id)
 select distinct on(x.customer_id,x.channel) p.id,e.organization_id,x.establishment_id,x.customer_id,c.organization_customer_id,x.whatsapp_contact_id,coalesce(c.organization_customer_id::text,x.customer_id::text,'contact:'||x.whatsapp_contact_id::text),'marketing_'||coalesce(nullif(x.channel,''),'whatsapp'),coalesce(nullif(x.channel,''),'whatsapp'),
  case x.status when 'opted_in' then 'granted' else 'revoked' end,x.created_at,case when x.status='opted_out' then x.created_at end,'baseline:'||x.origin,x.evidence||jsonb_build_object('baseline',true),'crm_consent_events',x.id::text,x.actor_id
 from public.crm_consent_events x join public.establishments e on e.id=x.establishment_id join public.privacy_contexts p on p.organization_id=e.organization_id and p.kind='tenant_controller' left join public.customers c on c.id=x.customer_id
 order by x.customer_id,x.channel,x.created_at desc
 on conflict do nothing;
insert into public.consent_records(context_id,organization_id,establishment_id,customer_id,organization_customer_id,subject_ref,purpose_key,channel,status,recorded_at,revoked_at,origin,evidence,legacy_source,legacy_id)
 select p.id,e.organization_id,c.establishment_id,c.id,c.organization_customer_id,coalesce(c.organization_customer_id::text,c.id::text),'marketing_whatsapp','whatsapp',case c.marketing_status when 'opted_in' then 'granted' else 'revoked' end,coalesce(c.marketing_consent_at,c.created_at),case when c.marketing_status='opted_out' then coalesce(c.marketing_consent_at,c.created_at) end,'baseline:customers.marketing_status',jsonb_build_object('baseline',true),'customers',c.id::text
 from public.customers c join public.establishments e on e.id=c.establishment_id join public.privacy_contexts p on p.organization_id=e.organization_id and p.kind='tenant_controller'
 where c.marketing_status in('opted_in','opted_out') and not exists(select 1 from public.crm_consent_events x where x.customer_id=c.id)
 on conflict do nothing;

do $$declare t text;begin foreach t in array array['consent_purposes','consent_text_versions','consent_records'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
revoke all on public.consent_current from public,anon,authenticated;grant select on public.consent_current to service_role;
