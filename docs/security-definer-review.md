# Revisão das funções SECURITY DEFINER (Fase 98G)

Levantamento no `masterapp-dev` em 04/11/2026 (mesmas migrations de produção). Produção não foi alterada.

## Resumo

| | Antes | Depois (dev) |
|---|---|---|
| Funções `SECURITY DEFINER` em `public` | 415 | 415 (nenhuma apagada) |
| Executáveis por `anon` | 22 (21 em produção, relatório 97) | 20 |
| Executáveis por usuário logado | 274 (273 + a nova `set_store_feature_flags`) | 254 |
| Sem `search_path` fixo | 0 | 0 |

- **Lote 1** (`20261104135000_phase98g_public_functions`): `anon` revogado de `place_public_order` (v1, sem uso) e `set_store_open` (exige login); limite de frequência em `place_public_order_v2` (30 pedidos por IP e 600 por loja a cada 10 min), `start_web_chat_session` (20 por IP) e `record_public_event` (300 por IP, recusa em silêncio). Prova: `scripts/dev/phase98g-public-check.sql` (7 de 7).
- **Lote 2** (`20261104136000_phase98g_internal_functions`): `EXECUTE` revogado de usuário logado em 19 funções internas (só chamadas pelo servidor com o cliente administrativo, por outras funções `SECURITY DEFINER` ou por gatilho). O `service_role` mantém acesso por concessão explícita. Conferido: nenhuma é usada em política nem chamada por função `SECURITY INVOKER`.
- **Classificação** gerada por `scripts/quality/security-definer-inventory.mjs` (procura `.rpc("nome")` e o tipo de cliente; referências em SQL) e revisada à mão. Quando havia dúvida, a função ficou como "app" e foi mantida.

## Funções executáveis por anon (as 22)

| Função | Por que é pública | Entrada e retorno | Limite | Ação |
|---|---|---|---|---|
| `get_public_menu`, `get_published_catalog`, `get_public_service_mode`, `get_public_payment_gateways` | cardápio público (`/loja/[slug]`) | por slug; devolvem só dados públicos da loja (nome, logo, cores, horários, modos aceitos); gateways sem segredos | leitura | mantidas |
| `quote_public_delivery` | frete no checkout | slug, bairro, subtotal validados | leitura | mantida |
| `place_public_order_v2` | pedido do cliente sem login | itens, nome, telefone, modo, pagamento validados por tamanho e valor | **novo: 30/IP e 600/loja a cada 10 min** | mantida |
| `place_public_order` | versão 1, nenhum código chama | — | — | **anon e authenticated revogados** |
| `get_public_order_status`, `get_customer_delivery_tracking`, `confirm_public_order_received`, `confirm_delivery_destination_location`, `register_customer_push_subscription` | acompanhamento do pedido | token aleatório do pedido (uuid); não devolvem nome, telefone nem endereço; o PIN de entrega vai para o próprio cliente | token por pedido; destino com janela de 30 min | mantidas |
| `create_waiter_call` | botão "chamar garçom" na mesa | mesa até 40 caracteres, nota limitada; só loja com chamada ligada; reaproveita chamado aberto | dedup por mesa | mantida |
| `record_qr_scan` | contagem do QR | slug e mesa | 30 s por origem | mantida |
| `record_public_event` | métricas do cardápio | evento de lista fechada | **novo: 300/IP a cada 10 min** | mantida |
| `start_web_chat_session`, `get_web_chat_history`, `post_web_chat_message` | chat do site (Fase 12) | chave pública do widget + origem + token da sessão | **novo na sessão: 20/IP**; mensagens já tinham `rate_limits` | mantidas (o app chama pelo servidor; candidatas a revogar `anon` na Fase 99) |
| `activate_printer_connector`, `fetch_printer_jobs`, `complete_printer_job` | agente de impressão no computador da cozinha | token do conector (hash no banco) | busca a cada 2 min | mantidas |
| `set_store_open` | — (exige dono/gerente logado) | — | — | **anon revogado** |

