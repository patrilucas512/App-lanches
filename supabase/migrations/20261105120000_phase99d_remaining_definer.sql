-- Fase 99D: funções SECURITY DEFINER restantes (docs/security-definer-review.md).
-- 1. As 3 do chat do site: o app as chama só pelo servidor (createAdminClient em app/api/web-chat), então nem
--    anon nem usuário logado precisam executá-las.
-- 2. 26 das 32 apontadas na 98 como "sem chamada direta": conferido em 05/11/2026 que nenhuma aparece no código
--    (nem por nome dinâmico), nas funções do Supabase, em outra função do banco, em gatilho ou no pg_cron.
--    As outras 6 da lista são usadas por telas (nome dinâmico) e continuam como estão.
-- O service_role mantém o acesso por concessão explícita. Nada é apagado.
revoke execute on function public.get_web_chat_history(requested_public_key uuid, requested_token text, requested_origin text) from public, anon, authenticated;
grant execute on function public.get_web_chat_history(requested_public_key uuid, requested_token text, requested_origin text) to service_role;
revoke execute on function public.post_web_chat_message(requested_public_key uuid, requested_token text, requested_origin text, requested_message_id text, requested_text text) from public, anon, authenticated;
grant execute on function public.post_web_chat_message(requested_public_key uuid, requested_token text, requested_origin text, requested_message_id text, requested_text text) to service_role;
revoke execute on function public.start_web_chat_session(requested_public_key uuid, requested_origin text, requested_existing_token text) from public, anon, authenticated;
grant execute on function public.start_web_chat_session(requested_public_key uuid, requested_origin text, requested_existing_token text) to service_role;
revoke execute on function public.assign_product_experiment(requested_experiment_key text, requested_organization_id uuid, requested_user_id uuid) from public, anon, authenticated;
grant execute on function public.assign_product_experiment(requested_experiment_key text, requested_organization_id uuid, requested_user_id uuid) to service_role;
revoke execute on function public.claim_waiter_invite(requested_token uuid) from public, anon, authenticated;
grant execute on function public.claim_waiter_invite(requested_token uuid) to service_role;
revoke execute on function public.confirm_table_payment(requested_session_id uuid, requested_payment_method text, requested_pix_payload text) from public, anon, authenticated;
grant execute on function public.confirm_table_payment(requested_session_id uuid, requested_payment_method text, requested_pix_payload text) to service_role;
revoke execute on function public.deactivate_printer_device(requested_device_id uuid) from public, anon, authenticated;
grant execute on function public.deactivate_printer_device(requested_device_id uuid) to service_role;
revoke execute on function public.delete_printer_device(requested_device_id uuid) from public, anon, authenticated;
grant execute on function public.delete_printer_device(requested_device_id uuid) to service_role;
revoke execute on function public.estimate_crm_segment(requested_establishment_id uuid, requested_segment_id uuid) from public, anon, authenticated;
grant execute on function public.estimate_crm_segment(requested_establishment_id uuid, requested_segment_id uuid) to service_role;
revoke execute on function public.fiscal_add_digital_document(requested_establishment_id uuid, requested_category text, requested_title text, requested_description text, requested_storage_path text, requested_file_name text, requested_mime text, requested_size bigint, requested_tags text[], requested_document_date date) from public, anon, authenticated;
grant execute on function public.fiscal_add_digital_document(requested_establishment_id uuid, requested_category text, requested_title text, requested_description text, requested_storage_path text, requested_file_name text, requested_mime text, requested_size bigint, requested_tags text[], requested_document_date date) to service_role;
revoke execute on function public.fiscal_link_received_to_finance(requested_document_id uuid, requested_due_date date) from public, anon, authenticated;
grant execute on function public.fiscal_link_received_to_finance(requested_document_id uuid, requested_due_date date) to service_role;
revoke execute on function public.get_customer_voice_timeline(requested_establishment_id uuid, requested_customer_id uuid, requested_limit integer) from public, anon, authenticated;
grant execute on function public.get_customer_voice_timeline(requested_establishment_id uuid, requested_customer_id uuid, requested_limit integer) to service_role;
revoke execute on function public.get_effective_loyalty_balance(requested_store_id uuid, requested_customer_id uuid) from public, anon, authenticated;
grant execute on function public.get_effective_loyalty_balance(requested_store_id uuid, requested_customer_id uuid) to service_role;
revoke execute on function public.get_organization_report(requested_organization_id uuid, requested_from timestamp with time zone, requested_to timestamp with time zone) from public, anon, authenticated;
grant execute on function public.get_organization_report(requested_organization_id uuid, requested_from timestamp with time zone, requested_to timestamp with time zone) to service_role;
revoke execute on function public.get_reservation_dashboard(requested_establishment_id uuid, requested_days integer) from public, anon, authenticated;
grant execute on function public.get_reservation_dashboard(requested_establishment_id uuid, requested_days integer) to service_role;
revoke execute on function public.get_saas_lifecycle_messages(requested_organization_id uuid) from public, anon, authenticated;
grant execute on function public.get_saas_lifecycle_messages(requested_organization_id uuid) to service_role;
revoke execute on function public.get_table_pix_data(requested_session_id uuid) from public, anon, authenticated;
grant execute on function public.get_table_pix_data(requested_session_id uuid) to service_role;
revoke execute on function public.get_voice_call_detail(requested_establishment_id uuid, requested_call_id uuid) from public, anon, authenticated;
grant execute on function public.get_voice_call_detail(requested_establishment_id uuid, requested_call_id uuid) to service_role;
revoke execute on function public.open_table_session(requested_table_id uuid, requested_customer_name text, requested_people_count integer, requested_opening_note text) from public, anon, authenticated;
grant execute on function public.open_table_session(requested_table_id uuid, requested_customer_name text, requested_people_count integer, requested_opening_note text) to service_role;
revoke execute on function public.purge_old_driver_locations() from public, anon, authenticated;
grant execute on function public.purge_old_driver_locations() to service_role;
revoke execute on function public.request_voice_callback(requested_establishment_id uuid, requested_call_id uuid, requested_phone text, requested_reason text, requested_queue_id uuid) from public, anon, authenticated;
grant execute on function public.request_voice_callback(requested_establishment_id uuid, requested_call_id uuid, requested_phone text, requested_reason text, requested_queue_id uuid) to service_role;
revoke execute on function public.save_table_combination(requested_establishment_id uuid, requested_name text, requested_table_ids uuid[], requested_min_capacity integer, requested_max_capacity integer) from public, anon, authenticated;
grant execute on function public.save_table_combination(requested_establishment_id uuid, requested_name text, requested_table_ids uuid[], requested_min_capacity integer, requested_max_capacity integer) to service_role;
revoke execute on function public.set_cash_register_active(requested_register_id uuid, requested_active boolean) from public, anon, authenticated;
grant execute on function public.set_cash_register_active(requested_register_id uuid, requested_active boolean) to service_role;
revoke execute on function public.set_manager_copilot_permissions(requested_establishment_id uuid, requested_user_id uuid, requested_permissions jsonb) from public, anon, authenticated;
grant execute on function public.set_manager_copilot_permissions(requested_establishment_id uuid, requested_user_id uuid, requested_permissions jsonb) to service_role;
revoke execute on function public.superadmin_change_subscription_plan(target_subscription_id uuid, target_plan_id uuid, confirmation text, reason text) from public, anon, authenticated;
grant execute on function public.superadmin_change_subscription_plan(target_subscription_id uuid, target_plan_id uuid, confirmation text, reason text) to service_role;
revoke execute on function public.transfer_whatsapp_conversation_store(requested_conversation_id uuid, requested_target_store_id uuid) from public, anon, authenticated;
grant execute on function public.transfer_whatsapp_conversation_store(requested_conversation_id uuid, requested_target_store_id uuid) to service_role;
revoke execute on function public.update_printer_device(requested_device_id uuid, requested_name text, requested_sector text, requested_auto_print boolean, requested_is_default boolean, requested_cash_register_id uuid) from public, anon, authenticated;
grant execute on function public.update_printer_device(requested_device_id uuid, requested_name text, requested_sector text, requested_auto_print boolean, requested_is_default boolean, requested_cash_register_id uuid) to service_role;
revoke execute on function public.workforce_decide_clock_correction(requested_correction_id uuid, requested_approve boolean, requested_reason text) from public, anon, authenticated;
grant execute on function public.workforce_decide_clock_correction(requested_correction_id uuid, requested_approve boolean, requested_reason text) to service_role;
revoke execute on function public.workforce_request_clock_correction(requested_entry_id uuid, requested_type text, requested_at timestamp with time zone, requested_reason text) from public, anon, authenticated;
grant execute on function public.workforce_request_clock_correction(requested_entry_id uuid, requested_type text, requested_at timestamp with time zone, requested_reason text) to service_role;
