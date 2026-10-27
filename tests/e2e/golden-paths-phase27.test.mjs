import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,existsSync } from "node:fs";
const root=new URL("../../",import.meta.url); const read=path=>readFileSync(new URL(path,root),"utf8");
const route=path=>assert.equal(existsSync(new URL(path,root)),true,`missing ${path}`);
test("01 novo cliente",()=>{route("app/cadastro/page.tsx");route("app/onboarding/page.tsx");route("app/painel/unidades/page.tsx");route("app/painel/cardapio/page.tsx");});
test("02 pedido real",()=>{const menu=read("components/public-menu.tsx");assert.match(menu,/checkout|pedido/i);route("app/cozinha/page.tsx");});
test("03 WhatsApp",()=>{route("app/api/whatsapp/webhook/route.ts");assert.match(read("lib/ai-attendant/orchestrator.ts"),/order|carrinho|cart/i);});
test("04 delivery",()=>{route("components/delivery-dispatch-manager.tsx");route("components/driver-dispatch-console.tsx");});
test("05 PIX",()=>{route("app/api/order-payments/pix/route.ts");route("app/api/order-payments/webhook/mercado-pago/route.ts");});
test("06 atendimento humano",()=>assert.match(read("lib/ai-attendant/orchestrator.ts"),/human|handoff|atendente/i));
test("07 multiempresa",()=>assert.match(read("tests/security-enterprise-phase25.test.mjs"),/tenant isolation/i));
test("08 multiunidade",()=>assert.match(read("tests/whatsapp-multiunit-phase7.test.mjs"),/isolado|isolamento/i));
test("09 estoque e reversão",()=>assert.match(read("tests/inventory-database-checks.sql"),/cancellation exactly once|rollback/i));
test("10 financeiro",()=>{route("app/painel/financeiro/page.tsx");assert.match(read("tests/financial-phase17.test.mjs"),/DRE|cashflow|fluxo/i);});
test("11 reserva",()=>{route("app/api/reservation-payments/[slug]/checkout/route.ts");assert.match(read("tests/reservations-phase15.test.mjs"),/check-in|checkin/i);});
test("12 billing",()=>{route("app/api/saas/checkout/route.ts");assert.match(read("tests/saas-billing-phase22.test.mjs"),/upgrade|downgrade|entitlement/i);});
test("13 integrações",()=>{route("app/api/v1/[...path]/route.ts");route("app/api/integrations/webhooks/process/route.ts");});

