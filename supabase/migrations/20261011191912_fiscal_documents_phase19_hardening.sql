-- Phase 19 hardening: automatic queueing, customer links and server-only provider result processing.
create or replace function private.normalize_fiscal_profile_status() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.provider='sandbox_adapter' and new.environment='test' then new.status:='ready';
 elsif new.provider='sandbox_adapter' and new.environment='production' then new.status:='error';
 else new.status:='incomplete'; end if;
 return new;
end$$;
revoke all on function private.normalize_fiscal_profile_status() from public,anon,authenticated;
create trigger fiscal_profile_status_guard before insert or update of provider,environment,credentials_configured on public.fiscal_profiles for each row execute function private.normalize_fiscal_profile_status();

create or replace function private.queue_automatic_fiscal_document() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.fiscal_profiles;enabled boolean;should_issue boolean;d_id uuid;idem text;
begin
 select * into p from public.fiscal_profiles where organization_id=new.organization_id and store_id=new.establishment_id and status='ready';
 if p.id is null or p.issue_mode='manual' then return new;end if;
 select coalesce(sf.fiscal_auto_issue_enabled,pl.fiscal_auto_issue_enabled,false) into enabled
 from public.establishments e left join public.store_feature_flags sf on sf.establishment_id=e.id
 left join public.subscriptions s on s.establishment_id=e.id and s.status::text in('active','trialing')
 left join public.plans pl on pl.id=s.plan_id where e.id=new.establishment_id limit 1;
 if not coalesce(enabled,false) then return new;end if;
 should_issue:=(p.issue_mode='order_confirmed' and new.status::text='confirmed') or (p.issue_mode='payment_confirmed' and (new.paid_at is not null or new.online_payment_status='approved')) or (p.issue_mode='completed' and new.status::text='completed');
 if not should_issue then return new;end if;
 idem:='auto:'||new.id||':'||p.issue_mode;
 insert into public.fiscal_documents(organization_id,store_id,direction,document_type,order_id,customer_id,status,provider,environment,total_cents,payload_hash,idempotency_key)
 values(new.organization_id,new.establishment_id,'issued','fiscal_invoice',new.id,new.customer_id,'pending',p.provider,p.environment,new.total_cents,encode(digest(jsonb_build_object('order_id',new.id,'total_cents',new.total_cents)::text,'sha256'),'hex'),idem)
 on conflict(organization_id,provider,idempotency_key) do update set updated_at=public.fiscal_documents.updated_at returning id into d_id;
 insert into public.fiscal_jobs(organization_id,store_id,document_id,job_type,idempotency_key) values(new.organization_id,new.establishment_id,d_id,'issue','issue:'||d_id) on conflict(idempotency_key) do nothing;
 return new;
end$$;
revoke all on function private.queue_automatic_fiscal_document() from public,anon,authenticated;
create trigger orders_fiscal_auto_queue after insert or update of status,paid_at,online_payment_status on public.orders for each row execute function private.queue_automatic_fiscal_document();

create or replace function public.fiscal_create_magic_link(requested_document_id uuid,requested_expires_in_minutes integer default 60) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.fiscal_documents;raw_token text;link_id uuid;begin
 select * into d from public.fiscal_documents where id=requested_document_id;
 if d.id is null or d.status<>'authorized' or not private.fiscal_can_access(d.organization_id,d.store_id,'view') then raise exception 'Documento indisponível';end if;
 if d.pdf_storage_path is null and d.xml_storage_path is null then raise exception 'Documento sem arquivo disponível';end if;
 raw_token:=gen_random_uuid()::text||replace(gen_random_uuid()::text,'-','');
 insert into public.fiscal_magic_links(document_id,token_hash,expires_at,created_by) values(d.id,encode(digest(raw_token,'sha256'),'hex'),now()+make_interval(mins=>least(greatest(requested_expires_in_minutes,5),1440)),auth.uid()) returning id into link_id;
 perform private.fiscal_audit(d.organization_id,d.store_id,'fiscal_magic_link_created','fiscal_document',d.id,jsonb_build_object('link_id',link_id,'expires_minutes',requested_expires_in_minutes));
 return jsonb_build_object('token',raw_token,'expires_at',now()+make_interval(mins=>least(greatest(requested_expires_in_minutes,5),1440)));
end$$;
revoke all on function public.fiscal_create_magic_link(uuid,integer) from public,anon;grant execute on function public.fiscal_create_magic_link(uuid,integer) to authenticated;

