import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261009042903_whatsapp_commerce_phase4.sql");
const conversation=read("lib/ai-attendant/order-conversation.ts");
const commerce=read("lib/ai-attendant/whatsapp-commerce.ts");
const pix=read("lib/order-payments/pix.ts");
const edge=read("supabase/functions/send-whatsapp-commerce-event/index.ts");
const settings=read("components/whatsapp-settings-manager.tsx");
const api=read("app/api/whatsapp/automation/route.ts");
const dashboard=read("app/painel/whatsapp/page.tsx");

const checks=[
  ["1. Pix usa o pedido oficial e a conta ativa",()=>{assert.match(commerce,/from\("orders"\)/);assert.match(commerce,/from\("payment_gateway_accounts"\)[\s\S]*eq\("active",true\)/);assert.match(commerce,/from\("order_payment_transactions"\)/);}],
  ["2. Pix reutiliza chave idempotente",()=>assert.match(commerce,/idempotencyKey=`\$\{provider\}:\$\{record\.id\}`/)],
  ["3. Pix valida e-mail e CPF",()=>assert.match(pix,/e-mail e CPF válidos/)],
  ["4. Pix possui expiração configurável",()=>assert.match(pix,/expiresInMinutes/)],
  ["5. Pix registra expiração no banco",()=>assert.match(commerce,/expires_at:pix\.expiresAt/)],
  ["6. confirmação usa webhook oficial existente",()=>assert.match(commerce,/confirm_online_order_payment/)],
  ["7. pagamento aprovado libera cozinha",()=>assert.match(migration,/payment_approved[\s\S]*seguindo para preparo/)],
  ["8. pagamento expirado é marcado automaticamente",()=>assert.match(migration,/status='expired'[\s\S]*expires_at<=now\(\)/)],
  ["9. cartão usa checkout hospedado",()=>assert.match(commerce,/createHostedCheckout/)],
  ["10. dados do cartão não são solicitados no chat",()=>assert.match(conversation,/Não envie dados do cartão por aqui/)],
  ["11. dinheiro preserva cálculo de troco",()=>assert.match(conversation,/Troco: \$\{money\(cents-totals\.total\)\}/)],
  ["12. recuperação é configurável",()=>assert.match(settings,/cart_recovery_enabled/)],
  ["13. recuperação envia no máximo uma vez",()=>assert.match(migration,/recovery_sent_at is null[\s\S]*cart-recovery:/)],
  ["14. recuperação respeita opt-out",()=>assert.match(migration,/not co\.marketing_opt_out/)],
  ["15. recuperação respeita janela de 24h",()=>assert.match(edge,/24\*60\*60\*1000/)],
  ["16. atendimento humano bloqueia automação",()=>assert.match(edge,/conversation\?\.human_controlled/)],
  ["17. upsell é limitado a uma oferta",()=>assert.match(conversation,/upsell_offer_count\|\|0\)<1/)],
  ["18. upsell usa somente produto ativo real",()=>assert.match(conversation,/from\("products"\)[\s\S]*eq\("active",true\)/)],
  ["19. repetição consulta último pedido concluído",()=>assert.match(conversation,/eq\("status","completed"\)[\s\S]*order\("created_at"/)],
  ["20. repetição exige confirmação explícita",()=>assert.match(conversation,/Envie REPETIR PEDIDO/)],
  ["21. jobs têm retentativa limitada",()=>assert.match(edge,/event\.attempts>=3/)],
  ["22. fila é protegida por RLS",()=>assert.match(migration,/whatsapp_commerce_outbox enable row level security/)],
  ["23. configuração exige permissão do tenant",()=>assert.match(migration,/has_whatsapp_permission\(requested_establishment_id,'configure'\)/)],
  ["24. dashboard expõe métricas comerciais reais",()=>{assert.match(api,/configure_whatsapp_commerce/);assert.match(dashboard,/get_whatsapp_commerce_metrics/);}],
];

for(const [name,run] of checks) test(name,run);
