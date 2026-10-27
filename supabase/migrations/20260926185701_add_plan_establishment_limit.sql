alter table public.plans
  add column if not exists max_establishments integer;

alter table public.plans
  drop constraint if exists plans_max_establishments_nonnegative;

alter table public.plans
  add constraint plans_max_establishments_nonnegative
  check (max_establishments is null or max_establishments >= 0);

comment on column public.plans.max_establishments is
  'Quantidade máxima de estabelecimentos cadastrados no plano; null representa ilimitado.';
