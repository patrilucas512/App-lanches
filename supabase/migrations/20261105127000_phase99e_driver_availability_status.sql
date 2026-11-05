-- Fase 99E: marcar pronto um pedido de delivery com motoboy disponível dava erro
-- ("driver_availability violates check constraint driver_availability_status_check") e a cozinha não avançava.
-- A Fase 40 trocou a regra de status de public.driver_availability e tirou 'offered', 'collecting' e 'blocked', que o
-- despacho das Fases 6/14 (private.offer_next_driver_locked, accept_delivery_assignment, ensure_driver_availability,
-- deactivate_driver_staff_member) e a tela do motoboy continuam usando. Em produção a última entrega é de 22/09/2026,
-- antes da Fase 40. Causa raiz: a regra volta a aceitar os status que o código grava, sem perder os da Fase 40.
alter table public.driver_availability drop constraint if exists driver_availability_status_check;
alter table public.driver_availability add constraint driver_availability_status_check check (status in (
  'offline', 'available', 'offered', 'collecting', 'delivering', 'paused', 'blocked',
  'assigned', 'picking_up', 'unavailable'));
