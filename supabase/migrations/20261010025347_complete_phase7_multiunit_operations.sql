-- Phase 7 completion: safe store cloning, multiple WhatsApp numbers,
-- consolidated reporting, customer 360, network loyalty and guarded transfers.

create or replace function public.clone_store_configuration(
  requested_source_store_id uuid,
  requested_target_store_id uuid,
  requested_sections text[] default array['appearance','business_hours','service','delivery','catalog','ai']
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  org_id uuid;
  target_org_id uuid;
  source_config public.ai_config_versions%rowtype;
  target_config_id uuid;
  target_version integer;
  copied jsonb := '{}'::jsonb;
begin
  if requested_source_store_id = requested_target_store_id then raise exception 'Escolha duas unidades diferentes.'; end if;
  select organization_id into org_id from public.establishments where id=requested_source_store_id;
  select organization_id into target_org_id from public.establishments where id=requested_target_store_id;
  if org_id is null or org_id <> target_org_id then raise exception 'As unidades precisam pertencer à mesma organização.'; end if;
  if not private.has_organization_role(org_id,array['owner','admin']) then raise exception 'Sem permissão para clonar configurações.'; end if;

  if 'appearance'=any(requested_sections) then
    update public.establishments t set
      logo_url=s.logo_url,cover_url=s.cover_url,accent_color=s.accent_color,secondary_color=s.secondary_color,
      menu_logo_url=s.menu_logo_url,menu_background_color=s.menu_background_color,menu_surface_color=s.menu_surface_color,
      menu_text_color=s.menu_text_color,menu_muted_color=s.menu_muted_color,updated_at=now()
    from public.establishments s where s.id=requested_source_store_id and t.id=requested_target_store_id;
    copied:=copied||jsonb_build_object('appearance',true);
  end if;

  if 'business_hours'=any(requested_sections) then
    delete from public.business_hours where establishment_id=requested_target_store_id;
    insert into public.business_hours(establishment_id,weekday,opens_at,closes_at,closed)
      select requested_target_store_id,weekday,opens_at,closes_at,closed from public.business_hours where establishment_id=requested_source_store_id;
    copied:=copied||jsonb_build_object('business_hours',true);
  end if;

  if 'service'=any(requested_sections) then
    insert into public.establishment_settings(establishment_id,currency,locale,timezone,pickup_enabled,delivery_enabled,dine_in_enabled,minimum_order_cents,estimated_minutes,payment_methods,waiter_calls_enabled)
      select requested_target_store_id,currency,locale,timezone,pickup_enabled,delivery_enabled,dine_in_enabled,minimum_order_cents,estimated_minutes,payment_methods,waiter_calls_enabled
      from public.establishment_settings where establishment_id=requested_source_store_id
    on conflict(establishment_id) do update set currency=excluded.currency,locale=excluded.locale,timezone=excluded.timezone,
      pickup_enabled=excluded.pickup_enabled,delivery_enabled=excluded.delivery_enabled,dine_in_enabled=excluded.dine_in_enabled,
      minimum_order_cents=excluded.minimum_order_cents,estimated_minutes=excluded.estimated_minutes,payment_methods=excluded.payment_methods,
      waiter_calls_enabled=excluded.waiter_calls_enabled,updated_at=now();
    delete from public.service_modes where establishment_id=requested_target_store_id;
    insert into public.service_modes(establishment_id,mode,waiter_mode_enabled,table_service_enabled,counter_pickup_enabled,delivery_enabled,customer_self_order_enabled,waiter_call_enabled,bill_closing_enabled,card_proof_required,manual_active_waiters,accepted_payment_methods,manager_approval_for_discount,manager_approval_for_cancellation,audit_enabled,auto_print_kitchen,printer_connection,printer_name,printer_paper_width,printer_network_address,printer_setup_completed,takeaway_enabled,store_open)
      select requested_target_store_id,mode,waiter_mode_enabled,table_service_enabled,counter_pickup_enabled,delivery_enabled,customer_self_order_enabled,waiter_call_enabled,bill_closing_enabled,card_proof_required,manual_active_waiters,accepted_payment_methods,manager_approval_for_discount,manager_approval_for_cancellation,audit_enabled,false,null,null,printer_paper_width,null,false,takeaway_enabled,false
      from public.service_modes where establishment_id=requested_source_store_id;
    copied:=copied||jsonb_build_object('service',true);
  end if;

  if 'delivery'=any(requested_sections) then
    delete from public.delivery_zones where establishment_id=requested_target_store_id;
    insert into public.delivery_zones(establishment_id,name,fee_cents,minimum_order_cents,estimated_minutes,active,free_delivery_above_cents,distance_km)
      select requested_target_store_id,name,fee_cents,minimum_order_cents,estimated_minutes,active,free_delivery_above_cents,distance_km from public.delivery_zones where establishment_id=requested_source_store_id;
    insert into public.delivery_settings(establishment_id,fee_model,fixed_fee_cents,free_delivery_above_cents,delivery_pin_required,alert_kitchen_delay_minutes,alert_waiting_driver_minutes,alert_driver_stale_minutes,alert_route_delay_minutes,alert_driver_stopped_minutes,service_city,service_state)
      select requested_target_store_id,fee_model,fixed_fee_cents,free_delivery_above_cents,delivery_pin_required,alert_kitchen_delay_minutes,alert_waiting_driver_minutes,alert_driver_stale_minutes,alert_route_delay_minutes,alert_driver_stopped_minutes,service_city,service_state from public.delivery_settings where establishment_id=requested_source_store_id
    on conflict(establishment_id) do update set fee_model=excluded.fee_model,fixed_fee_cents=excluded.fixed_fee_cents,free_delivery_above_cents=excluded.free_delivery_above_cents,delivery_pin_required=excluded.delivery_pin_required,alert_kitchen_delay_minutes=excluded.alert_kitchen_delay_minutes,alert_waiting_driver_minutes=excluded.alert_waiting_driver_minutes,alert_driver_stale_minutes=excluded.alert_driver_stale_minutes,alert_route_delay_minutes=excluded.alert_route_delay_minutes,alert_driver_stopped_minutes=excluded.alert_driver_stopped_minutes,service_city=excluded.service_city,service_state=excluded.service_state,updated_at=now();
    copied:=copied||jsonb_build_object('delivery',true);
  end if;

  if 'catalog'=any(requested_sections) then
    insert into public.categories(establishment_id,name,description,active,sort_order)
      select requested_target_store_id,s.name,s.description,s.active,s.sort_order from public.categories s
      where s.establishment_id=requested_source_store_id and not exists(select 1 from public.categories t where t.establishment_id=requested_target_store_id and lower(t.name)=lower(s.name));
    insert into public.products(establishment_id,category_id,name,description,image_url,price_cents,compare_at_price_cents,active,featured,sort_order,ingredients,addon_options,barcode)
      select requested_target_store_id,tc.id,p.name,p.description,p.image_url,p.price_cents,p.compare_at_price_cents,p.active,p.featured,p.sort_order,p.ingredients,p.addon_options,null
      from public.products p join public.categories sc on sc.id=p.category_id
      join public.categories tc on tc.establishment_id=requested_target_store_id and lower(tc.name)=lower(sc.name)
      where p.establishment_id=requested_source_store_id and not exists(select 1 from public.products tp where tp.establishment_id=requested_target_store_id and tp.category_id=tc.id and lower(tp.name)=lower(p.name));
    copied:=copied||jsonb_build_object('catalog',true);
  end if;

  if 'ai'=any(requested_sections) then
    select * into source_config from public.ai_config_versions where establishment_id=requested_source_store_id and status='published' order by version desc limit 1;
    if source_config.id is not null then
      select id into target_config_id from public.ai_config_versions where establishment_id=requested_target_store_id and status='draft' limit 1;
      if target_config_id is not null then
        delete from public.ai_custom_rules where config_version_id=target_config_id;
        delete from public.ai_faqs where config_version_id=target_config_id;
        delete from public.ai_knowledge_items where config_version_id=target_config_id;
        delete from public.ai_config_versions where id=target_config_id;
      end if;
      select coalesce(max(version),0)+1 into target_version from public.ai_config_versions where establishment_id=requested_target_store_id;
      insert into public.ai_config_versions(establishment_id,version,status,attendant_name,introduction,style,formality,response_length,emoji_level,custom_tone,fallback_message,operating_instructions,prohibited_behaviors,handoff_rules,automation_schedule,low_confidence_threshold,unknown_behavior,prompt_base_version,change_summary,created_by,inherit_organization_defaults)
        values(requested_target_store_id,target_version,'draft',source_config.attendant_name,source_config.introduction,source_config.style,source_config.formality,source_config.response_length,source_config.emoji_level,source_config.custom_tone,source_config.fallback_message,source_config.operating_instructions,source_config.prohibited_behaviors,source_config.handoff_rules,source_config.automation_schedule,source_config.low_confidence_threshold,source_config.unknown_behavior,source_config.prompt_base_version,'Clonado com segurança da unidade de origem',auth.uid(),source_config.inherit_organization_defaults)
        returning id into target_config_id;
      insert into public.ai_knowledge_items(establishment_id,config_version_id,title,category,content,status,created_by,organization_id,scope)
        select requested_target_store_id,target_config_id,title,category,content,status,auth.uid(),org_id,'local' from public.ai_knowledge_items where config_version_id=source_config.id and scope='local';
      insert into public.ai_faqs(establishment_id,config_version_id,question,answer,variations,category,status,created_by,organization_id,scope)
        select requested_target_store_id,target_config_id,question,answer,variations,category,status,auth.uid(),org_id,'local' from public.ai_faqs where config_version_id=source_config.id and scope='local';
      insert into public.ai_custom_rules(establishment_id,config_version_id,name,rule_type,condition_field,operator,condition_value,action,response_text,priority,enabled,created_by)
        select requested_target_store_id,target_config_id,name,rule_type,condition_field,operator,condition_value,action,response_text,priority,enabled,auth.uid() from public.ai_custom_rules where config_version_id=source_config.id;
      copied:=copied||jsonb_build_object('ai_draft_version',target_version);
    end if;
  end if;

  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata)
    values(requested_target_store_id,auth.uid(),'organization.store_configuration_cloned','establishment',requested_target_store_id,jsonb_build_object('source_store_id',requested_source_store_id,'sections',requested_sections));
  return jsonb_build_object('source_store_id',requested_source_store_id,'target_store_id',requested_target_store_id,'copied',copied,'sensitive_data_copied',false);
