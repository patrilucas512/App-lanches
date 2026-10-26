-- Operational modules and limits configurable per SaaS plan.
alter table public.plans
  add column if not exists cashier_enabled boolean not null default true,
  add column if not exists inventory_enabled boolean not null default true,
  add column if not exists staff_management_enabled boolean not null default true,
  add column if not exists drivers_enabled boolean not null default true,
  add column if not exists max_cashiers integer,
  add column if not exists max_inventory_items integer,
  add column if not exists max_drivers integer;

alter table public.plans
  drop constraint if exists plans_max_cashiers_nonnegative,
  drop constraint if exists plans_max_inventory_items_nonnegative,
  drop constraint if exists plans_max_drivers_nonnegative;

alter table public.plans
  add constraint plans_max_cashiers_nonnegative check (max_cashiers is null or max_cashiers >= 0),
  add constraint plans_max_inventory_items_nonnegative check (max_inventory_items is null or max_inventory_items >= 0),
  add constraint plans_max_drivers_nonnegative check (max_drivers is null or max_drivers >= 0);

comment on column public.plans.cashier_enabled is 'Habilita o módulo de caixa no plano.';
comment on column public.plans.inventory_enabled is 'Habilita o módulo de estoque no plano.';
comment on column public.plans.staff_management_enabled is 'Habilita cadastro e gestão de funcionários no plano.';
comment on column public.plans.drivers_enabled is 'Habilita cadastro e operação de motoboys no plano.';
comment on column public.plans.max_cashiers is 'Quantidade máxima de operadores de caixa; null representa ilimitado.';
comment on column public.plans.max_inventory_items is 'Quantidade máxima de itens de estoque; null representa ilimitado.';
comment on column public.plans.max_drivers is 'Quantidade máxima de motoboys; null representa ilimitado.';
