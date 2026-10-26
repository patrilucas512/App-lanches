begin;

select plan(24);

select has_table('public', 'deliveries', 'entregas existem');
select has_table('public', 'delivery_assignments', 'atribuições existem');
select has_table('public', 'delivery_events', 'eventos auditáveis existem');
select has_table('public', 'delivery_incidents', 'ocorrências existem');
select has_table('public', 'driver_locations', 'localizações existem');
select has_table('public', 'driver_financial_entries', 'lançamentos financeiros existem');
select has_table('public', 'driver_financial_closures', 'fechamentos existem');

select ok((select relrowsecurity from pg_class where oid='public.deliveries'::regclass), 'RLS ativa em entregas');
select ok((select relrowsecurity from pg_class where oid='public.delivery_assignments'::regclass), 'RLS ativa em atribuições');
select ok((select relrowsecurity from pg_class where oid='public.delivery_events'::regclass), 'RLS ativa em eventos');
select ok((select relrowsecurity from pg_class where oid='public.delivery_incidents'::regclass), 'RLS ativa em ocorrências');
select ok((select relrowsecurity from pg_class where oid='public.driver_locations'::regclass), 'RLS ativa em localização');
select ok((select relrowsecurity from pg_class where oid='public.driver_financial_entries'::regclass), 'RLS ativa no financeiro');

select has_function('public', 'quote_public_delivery', array['text','text','integer'], 'cotação pública existe');
select has_function('public', 'place_public_order_v2', array['text','text','text','text','jsonb','text','text','text','text','integer','jsonb'], 'checkout público existe');
select has_function('public', 'accept_delivery_assignment', array['uuid'], 'aceite atômico existe');
select has_function('public', 'reject_delivery_assignment', array['uuid','text'], 'recusa existe');
select has_function('public', 'expire_delivery_offer', array['uuid'], 'expiração existe');
select has_function('public', 'verify_pickup_code', array['uuid','text'], 'validação de retirada existe');
select has_function('public', 'update_driver_location', array['double precision','double precision','double precision','double precision','double precision','timestamp with time zone','uuid'], 'rastreamento existe');
select has_function('public', 'report_delivery_incident', array['uuid','text','text'], 'ocorrência existe');
select has_function('public', 'verify_delivery_pin', array['uuid','text'], 'PIN de entrega existe');
select has_function('public', 'complete_delivery_without_pin', array['uuid','text'], 'exceção administrativa existe');
select has_function('public', 'close_driver_financial_period', array['uuid','date','date','text'], 'fechamento financeiro existe');

select * from finish();
rollback;