end $$;

create or replace function public.add_whatsapp_connection(
  requested_establishment_id uuid, requested_label text, requested_routing_mode text,
  requested_phone_number_id text, requested_waba_id text, requested_display_phone text,
  requested_verified_name text, requested_access_token text, requested_app_secret text,
  requested_verify_token text, requested_graph_api_version text default 'v23.0', requested_primary boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.whatsapp_connections%rowtype; access_id uuid; app_id uuid; verify_id uuid; org_id uuid; should_primary boolean;
begin
  if not private.has_whatsapp_permission(requested_establishment_id,'configure') then raise exception 'Sem permissão para configurar o WhatsApp.'; end if;
  if requested_routing_mode not in ('store','organization') then raise exception 'Modo de roteamento inválido.'; end if;
  if nullif(btrim(requested_phone_number_id),'') is null or nullif(btrim(requested_waba_id),'') is null then raise exception 'Informe os identificadores da Meta.'; end if;
  if nullif(btrim(requested_access_token),'') is null or nullif(btrim(requested_app_secret),'') is null or nullif(btrim(requested_verify_token),'') is null then raise exception 'Informe todas as credenciais protegidas.'; end if;
  select organization_id into org_id from public.establishments where id=requested_establishment_id;
  should_primary:=requested_primary or not exists(select 1 from public.whatsapp_connections where establishment_id=requested_establishment_id and is_primary);
  if should_primary then update public.whatsapp_connections set is_primary=false where establishment_id=requested_establishment_id; end if;
  select vault.create_secret(requested_access_token,'masterapp-whatsapp-'||gen_random_uuid()||'-access') into access_id;
  select vault.create_secret(requested_app_secret,'masterapp-whatsapp-'||gen_random_uuid()||'-app') into app_id;
  select vault.create_secret(requested_verify_token,'masterapp-whatsapp-'||gen_random_uuid()||'-verify') into verify_id;
  insert into public.whatsapp_connections(establishment_id,organization_id,label,is_primary,routing_mode,phone_number_id,whatsapp_business_account_id,display_phone_number,verified_name,status,webhook_status,access_token_secret_id,app_secret_id,verify_token_secret_id,graph_api_version,connected_at)
    values(requested_establishment_id,org_id,coalesce(nullif(btrim(requested_label),''),'WhatsApp'),should_primary,requested_routing_mode,btrim(requested_phone_number_id),btrim(requested_waba_id),nullif(btrim(requested_display_phone),''),nullif(btrim(requested_verified_name),''),'connected','pending',access_id,app_id,verify_id,coalesce(nullif(btrim(requested_graph_api_version),''),'v23.0'),now()) returning * into saved;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id,metadata) values(requested_establishment_id,auth.uid(),'whatsapp.connection_added','whatsapp_connection',saved.id,jsonb_build_object('label',saved.label,'routing_mode',saved.routing_mode,'is_primary',saved.is_primary));
  return to_jsonb(saved)-'access_token_secret_id'-'app_secret_id'-'verify_token_secret_id';
