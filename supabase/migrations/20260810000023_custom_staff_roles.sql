create table public.staff_roles (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text,
  color text not null default '#7b2326' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, establishment_id)
);

create unique index staff_roles_establishment_name_unique
  on public.staff_roles (establishment_id, lower(btrim(name)));
create index staff_roles_establishment_idx on public.staff_roles (establishment_id, created_at);

create table public.custom_staff_members (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  role_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  employment_type text not null default 'fixed' check (employment_type in ('fixed', 'daily')),
  work_date date,
  payment_cycle text not null default 'monthly' check (payment_cycle in ('daily', 'weekly', 'biweekly', 'monthly')),
  shift_start time,
  shift_end time,
  photo_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_staff_daily_date check (employment_type <> 'daily' or work_date is not null),
  constraint custom_staff_role_tenant_fk foreign key (role_id, establishment_id)
    references public.staff_roles(id, establishment_id) on delete cascade
);

create index custom_staff_members_role_idx on public.custom_staff_members (role_id, status, name);
create index custom_staff_members_establishment_idx on public.custom_staff_members (establishment_id, status);

create trigger staff_roles_touch before update on public.staff_roles
for each row execute function public.touch_updated_at();
create trigger custom_staff_members_touch before update on public.custom_staff_members
for each row execute function public.touch_updated_at();

alter table public.staff_roles enable row level security;
alter table public.custom_staff_members enable row level security;

create policy staff_roles_admin_all on public.staff_roles
for all to authenticated
using (exists (
  select 1 from public.establishment_members em
  where em.establishment_id = staff_roles.establishment_id
    and em.user_id = (select auth.uid())
    and em.role in ('owner', 'manager')
))
with check (exists (
  select 1 from public.establishment_members em
  where em.establishment_id = staff_roles.establishment_id
    and em.user_id = (select auth.uid())
    and em.role in ('owner', 'manager')
));

create policy custom_staff_members_admin_all on public.custom_staff_members
for all to authenticated
using (exists (
  select 1 from public.establishment_members em
  where em.establishment_id = custom_staff_members.establishment_id
    and em.user_id = (select auth.uid())
    and em.role in ('owner', 'manager')
))
with check (exists (
  select 1 from public.establishment_members em
  where em.establishment_id = custom_staff_members.establishment_id
    and em.user_id = (select auth.uid())
    and em.role in ('owner', 'manager')
));

grant select, insert, update, delete on public.staff_roles to authenticated;
grant select, insert, update, delete on public.custom_staff_members to authenticated;
