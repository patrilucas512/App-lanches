import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the existing provider module, without loading application env files.
const source = await readFile(new URL('../lib/order-payments/providers.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const providers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const input = {
  provider: 'mercado_pago', environment: 'test', credential: 'FAKE-NOT-A-CREDENTIAL',
  origin: 'https://store.example.test', accountId: 'fixture-account',
  order: { id: 'fixture-order', orderNumber: 123, amountCents: 1990,
    customerName: 'Fixture', trackingToken: 'fixture-token', establishmentSlug: 'fixture-store' },
};

function mockFetch(t, body, status = 200) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

test('Mercado Pago: centavos, retorno sandbox e chave estável', async t => {
  const calls = mockFetch(t, { id: 'preference', sandbox_init_point: 'https://sandbox.example.test/pay', init_point: 'https://live.example.test/pay' });
  const result = await providers.createHostedCheckout(input);
  await providers.createHostedCheckout(input);
  assert.equal(result.checkoutUrl, 'https://sandbox.example.test/pay');
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.items[0].unit_price, 19.9);
  assert.equal(body.items[0].currency_id, 'BRL');
  assert.equal(body.external_reference, input.order.id);
  assert.equal(body.notification_url, `${input.origin}/api/order-payments/webhook/mercado-pago?account=fixture-account`);
  assert.equal(calls[0].options.headers['X-Idempotency-Key'], calls[1].options.headers['X-Idempotency-Key']);
});

test('Pagar.me: sandbox, valor inteiro e limite de uma sessão paga', async t => {
  const calls = mockFetch(t, { id: 'link', url: 'https://sandbox.example.test/pay' });
  await providers.createHostedCheckout({ ...input, provider: 'pagarme' });
  assert.equal(calls[0].url, 'https://sdx-api.pagar.me/core/v5/paymentlinks');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.cart_settings.items[0].amount, 1990);
  assert.equal(body.payment_settings.credit_card_settings.installments[0].total, 1990);
  assert.equal(body.max_paid_sessions, 1);
  assert.equal(body.order_code, input.order.id);
});

for (const environment of ['test', 'production']) {
  test(`Mercado Pago ${environment}: URL ausente, vazia ou não textual rejeitada`, async t => {
    for (const value of [undefined, null, '', '   ', 123, {}]) {
      const response = { id: 'fixture', init_point: value, sandbox_init_point: value };
      const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
      try {
        await assert.rejects(providers.createHostedCheckout({ ...input, environment }), /não retornou o link/);
      } finally {
        mocked.mock.restore();
      }
    }
  });
}

test('Mercado Pago: produção mantém init_point e sandbox mantém fallback existente', async t => {
  mockFetch(t, { id: 'fixture', init_point: 'https://checkout.example.test/pay' });
  for (const environment of ['test', 'production']) {
    const result = await providers.createHostedCheckout({ ...input, environment });
    assert.equal(result.checkoutUrl, 'https://checkout.example.test/pay');
  }
});

for (const provider of ['mercado_pago', 'pagarme']) {
  test(`${provider}: resposta incompleta rejeitada`, async t => {
    mockFetch(t, { id: 'missing-url' });
    await assert.rejects(providers.createHostedCheckout({ ...input, provider }), /não retornou o link/);
  });
  test(`${provider}: erro HTTP não vira checkout válido`, async t => {
    mockFetch(t, { message: 'Fixture gateway unavailable' }, 503);
    await assert.rejects(providers.createHostedCheckout({ ...input, provider }), /Fixture gateway unavailable/);
  });
}

test('consultas de confirmação codificam IDs e não usam cache', async t => {
  const calls = mockFetch(t, { status: 'pending' });
  await providers.fetchMercadoPagoPayment(input.credential, 'id/with?chars');
  await providers.fetchPagarmeOrder('test', input.credential, 'id/with?chars');
  assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/payments/id%2Fwith%3Fchars');
  assert.equal(calls[1].url, 'https://sdx-api.pagar.me/core/v5/orders/id%2Fwith%3Fchars');
  for (const call of calls) assert.equal(call.options.cache, 'no-store');
});

test('assinatura configurada: válida aceita; adulterada, ausente e incompleta rejeitadas', () => {
  const secret = 'fixture-secret';
  const signature = `ts=123,v1=${createHmac('sha256', secret).update('id:456;request-id:req;ts:123;').digest('hex')}`;
  const signed = { secret, signature, dataId: '456', requestId: 'req' };
  assert.equal(providers.verifyMercadoPagoSignature(signed), true);
  for (const change of [{ dataId: '457' }, { requestId: 'other' }, { signature: null }, { signature: 'ts=123,v1=bad' }, { requestId: null }]) {
    assert.equal(providers.verifyMercadoPagoSignature({ ...signed, ...change }), false);
  }
});

test('status desconhecido nunca é tratado como pagamento aprovado', () => {
  for (const value of ['approved', 'paid', 'PAID']) assert.equal(providers.normalizePaymentStatus(value), 'approved');
  for (const value of ['rejected', 'failed', 'declined', 'payment_failed']) assert.equal(providers.normalizePaymentStatus(value), 'declined');
  for (const value of ['refunded', 'chargedback']) assert.equal(providers.normalizePaymentStatus(value), 'refunded');
  for (const value of [null, undefined, '', 'unknown', 'processing']) assert.equal(providers.normalizePaymentStatus(value), 'pending');
});