end $$;

create or replace function public.disconnect_whatsapp_connection_by_id(requested_connection_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_connections%rowtype;
begin
  select * into c from public.whatsapp_connections where id=requested_connection_id;
  if c.id is null or not private.has_whatsapp_permission(c.establishment_id,'configure') then raise exception 'Sem permissão para desconectar este número.'; end if;
  update public.whatsapp_connections set status='disconnected',disconnected_at=now(),is_primary=false where id=c.id;
  if c.is_primary then update public.whatsapp_connections set is_primary=true where id=(select id from public.whatsapp_connections where establishment_id=c.establishment_id and status='connected' and id<>c.id order by created_at limit 1); end if;
  insert into public.audit_logs(establishment_id,actor_id,action,entity_type,entity_id) values(c.establishment_id,auth.uid(),'whatsapp.connection_disconnected','whatsapp_connection',c.id);
end $$;

create or replace function public.get_organization_report(requested_organization_id uuid, requested_from timestamptz default date_trunc('month',now()), requested_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_organization_role(requested_organization_id,array['owner','admin','supervisor','analyst']) then raise exception 'Sem acesso ao relatório da organização.'; end if;
  with store_metrics as (
    select e.id,e.name,
      count(o.id) orders,
      count(o.id) filter(where o.status::text not in ('cancelled','canceled')) approved_orders,
      count(o.id) filter(where o.status::text in ('cancelled','canceled')) cancelled_orders,
      coalesce(sum(o.total_cents) filter(where o.status::text not in ('cancelled','canceled')),0) revenue_cents,
      count(o.id) filter(where o.fulfillment_type='delivery') deliveries
    from public.establishments e left join public.orders o on o.store_id=e.id and o.created_at>=requested_from and o.created_at<requested_to
    where e.organization_id=requested_organization_id group by e.id,e.name
  ) select jsonb_build_object(
      'from',requested_from,'to',requested_to,
      'totals',jsonb_build_object('orders',coalesce(sum(orders),0),'approved_orders',coalesce(sum(approved_orders),0),'cancelled_orders',coalesce(sum(cancelled_orders),0),'revenue_cents',coalesce(sum(revenue_cents),0),'deliveries',coalesce(sum(deliveries),0)),
      'stores',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'orders',orders,'approved_orders',approved_orders,'cancelled_orders',cancelled_orders,'revenue_cents',revenue_cents,'deliveries',deliveries) order by revenue_cents desc),'[]'::jsonb)
    ) into result from store_metrics;
  return coalesce(result,jsonb_build_object('from',requested_from,'to',requested_to,'totals',jsonb_build_object(),'stores','[]'::jsonb));