## Funções executáveis por usuário logado (274: as 273 abaixo e a \place_public_order\ v1, revogada no lote 1)

Categorias: **app** = a tela chama com a sessão do usuário; **app (pública)** = também pública, usada por quem está logado no cardápio; **interna** = só servidor/outras funções; **morta** = nenhuma chamada direta encontrada.

| Função | Categoria | Onde é chamada | Ação na 98G |
|---|---|---|---|
| `accept_delivery_assignment` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `accept_support_assignment` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `activate_store_from_onboarding` | app | app: route.ts | mantida |
| `add_driver_financial_adjustment` | app | app (sessão): driver-financial-manager.tsx | mantida |
| `add_support_internal_note` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `add_whatsapp_connection` | app | app (sessão): route.ts | mantida |
| `apply_migration_job` | app | app: route.ts | mantida |
| `apply_onboarding_menu_template` | app | app: route.ts | mantida |
| `approve_crm_campaign` | app | app (sessão): crm-manager.tsx | mantida |
| `archive_cashier_staff_member` | app | app (sessão): custom-staff-manager.tsx | mantida |
| `assign_delivery_v2` | interna | servidor (admin): route.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `assign_product_experiment` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `cancel_copilot_action` | app | app (sessão): route.ts | mantida |
| `cancel_crm_campaign` | app | app (sessão): crm-manager.tsx | mantida |
| `claim_omnichannel_conversation` | app | app (nome dinâmico): omnichannel-inbox.tsx | mantida |
| `claim_waiter_invite` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `claim_whatsapp_conversation` | app | app (nome dinâmico): support-supervision.tsx; app (nome dinâmico): whatsapp-inbox.tsx | mantida |
| `clone_store_configuration` | app | app (sessão): unit-management.tsx | mantida |
| `close_cash_shift` | app | app (sessão): pos-console.tsx | mantida |
| `close_driver_financial_period` | app | app (sessão): driver-financial-manager.tsx | mantida |
| `complete_delivery_without_pin` | app | app (nome dinâmico): delivery-dispatch-manager.tsx | mantida |
| `configure_copilot_action_settings` | app | app (sessão): route.ts | mantida |
| `configure_manager_copilot_alerts` | app | app (sessão): route.ts | mantida |
| `configure_payment_gateway` | app | app (sessão): route.ts | mantida |
| `configure_platform_payment_gateway` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `configure_support_agent_shift` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `configure_support_queue` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `configure_support_settings` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `configure_voice_connection` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `configure_whatsapp_automation` | app | app (sessão): route.ts | mantida |
| `configure_whatsapp_commerce` | app | app (sessão): route.ts | mantida |
| `configure_whatsapp_connection` | app | app (sessão): route.ts | mantida |
| `confirm_copilot_action` | app | app (sessão): route.ts | mantida |
| `confirm_delivery_destination_location` | app (pública) | app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `confirm_public_order_received` | app (pública) | app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `confirm_return_to_store` | app | app (nome dinâmico): delivery-dispatch-manager.tsx | mantida |
| `confirm_table_payment` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `create_ai_config_draft` | app | app (sessão): ai-attendant-manager.tsx | mantida |
| `create_cash_register` | app | app (sessão): multi-printer-manager.tsx | mantida |
| `create_cashier_invite` | app | app (sessão): custom-staff-manager.tsx; app (nome dinâmico): seed-dev.mjs | mantida |
| `create_customer_subscription_plan` | app | app (sessão): subscription-manager.tsx | mantida |
| `create_driver_invite` | app | app (sessão): custom-staff-manager.tsx; app (nome dinâmico): seed-dev.mjs | mantida |
| `create_establishment` | app | app (sessão): onboarding-form.tsx; app (nome dinâmico): seed-dev.mjs | mantida |
| `create_kitchen_invite` | app | app (sessão): kitchen-access.tsx; app (nome dinâmico): seed-dev.mjs | mantida |
| `create_masterapp_support_ticket` | app | app: route.ts | mantida |
| `create_onboarding_test_order` | app | app: route.ts | mantida |
| `create_organization_store` | app | app (sessão): unit-management.tsx | mantida |
| `create_reservation` | app | app (nome dinâmico): route.ts; app: public-api.ts | mantida |
| `create_waiter_call` | app (pública) | app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `create_waiter_invite` | app | app (sessão): attendance-manager.tsx; app (nome dinâmico): seed-dev.mjs | mantida |
| `crm_customer_status` | interna | sql: 20261009052202_whatsapp_crm_phase5.sql | **EXECUTE revogado de authenticated** (lote 2) |
| `deactivate_driver_staff_member` | app | app (sessão): custom-staff-manager.tsx | mantida |
| `deactivate_printer_device` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `decide_delivery_group_suggestion` | app | app (nome dinâmico): delivery-dispatch-manager.tsx | mantida |
| `delete_kitchen_operator` | app | app (sessão): kitchen-access.tsx; app (sessão): team-delete-button.tsx | mantida |
| `delete_printer_device` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `delete_waiter` | app | app (sessão): attendance-manager.tsx; app (sessão): team-delete-button.tsx | mantida |
| `dining_room_action` | app | app (nome dinâmico): advanced-dining-room.tsx | mantida |
| `disconnect_whatsapp_connection` | app | app (sessão): route.ts | mantida |
| `disconnect_whatsapp_connection_by_id` | app | app (sessão): route.ts | mantida |
| `enqueue_product_event` | app | app: route.ts | mantida |
| `enqueue_support_conversation` | interna | sql: 20261010032519_whatsapp_supervision_phase8.sql | **EXECUTE revogado de authenticated** (lote 2) |
| `ensure_default_support_queue` | interna | sql: 20261010032519_whatsapp_supervision_phase8.sql | **EXECUTE revogado de authenticated** (lote 2) |
| `estimate_crm_segment` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `expire_delivery_offer` | app | app (nome dinâmico): delivery-dispatch-manager.tsx | mantida |
| `financial_add_attachment` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_configure_settings` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_confirm_action` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_create_entry` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_generate_recurring` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_phase17_summary` | app | app (sessão): route.ts; app (sessão): financial-phase17-console.tsx | mantida |
| `financial_preview_action` | app | app (sessão): financial-phase17-console.tsx | mantida |
| `financial_save_budget` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_save_category` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_save_cost_center` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `financial_save_recurring` | app | app (nome dinâmico): financial-phase17-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `fiscal_add_digital_document` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `fiscal_configure_profile` | app | app (nome dinâmico): fiscal-phase19-console.tsx | mantida |
| `fiscal_confirm_action` | app | app (nome dinâmico): fiscal-phase19-console.tsx | mantida |
| `fiscal_create_export` | app | app (nome dinâmico): fiscal-phase19-console.tsx | mantida |
| `fiscal_create_magic_link` | app | app (sessão): fiscal-phase19-console.tsx | mantida |
| `fiscal_link_received_to_finance` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `fiscal_phase19_summary` | app | app (sessão): route.ts; app (sessão): route.ts | mantida |
| `fiscal_preview_action` | app | app (sessão): fiscal-phase19-console.tsx | mantida |
| `fiscal_register_received_document` | app | app (nome dinâmico): fiscal-phase19-console.tsx | mantida |
| `fiscal_save_product_profile` | app | app (nome dinâmico): fiscal-phase19-console.tsx | mantida |
| `get_ai_dashboard` | app | app (sessão): page.tsx; app (sessão): ai-attendant-manager.tsx | mantida |
| `get_crm_customer_360` | app | app (sessão): crm-manager.tsx | mantida |
| `get_crm_dashboard` | app | app (sessão): page.tsx | mantida |
| `get_customer_delivery_tracking` | app (pública) | app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `get_customer_omnichannel_timeline` | app | app (sessão): crm-manager.tsx | mantida |
| `get_customer_subscription_dashboard` | app | app (sessão): page.tsx | mantida |
| `get_customer_voice_timeline` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `get_delivery_operations_dashboard` | app | app (sessão): page.tsx; app (sessão): delivery-dispatch-manager.tsx | mantida |
| `get_driver_delivery_detail` | app | app (sessão): driver-dispatch-console.tsx | mantida |
| `get_driver_financial_dashboard` | app | app (sessão): page.tsx; app (sessão): driver-financial-manager.tsx | mantida |
| `get_effective_loyalty_balance` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `get_loyalty_balance` | interna | servidor (admin): order-conversation.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `get_manager_copilot_snapshot` | app | app (sessão): route.ts; app (sessão): page.tsx | mantida |
| `get_omnichannel_analytics` | app | app (sessão): page.tsx | mantida |
| `get_omnichannel_conversation` | app | app (sessão): omnichannel-inbox.tsx | mantida |
| `get_organization_report` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `get_organization_unit_dashboard` | app | app (sessão): page.tsx | mantida |
| `get_printer_connector_status` | app | app (sessão): page.tsx; app (sessão): kitchen-board.tsx | mantida |
| `get_product_growth_summary` | interna | servidor (admin): route.ts; servidor (admin): page.tsx | **EXECUTE revogado de authenticated** (lote 2) |
| `get_public_menu` | app (pública) | app (nome dinâmico): page.tsx | mantida (também usada por quem está logado no cardápio) |
| `get_public_order_status` | app (pública) | app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `get_public_payment_gateways` | app (pública) | app (nome dinâmico): page.tsx | mantida (também usada por quem está logado no cardápio) |
| `get_public_service_mode` | app (pública) | app (nome dinâmico): page.tsx | mantida (também usada por quem está logado no cardápio) |
| `get_published_catalog` | app (pública) | app (nome dinâmico): page.tsx | mantida (também usada por quem está logado no cardápio) |
| `get_quality_summary` | interna | servidor (admin): route.ts; servidor (admin): page.tsx | **EXECUTE revogado de authenticated** (lote 2) |
| `get_reservation_availability` | interna | servidor (admin): route.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `get_reservation_dashboard` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `get_saas_billing_portal` | app | app (sessão): page.tsx | mantida |
| `get_saas_lifecycle_messages` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `get_security_summary` | app | app (sessão): route.ts; app (sessão): copilot-tools.ts | mantida |
| `get_support_peak_hours` | app | app (sessão): page.tsx; app (sessão): support-supervision.tsx | mantida |
| `get_support_productivity` | app | app (sessão): page.tsx; app (sessão): support-supervision.tsx | mantida |
| `get_support_supervision_dashboard` | app | app (sessão): page.tsx; app (sessão): support-supervision.tsx | mantida |
| `get_table_pix_data` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `get_voice_call_detail` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `get_voice_dashboard` | app | app (sessão): page.tsx; app (sessão): voice-dashboard.tsx | mantida |
| `get_web_chat_history` | app (pública) | — | mantida (também usada por quem está logado no cardápio) |
| `get_whatsapp_commerce_metrics` | app | app (sessão): page.tsx | mantida |
| `inventory_confirm_count` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `inventory_convert_quantity` | interna | sql: 20261010215634_inventory_costs_purchases_phase16.sql; sql: 20261011054306_inventory_recipe_conversions_phase16.sql | **EXECUTE revogado de authenticated** (lote 2) |
| `inventory_create_purchase_order` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `inventory_create_transfer` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `inventory_phase16_summary` | app | app (sessão): route.ts; app (sessão): inventory-phase16-console.tsx | mantida |
| `inventory_product_costs` | app | app (sessão): route.ts; app (sessão): inventory-phase16-console.tsx | mantida |
| `inventory_purchase_action` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida |
| `inventory_receive_purchase` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `inventory_record_waste` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `inventory_save_item_v2` | app | app (sessão): inventory-manager.tsx | mantida |
| `inventory_save_recipe_v2` | app | app (sessão): inventory-manager.tsx | mantida |
| `inventory_save_supplier` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `inventory_start_count` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `inventory_transfer_action` | app | app (nome dinâmico): inventory-phase16-console.tsx | mantida (chamada pela tela por nome dinâmico) |
| `issue_pickup_code` | app | app (nome dinâmico): delivery-dispatch-manager.tsx | mantida |
| `join_waitlist` | app | app (nome dinâmico): route.ts; app (nome dinâmico): customer-portal.tsx | mantida (chamada pela tela por nome dinâmico) |
| `kitchen_task_transition` | interna | servidor (admin): route.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `list_copilot_actions` | app | app (sessão): route.ts | mantida |
| `list_crm_customers` | app | app (sessão): page.tsx | mantida |
| `list_omnichannel_inbox` | app | app (sessão): page.tsx; app (sessão): omnichannel-inbox.tsx | mantida |
| `list_printer_devices` | app | app (sessão): page.tsx; app (sessão): kitchen-board.tsx | mantida |
| `manage_customer_subscription_plan` | app | app (sessão): subscription-manager.tsx | mantida |
| `manage_kitchen_operator` | app | app (sessão): kitchen-access.tsx; script: seed-dev.mjs | mantida |
| `manage_saas_subscription` | app | app (sessão): route.ts | mantida |
| `manage_waiter` | app | app (sessão): attendance-manager.tsx; script: seed-dev.mjs | mantida |
| `mark_driver_arrived` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `mark_driver_to_pickup` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `mark_whatsapp_conversation_read` | app | app (sessão): whatsapp-inbox.tsx | mantida |
| `merge_customers_omnichannel` | app | app: route.ts; app (sessão): crm-manager.tsx | mantida |
| `open_advanced_table_session` | app | app (nome dinâmico): advanced-dining-room.tsx | mantida |
| `open_cash_shift` | app | app (sessão): pos-console.tsx | mantida |
| `open_table_session` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `open_table_session_by_label` | app | app (sessão): waiter-console.tsx | mantida |
| `place_public_order_v2` | app (pública) | servidor (admin): route.ts; app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `post_masterapp_support_message` | app | app: route.ts | mantida |
| `post_web_chat_message` | app (pública) | servidor (admin): route.ts | mantida (também usada por quem está logado no cardápio) |
| `prepare_printer_device_activation` | app | app (sessão): kitchen-board.tsx | mantida |
| `preview_copilot_action` | app | app (sessão): route.ts | mantida |
| `preview_customer_merge` | app | app: route.ts; app (sessão): crm-manager.tsx | mantida |
| `preview_saas_plan_change` | app | app (sessão): route.ts | mantida |
| `process_support_assignment_timeouts` | interna | sql: 20261010035000_whatsapp_supervision_phase8_workers.sql | **EXECUTE revogado de authenticated** (lote 2) |
| `process_support_sla` | interna | sql: 20261010035000_whatsapp_supervision_phase8_workers.sql | **EXECUTE revogado de authenticated** (lote 2) |
| `publish_ai_config` | app | app (sessão): ai-attendant-manager.tsx | mantida |
| `purge_old_driver_locations` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `queue_kitchen_print` | app | app (sessão): kitchen-board.tsx | mantida |
| `queue_printer_test` | app | app (sessão): printer-setup-wizard.tsx | mantida |
| `queue_printer_test_device` | app | app (sessão): multi-printer-manager.tsx | mantida |
| `quote_public_delivery` | app (pública) | servidor (admin): order-conversation.ts; app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `rate_masterapp_support_ticket` | app | app: route.ts | mantida |
| `record_cash_adjustment` | app | app (sessão): pos-console.tsx | mantida |
| `record_dining_payment` | app | app (nome dinâmico): advanced-dining-room.tsx | mantida |
| `record_manager_copilot_query` | app | app (sessão): route.ts | mantida |
| `record_public_event` | app (pública) | app (sessão): public-menu.tsx; script: cx-smoke.mjs | mantida (também usada por quem está logado no cardápio) |
| `record_qr_scan` | app (pública) | app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `record_support_human_response` | interna | servidor (admin): route.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `refresh_delivery_group_suggestions` | app | app (sessão): delivery-dispatch-manager.tsx | mantida |
| `refresh_delivery_operational_alerts` | app | app (sessão): page.tsx; app (sessão): delivery-dispatch-manager.tsx | mantida |
| `refresh_fixed_driver_shift` | app | app (sessão): driver-dispatch-console.tsx | mantida |
| `refresh_onboarding_progress` | app | app: route.ts | mantida |
| `register_customer_push_subscription` | app (pública) | app (sessão): public-menu.tsx | mantida (também usada por quem está logado no cardápio) |
| `register_driver_push_subscription` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `register_kitchen_push_subscription` | app | app (sessão): kitchen-board.tsx | mantida |
| `register_operations_push_subscription` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `register_pos_sale` | app | app (sessão): pos-console.tsx | mantida |
| `register_printer_connector` | app | app (sessão): printer-setup-wizard.tsx | mantida |
| `register_printer_device` | app | app (sessão): multi-printer-manager.tsx | mantida |
| `register_table_payment` | app | app (sessão): waiter-console.tsx | mantida |
| `register_waiter_push_subscription` | app | app (sessão): waiter-order-tracker.tsx | mantida |
| `reject_delivery_assignment` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `release_table_session` | app | app (sessão): waiter-console.tsx | mantida |
| `remove_cash_register` | app | app (sessão): multi-printer-manager.tsx | mantida |
| `report_delivery_incident` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `request_release_rollback` | interna | servidor (admin): route.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `request_saas_plan_change` | app | app (sessão): route.ts | mantida |
| `request_table_closure` | app | app (sessão): waiter-console.tsx | mantida |
| `request_voice_callback` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `reservation_action` | app | app (nome dinâmico): route.ts; app: public-api.ts | mantida |
| `reserve_table_pix` | app | app (sessão): route.ts | mantida |
| `resolve_omnichannel_conversation` | app | app (nome dinâmico): omnichannel-inbox.tsx | mantida |
| `resolve_whatsapp_conversation` | app | app (nome dinâmico): support-supervision.tsx; app (nome dinâmico): whatsapp-inbox.tsx | mantida |
| `return_omnichannel_to_ai` | app | app (nome dinâmico): omnichannel-inbox.tsx | mantida |
| `return_whatsapp_to_automation` | app | app (nome dinâmico): whatsapp-inbox.tsx | mantida |
| `review_support_conversation` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `rollback_ai_config` | app | app (sessão): ai-attendant-manager.tsx | mantida |
| `rollback_migration_job` | app | app: route.ts | mantida |
| `run_masterapp_support_diagnostic` | app | app: route.ts | mantida |
| `saas_billing_metrics` | app | app (sessão): page.tsx | mantida |
| `saas_effective_entitlement` | interna | servidor (admin): route.ts; servidor (admin): saas-billing.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `save_customer_subscription_benefit` | app | app (sessão): subscription-manager.tsx | mantida |
| `save_dining_area` | app | app (nome dinâmico): dining-room-manager.tsx | mantida |
| `save_driver_compensation_policy` | app | app (sessão): custom-staff-manager.tsx; app (sessão): driver-financial-manager.tsx | mantida |
| `save_manager_copilot_feedback` | app | app (sessão): route.ts | mantida |
| `save_printer_settings` | app | app (sessão): printer-setup-wizard.tsx | mantida |
| `save_reservation_settings` | app | app (nome dinâmico): dining-room-manager.tsx | mantida |
| `save_reservation_table` | app | app (nome dinâmico): dining-room-manager.tsx | mantida |
| `save_table_combination` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `send_web_chat_staff_message` | app | app (sessão): route.ts | mantida |
| `set_active_unit` | app | app (sessão): route.ts | mantida |
| `set_ai_member_permissions` | app | app (sessão): ai-attendant-manager.tsx | mantida |
| `set_cash_register_active` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `set_customer_marketing_consent` | interna | servidor (admin): order-conversation.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `set_deploy_freeze` | interna | servidor (admin): route.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `set_driver_availability` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `set_kitchen_auto_print` | app | app (sessão): kitchen-print-settings.tsx | mantida |
| `set_manager_copilot_permissions` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `set_onboarding_step_status` | app | app: route.ts | mantida |
| `set_organization_store_status` | app | app (sessão): unit-management.tsx | mantida |
| `set_printer_device_active` | app | app (sessão): kitchen-board.tsx; app (sessão): multi-printer-manager.tsx | mantida |
| `set_quality_feature_flag` | interna | servidor (admin): route.ts | **EXECUTE revogado de authenticated** (lote 2) |
| `set_store_feature_flags` | app | sql: phase98a-flags-check.sql | mantida (chamada pela tela por nome dinâmico) |
| `set_store_open` | app | app (sessão): store-status-control.tsx | mantida para authenticated; **anon revogado** (lote 1) |
| `set_support_agent_presence` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `set_support_queue_member` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `set_whatsapp_member_permissions` | app | app (sessão): whatsapp-settings-manager.tsx | mantida |
| `start_delivery_dispatch` | app | app (nome dinâmico): delivery-dispatch-manager.tsx | mantida |
| `start_delivery_group_dispatch` | app | app (nome dinâmico): delivery-dispatch-manager.tsx | mantida |
| `start_delivery_route` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `start_or_resume_onboarding` | app | app: route.ts | mantida |
| `start_web_chat_session` | app (pública) | sql: 20261104135000_phase98g_public_functions.sql; sql: phase98g-public-check.sql | mantida (também usada por quem está logado no cardápio) |
| `submit_table_order` | app | app (sessão): waiter-console.tsx | mantida |
| `superadmin_change_subscription_plan` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `superadmin_extend_trial` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `superadmin_set_establishment_block` | app | app (sessão): superadmin-actions.tsx | mantida |
| `superadmin_set_public_menu` | app | app (sessão): superadmin-actions.tsx | mantida |
| `support_message_lifecycle` | interna (gatilho) | sql: 20261010032519_whatsapp_supervision_phase8.sql | **EXECUTE revogado de authenticated** (lote 2) |
| `transfer_support_conversation` | app | app (nome dinâmico): support-supervision.tsx | mantida (chamada pela tela por nome dinâmico) |
| `transfer_whatsapp_conversation_store` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `transport_dispatch_trip` | app | app: route.ts | mantida |
| `transport_record_pod` | app | app: route.ts | mantida |
| `undo_copilot_action` | app | app (sessão): route.ts | mantida |
| `unmerge_customers_omnichannel` | app | app (sessão): crm-manager.tsx | mantida |
| `update_driver_location` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `update_kitchen_ticket` | app | app (sessão): kitchen-board.tsx; app (sessão): waiter-order-tracker.tsx | mantida |
| `update_pix_settings` | app | app (sessão): pix-settings-form.tsx | mantida |
| `update_printer_device` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `update_service_mode` | app | app (sessão): attendance-manager.tsx | mantida |
| `update_support_conversation` | app | app (nome dinâmico): support-supervision.tsx | mantida |
| `verify_delivery_pin` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `verify_pickup_code` | app | app (nome dinâmico): driver-dispatch-console.tsx | mantida |
| `waitlist_action` | app | app (nome dinâmico): dining-room-manager.tsx | mantida |
| `wms_apply_count_adjustment` | app | app: route.ts | mantida |
| `wms_move_inventory` | app | app: route.ts | mantida |
| `workforce_copy_previous_week_preview` | app | app (sessão): workforce-phase18-console.tsx | mantida |
| `workforce_decide_clock_correction` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `workforce_phase18_summary` | app | app (sessão): route.ts; app (sessão): workforce-phase18-console.tsx | mantida |
| `workforce_publish_schedule` | app | app (nome dinâmico): workforce-phase18-console.tsx | mantida |
| `workforce_record_clock` | app | app (sessão): employee-time-clock.tsx | mantida |
| `workforce_request_clock_correction` | morta | — | apontada: sem chamada direta no código; revisar (pode ser chamada por nome dinâmico) |
| `workforce_save_shift` | app | app (nome dinâmico): workforce-phase18-console.tsx | mantida |
