import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/contracts/${name}`,import.meta.url),"utf8"));
test("Meta fixture remains sanitized and structurally valid",()=>{const data=fixture("meta-whatsapp-message.json");assert.equal(data.object,"whatsapp_business_account");assert.equal(data.entry[0].changes[0].field,"messages");});
test("Mercado Pago fixture is sandbox",()=>assert.equal(fixture("mercado-pago-payment.json").live_mode,false));
test("Pagar.me fixture uses sandbox metadata",()=>assert.equal(fixture("pagarme-order.json").metadata.environment,"sandbox"));

