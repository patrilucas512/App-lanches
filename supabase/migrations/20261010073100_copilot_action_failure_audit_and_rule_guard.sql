alter table public.copilot_rule_definitions
  add constraint copilot_rule_known_action_check
  check (action_type in ('INTERNAL_ALERT_CREATE','PRODUCT_SET_AVAILABILITY','CAMPAIGN_PAUSE','CAMPAIGN_RESUME','STORE_TEMPORARILY_CLOSE','STORE_REOPEN','DELIVERY_TOGGLE','UPDATE_DELIVERY_ESTIMATE','AI_TOGGLE','WHATSAPP_AUTOMATION_TOGGLE','ASSIGN_CONVERSATION','CHANGE_CONVERSATION_PRIORITY','QUEUE_ADJUST_CAPACITY'));

alter table public.copilot_rule_definitions
  add constraint copilot_rule_auto_low_risk_check
  check (approval_mode <> 'auto_low_risk' or action_type = 'INTERNAL_ALERT_CREATE');

create or replace function public.confirm_copilot_action(requested_action_id uuid,requested_confirmation_token uuid,requested_confirmation_text text default null)
returns jsonb language plpgsql security definer set search_path='extensions' as $$
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

revoke all on function public.confirm_copilot_action(uuid,uuid,text) from public,anon;
grant execute on function public.confirm_copilot_action(uuid,uuid,text) to authenticated;
