-- quality: allow-nonconcurrent-index reason=new-empty-flag-audit-tables (os índices são de tabelas criadas nesta migration)
-- Fase 98A: dono e gerente só ligam flags permitidas pelo plano da loja.
--
-- Regra do app (lib/store-entitlements.ts, private.cx_flag_enabled e demais leitores): um módulo está ligado
-- quando o plano OU a loja liga. Então `store_feature_flags.<flag> = true` com o plano desligado é uma
-- concessão fora do plano. As políticas `store_flags_admin_*` deixavam dono e gerente gravar direto pela API
-- (o INSERT funcionava em loja sem linha; o UPDATE só falhava por acaso, ver item 1).
--
-- 1. Correção de leitura: `private.has_store_access` foi revogada de `authenticated` na Fase 7, mas é usada
--    nas políticas de leitura de store_feature_flags, channels, store_service_areas e web_chat_widget_configs.
--    Todo SELECT de usuário logado nessas tabelas dava "permission denied" (o menu da 97E nunca via as flags
--    da loja). A função é SECURITY DEFINER e só responde sobre o próprio usuário: volta a ser executável.
-- 2. `authenticated` não grava mais direto em store_feature_flags. Nenhuma tela grava por esse caminho: as
--    gravações do app usam o servidor (service_role) ou funções SECURITY DEFINER, que seguem iguais.
-- 3. RPC `public.set_store_feature_flags`: superadmin ajusta qualquer flag; dono e gerente só LIGAM o que o
--    plano permite (ou as chaves operacionais da loja: entrega, WhatsApp, atendente). Desligar é livre.
--    Valores já ligados não são tocados: lojas existentes mantêm o que têm.
-- 4. Toda mudança (RPC, servidor, billing, migrations) fica em `public.store_feature_flag_audit`.

grant execute on function private.has_store_access(uuid) to authenticated;

-- limpa a primeira versão desta migration aplicada no masterapp-dev (gatilho SECURITY INVOKER)
drop trigger if exists store_feature_flags_plan_guard on public.store_feature_flags;
drop function if exists private.guard_store_feature_flags();
drop function if exists private.log_store_feature_flag_change(uuid,text,text,text,jsonb);

create table if not exists public.store_feature_flag_audit (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('superadmin','store_admin','server','system')),
  db_role text not null,
  operation text not null check (operation in ('INSERT','UPDATE')),
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists store_feature_flag_audit_store_idx on public.store_feature_flag_audit(establishment_id, created_at desc);
create index if not exists store_feature_flag_audit_actor_idx on public.store_feature_flag_audit(changed_by);
alter table public.store_feature_flag_audit enable row level security;
revoke all on public.store_feature_flag_audit from anon, authenticated;
grant select on public.store_feature_flag_audit to authenticated;
drop policy if exists store_feature_flag_audit_read on public.store_feature_flag_audit;
create policy store_feature_flag_audit_read on public.store_feature_flag_audit for select to authenticated
  using (private.has_role(establishment_id, array['owner'::public.member_role,'manager'::public.member_role]));

-- 2. sem escrita direta de usuário logado
drop policy if exists store_flags_admin_insert on public.store_feature_flags;
drop policy if exists store_flags_admin_update on public.store_feature_flags;
drop policy if exists store_flags_admin_delete on public.store_feature_flags;
revoke insert, update, delete, truncate on public.store_feature_flags from anon, authenticated;

