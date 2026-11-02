-- Phase 38B: versioned surveys, one dispatch per order, consent checks at send time and the public response path.
-- quality: allow-nonconcurrent-index reason=new-empty-customer-experience-tables

create table public.cx_survey_definitions(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid references public.establishments(id) on delete cascade,key text not null,name text not null,version integer not null default 1 check(version>0),survey_type text not null check(survey_type in('nps','csat','ces')),scale text not null check(scale in('1-5','0-10','1-7')),questions jsonb not null,trigger_type text not null check(trigger_type in('order_delivered','order_picked_up','table_closed','reservation_completed','support_conversation_closed','subscription_cycle','manual')),delay_minutes integer not null default 60 check(delay_minutes>=0),channels text[] not null default '{whatsapp}',audience text not null default 'all_customers' check(audience in('all_customers','known_customers')),max_frequency_days integer check(max_frequency_days is null or max_frequency_days>=0),status text not null default 'draft' check(status in('draft','active','paused','retired')),created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,key,version),
 check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and 5),
 check((survey_type='nps' and scale='0-10') or(survey_type='csat' and scale='1-5') or(survey_type='ces' and scale='1-7')));
create unique index cx_survey_one_active_idx on public.cx_survey_definitions(organization_id,coalesce(store_id,'00000000-0000-0000-0000-000000000000'::uuid),trigger_type) where status='active';
create index cx_survey_definitions_store_idx on public.cx_survey_definitions(store_id) where store_id is not null;
create index cx_survey_definitions_created_by_idx on public.cx_survey_definitions(created_by) where created_by is not null;

create table public.cx_survey_dispatches(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,definition_id uuid not null references public.cx_survey_definitions(id) on delete restrict,definition_version integer not null,customer_id uuid references public.customers(id) on delete set null,order_id uuid references public.orders(id) on delete set null,source_ref text,trigger_type text not null,channel text not null,token_hash text unique,status text not null default 'queued' check(status in('queued','processing','sent','link_ready','answered','skipped','failed','expired')),skip_reason text,scheduled_at timestamptz not null default now(),sent_at timestamptz,expires_at timestamptz,attempts integer not null default 0 check(attempts>=0),error_message text,feedback_id uuid references public.crm_feedback(id) on delete set null,idempotency_key text not null,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,idempotency_key));
create index cx_survey_dispatches_queue_idx on public.cx_survey_dispatches(status,scheduled_at);
create index cx_survey_dispatches_customer_idx on public.cx_survey_dispatches(organization_id,customer_id,sent_at desc) where customer_id is not null;
create index cx_survey_dispatches_store_idx on public.cx_survey_dispatches(store_id,created_at desc);
create index cx_survey_dispatches_definition_idx on public.cx_survey_dispatches(definition_id);
create index cx_survey_dispatches_order_idx on public.cx_survey_dispatches(order_id) where order_id is not null;
create index cx_survey_dispatches_feedback_idx on public.cx_survey_dispatches(feedback_id) where feedback_id is not null;
create index cx_survey_dispatches_created_by_idx on public.cx_survey_dispatches(created_by) where created_by is not null;

create table public.cx_survey_responses(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,store_id uuid not null references public.establishments(id) on delete cascade,definition_id uuid not null references public.cx_survey_definitions(id) on delete restrict,definition_version integer not null,dispatch_id uuid references public.cx_survey_dispatches(id) on delete set null,feedback_id uuid not null references public.crm_feedback(id) on delete cascade,answers jsonb not null default '{}',requester_hash text,created_at timestamptz not null default now());
create index cx_survey_responses_store_idx on public.cx_survey_responses(store_id,created_at desc);
create index cx_survey_responses_rate_idx on public.cx_survey_responses(store_id,requester_hash,created_at desc) where requester_hash is not null;
create index cx_survey_responses_definition_idx on public.cx_survey_responses(definition_id);
create index cx_survey_responses_dispatch_idx on public.cx_survey_responses(dispatch_id) where dispatch_id is not null;
create index cx_survey_responses_feedback_idx on public.cx_survey_responses(feedback_id);
create index cx_survey_responses_org_idx on public.cx_survey_responses(organization_id);

