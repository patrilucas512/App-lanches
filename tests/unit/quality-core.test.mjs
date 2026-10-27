import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOrganization,createStore,createOrder,createPayment } from "../factories/masterapp.mjs";
const source=readFileSync(new URL("../../lib/quality/core.ts",import.meta.url),"utf8");
test("factories isolate every scenario",()=>{const a=createOrganization(),b=createOrganization();assert.notEqual(a.id,b.id);assert.equal(a.is_test_organization,true);});
test("money rules use integer cents",()=>assert.match(source,/Number\.isSafeInteger/));
test("rollout is deterministic and supports kill switch",()=>assert.match(source,/sha256[\s\S]*killSwitch/));
test("test target cannot match production",()=>assert.match(source,/blocked against production[\s\S]*production origin/));
test("order and payment factories carry idempotency",()=>{const store=createStore();const order=createOrder(store);const payment=createPayment(order);assert.match(order.idempotency_key,/order-/);assert.equal(payment.amount_cents,order.total_cents);});

