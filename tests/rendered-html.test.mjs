import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the MasterApp marketing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>MasterApp — Cardápio, pedidos e gestão<\/title>/i);
  assert.match(html, /MASTERAPP/);
  assert.match(html, /Começar teste grátis/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("opens the short QR link directly in the public menu", async () => {
  const response = await render("/q/app-lanches");
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/loja/app-lanches?origem=qr",
  );
});

test("keeps the public menu bag, campaigns and secure quantity addons integrated", async () => {
  const [menu, catalog, addonGroups, campaigns, printers, storeControl, migration, integration, cashMigration, kitchen, css] = await Promise.all([
    readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/catalog-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/addon-groups-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/campaigns-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/multi-printer-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/store-status-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819090000_store_status_and_fulfillment_modes.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819234500_integrate_public_addons_campaigns.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260820013000_public_order_cash_change.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/kitchen-board.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(menu, /Sacola/);
  assert.match(menu, /masterapp:menu-theme/);
  assert.match(menu, /changeAddon/);
  assert.match(menu, /group_id: addon\.group_id/);
  assert.match(menu, /product\.addon_groups/);
  assert.match(menu, /promotion_type/);
  assert.match(menu, /product-carousel/);
  assert.match(menu, /Para viagem/);
  assert.match(menu, /Retirada/);
  assert.doesNotMatch(menu, /name="delivery_postal_code"/);
  assert.doesNotMatch(menu, /name="delivery_city"/);
  assert.doesNotMatch(menu, /name="delivery_state"/);
  assert.match(menu, /name="delivery_neighborhood"/);
  assert.match(menu, /VALOR QUE VAI PAGAR/);
  assert.match(menu, /requested_cash_received_cents/);
  assert.match(addonGroups, /Grupos de adicionais/);
  assert.match(addonGroups, /product_addon_groups/);
  assert.match(addonGroups, /duplicateGroup/);
  assert.match(addonGroups, /removeGroup/);
  assert.match(campaigns, /Banners e promoções/);
  assert.match(campaigns, /duplicateCampaign/);
  assert.match(campaigns, /removeCampaign/);
  assert.match(catalog, /removeCategory/);
  assert.match(catalog, /removeProduct/);
  assert.match(catalog, /Excluir adicional/);
  assert.match(printers, /set_printer_device_active/);
  assert.doesNotMatch(printers, /delete_printer_device/);
  assert.match(printers, /remove_cash_register/);
  assert.match(storeControl, /set_store_open/);
  const qrManager = await readFile(new URL("../components/qr-code-manager.tsx", import.meta.url), "utf8");
  assert.match(qrManager, /errorCorrectionLevel: "M"/);
  assert.match(qrManager, /width: 1024/);
  assert.match(qrManager, /margin: 6/);
  assert.match(qrManager, /\/q\/\$\{encodeURIComponent\(slug\)\}/);
  assert.match(qrManager, /display_name: settings\.displayName/);
  assert.match(qrManager, /Baixar novo QR direto/);
  assert.match(qrManager, /qr-direto-atualizado-/);
  assert.doesNotMatch(qrManager, /context\.drawImage\(logo/);
  assert.match(menu, /product-carousel-arrow previous/);
  assert.match(menu, /product-carousel-arrow next/);
  assert.match(migration, /takeaway_enabled/);
  assert.match(migration, /store_open/);
  assert.match(integration, /resolve_public_order_addons/);
  assert.match(integration, /product_addon_groups/);
  assert.match(integration, /promotion_value/);
  assert.match(cashMigration, /cash_received_cents/);
  assert.match(cashMigration, /cash_change_cents/);
  assert.match(kitchen, /pulse < 30/);
  assert.match(kitchen, /Testar alerta 15 s/);
  assert.match(menu, /order-tracking-shell/);
  assert.match(kitchen, /PAGAR EM DINHEIRO/);
  assert.match(css, /\.menu-page\.menu-light/);
  assert.match(css, /\.addon-counter-row/);
  assert.match(css, /\.product-carousel-arrow\.previous \{ left:-23px/);
  assert.match(css, /grid-template-columns:minmax\(175px,42%\)/);
});

test("keeps the administrative CRUD, filters and responsive layouts available", async () => {
  const [catalog, addonGroups, campaigns, css] = await Promise.all([
    readFile(new URL("../components/catalog-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/addon-groups-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/campaigns-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(catalog, /Buscar produtos/);
  assert.match(catalog, /Mais vendidos/);
  assert.match(catalog, /toggleProduct/);
  assert.match(catalog, /duplicateProduct/);
  assert.match(catalog, /removeProduct/);
  assert.match(catalog, /saveCategoryOrder/);
  assert.match(catalog, /window\.confirm/);
  assert.match(addonGroups, /saveGroup/);
  assert.match(addonGroups, /duplicateGroup/);
  assert.match(addonGroups, /removeGroup/);
  assert.match(campaigns, /saveCampaign/);
  assert.match(campaigns, /duplicateCampaign/);
  assert.match(campaigns, /removeCampaign/);
  assert.match(css, /@media\(max-width:580px\).*admin-product-grid\{grid-template-columns:1fr\}/s);
  assert.match(css, /@media\(max-width:700px\).*admin-addon-group/s);
  assert.match(css, /@media\(max-width:900px\).*admin-sidebar.*display:none/s);
});

test("keeps the public menu identity editable and connected to real data", async () => {
  const [branding, menu, catalogPage, personalizationPage, shell, migration, css] = await Promise.all([
    readFile(new URL("../components/menu-branding-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/painel/cardapio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/painel/personalizacao/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260820005649_customize_public_menu_branding.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(catalogPage, /\/painel\/personalizacao/);
  assert.match(personalizationPage, /MenuBrandingManager/);
  assert.match(shell, /label: "Personalizar site"/);
  assert.match(branding, /NOME EXIBIDO NO SISTEMA/);
  assert.match(branding, /IMAGEM DE CAPA DO CARDÁPIO/);
  assert.match(branding, /Escolher imagem da galeria/);
  assert.match(branding, /menu_logo_url/);
  assert.match(branding, /cover_url/);
  assert.match(branding, /menu_background_color/);
  assert.match(menu, /--menu-brand-bg/);
  assert.match(menu, /--menu-brand-surface/);
  assert.match(menu, /--menu-surface-text/);
  assert.match(migration, /coalesce\(e\.menu_display_name,e\.name\)/);
  assert.match(migration, /coalesce\(e\.menu_logo_url,e\.logo_url\)/);
  assert.match(css, /\.menu-branding-layout/);
  assert.match(css, /\.menu-page \.order-tracking :is\(h2,h3,p,b,strong,span,small\)/);
});

test("keeps delivery quotes, protected addresses and admin delivery rules integrated", async () => {
  const [menu, settings, settingsPage, migration, css] = await Promise.all([
    readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/delivery-settings-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/painel/configuracoes/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260824193446_phase3_delivery_checkout.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(menu, /quote_public_delivery/);
  assert.match(menu, /place_public_order_v2/);
  assert.doesNotMatch(menu, /name="delivery_postal_code"/);
  assert.doesNotMatch(menu, /name="delivery_city"/);
  assert.doesNotMatch(menu, /name="delivery_state"/);
  assert.match(menu, /name="delivery_street"/);
  assert.match(menu, /name="delivery_number"/);
  assert.match(menu, /name="delivery_neighborhood"/);
  assert.match(settings, /service_city/);
  assert.match(settings, /service_state/);
  assert.match(menu, /Calcular taxa de entrega/);
  assert.match(settings, /Taxa fixa para toda entrega/);
  assert.match(settings, /Taxa diferente por bairro/);
  assert.match(settingsPage, /DeliverySettingsManager/);
  assert.match(migration, /create table if not exists public\.delivery_settings/);
  assert.match(migration, /create table if not exists public\.delivery_destinations/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\.quote_public_delivery/);
  assert.match(css, /\.delivery-quote-card/);
  assert.match(css, /\.delivery-settings-panel/);
});

test("keeps kitchen and delivery statuses synchronized without closing delivery in the kitchen", async () => {
  const [kitchen, kitchenPage, migration, css] = await Promise.all([
    readFile(new URL("../components/kitchen-board.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cozinha/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260824213000_phase4_kitchen_delivery_status.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(kitchenPage, /from\("deliveries"\)/);
  assert.match(kitchen, /Pronto para despacho/);
  assert.match(kitchen, /Aguardando a fila de motoboys/);
  assert.match(kitchen, /table: "deliveries"/);
  assert.match(migration, /create table if not exists public\.deliveries/);
  assert.match(migration, /create table if not exists public\.delivery_events/);
  assert.match(migration, /delivery\.ready_for_dispatch/);
  assert.match(migration, /Pedidos de entrega são concluídos pelo fluxo do motoboy/);
  assert.match(css, /\.kitchen-delivery-stage\.stage-ready_for_dispatch/);
});

test("keeps driver staff, protected invites and individual access integrated", async () => {
  const [team, access, driverPage, migration, loginFunction] = await Promise.all([
    readFile(new URL("../components/custom-staff-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/driver-access.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/motoboy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260824233000_phase5_driver_team_invites.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/employee-login/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(team, /create_driver_invite/);
  assert.match(team, /convite-motoboy/);
  assert.match(team, /VEÍCULO/);
  assert.match(access, /activate-driver-access/);
  assert.match(access, /kind: "driver"/);
  assert.match(driverPage, /driver_profiles/);
  assert.match(migration, /create table public\.driver_profiles/);
  assert.match(migration, /create table public\.driver_access_links/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /role\.system_key = 'driver'/);
  assert.match(loginFunction, /'driver'/);
});

test("keeps fair driver availability and concurrency-safe delivery dispatch integrated", async () => {
  const [driverConsole, dispatchManager, driverPage, ordersPage, migration, css] = await Promise.all([
    readFile(new URL("../components/driver-dispatch-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/delivery-dispatch-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/motoboy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/painel/pedidos/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825001000_phase6_driver_dispatch.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(driverPage, /DriverDispatchConsole/);
  assert.match(driverConsole, /set_driver_availability/);
  assert.match(driverConsole, /accept_delivery_assignment/);
  assert.match(driverConsole, /reject_delivery_assignment/);
  assert.match(dispatchManager, /start_delivery_dispatch/);
  assert.match(dispatchManager, /delivery_assignments/);
  assert.match(ordersPage, /DeliveryDispatchManager/);
  assert.match(migration, /create table public\.driver_availability/);
  assert.match(migration, /create table public\.delivery_assignments/);
  assert.match(migration, /for update of availability skip locked/);
  assert.match(migration, /delivery_assignments_one_accepted_delivery_idx/);
  assert.match(migration, /actor_driver_id/);
  assert.match(css, /\.delivery-dispatch-panel/);
  assert.match(css, /\.driver-offer-card/);
});

test("keeps delivery custody, protected address and customer PIN integrated", async () => {
  const [driverConsole, dispatchManager, publicMenu, ordersPage, migration, css] = await Promise.all([
    readFile(new URL("../components/driver-dispatch-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/delivery-dispatch-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/painel/pedidos/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825013000_phase7_delivery_custody.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(driverConsole, /verify_pickup_code/);
  assert.match(driverConsole, /get_driver_delivery_detail/);
  assert.match(driverConsole, /verify_delivery_pin/);
  assert.match(driverConsole, /report_delivery_incident/);
  assert.match(dispatchManager, /issue_pickup_code/);
  assert.match(dispatchManager, /complete_delivery_without_pin/);
  assert.match(dispatchManager, /confirm_return_to_store/);
  assert.match(publicMenu, /delivery_pin/);
  assert.match(publicMenu, /PIN SEGURO DE ENTREGA/);
  assert.match(ordersPage, /returning_to_store/);
  assert.match(migration, /create table public\.delivery_incidents/);
  assert.match(migration, /pickup_code_hash/);
  assert.match(migration, /delivery_pin_hash/);
  assert.match(migration, /private\.delivery_pin_for_token/);
  assert.match(migration, /create or replace function public\.get_driver_delivery_detail/);
  assert.match(migration, /status in \('picked_up','on_route','arrived','returning_to_store'\)/);
  assert.match(migration, /A entrega é confirmada pelo PIN informado ao motoboy/);
  assert.match(css, /\.delivery-pin-card/);
  assert.match(css, /\.custody-code/);
});

test("admin operation navigation opens the delivery monitor directly", async () => {
  const [shell, manager] = await Promise.all([
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/delivery-dispatch-manager.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /key: "deliveries", href: "\/painel\/pedidos#despacho-entregas", label: "Entregas", icon: "🚚", group: "operacao"/);
  assert.match(manager, /id="despacho-entregas"/);
});

test("keeps driver location private and customer tracking approximate", async () => {
  const [driverConsole, publicMenu, migration, css] = await Promise.all([
    readFile(new URL("../components/driver-dispatch-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825020000_phase8_driver_location_tracking.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(driverConsole, /navigator\.geolocation\.watchPosition/);
  assert.match(driverConsole, /update_driver_location/);
  assert.match(driverConsole, /Ativar localização/);
  assert.match(publicMenu, /get_customer_delivery_tracking/);
  assert.match(publicMenu, /Ver posição aproximada/);
  assert.match(migration, /create table public\.driver_locations/);
  assert.match(migration, /location\.received_at < now\(\) - interval '30 days'/);
  assert.match(migration, /round\(location\.latitude::numeric,3\)/);
  assert.match(migration, /delivery\.status in \('picked_up','on_route','arrived'\)/);
  assert.match(migration, /revoke all on table public\.driver_locations from anon, authenticated/);
  assert.match(css, /\.driver-location-control/);
  assert.match(css, /\.customer-driver-location/);
});

test("keeps delivery completion atomic, auditable and protected by PIN", async () => {
  const [driverConsole, dispatchManager, publicMenu, migration, css] = await Promise.all([
    readFile(new URL("../components/driver-dispatch-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/delivery-dispatch-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825022000_phase9_delivery_completion_proof.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(driverConsole, /requested_pin: deliveryPin/);
  assert.match(driverConsole, /deliveryPin\.length !== 4/);
  assert.match(dispatchManager, /complete_delivery_without_pin/);
  assert.match(dispatchManager, /Motivo obrigatório para auditoria/);
  assert.match(publicMenu, /delivery_confirmation/);
  assert.match(publicMenu, /Entrega confirmada com segurança/);
  assert.match(migration, /delivery_confirmation_method/);
  assert.match(migration, /delivery_pin_verified/);
  assert.match(migration, /delivery_latitude/);
  assert.match(migration, /delivery_longitude/);
  assert.match(migration, /from public\.driver_locations/);
  assert.match(migration, /where id = requested_delivery_id for update/);
  assert.match(migration, /status = 'available'/);
  assert.match(migration, /active_delivery_count = greatest\(active_delivery_count - 1, 0\)/);
  assert.match(migration, /delivery\.status = 'delivered'/);
  assert.match(migration, /requested_pin !~ '\^\[0-9\]\{4\}\$'/);
  assert.match(migration, /revoke all on function public\.verify_delivery_pin\(uuid,text\) from public, anon/);
  assert.match(css, /\.tracking-delivery-update\.success/);
});

test("saves the customer's last order and restores it with the current menu", async () => {
  const [publicMenu, css] = await Promise.all([
    readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(publicMenu, /masterapp:\$\{menu\.establishment\.slug\}:ultimo-pedido/);
  assert.match(publicMenu, /localStorage\.setItem\(lastOrderStorageKey, JSON\.stringify\(savedOrder\)\)/);
  assert.match(publicMenu, /products\.find\(\(candidate\) => candidate\.id === savedItem\.productId\)/);
  assert.match(publicMenu, /Último pedido neste celular/);
  assert.match(publicMenu, /Pedir novamente/);
  assert.match(css, /\.last-order-card/);
  assert.match(css, /\.repeat-order-button/);
});

test("all staff areas keep registration collapsed behind the same active-count control", async () => {
  const [controls, waiters, kitchen, customStaff, css] = await Promise.all([
    readFile(new URL("../components/staff-section-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/attendance-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/kitchen-access.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/custom-staff-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(controls, /ativos de \$\{totalCount\} cadastrados/);
  assert.match(controls, /aria-expanded=\{open\}/);
  assert.match(controls, /Cadastrar \$\{label\}/);
  assert.match(waiters, /<StaffSectionControls activeCount=\{activeCount\} totalCount=\{waiters\.length\}/);
  assert.match(kitchen, /<StaffSectionControls activeCount=\{activeCount\} totalCount=\{operators\.length\}/);
  assert.match(customStaff, /role\.system_key === "driver" \? "motoboy"/);
  assert.match(customStaff, /role\.custom_staff_members\.filter\(isActiveToday\)\.length/);
  assert.match(css, /\.staff-registration-toggle\.open > span/);
});

test("keeps the administrative delivery monitor tenant-safe and auditable", async () => {
  const [dispatchManager, ordersPage, migration, css] = await Promise.all([
    readFile(new URL("../components/delivery-dispatch-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/painel/pedidos/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825023000_phase10_delivery_admin_monitoring.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(ordersPage, /get_delivery_operations_dashboard/);
  assert.match(dispatchManager, /CENTRAL DE ENTREGAS/);
  assert.match(dispatchManager, /MAPA OPERACIONAL/);
  assert.match(dispatchManager, /Abrir posição no mapa/);
  assert.match(dispatchManager, /Linha do tempo operacional/);
  assert.match(dispatchManager, /Ocorrências abertas/);
  assert.match(migration, /private\.has_role/);
  assert.match(migration, /array\['owner','manager'\]/);
  assert.match(migration, /from public\.driver_locations/);
  assert.match(migration, /from public\.delivery_events/);
  assert.match(migration, /from public\.delivery_incidents/);
  assert.match(migration, /revoke all on function public\.get_delivery_operations_dashboard\(uuid\) from public, anon/);
  assert.match(css, /\.delivery-operations-stats/);
  assert.match(css, /\.delivery-map-panel/);
  assert.match(css, /\.delivery-event-timeline/);
});

test("keeps driver payouts separated, immutable and auditable", async () => {
  const [manager, teamPage, staffManager, migration, css] = await Promise.all([
    readFile(new URL("../components/driver-financial-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/painel/equipe/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/custom-staff-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825030000_phase11_driver_financials.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(teamPage, /get_driver_financial_dashboard/);
  assert.match(teamPage, /DriverFinancialManager/);
  assert.match(staffManager, /TIPO DE CONTRATO \/ REPASSE/);
  assert.match(manager, /TAXAS DOS CLIENTES/);
  assert.match(manager, /REPASSES \+ DIÁRIAS/);
  assert.match(manager, /RESULTADO LOGÍSTICO BRUTO/);
  assert.match(manager, /save_driver_compensation_policy/);
  assert.match(manager, /add_driver_financial_adjustment/);
  assert.match(manager, /close_driver_financial_period/);
  assert.match(migration, /create table if not exists public\.driver_compensation_policies/);
  assert.match(migration, /create table if not exists public\.driver_financial_entries/);
  assert.match(migration, /driver_financial_entries_immutable/);
  assert.match(migration, /unique\(establishment_id, idempotency_key\)/);
  assert.match(migration, /driver_payout_cents/);
  assert.match(migration, /logistics_margin_cents/);
  assert.match(migration, /revoke all on public\.driver_compensation_policies/);
  assert.match(css, /\.driver-finance-stats/);
});

test("keeps delivery push notifications targeted, realtime and tenant-safe", async () => {
  const [driverConsole, dispatchManager, pushFunction, serviceWorker, migration] = await Promise.all([
    readFile(new URL("../components/driver-dispatch-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/delivery-dispatch-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/send-push-notification/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/push-sw.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825042000_phase12_delivery_notifications.sql", import.meta.url), "utf8"),
  ]);
  assert.match(driverConsole, /register_driver_push_subscription/);
  assert.match(driverConsole, /Alertas de novas entregas ativados/);
  assert.match(dispatchManager, /register_operations_push_subscription/);
  assert.match(dispatchManager, /delivery_incidents/);
  assert.match(pushFunction, /new_delivery_offer/);
  assert.match(pushFunction, /Seu pedido está a caminho/);
  assert.match(pushFunction, /Seu pedido chegou!/);
  assert.match(pushFunction, /delivery_push_notification_events/);
  assert.match(pushFunction, /x-webhook-secret/);
  assert.match(serviceWorker, /MasterApp/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /private\.has_role/);
  assert.match(migration, /driver_profile_id=auth\.uid\(\)|user_id=auth\.uid\(\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.delivery_incidents/);
});
