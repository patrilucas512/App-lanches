-- Somente para o banco de DESENVOLVIMENTO (masterapp-dev). Cancela todos os pedidos abertos da loja fictícia
-- (os testes E2E deixam de 3 a 6 por rodada), para a tela da cozinha não acumular comandas. Pedidos de retirada não pagos não podem ser
-- concluídos (regra private.validate_pickup_payment), por isso são cancelados.
with store as (select id from public.establishments where slug = 'lanchonete-teste'),
tickets as (
  update public.kitchen_tickets set status = 'canceled'
  where establishment_id = (select id from store) and status in ('received', 'preparing', 'ready') returning 1
),
orders as (
  update public.orders set status = 'canceled'
  where establishment_id = (select id from store) and status in ('new', 'confirmed', 'preparing', 'ready') returning 1
)
select (select count(*) from tickets) as comandas, (select count(*) from orders) as pedidos;