-- Picks the store's survey first, then the organization's. idempotency_key is the guarantee of one survey per order.
create function private.cx_enqueue_survey(requested_store_id uuid,requested_customer_id uuid,requested_order_id uuid,requested_trigger text,requested_ref text) returns void language plpgsql security definer set search_path='' as $$
declare org uuid; d public.cx_survey_definitions%rowtype;
begin
 if requested_customer_id is null then return; end if;
 if not private.cx_flag_enabled(requested_store_id,'customer_experience_enabled') or not private.cx_flag_enabled(requested_store_id,'cx_surveys_enabled') then return; end if;
 select organization_id into org from public.establishments where id=requested_store_id;
 if org is null then return; end if;
 select * into d from public.cx_survey_definitions where organization_id=org and(store_id=requested_store_id or store_id is null) and trigger_type=requested_trigger and status='active' order by store_id nulls last limit 1;
 if d.id is null then return; end if;
 insert into public.cx_survey_dispatches(organization_id,store_id,definition_id,definition_version,customer_id,order_id,source_ref,trigger_type,channel,scheduled_at,expires_at,idempotency_key)
 values(org,requested_store_id,d.id,d.version,requested_customer_id,requested_order_id,requested_ref,requested_trigger,coalesce(d.channels[1],'whatsapp'),now()+make_interval(mins=>d.delay_minutes),now()+interval '14 days',case when requested_order_id is not null then 'order:'||requested_order_id else requested_trigger||':'||requested_ref end)
 on conflict(organization_id,idempotency_key) do nothing;
end$$;
revoke all on function private.cx_enqueue_survey(uuid,uuid,uuid,text,text) from public,anon,authenticated;

-- These triggers run inside the operational transaction: a survey failure must never block closing an order, a reservation or a support request.
create function private.cx_on_order_completed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  begin perform private.cx_enqueue_survey(new.establishment_id,new.customer_id,new.id,case new.fulfillment_type when 'delivery' then 'order_delivered' when 'dine_in' then 'table_closed' else 'order_picked_up' end,new.id::text);
  exception when others then null; end;
 end if;
 return null;
end$$;
create trigger cx_order_survey after update of status on public.orders for each row execute function private.cx_on_order_completed();
create function private.cx_on_reservation_completed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  begin perform private.cx_enqueue_survey(new.establishment_id,new.customer_id,null,'reservation_completed',new.id::text);
  exception when others then null; end;
 end if;
 return null;
end$$;
create trigger cx_reservation_survey after update of status on public.reservations for each row execute function private.cx_on_reservation_completed();
create function private.cx_on_support_closed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('resolved','closed') and old.status not in('resolved','closed') then
  begin perform private.cx_enqueue_survey(new.establishment_id,new.customer_id,null,'support_conversation_closed',new.id::text);
  exception when others then null; end;
 end if;
 return null;
end$$;
create trigger cx_support_survey after update of status on public.customer_support_requests for each row execute function private.cx_on_support_closed();
revoke all on function private.cx_on_order_completed(),private.cx_on_reservation_completed(),private.cx_on_support_closed() from public,anon,authenticated;

-- An answer given through the attendant or the portal also closes the dispatch.
create function private.cx_feedback_close_dispatch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.answered_at is not null and(tg_op='INSERT' or old.answered_at is null) then
  begin update public.cx_survey_dispatches set status='answered',feedback_id=coalesce(feedback_id,new.id),updated_at=now() where status in('queued','processing','sent','link_ready') and(feedback_id=new.id or(new.order_id is not null and order_id=new.order_id));
  exception when others then null; end;
 end if;
 return null;
end$$;
revoke all on function private.cx_feedback_close_dispatch() from public,anon,authenticated;
create trigger cx_feedback_close_dispatch after insert or update of answered_at on public.crm_feedback for each row execute function private.cx_feedback_close_dispatch();

create function public.cx_get_public_survey(requested_slug text,requested_token_hash text default null,requested_source text default 'qr_table') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare store public.establishments%rowtype; dispatch public.cx_survey_dispatches%rowtype; d public.cx_survey_definitions%rowtype;
begin
 select * into store from public.establishments where slug=requested_slug;
 if store.id is null or not private.cx_flag_enabled(store.id,'customer_experience_enabled') or not private.cx_flag_enabled(store.id,'cx_surveys_enabled') then return null; end if;
 if requested_token_hash is not null then
  select * into dispatch from public.cx_survey_dispatches where token_hash=requested_token_hash and store_id=store.id;
  if dispatch.id is null then return null; end if;
  select * into d from public.cx_survey_definitions where id=dispatch.definition_id;
 else
  select * into d from public.cx_survey_definitions where organization_id=store.organization_id and(store_id=store.id or store_id is null) and status='active' and requested_source=any(channels) order by store_id nulls last,updated_at desc limit 1;
  if d.id is null then return null; end if;
 end if;
 return jsonb_build_object('store',jsonb_build_object('name',coalesce(store.menu_display_name,store.name),'logo_url',coalesce(store.menu_logo_url,store.logo_url),'accent_color',store.accent_color),'survey',jsonb_build_object('survey_type',d.survey_type,'scale',d.scale,'questions',d.questions),'state',case when dispatch.id is null then 'open' when dispatch.status='answered' then 'answered' when dispatch.expires_at<now() then 'expired' else 'open' end);
end$$;

