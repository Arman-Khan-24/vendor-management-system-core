import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/upi.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { upiPaymentLink } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const payment = { upiId: 'merchant@orderledger', payeeName: 'Merchant QA', amount: 300, reference: 'INV-0001' };

test('UPI link carries the exact merchant, INR amount and bill reference', () => {
  const url = new URL(upiPaymentLink(payment));
  assert.equal(url.protocol, 'upi:');
  assert.equal(url.hostname, 'pay');
  assert.equal(url.searchParams.get('pa'), payment.upiId);
  assert.equal(url.searchParams.get('pn'), payment.payeeName);
  assert.equal(url.searchParams.get('am'), '300.00');
  assert.equal(url.searchParams.get('cu'), 'INR');
  assert.equal(url.searchParams.get('tn'), 'INV-0001');
});
test('customer notes and names cannot override receiver or amount parameters', () => {
  const url = new URL(upiPaymentLink({ ...payment, payeeName: 'Shop & pa=wrong@bank', reference: 'INV-0001 &am=1&pa=wrong@bank' }));
  assert.deepEqual(url.searchParams.getAll('pa'), [payment.upiId]);
  assert.deepEqual(url.searchParams.getAll('am'), ['300.00']);
});
test('decimal balances retain cents and invalid payment amounts are rejected', () => {
  assert.equal(new URL(upiPaymentLink({ ...payment, amount: 199.95 })).searchParams.get('am'), '199.95');
  for (const amount of [0, -1, NaN, Infinity, 1.001]) assert.throws(() => upiPaymentLink({ ...payment, amount }));
});
test('an invalid or embedded payment URL is not accepted as a merchant UPI ID', () => {
  for (const upiId of ['', 'not-a-vpa', 'upi://pay?pa=shop@bank', 'shop@bank&am=1']) assert.throws(() => upiPaymentLink({ ...payment, upiId }));
});
