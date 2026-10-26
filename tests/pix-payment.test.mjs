import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/order-payments/pix.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createPixPayment, readPixPayment } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const fixture = { id: '123', status: 'pending', external_reference: 'order', transaction_amount: 19.9, currency_id: 'BRL', payment_method_id: 'pix', date_of_expiration: '2030-01-01T00:00:00Z', point_of_interaction: { transaction_data: { qr_code: '000201fixture', qr_code_base64: 'aW1hZ2U=' } } };
test('Pix: amount and order must match trusted payment', () => {
  assert.equal(readPixPayment(fixture, 'order', 1990).amountCents, 1990);
  assert.throws(() => readPixPayment(fixture, 'other-order', 1990));
  assert.throws(() => readPixPayment(fixture, 'order', 1900));
  assert.throws(() => readPixPayment({ ...fixture, currency_id: 'USD' }, 'order', 1990));
});
test('Pix: missing or malformed image is rejected', () => {
  assert.throws(() => readPixPayment({ ...fixture, point_of_interaction: {} }, 'order', 1990));
  assert.throws(() => readPixPayment({ ...fixture, point_of_interaction: { transaction_data: { qr_code: 'x', qr_code_base64: '<svg>' } } }, 'order', 1990));
});
test('Pix: stable idempotency key and BRL centavos, no credentials in response', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return Response.json(fixture); });
  const input = { credential: 'test-secret', accountId: 'account', origin: 'https://example.test', orderId: 'order', orderNumber: 1, amountCents: 1990, email: 'buyer@example.test', cpf: '12345678909', createdAt: new Date().toISOString() };
  const result = await createPixPayment(input);
  await createPixPayment(input);
  assert.equal(calls[0].options.headers['X-Idempotency-Key'], calls[1].options.headers['X-Idempotency-Key']);
  assert.equal(JSON.parse(calls[0].options.body).transaction_amount, 19.9);
  assert.equal(JSON.parse(calls[0].options.body).payment_method_id, 'pix');
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});
test('Pix: reject invalid payer and expired reservation before network', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('network must not be called'); });
  await assert.rejects(createPixPayment({ amountCents: 0 }), /Valor/);
  await assert.rejects(createPixPayment({ amountCents: 100, email: 'invalid', cpf: '1' }), /Informe/);
  await assert.rejects(createPixPayment({ amountCents: 100, email: 'a@b.test', cpf: '12345678909', createdAt: '2000-01-01' }), /expirou/);
});
