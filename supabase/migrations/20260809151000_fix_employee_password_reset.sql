create or replace function public.claim_waiter_invite_as_user(
  requested_token uuid,
  requested_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_record public.waiter_access_links%rowtype;
  waiter_record public.waiters%rowtype;
begin
  if requested_user_id is null or not exists (select 1 from auth.users where id = requested_user_id) then
    raise exception 'Usuário de acesso inválido.';
  end if;
  select * into link_record from public.waiter_access_links
  where token=requested_token and used_at is null and expires_at>now() for update;
  if not found then raise exception 'Convite inválido ou expirado.'; end if;
  select * into waiter_record from public.waiters where id=link_record.waiter_id for update;
  if waiter_record.phone is null or btrim(waiter_record.phone)='' then raise exception 'O garçom não possui WhatsApp cadastrado.'; end if;
  if exists (select 1 from public.establishment_members where user_id=requested_user_id and establishment_id<>link_record.establishment_id) then
    raise exception 'Este telefone já pertence a outro estabelecimento.';
  end if;

  if exists (select 1 from public.establishment_members where establishment_id=link_record.establishment_id and user_id=requested_user_id) then
    update public.establishment_members set role='attendant'
    where establishment_id=link_record.establishment_id and user_id=requested_user_id;
  else
    insert into public.establishment_members(establishment_id,user_id,role)
    values(link_record.establishment_id,requested_user_id,'attendant');
  end if;

  update public.waiters set user_id=requested_user_id,email=null,status='active',active_now=true,last_access_at=now(),updated_at=now()
  where id=waiter_record.id returning * into waiter_record;
  update public.waiter_access_links set used_at=now() where id=link_record.id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(link_record.establishment_id,requested_user_id,'waiter.password_reset','waiters',waiter_record.id,jsonb_build_object('phone_only',true));
  return to_jsonb(waiter_record);
end
$$;

create or replace function public.claim_kitchen_invite_as_user(
  requested_token uuid,
  requested_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_record public.kitchen_access_links%rowtype;
  operator_record public.kitchen_operators%rowtype;
begin
  if requested_user_id is null or not exists (select 1 from auth.users where id=requested_user_id) then
    raise exception 'Usuário de acesso inválido.';
  end if;
  select * into link_record from public.kitchen_access_links
  where token=requested_token and used_at is null and expires_at>now() for update;
  if not found then raise exception 'Acesso inválido ou expirado.'; end if;
  select * into operator_record from public.kitchen_operators where id=link_record.operator_id for update;
  if exists (select 1 from public.establishment_members where user_id=requested_user_id and establishment_id<>link_record.establishment_id) then
    raise exception 'Este WhatsApp já pertence a outro estabelecimento.';
  end if;

  if exists (select 1 from public.establishment_members where establishment_id=link_record.establishment_id and user_id=requested_user_id) then
    update public.establishment_members set role='kitchen'
    where establishment_id=link_record.establishment_id and user_id=requested_user_id;
  else
    insert into public.establishment_members(establishment_id,user_id,role)
    values(link_record.establishment_id,requested_user_id,'kitchen');
  end if;

  update public.kitchen_operators set user_id=requested_user_id,status='active',last_access_at=now(),updated_at=now()
  where id=operator_record.id returning * into operator_record;
  update public.kitchen_access_links set used_at=now() where id=link_record.id;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
  values(link_record.establishment_id,requested_user_id,'kitchen.password_reset','kitchen_operators',operator_record.id,'{}'::jsonb);
  return to_jsonb(operator_record);
end
$$;

revoke all on function public.claim_waiter_invite_as_user(uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_kitchen_invite_as_user(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_waiter_invite_as_user(uuid,uuid) to service_role;
grant execute on function public.claim_kitchen_invite_as_user(uuid,uuid) to service_role;
