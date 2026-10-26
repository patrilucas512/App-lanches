import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const uri = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const pix = uri(compile(await readFile(new URL('../lib/order-payments/pix.ts', import.meta.url), 'utf8')));
const providers = uri(compile(await readFile(new URL('../lib/order-payments/providers.ts', import.meta.url), 'utf8')));
const source = compile(await readFile(new URL('../lib/order-payments/table-pix.ts', import.meta.url), 'utf8'))
  .replace('"./pix"', JSON.stringify(pix)).replace('"./providers"', JSON.stringify(providers));
const { reconcileTablePix } = await import(uri(source));
const payment = { id:'123', external_reference:'transaction-1', status:'approved', live_mode:true, transaction_amount:19.90, currency_id:'BRL', payment_method_id:'pix' };
function backend() {
  const calls=[];
  const query={ select(){return this;}, eq(){return this;}, async single(){return {data:{environment:'production'}};} };
  return { calls, from(){return query;}, async rpc(name,args){calls.push({name,args});return {data:{status:args.requested_status}};} };
}
test('Mesa Pix: only provider approval invokes automatic financial confirmation', async()=>{
  const admin=backend();
  const result=await reconcileTablePix(admin,'account',{id:'transaction-1',amount_cents:1990},payment);
  assert.equal(result.status,'approved');
  assert.equal(admin.calls[0].name,'confirm_online_table_payment');
  assert.equal(admin.calls[0].args.requested_external_id,'123');
});
test('Mesa Pix: mismatched amount, reference, currency and test environment cannot settle', async()=>{
  for(const override of [{transaction_amount:1},{external_reference:'other'},{currency_id:'USD'},{live_mode:false},{payment_method_id:'card'}]) {
    const admin=backend();
    await assert.rejects(reconcileTablePix(admin,'account',{id:'transaction-1',amount_cents:1990},{...payment,...override}));
    assert.equal(admin.calls.length,0);
  }
});
test('Mesa Pix: cancellation and refund keep their state, never approved', async()=>{
  for(const [raw,expected] of [['cancelled','canceled'],['refunded','refunded'],['rejected','declined']]) {
    const admin=backend();
    const result=await reconcileTablePix(admin,'account',{id:'transaction-1',amount_cents:1990},{...payment,status:raw});
    assert.equal(result.status,expected);
  }
});
