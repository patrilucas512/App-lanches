import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const read = path => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("WhatsApp schema is tenant-scoped, idempotent and protected by RLS", async () => {
  const migration = await read("supabase/migrations/20261008014220_whatsapp_human_support_v1.sql");
  for (const table of ["whatsapp_connections","whatsapp_contacts","whatsapp_conversations","whatsapp_messages"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /unique \(establishment_id, whatsapp_message_id\)/);
  assert.match(migration, /private\.has_whatsapp_permission/);
  assert.match(migration, /process_whatsapp_inbound_message/);
  assert.match(migration, /current_user not in \('service_role','postgres'\)/);
  assert.match(migration, /vault\.create_secret/);
  assert.doesNotMatch(migration, /access_token text[,\n]/);
});

test("webhook verifies Meta signature and handles messages plus statuses", async () => {
  const [route, cloud] = await Promise.all([read("app/api/whatsapp/webhook/route.ts"), read("lib/whatsapp/cloud-api.ts")]);
  assert.match(route, /x-hub-signature-256/);
  assert.match(route, /process_whatsapp_inbound_message/);
  assert.match(route, /update_whatsapp_message_status/);
  assert.match(cloud, /createHmac\("sha256"/);
  assert.match(cloud, /timingSafeEqual/);
});

test("outbound messages only travel through authenticated backend service", async () => {
  const [api, service, inbox, settings] = await Promise.all([read("app/api/whatsapp/messages/route.ts"),read("lib/whatsapp/message-service.ts"),read("components/whatsapp-inbox.tsx"),read("components/whatsapp-settings-manager.tsx")]);
  assert.match(api, /sendStoredWhatsAppText/);
  assert.match(service, /sendWhatsAppText/);
  assert.match(api, /can_respond/);
  assert.match(api, /client_request_id/);
  assert.match(inbox, /Assumir atendimento/);
  assert.match(inbox, /Finalizar/);
  assert.match(settings, /ACCESS TOKEN/);
  assert.doesNotMatch(settings, /setConnection\([^)]*access_token/);
});

test("Phase 2 keeps intelligence outside the webhook and uses a swappable provider", async () => {
  const [webhook, orchestrator, provider, types] = await Promise.all([read("app/api/whatsapp/webhook/route.ts"),read("lib/ai-attendant/orchestrator.ts"),read("lib/ai-attendant/providers/openai-provider.ts"),read("lib/ai-attendant/types.ts")]);
  assert.match(webhook,/processWhatsAppAutomation/);
  assert.doesNotMatch(webhook,/routeByRules|searchProducts|getOrderStatus/);
  assert.match(types,/interface AIProvider/);
  assert.match(types,/generateResponse\(context: AIContext, message: string, tools: AvailableTool\[\]\)/);
  assert.match(provider,/OPENAI_API_KEY/);
  assert.match(provider,/text: \{ format: \{ type: "json_schema"/);
  assert.match(orchestrator,/human_controlled/);
  assert.match(orchestrator,/limit\(6\)/);
});

test("Phase 2 covers the mandatory service intents with tenant-scoped real data", async () => {
  const [router,tools] = await Promise.all([read("lib/ai-attendant/intent-router.ts"),read("lib/ai-attendant/masterapp-tools.ts")]);
  for (const intent of ["hours","contact","payment_methods","delivery","pickup","menu","categories","product_search","availability","promotions","order_status","human_handoff"]) assert.match(router,new RegExp(`"${intent}"`));
  for (const table of ["establishments","establishment_settings","business_hours","delivery_settings","delivery_zones","categories","products","product_variations","addons","banners","customers","orders"]) assert.match(tools,new RegExp(`from\\(\\"${table}\\"\\)`));
  assert.match(tools,/\.eq\("establishment_id",context\.establishmentId\)/);
  assert.doesNotMatch(tools,/from\("orders"\)\.(insert|update|delete)/);
});

test("Phase 2 configuration, handoff, rate limit and audit trail are persisted securely", async () => {
  const migration=await read("supabase/migrations/20261008023406_whatsapp_ai_attendant_phase2.sql");
  for(const field of ["ai_enabled","automatic_replies_enabled","human_handoff_enabled","ai_outside_business_hours","ai_attendant_name","ai_welcome_message","ai_fallback_message"]) assert.match(migration,new RegExp(field));
  assert.match(migration,/create table if not exists public\.whatsapp_automation_events/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/return_whatsapp_to_automation/);
  assert.match(migration,/set_whatsapp_waiting_human/);
  assert.match(migration,/current_user not in \('service_role','postgres'\)/);
});

test("Phase 2 UI makes AI, human and waiting states controllable", async()=>{
  const [inbox,settings]=await Promise.all([read("components/whatsapp-inbox.tsx"),read("components/whatsapp-settings-manager.tsx")]);
  assert.match(inbox,/IA respondendo/);
  assert.match(inbox,/Aguardando humano/);
  assert.match(inbox,/Assumir atendimento/);
  assert.match(inbox,/Devolver para IA/);
  assert.match(settings,/Atendente com IA/);
  assert.match(settings,/Responder fora do horário/);
});

test("navigation and realtime expose unread conversations without refresh", async () => {
  const [shell,badge,inbox] = await Promise.all([read("components/dashboard-shell.tsx"),read("components/whatsapp-nav-item.tsx"),read("components/whatsapp-inbox.tsx")]);
  assert.match(shell, /\/painel\/whatsapp/);
  assert.match(badge, /whatsapp-nav-badge/);
  assert.match(badge, /postgres_changes/);
  assert.match(inbox, /whatsapp_messages/);
  assert.match(inbox, /postgres_changes/);
});

