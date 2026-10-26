-- Super Administrator control center.
-- Every exposed table is protected by RLS and only private.is_superadmin() can mutate it.

alter table public.profiles
  add column if not exists status text not null default 'active' check (status in ('active','inactive','blocked','pending_invite')),
  add column if not exists last_login_at timestamptz;

alter table public.establishments
  add column if not exists public_menu_active boolean not null default true,
  add column if not exists blocked_at timestamptz,
  add column if not exists block_type text,
  add column if not exists block_reason text,
  add column if not exists block_message text,
  add column if not exists last_activity_at timestamptz;

alter table public.establishment_members
  add column if not exists status text not null default 'active' check (status in ('active','inactive','blocked','pending_invite')),
  add column if not exists updated_at timestamptz not null default now();

alter table public.plans
  add column if not exists max_waiters integer,
  add column if not exists max_qr_codes integer,
  add column if not exists waiter_mode_enabled boolean not null default true,
  add column if not exists kitchen_enabled boolean not null default true,
  add column if not exists pix_secure_enabled boolean not null default true,
  add column if not exists card_proof_enabled boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.platform_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value integer not null check (discount_value > 0),
  duration text not null default 'once' check (duration in ('once','repeating','forever')),
  valid_until timestamptz,
  max_redemptions integer,
  redeemed_count integer not null default 0,
  applicable_plan_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  type text not null default 'info' check (type in ('info','alert','maintenance','billing','news','block')),
  target_type text not null default 'all' check (target_type in ('all','plan','past_due','trial','establishment')),
  target_plan_id uuid references public.plans(id) on delete set null,
  target_establishment_id uuid references public.establishments(id) on delete cascade,
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid references public.establishments(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open','analyzing','waiting_customer','resolved','closed')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.support_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  note text not null,
  is_internal boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.superadmin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  superadmin_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  establishment_id uuid references public.establishments(id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  ip_address inet,
  device_info text,
  created_at timestamptz not null default now()
);

create table if not exists public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  superadmin_user_id uuid not null references public.profiles(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists platform_announcements_target_idx on public.platform_announcements(target_type, target_establishment_id, is_active);
create index if not exists support_tickets_establishment_idx on public.support_tickets(establishment_id, status, created_at desc);
create index if not exists support_notes_ticket_idx on public.support_notes(ticket_id, created_at);
create index if not exists superadmin_audit_created_idx on public.superadmin_audit_logs(created_at desc);
create index if not exists superadmin_audit_establishment_idx on public.superadmin_audit_logs(establishment_id, created_at desc);
create index if not exists impersonation_active_idx on public.impersonation_sessions(superadmin_user_id, ended_at);
create index if not exists establishments_blocked_idx on public.establishments(blocked_at) where blocked_at is not null;

alter table public.platform_coupons enable row level security;
alter table public.platform_announcements enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_notes enable row level security;
alter table public.platform_settings enable row level security;
alter table public.superadmin_audit_logs enable row level security;
alter table public.impersonation_sessions enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['platform_coupons','platform_announcements','support_tickets','support_notes','platform_settings','superadmin_audit_logs','impersonation_sessions']
  loop
    execute format('drop policy if exists superadmin_all on public.%I', table_name);
    execute format('create policy superadmin_all on public.%I for all to authenticated using ((select private.is_superadmin())) with check ((select private.is_superadmin()))', table_name);
  end loop;
end $$;

drop policy if exists plans_superadmin_insert on public.plans;
drop policy if exists plans_superadmin_update on public.plans;
create policy plans_superadmin_insert on public.plans for insert to authenticated with check ((select private.is_superadmin()));
create policy plans_superadmin_update on public.plans for update to authenticated using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

grant select, insert, update on public.platform_coupons, public.platform_announcements, public.support_tickets, public.support_notes, public.platform_settings to authenticated;
grant select, insert on public.superadmin_audit_logs, public.impersonation_sessions to authenticated;
grant update on public.impersonation_sessions to authenticated;
grant insert, update on public.plans to authenticated;

create or replace function public.superadmin_set_establishment_block(
  target_establishment_id uuid,
  should_block boolean,
  confirmation text,
  reason text default null,
  block_kind text default 'administrative'
) returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare previous_row jsonb; next_row jsonb;
begin
  if not private.is_superadmin() then raise exception 'Acesso negado'; end if;
  if confirmation <> (case when should_block then 'BLOQUEAR' else 'DESBLOQUEAR' end) then raise exception 'Confirmação inválida'; end if;
  select to_jsonb(e) into previous_row from public.establishments e where id = target_establishment_id for update;
  if previous_row is null then raise exception 'Estabelecimento não encontrado'; end if;
  update public.establishments set
    active = not should_block,
    blocked_at = case when should_block then now() else null end,
    block_type = case when should_block then coalesce(block_kind,'administrative') else null end,
    block_reason = case when should_block then nullif(reason,'') else null end,
    updated_at = now()
  where id = target_establishment_id returning to_jsonb(establishments.*) into next_row;
  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,establishment_id,old_value,new_value,reason)
  values (auth.uid(),case when should_block then 'establishment.blocked' else 'establishment.unblocked' end,'establishment',target_establishment_id,target_establishment_id,previous_row,next_row,reason);
end $$;

create or replace function public.superadmin_set_public_menu(
  target_establishment_id uuid,
  is_enabled boolean,
  confirmation text,
  reason text default null
) returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare old_value boolean;
begin
  if not private.is_superadmin() then raise exception 'Acesso negado'; end if;
  if confirmation <> (case when is_enabled then 'REATIVAR' else 'SUSPENDER' end) then raise exception 'Confirmação inválida'; end if;
  select public_menu_active into old_value from public.establishments where id=target_establishment_id for update;
  update public.establishments set public_menu_active=is_enabled, updated_at=now() where id=target_establishment_id;
  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,establishment_id,old_value,new_value,reason)
  values(auth.uid(),'establishment.public_menu_changed','establishment',target_establishment_id,target_establishment_id,jsonb_build_object('enabled',old_value),jsonb_build_object('enabled',is_enabled),reason);
