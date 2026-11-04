-- Fase 98G (lote 2): funções SECURITY DEFINER internas deixam de ser executáveis por usuário logado.
-- Critério (docs/security-definer-review.md): o código só as chama pelo cliente administrativo (service_role),
-- ou só outras funções SECURITY DEFINER as chamam, ou são função de gatilho. Nenhuma aparece em política nem
-- é chamada por função SECURITY INVOKER (conferido no masterapp-dev em 04/11/2026). O service_role mantém o
-- acesso por concessão explícita. Nada é apagado.
revoke execute on function public.assign_delivery_v2(requested_delivery_id uuid, requested_driver_id uuid, requested_mode text, requested_idempotency_key text, requested_reason text) from public, anon, authenticated;
grant execute on function public.assign_delivery_v2(requested_delivery_id uuid, requested_driver_id uuid, requested_mode text, requested_idempotency_key text, requested_reason text) to service_role;
revoke execute on function public.crm_customer_status(target_customer uuid) from public, anon, authenticated;
grant execute on function public.crm_customer_status(target_customer uuid) to service_role;
revoke execute on function public.enqueue_support_conversation(requested_conversation_id uuid, requested_queue_id uuid, requested_priority text, requested_source text) from public, anon, authenticated;
grant execute on function public.enqueue_support_conversation(requested_conversation_id uuid, requested_queue_id uuid, requested_priority text, requested_source text) to service_role;
revoke execute on function public.ensure_default_support_queue(requested_establishment_id uuid) from public, anon, authenticated;
grant execute on function public.ensure_default_support_queue(requested_establishment_id uuid) to service_role;
revoke execute on function public.get_loyalty_balance(requested_establishment_id uuid, requested_customer_id uuid) from public, anon, authenticated;
grant execute on function public.get_loyalty_balance(requested_establishment_id uuid, requested_customer_id uuid) to service_role;
revoke execute on function public.get_product_growth_summary(requested_days integer) from public, anon, authenticated;
grant execute on function public.get_product_growth_summary(requested_days integer) to service_role;
revoke execute on function public.get_quality_summary() from public, anon, authenticated;
grant execute on function public.get_quality_summary() to service_role;
revoke execute on function public.get_reservation_availability(requested_establishment_id uuid, requested_start timestamp with time zone, requested_party_size integer, requested_duration_minutes integer, requested_area_id uuid) from public, anon, authenticated;
grant execute on function public.get_reservation_availability(requested_establishment_id uuid, requested_start timestamp with time zone, requested_party_size integer, requested_duration_minutes integer, requested_area_id uuid) to service_role;
revoke execute on function public.inventory_convert_quantity(requested_item_id uuid, requested_quantity numeric, requested_from_unit text) from public, anon, authenticated;
grant execute on function public.inventory_convert_quantity(requested_item_id uuid, requested_quantity numeric, requested_from_unit text) to service_role;
revoke execute on function public.kitchen_task_transition(requested_task_id uuid, requested_status text, requested_idempotency_key text, requested_reason text) from public, anon, authenticated;
grant execute on function public.kitchen_task_transition(requested_task_id uuid, requested_status text, requested_idempotency_key text, requested_reason text) to service_role;
revoke execute on function public.process_support_assignment_timeouts(requested_limit integer) from public, anon, authenticated;
grant execute on function public.process_support_assignment_timeouts(requested_limit integer) to service_role;
revoke execute on function public.process_support_sla(requested_limit integer) from public, anon, authenticated;
grant execute on function public.process_support_sla(requested_limit integer) to service_role;
revoke execute on function public.record_support_human_response(requested_conversation_id uuid, requested_user_id uuid) from public, anon, authenticated;
grant execute on function public.record_support_human_response(requested_conversation_id uuid, requested_user_id uuid) to service_role;
revoke execute on function public.request_release_rollback(requested_release_id uuid, requested_reason text) from public, anon, authenticated;
grant execute on function public.request_release_rollback(requested_release_id uuid, requested_reason text) to service_role;
revoke execute on function public.saas_effective_entitlement(requested_organization_id uuid, requested_feature text) from public, anon, authenticated;
grant execute on function public.saas_effective_entitlement(requested_organization_id uuid, requested_feature text) to service_role;
revoke execute on function public.set_customer_marketing_consent(requested_establishment_id uuid, requested_customer_id uuid, requested_contact_id uuid, requested_status text, requested_origin text, requested_channel text, requested_evidence jsonb) from public, anon, authenticated;
grant execute on function public.set_customer_marketing_consent(requested_establishment_id uuid, requested_customer_id uuid, requested_contact_id uuid, requested_status text, requested_origin text, requested_channel text, requested_evidence jsonb) to service_role;
revoke execute on function public.set_deploy_freeze(requested_environment text, requested_frozen boolean, requested_reason text) from public, anon, authenticated;
grant execute on function public.set_deploy_freeze(requested_environment text, requested_frozen boolean, requested_reason text) to service_role;
revoke execute on function public.set_quality_feature_flag(requested_flag_key text, requested_enabled boolean, requested_kill_switch boolean, requested_rollout_percent integer, requested_internal_only boolean, requested_target_organizations uuid[], requested_target_plans text[]) from public, anon, authenticated;
grant execute on function public.set_quality_feature_flag(requested_flag_key text, requested_enabled boolean, requested_kill_switch boolean, requested_rollout_percent integer, requested_internal_only boolean, requested_target_organizations uuid[], requested_target_plans text[]) to service_role;
revoke execute on function public.support_message_lifecycle() from public, anon, authenticated;
grant execute on function public.support_message_lifecycle() to service_role;
