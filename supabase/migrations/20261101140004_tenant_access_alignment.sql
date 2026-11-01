-- As policies de organização avaliam esta função com o papel do cliente; ela só responde sobre o próprio usuário.
grant execute on function private.has_organization_role(uuid, text[]) to authenticated;

-- Acesso por unidade passa a seguir a mesma regra de vínculo ativo já usada pelas rotas do app.
create or replace function private.has_role(target_establishment uuid, allowed_roles public.member_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_superadmin() or exists (
    select 1 from public.establishment_members m
    where m.user_id = (select auth.uid())
      and m.establishment_id = target_establishment
      and m.status = 'active'
      and (allowed_roles is null or m.role = any(allowed_roles))
  )
$$;

-- Rotinas automáticas e a ativação guiada respeitam decisões administrativas da plataforma.
create or replace function public.process_due_copilot_temporary_operations(requested_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare op public.copilot_temporary_operations%rowtype; processed integer:=0; held boolean;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Acesso restrito ao scheduler.'; end if;
  for op in select * from public.copilot_temporary_operations where status='scheduled' and restore_at<=now() order by restore_at for update skip locked limit least(greatest(requested_limit,1),500) loop
    begin
      select (blocked_at is not null or not public_menu_active) into held from public.establishments where id=op.establishment_id;
      if not coalesce(held,false) then
        update public.establishments set active=coalesce((op.restore_state->>'active')::boolean,true),unit_status=coalesce(op.restore_state->>'unit_status','active'),updated_at=now() where id=op.establishment_id;
        update public.service_modes set store_open=coalesce((op.restore_state->>'store_open')::boolean,true),updated_at=now() where establishment_id=op.establishment_id;
      end if;
      update public.copilot_temporary_operations set status='restored',restored_at=now() where id=op.id;
      insert into public.copilot_action_events(action_id,organization_id,establishment_id,event_type,metadata) values(op.action_id,op.organization_id,op.establishment_id,'action_executed',jsonb_build_object('automatic_restore',true,'skipped',coalesce(held,false))); processed:=processed+1;
    exception when others then update public.copilot_temporary_operations set status='failed',failure_reason=left(sqlerrm,1000) where id=op.id; end;
  end loop;
  return processed;
end $$;

create or replace function public.activate_store_from_onboarding(requested_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.onboarding_sessions%rowtype; missing text[]:='{}';
begin
 select * into s from public.onboarding_sessions where id=requested_session_id;
 if s.id is null or not private.onboarding_can(s.organization_id,'activate') then raise exception 'Sem permissão para ativar'; end if;
 if not exists(select 1 from public.establishments where id=s.establishment_id and active and blocked_at is null and public_menu_active) then missing:=array_append(missing,'unidade ativa'); end if;
 if not exists(select 1 from public.business_hours where establishment_id=s.establishment_id) then missing:=array_append(missing,'horários'); end if;
 if not exists(select 1 from public.products where establishment_id=s.establishment_id and active) then missing:=array_append(missing,'produto ativo'); end if;
 if not exists(select 1 from public.establishment_settings where establishment_id=s.establishment_id and jsonb_array_length(payment_methods)>0) then missing:=array_append(missing,'pagamento'); end if;
 if array_length(missing,1)>0 then return jsonb_build_object('ready',false,'missing',missing); end if;
 update public.establishments set onboarding_completed=true,public_menu_active=true,onboarding_activated_at=coalesce(onboarding_activated_at,now()),updated_at=now() where id=s.establishment_id;
 update public.organizations set activated_at=coalesce(activated_at,now()),updated_at=now() where id=s.organization_id;
 update public.onboarding_steps set status='completed',completed_at=now(),configured_by=(select auth.uid()),updated_at=now() where session_id=s.id and step_key='launch';
 update public.onboarding_sessions set status='completed',progress_percent=100,completed_at=now(),current_step=null,last_activity_at=now(),updated_at=now() where id=s.id;
 insert into public.onboarding_events(organization_id,establishment_id,session_id,event_type,step_key,actor_user_id) values(s.organization_id,s.establishment_id,s.id,'store_activated','launch',(select auth.uid()));
 return jsonb_build_object('ready',true,'store_id',s.establishment_id);
end$$;