end $$;

create or replace function public.superadmin_change_subscription_plan(
  target_subscription_id uuid,
  target_plan_id uuid,
  confirmation text,
  reason text default null
) returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare old_row jsonb; new_row jsonb; target_establishment uuid;
begin
  if not private.is_superadmin() then raise exception 'Acesso negado'; end if;
  if confirmation <> 'ALTERAR PLANO' then raise exception 'Confirmação inválida'; end if;
  if not exists(select 1 from public.plans where id=target_plan_id) then raise exception 'Plano não encontrado'; end if;
  select to_jsonb(s),s.establishment_id into old_row,target_establishment from public.subscriptions s where id=target_subscription_id for update;
  update public.subscriptions set plan_id=target_plan_id,updated_at=now() where id=target_subscription_id returning to_jsonb(subscriptions.*) into new_row;
  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,establishment_id,old_value,new_value,reason)
  values(auth.uid(),'subscription.plan_changed','subscription',target_subscription_id,target_establishment,old_row,new_row,reason);
end $$;

create or replace function public.superadmin_extend_trial(
  target_subscription_id uuid,
  extra_days integer,
  confirmation text,
  reason text default null
) returns void
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare old_end timestamptz; new_end timestamptz; target_establishment uuid;
begin
  if not private.is_superadmin() then raise exception 'Acesso negado'; end if;
  if confirmation <> 'ESTENDER TESTE' or extra_days < 1 or extra_days > 365 then raise exception 'Confirmação ou período inválido'; end if;
  select trial_ends_at,establishment_id into old_end,target_establishment from public.subscriptions where id=target_subscription_id for update;
  new_end := greatest(coalesce(old_end,now()),now()) + make_interval(days=>extra_days);
  update public.subscriptions set trial_ends_at=new_end,status='trialing',updated_at=now() where id=target_subscription_id;
  insert into public.superadmin_audit_logs(superadmin_user_id,action,entity,entity_id,establishment_id,old_value,new_value,reason)
  values(auth.uid(),'subscription.trial_extended','subscription',target_subscription_id,target_establishment,jsonb_build_object('trial_ends_at',old_end),jsonb_build_object('trial_ends_at',new_end),reason);
end $$;

revoke all on function public.superadmin_set_establishment_block(uuid,boolean,text,text,text) from public, anon;
revoke all on function public.superadmin_set_public_menu(uuid,boolean,text,text) from public, anon;
revoke all on function public.superadmin_change_subscription_plan(uuid,uuid,text,text) from public, anon;
revoke all on function public.superadmin_extend_trial(uuid,integer,text,text) from public, anon;
grant execute on function public.superadmin_set_establishment_block(uuid,boolean,text,text,text) to authenticated;
grant execute on function public.superadmin_set_public_menu(uuid,boolean,text,text) to authenticated;
grant execute on function public.superadmin_change_subscription_plan(uuid,uuid,text,text) to authenticated;
grant execute on function public.superadmin_extend_trial(uuid,integer,text,text) to authenticated;

insert into public.platform_settings(key,value)
values
  ('platform', jsonb_build_object('name','MasterApp','support_email','','support_whatsapp','','default_trial_days',14,'late_grace_days',3)),
  ('maintenance', jsonb_build_object('enabled',false,'message','Estamos realizando uma manutenção programada.'))
on conflict (key) do nothing;
