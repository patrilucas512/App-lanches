-- Fase 98D: login de funcionário por nome falhava sempre (achado pelo E2E da equipe).
--
-- As funções activate-{waiter,kitchen,cashier,driver}-access criam o usuário com o telefone normalizado
-- (10 ou 11 dígitos ganham o 55 do país: w.5511900000003@garcom.mesaviva.app), mas
-- get_employee_login_candidates montava o e-mail só com os dígitos digitados (w.11900000003@...). O
-- signInWithPassword da função employee-login nunca achava o usuário: "Nome ou senha inválidos.".
--
-- Correção: a mesma normalização das funções de ativação, e a variante antiga (só dígitos) logo depois, para
-- não quebrar contas criadas com outro formato. A função employee-login já tenta até 5 candidatos e confere
-- o user_id de cada um.

create or replace function public.get_employee_login_candidates(requested_kind text, requested_name text, requested_slug text default null)
returns jsonb language plpgsql set search_path = '' as $function$
declare normalized_name text := lower(regexp_replace(btrim(coalesce(requested_name, '')), '\s+', ' ', 'g')); result jsonb;
begin
  if requested_kind not in ('waiter','kitchen','cashier','driver') or length(normalized_name) < 3 then return '[]'::jsonb; end if;
  with people as (
    select member.user_id, member.phone, member.status::text as status, true as active_now, member.employment_type::text as access_type, member.work_date, e.slug as establishment_slug
    from public.custom_staff_members member
    join public.staff_roles role on role.id = member.role_id
    join public.establishments e on e.id = member.establishment_id
    left join public.driver_profiles driver on driver.custom_staff_member_id = member.id
    where requested_kind in ('cashier','driver') and member.user_id is not null
      and ((requested_kind = 'cashier' and role.financial_role = true) or
           (requested_kind = 'driver' and role.system_key = 'driver' and driver.active and driver.approval_status = 'approved'))
      and lower(regexp_replace(btrim(member.name), '\s+', ' ', 'g')) = normalized_name
      and (nullif(btrim(requested_slug), '') is null or e.slug = lower(btrim(requested_slug)))
    union all
    select w.user_id, w.phone, w.status::text, w.active_now, w.employment_type::text, w.work_date, e.slug
    from public.waiters w join public.establishments e on e.id = w.establishment_id
    where requested_kind = 'waiter' and w.user_id is not null
      and lower(regexp_replace(btrim(w.name), '\s+', ' ', 'g')) = normalized_name
      and (nullif(btrim(requested_slug), '') is null or e.slug = lower(btrim(requested_slug)))
    union all
    select k.user_id, k.phone, k.status::text, true, k.access_type::text, k.work_date, e.slug
    from public.kitchen_operators k join public.establishments e on e.id = k.establishment_id
    where requested_kind = 'kitchen' and k.user_id is not null
      and lower(regexp_replace(btrim(k.name), '\s+', ' ', 'g')) = normalized_name
      and (nullif(btrim(requested_slug), '') is null or e.slug = lower(btrim(requested_slug)))
  ), limited as (select * from people limit 5),
  emails as (
    select l.*, v.ord, v.digits from limited l
    cross join lateral (select regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') as raw) p
    -- mesma regra de normalizeBrazilianPhone das funções de ativação
    cross join lateral (values (1, case when p.raw ~ '^\d{10,11}$' then '55' || p.raw when p.raw ~ '^55\d{10,11}$' then p.raw
                                   when length(p.raw) between 10 and 15 then p.raw end),
                               (2, p.raw)) v(ord, digits)
    where v.digits is not null and v.digits <> ''
  ), candidate as (
    select distinct on (user_id, digits) user_id,
      case requested_kind when 'waiter' then 'w.' when 'kitchen' then 'k.' when 'cashier' then 'c.' else 'd.' end || digits ||
      case requested_kind when 'waiter' then '@garcom.mesaviva.app' when 'kitchen' then '@cozinha.mesaviva.app'
        when 'cashier' then '@caixa.mesaviva.app' else '@motoboy.masterapp.app' end as login_email,
      status, active_now, access_type, work_date, establishment_slug, ord
    from emails order by user_id, digits, ord
  )
  select coalesce(jsonb_agg(to_jsonb(c) - 'ord' order by c.ord), '[]'::jsonb) into result from candidate c;
  return result;
end $function$;
revoke all on function public.get_employee_login_candidates(text, text, text) from public, anon, authenticated;
grant execute on function public.get_employee_login_candidates(text, text, text) to service_role;