end $$;

create or replace function public.get_effective_loyalty_balance(requested_store_id uuid, requested_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org_id uuid; org_customer_id uuid; loyalty_mode text; result_balance integer;
begin
  select e.organization_id,o.loyalty_mode into org_id,loyalty_mode from public.establishments e join public.organizations o on o.id=e.organization_id where e.id=requested_store_id;
  if not private.has_store_access(requested_store_id) then raise exception 'Sem acesso à fidelidade desta unidade.'; end if;
  if loyalty_mode='network' then
    select organization_customer_id into org_customer_id from public.customers where id=requested_customer_id and establishment_id=requested_store_id;
    select coalesce(balance,0) into result_balance from public.organization_loyalty_accounts where organization_id=org_id and organization_customer_id=org_customer_id;
  else select coalesce(balance,0) into result_balance from public.loyalty_accounts where establishment_id=requested_store_id and customer_id=requested_customer_id;
  end if;
  return jsonb_build_object('mode',loyalty_mode,'balance',coalesce(result_balance,0));
end $$;

create or replace function public.validate_campaign_store_scope() returns trigger language plpgsql set search_path='' as $$
begin
  if new.campaign_scope='organization' and exists(select 1 from unnest(coalesce(new.target_establishment_ids,'{}'::uuid[])) id left join public.establishments e on e.id=id where e.id is null or e.organization_id<>new.organization_id) then raise exception 'A campanha contém unidade fora da organização.'; end if;
  return new;
end $$;
drop trigger if exists validate_campaign_store_scope_trigger on public.crm_campaigns;
create trigger validate_campaign_store_scope_trigger before insert or update of organization_id,campaign_scope,target_establishment_ids on public.crm_campaigns for each row execute function public.validate_campaign_store_scope();

revoke all on function public.clone_store_configuration(uuid,uuid,text[]) from public,anon;
revoke all on function public.add_whatsapp_connection(uuid,text,text,text,text,text,text,text,text,text,text,boolean) from public,anon;
revoke all on function public.disconnect_whatsapp_connection_by_id(uuid) from public,anon;
revoke all on function public.get_organization_report(uuid,timestamptz,timestamptz) from public,anon;
revoke all on function public.get_effective_loyalty_balance(uuid,uuid) from public,anon;
grant execute on function public.clone_store_configuration(uuid,uuid,text[]) to authenticated;
grant execute on function public.add_whatsapp_connection(uuid,text,text,text,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.disconnect_whatsapp_connection_by_id(uuid) to authenticated;
grant execute on function public.get_organization_report(uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.get_effective_loyalty_balance(uuid,uuid) to authenticated;
