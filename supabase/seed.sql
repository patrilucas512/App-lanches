-- Synthetic data only. It is a no-op unless a development/staging session explicitly opts in.
do $$ begin
  if current_setting('app.masterapp_test_environment',true) not in ('development','staging') then
    raise notice 'MasterApp QA seed skipped outside development/staging'; return;
  end if;
  insert into public.organizations(id,name,slug,status,timezone,is_test_organization,test_safety_profile,business_type)
  values
   ('27000000-0000-0000-0000-000000000001','Restaurante QA','qa-restaurante','active','America/Sao_Paulo',true,current_setting('app.masterapp_test_environment'),'restaurant'),
   ('27000000-0000-0000-0000-000000000002','Pizzaria QA','qa-pizzaria','active','America/Sao_Paulo',true,current_setting('app.masterapp_test_environment'),'pizzeria'),
   ('27000000-0000-0000-0000-000000000003','Rede Multiunidade QA','qa-rede','active','America/Sao_Paulo',true,current_setting('app.masterapp_test_environment'),'restaurant')
  on conflict(id) do nothing;
end $$;

