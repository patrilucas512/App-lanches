import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const read = name => readFile(new URL('../'+name, import.meta.url),'utf8');
const code = ts.transpileModule(await read('lib/delivery-address.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {parseDeliveryAddress} = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('Compact address keeps street, number and neighborhood without guessing',()=>{
 assert.deepEqual(parseDeliveryAddress(' Rua das Flores, 125, Centro '),{street:'Rua das Flores',number:'125',neighborhood:'Centro'});
 for(const invalid of ['', 'Rua sem número', 'Rua, 1', 'Rua, , Centro', 'Rua, 1, Centro, extra']) assert.equal(parseDeliveryAddress(invalid),null);
});
test('Simplified delivery form, Pix support and printed cash change remain connected',async()=>{
 const menu=await read('components/public-menu.tsx');
 const form=menu.slice(menu.indexOf('<form ref={checkoutForm}'));
 const positions=['name="name"','name="delivery_street"','name="delivery_number"','name="delivery_complement"','name="delivery_neighborhood"','name="delivery_reference"','name="payment"','name="phone"'].map(x=>form.indexOf(x));
 assert.ok(positions.every((p,i)=>p>=0 && (i===0 || p>positions[i-1])));
 assert.ok(!form.includes('name="delivery_address"'));
 assert.ok(!form.includes('name="delivery_postal_code"'));
 assert.ok(!form.includes('name="delivery_city"'));
 assert.ok(!form.includes('name="delivery_state"'));
 assert.match(await read('app/api/order-payments/pix/route.ts'),/\["pickup", "takeaway", "delivery"\]/);
 assert.match(await read('components/kitchen-board.tsx'),/PAGAR EM DINHEIRO/);
 assert.match(await read('components/kitchen-board.tsx'),/TROCO:/);
});
