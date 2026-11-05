-- Fase 99E: loja nova com entrega ligada no onboarding não recebia pedido de delivery. O onboarding cria a zona de
-- entrega mas não a linha de public.delivery_settings, e a cotação pública (private.resolve_public_delivery_quote),
-- o pedido público, a retirada com código e os alertas de entrega exigem essa linha ("A entrega ainda não foi
-- configurada pelo estabelecimento"). Só funcionava depois de o dono salvar Configurações → Entrega.
-- Causa raiz: ao ganhar a primeira zona, a loja passa a ter a configuração padrão "por bairro" (a mesma que a tela
-- de Configurações grava). Lojas que já têm zona e não têm a linha são completadas aqui (produção: 0 em 05/11/2026).
create or replace function private.ensure_delivery_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.delivery_settings(establishment_id, store_id, organization_id, fee_model)
  select e.id, e.id, e.organization_id, 'neighborhood' from public.establishments e where e.id = new.establishment_id
  on conflict (establishment_id) do nothing;
  return new;
end $$;
revoke all on function private.ensure_delivery_settings() from public, anon, authenticated;

drop trigger if exists delivery_zones_ensure_settings on public.delivery_zones;
create trigger delivery_zones_ensure_settings after insert on public.delivery_zones
  for each row execute function private.ensure_delivery_settings();

insert into public.delivery_settings(establishment_id, store_id, organization_id, fee_model)
select e.id, e.id, e.organization_id, 'neighborhood' from public.establishments e
where exists (select 1 from public.delivery_zones z where z.establishment_id = e.id)
  and not exists (select 1 from public.delivery_settings s where s.establishment_id = e.id);
