-- Phase 11 hardening after production advisor review.
create index if not exists voice_connections_org_idx on public.voice_connections(organization_id) where organization_id is not null;
create index if not exists voice_calls_org_idx on public.voice_call_sessions(organization_id);
create index if not exists voice_calls_customer_idx on public.voice_call_sessions(customer_id) where customer_id is not null;
create index if not exists voice_calls_queue_idx on public.voice_call_sessions(queue_id) where queue_id is not null;
create index if not exists voice_calls_assignee_idx on public.voice_call_sessions(assigned_user_id) where assigned_user_id is not null;
create index if not exists voice_calls_order_idx on public.voice_call_sessions(order_id) where order_id is not null;
create index if not exists voice_events_store_idx on public.voice_call_events(establishment_id,created_at desc);
create index if not exists voice_callbacks_call_idx on public.voice_callbacks(call_session_id) where call_session_id is not null;
create index if not exists voice_callbacks_customer_idx on public.voice_callbacks(customer_id) where customer_id is not null;
create index if not exists voice_callbacks_queue_fk_idx on public.voice_callbacks(queue_id) where queue_id is not null;
create index if not exists voice_callbacks_assignee_idx on public.voice_callbacks(assigned_user_id) where assigned_user_id is not null;
create index if not exists voice_costs_call_idx on public.voice_cost_usage(call_session_id);
create index if not exists voice_blocklist_actor_idx on public.voice_blocklist(created_by) where created_by is not null;
create index if not exists voice_permissions_user_idx on public.voice_member_permissions(user_id);
create index if not exists voice_order_links_store_idx on public.voice_order_links(establishment_id,created_at desc);
create index if not exists voice_order_links_call_idx on public.voice_order_links(call_session_id);
create index if not exists voice_transcripts_store_idx on public.voice_transcript_segments(establishment_id,created_at desc);

create or replace function public.get_voice_call_detail(requested_establishment_id uuid, requested_call_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; transcript_allowed boolean; recording_allowed boolean; call_row public.voice_call_sessions%rowtype;
begin
  if not private.can_voice(requested_establishment_id,'view') then raise exception 'Acesso negado.'; end if;
  select * into call_row from public.voice_call_sessions where id=requested_call_id and establishment_id=requested_establishment_id;
  if not found then raise exception 'Ligação não encontrada.'; end if;
  transcript_allowed:=private.can_voice(requested_establishment_id,'transcript');
  recording_allowed:=private.can_voice(requested_establishment_id,'recording');
  select jsonb_build_object(
    'call',to_jsonb(call_row)-'recording_storage_path',
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.voice_call_events e where e.call_session_id=requested_call_id),'[]'::jsonb),
    'transcript',case when transcript_allowed then coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.voice_transcript_segments t where t.call_session_id=requested_call_id),'[]'::jsonb) else null end,
    'recording_available',recording_allowed and call_row.recording_storage_path is not null,
    'recording_requires_signed_url',recording_allowed and call_row.recording_storage_path is not null,
    'order',case when call_row.order_id is null then null else (select to_jsonb(o) from public.orders o where o.id=call_row.order_id and o.establishment_id=requested_establishment_id) end
  ) into result;
  if transcript_allowed then insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'call_transcript_accessed','voice_call',requested_call_id,'{}'); end if;
  if recording_allowed and call_row.recording_storage_path is not null then insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,(select auth.uid()),'call_recording_accessed','voice_call',requested_call_id,jsonb_build_object('signed_url_required',true)); end if;
  return result;
end $$;
revoke all on function public.get_voice_call_detail(uuid,uuid) from public,anon;
grant execute on function public.get_voice_call_detail(uuid,uuid) to authenticated;
