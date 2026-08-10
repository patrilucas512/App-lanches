alter table public.staff_roles
  add column if not exists financial_role boolean not null default false,
  add column if not exists system_key text;

alter table public.staff_roles drop constraint if exists staff_roles_system_key_check;
alter table public.staff_roles add constraint staff_roles_system_key_check
  check (system_key is null or system_key in ('cashier'));

create unique index if not exists staff_roles_establishment_system_unique
  on public.staff_roles (establishment_id, system_key)
  where system_key is not null;

insert into public.staff_roles (establishment_id, name, description, color, financial_role, system_key)
select id, 'Caixa', 'Responsáveis por recebimentos, fechamento e conferência financeira.', '#1f6b50', true, 'cashier'
from public.establishments
on conflict (establishment_id, system_key) where system_key is not null do nothing;

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  staff_member_id uuid not null references public.custom_staff_members(id) on delete restrict,
  staff_role_id uuid not null references public.staff_roles(id) on delete restrict,
  operator_name text not null check (char_length(trim(operator_name)) >= 2),
  movement_type text not null check (movement_type in ('inflow', 'outflow')),
  category text not null check (char_length(trim(category)) >= 2),
  payment_method text not null check (payment_method in ('pix', 'cash', 'credit_card', 'debit_card', 'transfer', 'other')),
  amount_cents integer not null check (amount_cents > 0),
  description text,
  reference text,
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists cash_movements_establishment_occurred_idx
  on public.cash_movements (establishment_id, occurred_at desc);
create index if not exists cash_movements_member_occurred_idx
  on public.cash_movements (staff_member_id, occurred_at desc);

alter table public.cash_movements enable row level security;

drop policy if exists cash_movements_owner_manager_select on public.cash_movements;
create policy cash_movements_owner_manager_select on public.cash_movements
for select to authenticated using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);

drop policy if exists cash_movements_owner_manager_insert on public.cash_movements;
create policy cash_movements_owner_manager_insert on public.cash_movements
for insert to authenticated with check (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.custom_staff_members member
    join public.staff_roles role on role.id = member.role_id
    where member.id = staff_member_id
      and member.establishment_id = cash_movements.establishment_id
      and role.id = staff_role_id
      and role.establishment_id = cash_movements.establishment_id
      and role.financial_role = true
  )
);

drop policy if exists cash_movements_owner_manager_update on public.cash_movements;
create policy cash_movements_owner_manager_update on public.cash_movements
for update to authenticated using (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
) with check (
  private.has_role(establishment_id, array['owner','manager']::public.member_role[])
);

grant select, insert, update on public.cash_movements to authenticated;