-- plano vigente da loja como jsonb (mesma escolha de assinatura de private.cx_flag_enabled)
create or replace function private.store_plan_flags(requested_store_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.establishment_id = requested_store_id and s.status::text in ('active','trialing','past_due')
  order by s.created_at desc limit 1
$$;
revoke all on function private.store_plan_flags(uuid) from public, anon, authenticated;

-- chaves que só existem na loja e são escolha operacional do dono (não são módulo vendido)
create or replace function private.store_operational_flags()
returns text[] language sql immutable set search_path = '' as $$
  select array['delivery_enabled','whatsapp_enabled','ai_enabled']::text[]
$$;
revoke all on function private.store_operational_flags() from public, anon, authenticated;

-- 4. auditoria de toda gravação
create or replace function private.audit_store_feature_flags()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  new_row jsonb := to_jsonb(new);
  old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  changes jsonb := '{}'::jsonb;
  k text;
  actor text := nullif(current_setting('masterapp.flag_actor', true), '');
begin
  for k in select key from jsonb_each(new_row) where key like '%\_enabled' and jsonb_typeof(value) = 'boolean' loop
    if tg_op = 'UPDATE' and (new_row->k) is distinct from (old_row->k) then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', old_row->k, 'to', new_row->k));
    elsif tg_op = 'INSERT' and (new_row->>k)::boolean then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', null, 'to', true));
    end if;
  end loop;
  if changes = '{}'::jsonb then return null; end if;
  insert into public.store_feature_flag_audit(establishment_id, changed_by, actor_kind, db_role, operation, changes)
  values (new.establishment_id, (select auth.uid()),
          coalesce(actor, case when (select auth.uid()) is null then 'system' else 'server' end),
          coalesce(nullif(current_setting('role', true), 'none'), session_user::text), tg_op, changes);
  return null;
end $$;
revoke all on function private.audit_store_feature_flags() from public, anon, authenticated;
drop trigger if exists store_feature_flags_audit on public.store_feature_flags;
create trigger store_feature_flags_audit after insert or update on public.store_feature_flags
  for each row execute function private.audit_store_feature_flags();

-- 3. único caminho de gravação para usuário logado
create or replace function public.set_store_feature_flags(requested_store_id uuid, requested_flags jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  is_admin boolean := private.is_superadmin();
  plan_row jsonb;
  current_row jsonb;
  k text;
  v jsonb;
  blocked text[] := '{}';
  unknown text[] := '{}';
  sets text[] := '{}';
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if requested_store_id is null or requested_flags is null or jsonb_typeof(requested_flags) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(requested_flags)) > 400 then raise exception 'INVALID_INPUT' using errcode = '22023'; end if;
  if not is_admin and not private.has_role(requested_store_id, array['owner'::public.member_role,'manager'::public.member_role]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select to_jsonb(f) into current_row from public.store_feature_flags f where f.establishment_id = requested_store_id;
  if current_row is null then
    insert into public.store_feature_flags(establishment_id) values (requested_store_id) on conflict do nothing;
    select to_jsonb(f) into current_row from public.store_feature_flags f where f.establishment_id = requested_store_id;
  end if;
  plan_row := coalesce(private.store_plan_flags(requested_store_id), '{}'::jsonb);
  for k, v in select key, value from jsonb_each(requested_flags) loop
    if k not like '%\_enabled' or not (current_row ? k) or jsonb_typeof(v) <> 'boolean' then
      unknown := unknown || k; continue;
    end if;
    if (current_row->k) = v then continue; end if;
    if v = 'true'::jsonb and not is_admin then
      if plan_row ? k then
        if coalesce((plan_row->>k)::boolean, false) = false then blocked := blocked || k; end if;
      elsif not (k = any(private.store_operational_flags())) then
        blocked := blocked || k;
      end if;
    end if;
    sets := sets || format('%I = %L', k, (v #>> '{}')::boolean);
  end loop;
  if cardinality(unknown) > 0 then
    raise exception 'UNKNOWN_FLAG: %', array_to_string(unknown, ',') using errcode = '22023';
  end if;
  if cardinality(blocked) > 0 then
    raise exception 'FLAG_OUTSIDE_PLAN: %', array_to_string(blocked, ',')
      using errcode = '42501', hint = 'O plano da loja não inclui este módulo. Fale com o suporte ou mude de plano.';
  end if;
  if cardinality(sets) = 0 then return jsonb_build_object('changed', 0); end if;
  perform set_config('masterapp.flag_actor', case when is_admin then 'superadmin' else 'store_admin' end, true);
  execute format('update public.store_feature_flags set %s, updated_by = $1, updated_at = now() where establishment_id = $2',
                 array_to_string(sets, ', ')) using uid, requested_store_id;
  perform set_config('masterapp.flag_actor', '', true);
  return jsonb_build_object('changed', cardinality(sets));
end $$;
revoke all on function public.set_store_feature_flags(uuid, jsonb) from public, anon;
grant execute on function public.set_store_feature_flags(uuid, jsonb) to authenticated;
comment on function public.set_store_feature_flags(uuid, jsonb) is
  'Fase 98A: grava flags da loja. Superadmin: qualquer flag. Dono/gerente: só liga o que o plano permite.';