create function public.cx_submit_survey_response(requested_slug text,requested_token_hash text,requested_source text,requested_score numeric,requested_comment text,requested_dimensions jsonb,requested_items jsonb,requested_requester_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare store public.establishments%rowtype; dispatch public.cx_survey_dispatches%rowtype; d public.cx_survey_definitions%rowtype; f public.crm_feedback%rowtype; feedback uuid; detractor boolean; clean_comment text:=nullif(left(btrim(coalesce(requested_comment,'')),1000),''); legacy smallint; effective_source text:=requested_source;
begin
 select * into store from public.establishments where slug=requested_slug;
 if store.id is null or not private.cx_flag_enabled(store.id,'cx_surveys_enabled') then raise exception 'CX_SURVEY_UNAVAILABLE'; end if;
 if requested_token_hash is not null then
  select * into dispatch from public.cx_survey_dispatches where token_hash=requested_token_hash and store_id=store.id for update;
  if dispatch.id is null then raise exception 'CX_SURVEY_UNAVAILABLE'; end if;
  if dispatch.status='answered' then raise exception 'CX_ALREADY_ANSWERED'; end if;
  if dispatch.expires_at<now() or dispatch.status in('expired','skipped') then raise exception 'CX_SURVEY_EXPIRED'; end if;
  -- The link says where it was delivered: the page cannot relabel it.
  effective_source:=dispatch.channel;
  select * into d from public.cx_survey_definitions where id=dispatch.definition_id;
 else
  select * into d from public.cx_survey_definitions where organization_id=store.organization_id and(store_id=store.id or store_id is null) and status='active' and requested_source=any(channels) order by store_id nulls last,updated_at desc limit 1;
  if d.id is null then raise exception 'CX_SURVEY_UNAVAILABLE'; end if;
  if requested_requester_hash is not null and(select count(*) from public.cx_survey_responses where store_id=store.id and requester_hash=requested_requester_hash and created_at>now()-interval '1 hour')>=5 then raise exception 'CX_RATE_LIMITED'; end if;
 end if;
 if requested_score is null or(d.scale='0-10' and requested_score not between 0 and 10) or(d.scale='1-5' and requested_score not between 1 and 5) or(d.scale='1-7' and requested_score not between 1 and 7) then raise exception 'CX_SCORE_INVALID'; end if;
 detractor:=case d.survey_type when 'nps' then requested_score<=6 when 'csat' then requested_score<=2 else requested_score<=3 end;
 legacy:=case when d.scale='1-5' then requested_score::smallint end;
 if dispatch.order_id is not null then select * into f from public.crm_feedback where order_id=dispatch.order_id for update; elsif dispatch.feedback_id is not null then select * into f from public.crm_feedback where id=dispatch.feedback_id for update; end if;
 if f.id is not null and f.answered_at is not null then raise exception 'CX_ALREADY_ANSWERED'; end if;
 if f.id is not null then
  update public.crm_feedback set rating=legacy,score=requested_score,scale=d.scale,feedback_type=d.survey_type,comment=clean_comment,source=effective_source,channel=effective_source,dimension_ratings=coalesce(requested_dimensions,'{}'),item_ratings=coalesce(requested_items,'[]'),needs_human_attention=detractor,answered_at=now() where id=f.id returning id into feedback;
 else
  insert into public.crm_feedback(establishment_id,organization_id,customer_id,order_id,rating,score,scale,feedback_type,comment,source,channel,dimension_ratings,item_ratings,needs_human_attention,answered_at)
  values(store.id,store.organization_id,dispatch.customer_id,dispatch.order_id,legacy,requested_score,d.scale,d.survey_type,clean_comment,effective_source,effective_source,coalesce(requested_dimensions,'{}'),coalesce(requested_items,'[]'),detractor,now()) returning id into feedback;
 end if;
 insert into public.cx_survey_responses(organization_id,store_id,definition_id,definition_version,dispatch_id,feedback_id,answers,requester_hash) values(store.organization_id,store.id,d.id,d.version,dispatch.id,feedback,jsonb_build_object('score',requested_score,'dimensions',coalesce(requested_dimensions,'{}'),'items',coalesce(requested_items,'[]')),requested_requester_hash);
 if dispatch.id is not null then update public.cx_survey_dispatches set status='answered',feedback_id=feedback,updated_at=now() where id=dispatch.id; end if;
 return jsonb_build_object('feedback_id',feedback,'organization_id',store.organization_id,'store_id',store.id,'detractor',detractor,'identified',dispatch.customer_id is not null);
end$$;

do $$declare f text;begin foreach f in array array['cx_get_public_survey(text,text,text)','cx_submit_survey_response(text,text,text,numeric,text,jsonb,jsonb,text)'] loop execute format('revoke all on function public.%s from public,anon,authenticated',f);execute format('grant execute on function public.%s to service_role',f);end loop;end$$;
do $$declare t text;begin foreach t in array array['cx_survey_definitions','cx_survey_dispatches','cx_survey_responses'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end$$;
