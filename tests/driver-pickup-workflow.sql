-- Rollback-only checks after applying driver_pickup_workflow.
begin;
do $test$
declare d public.driver_profiles%rowtype; o uuid; dl uuid; a uuid; result jsonb;
begin
 select p.* into d from public.driver_profiles p join public.custom_staff_members m on m.id=p.custom_staff_member_id where p.active and p.approval_status='approved' and p.user_id=m.user_id and m.status='active' limit 1;
 if d.id is null then raise exception 'No active driver fixture'; end if;
 perform set_config('request.jwt.claim.sub',d.user_id::text,true);
 update public.driver_availability set status='available',active_delivery_count=0 where driver_profile_id=d.id;
 insert into public.orders(establishment_id,order_number,fulfillment_type,customer_name,customer_phone,subtotal_cents,total_cents)
 overriding system value values(d.establishment_id,-987654333,'delivery','Teste rollback','11999999999',1990,1990) returning id into o;
 select id into dl from public.deliveries where order_id=o;
 if dl is null then insert into public.deliveries(establishment_id,order_id) values(d.establishment_id,o) returning id into dl; end if;
 insert into public.delivery_destinations(delivery_order_id,establishment_id,recipient_name,recipient_phone,street,street_number,neighborhood,reference)
 values(o,d.establishment_id,'Teste rollback','11999999999','Rua teste','123','Centro','Portao teste');
 update public.deliveries set status='ready_for_dispatch',ready_at=now() where id=dl;
 select id into a from public.delivery_assignments where delivery_id=dl and status='offered' and driver_profile_id=d.id;
 if a is null then raise exception 'Ready did not offer to available driver'; end if;
 perform public.accept_delivery_assignment(a);
 result:=public.get_driver_delivery_detail(dl);
 if result->>'street'<>'Rua teste' then raise exception 'Assigned driver cannot read destination before pickup'; end if;
 update public.driver_profiles set driver_kind='partner' where id=d.id;
 result:=public.verify_pickup_code(dl,null);
 if coalesce((result->>'verified')::boolean,false) then raise exception 'Partner bypassed custody code'; end if;
 update public.driver_profiles set driver_kind='fixed' where id=d.id;
 result:=public.verify_pickup_code(dl,'');
 if not coalesce((result->>'verified')::boolean,false) then raise exception 'Fixed driver requires unnecessary code'; end if;
 if not exists(select 1 from public.deliveries where id=dl and status='picked_up' and pickup_verified_by=d.user_id and delivery_pin_hash is not null) then raise exception 'Pickup did not preserve customer PIN'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.get_driver_delivery_detail(dl);
  raise exception 'TEST_ADDRESS_LEAK';
 exception when others then if sqlerrm='TEST_ADDRESS_LEAK' then raise; end if; end;
end $test$;
select 'PASS ready dispatch, early address, partner guard, fixed pickup, customer PIN and authorization' result;
rollback;