create or replace function public.fiscal_resolve_magic_link(requested_token text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.fiscal_magic_links;d public.fiscal_documents;begin
 if auth.role()<>'service_role' then raise exception 'Somente serviço interno';end if;
 select * into l from public.fiscal_magic_links where token_hash=encode(digest(requested_token,'sha256'),'hex') for update;
 if l.id is null or l.revoked_at is not null or l.expires_at<=now() or l.access_count>=l.max_access_count then raise exception 'Link inválido ou expirado';end if;
 update public.fiscal_magic_links set access_count=access_count+1 where id=l.id;
 select * into d from public.fiscal_documents where id=l.document_id and status='authorized';
 return jsonb_build_object('document_id',d.id,'pdf_storage_path',d.pdf_storage_path,'xml_storage_path',d.xml_storage_path,'document_number',d.document_number,'expires_at',l.expires_at);
end$$;
revoke all on function public.fiscal_resolve_magic_link(text) from public,anon,authenticated;grant execute on function public.fiscal_resolve_magic_link(text) to service_role;

create or replace function public.fiscal_apply_provider_result(requested_job_id uuid,requested_result jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.fiscal_jobs;d public.fiscal_documents;new_status text;begin
 if auth.role()<>'service_role' then raise exception 'Somente serviço interno';end if;
 select * into j from public.fiscal_jobs where id=requested_job_id for update;if j.id is null then raise exception 'Job não encontrado';end if;
 new_status:=coalesce(requested_result->>'status','error');if new_status not in('pending','processing','authorized','rejected','cancelled','contingency','error') then new_status:='error';end if;
 update public.fiscal_documents set status=new_status,provider_document_id=coalesce(requested_result->>'providerDocumentId',provider_document_id),document_number=coalesce(requested_result->>'number',document_number),series=coalesce(requested_result->>'series',series),access_key=coalesce(requested_result->>'accessKey',access_key),error_code=requested_result->>'errorCode',error_message=requested_result->>'errorMessage',issued_at=case when new_status='authorized' then coalesce(issued_at,now()) else issued_at end,cancelled_at=case when new_status='cancelled' then now() else cancelled_at end,updated_at=now() where id=j.document_id returning * into d;
 update public.fiscal_jobs set status=case when new_status in('authorized','cancelled') then 'completed' when new_status in('error','rejected') and attempts+1>=max_attempts then 'dead_letter' when new_status in('error','rejected') then 'failed' else 'processing' end,attempts=attempts+1,last_error=requested_result->>'errorMessage',next_attempt_at=now()+make_interval(mins=>least(60,power(2,least(attempts,5))::integer)),updated_at=now() where id=j.id;
 insert into public.fiscal_document_events(document_id,event_type,status,payload) values(d.id,'provider_result',new_status,requested_result-'xml');
 return jsonb_build_object('document_id',d.id,'status',new_status);
end$$;
revoke all on function public.fiscal_apply_provider_result(uuid,jsonb) from public,anon,authenticated;grant execute on function public.fiscal_apply_provider_result(uuid,jsonb) to service_role;

create or replace function public.fiscal_add_digital_document(requested_establishment_id uuid,requested_category text,requested_title text,requested_description text,requested_storage_path text,requested_file_name text,requested_mime text,requested_size bigint,requested_tags text[] default '{}',requested_document_date date default current_date) returns public.digital_documents language plpgsql security definer set search_path=public,private,pg_temp as $$
declare org uuid;r public.digital_documents;begin select organization_id into org from public.establishments where id=requested_establishment_id;if not private.fiscal_can_access(org,requested_establishment_id,'import') then raise exception 'Sem permissão';end if;insert into public.digital_documents(organization_id,store_id,category,title,description,storage_path,file_name,mime_type,size_bytes,tags,document_date,retention_until,created_by) values(org,requested_establishment_id,requested_category,btrim(requested_title),nullif(btrim(requested_description),''),requested_storage_path,requested_file_name,requested_mime,requested_size,coalesce(requested_tags,'{}'),requested_document_date,current_date+1825,auth.uid()) returning * into r;perform private.fiscal_audit(org,requested_establishment_id,'digital_document_added','digital_document',r.id,jsonb_build_object('category',r.category,'tags',r.tags));return r;end$$;
revoke all on function public.fiscal_add_digital_document(uuid,text,text,text,text,text,text,bigint,text[],date) from public,anon;grant execute on function public.fiscal_add_digital_document(uuid,text,text,text,text,text,text,bigint,text[],date) to authenticated;
