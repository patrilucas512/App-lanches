-- Phase 37 hardening: bridge the immutable audience snapshot to the existing
-- canonical CRM recipient queue. The database only schedules pg_net work;
-- provider delivery remains outside the publishing HTTP request.
create or replace function public.prepare_marketing_campaign_dispatch(requested_organization_id uuid,requested_store_id uuid,requested_campaign_id uuid,requested_snapshot_id uuid,requested_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare campaign public.crm_campaigns%rowtype; inserted_count integer; queued_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required.'; end if;
  select * into campaign from public.crm_campaigns where id=requested_campaign_id and establishment_id=requested_store_id and organization_id=requested_organization_id for update;
  if not found then raise exception 'Campanha não encontrada.'; end if;
  if campaign.approval_status<>'approved' or campaign.status<>'draft' then raise exception 'Campanha precisa estar aprovada e em rascunho.'; end if;
  if not exists(select 1 from public.marketing_audience_snapshots s where s.id=requested_snapshot_id and s.campaign_id=campaign.id and s.organization_id=requested_organization_id and s.store_id=requested_store_id) then raise exception 'Snapshot inválido.'; end if;
  if 'whatsapp'=any(campaign.channels) and not exists(select 1 from public.whatsapp_message_templates t where t.id=campaign.template_id and t.establishment_id=requested_store_id and t.status='approved') then raise exception 'Template oficial do WhatsApp não aprovado.'; end if;

  insert into public.crm_campaign_recipients(establishment_id,campaign_id,customer_id,whatsapp_contact_id,wa_id,variant)
  select requested_store_id,campaign.id,m.customer_id,wc.id,wc.wa_id,coalesce(nullif(m.assignment,'control'),'A')
  from public.marketing_audience_snapshot_members m
  join public.customers c on c.id=m.customer_id and c.establishment_id=requested_store_id and c.marketing_status='opted_in'
  join lateral(select w.* from public.whatsapp_contacts w where w.customer_id=c.id and w.establishment_id=requested_store_id and not w.marketing_opt_out and w.blocked_at is null order by w.last_message_at desc nulls last limit 1)wc on true
  where m.snapshot_id=requested_snapshot_id and m.channel='whatsapp' and m.eligible and coalesce(m.assignment,'A')<>'control'
  on conflict do nothing;
  get diagnostics inserted_count=row_count;

  update public.marketing_delivery_jobs set status='completed',attempts=attempts+1,last_error=null
  where campaign_id=campaign.id and snapshot_id=requested_snapshot_id and channel='whatsapp' and status in('pending','failed');
  get diagnostics queued_count=row_count;
  update public.crm_campaigns set estimated_recipients=inserted_count,status=case when scheduled_at is not null and scheduled_at>now() then 'scheduled' else 'processing' end,audience_snapshot_id=requested_snapshot_id,updated_at=now() where id=campaign.id;
  insert into public.marketing_audit_events(organization_id,store_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(requested_organization_id,requested_store_id,requested_actor_id,'campaign_dispatch_prepared','crm_campaigns',campaign.id,jsonb_build_object('snapshot_id',requested_snapshot_id,'recipients',inserted_count,'handoff_batches',queued_count,'control_excluded',true));
  if inserted_count>0 and (campaign.scheduled_at is null or campaign.scheduled_at<=now()) then
    perform net.http_post(url:='https://qjwmjwubtgqginwhmajv.supabase.co/functions/v1/process-whatsapp-campaign-batch',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('campaign_id',campaign.id,'token',campaign.dispatch_token),timeout_milliseconds:=5000);
  end if;
  return jsonb_build_object('campaign_id',campaign.id,'recipients',inserted_count,'handoff_batches',queued_count,'status',case when campaign.scheduled_at is not null and campaign.scheduled_at>now() then 'scheduled' else 'processing' end);
end $$;
revoke all on function public.prepare_marketing_campaign_dispatch(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_marketing_campaign_dispatch(uuid,uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
