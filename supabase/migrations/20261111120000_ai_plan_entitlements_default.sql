-- Todo plano precisa de uma linha em ai_plan_entitlements. Sem ela a tela "Plano e limites" mostra
-- "Não incluído" e o envio da IA (lib/ai-attendant/config.ts) trata a IA como fora do plano.
-- A fase 6 só criou linhas para os planos que já existiam; o plano Piloto, criado depois, ficou sem.
-- Aqui: preenche os planos que faltam e cria a linha padrão sempre que um plano novo é cadastrado.
-- O padrão é o mesmo da fase 6 (IA liberada, sem limite mensal, passa para uma pessoa ao atingir o limite).

create or replace function private.create_default_ai_plan_entitlements()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ai_plan_entitlements(plan_id) values (new.id) on conflict (plan_id) do nothing;
  return new;
end $$;

revoke all on function private.create_default_ai_plan_entitlements() from public, anon, authenticated;

drop trigger if exists plans_default_ai_entitlements on public.plans;
create trigger plans_default_ai_entitlements
after insert on public.plans
for each row execute function private.create_default_ai_plan_entitlements();

insert into public.ai_plan_entitlements(plan_id)
select p.id from public.plans p
on conflict (plan_id) do nothing;
