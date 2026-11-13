import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { config } from '../config/env.js';
import { pool } from '../database/connection.js';
import { encryptSecret } from '../services/business-settings.service.js';
import { OrderImportService } from '../services/order-import.service.js';
import { requestInProcess } from './helpers/http.js';

const businessId = '10000000-0000-4000-8000-000000000001';
const catalog = [{ id: '10000000-0000-4000-8000-000000000002', name: 'Tomato', unit: 'kg', current_price: '40' }];
async function extraction(items: unknown[], run: (requests: string[]) => Promise<void>) {
  const originalQuery = pool.query, originalFetch = globalThis.fetch;
  const requests: string[] = [];
  (pool as any).query = async (sql: string, params: unknown[]) => {
    assert.equal(params[0], businessId);
    if (sql.includes('FROM products')) return { rows: catalog };
    assert.match(sql, /FROM business_connections/);
    return { rows: [{ slot: 'primary', provider: 'gemini', model: 'synthetic-model', endpoint: 'https://generativelanguage.googleapis.com/v1beta', api_key_encrypted: encryptSecret('synthetic-key', businessId, 'primary') }] };
  };
  globalThis.fetch = async (_url, init) => {
    requests.push(String(init?.body));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items, warnings: [] }) }] } }] });
  };
  try { await run(requests); } finally { pool.query = originalQuery; globalThis.fetch = originalFetch; }
}

test('text import uses the tenant catalog and saved AI, converts units and combines lines', async () => {
  await extraction([{ product: 'Tomato', quantity: 500, unit: 'g' }, { product: 'Tomato', quantity: 1, unit: 'kg' }], async requests => {
    const draft = await OrderImportService.extract(businessId, { text: 'Tomato 500g and another 1kg' });
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].quantity, 1.5);
    assert.equal(draft.items[0].productId, catalog[0].id);
    assert.match(requests[0], /Tomato 500g/);
  });
});

test('unknown, incompatible and excessive combined quantities remain visible for review', async () => {
  await extraction([{ product: 'Tomato', quantity: 99999999, unit: 'kg' }, { product: 'Tomato', quantity: 2, unit: 'kg' }, { product: 'Tomato', quantity: 1, unit: 'box' }, { product: 'Unknown', quantity: 2, unit: 'kg' }], async () => {
    const draft = await OrderImportService.extract(businessId, { text: 'Uncertain order' });
    assert.equal(draft.items.length, 4);
    assert.equal(draft.items.filter(item => item.quantity === null).length, 3);
    assert.ok(draft.warnings.some(warning => warning.includes('too large')));
    assert.ok(draft.items.some(item => item.inputProduct === 'Unknown'));
  });
});

test('provider quota rejection remains a 429 without replaying extraction', async () => {
  await extraction([], async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({}, { status: 429 }); };
    await assert.rejects(() => OrderImportService.extract(businessId, { text: 'Tomato 2 kg' }), (error: any) => {
      assert.equal(error.statusCode, 429);
      assert.match(error.message, /rate or quota limit/);
      assert.doesNotMatch(error.message, /synthetic-key/);
      return true;
    });
    assert.equal(calls, 1);
  });
});

test('photo import forwards bytes and caption; invalid photos and empty extraction fail clearly', async () => {
  await extraction([{ product: 'Tomato', quantity: 2, unit: 'kg' }], async requests => {
    const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64');
    await OrderImportService.extract(businessId, { text: 'Use final quantities', image: { data, mimeType: 'image/png' } });
    assert.match(requests[0], /Use final quantities/);
    assert.equal(JSON.parse(requests[0]).contents[0].parts[2].inline_data.data, data);
    await assert.rejects(() => OrderImportService.extract(businessId, { text: '', image: { data: 'AAAA', mimeType: 'image/png' } }), /valid JPEG or PNG/);
    assert.equal(requests.length, 1);
  });
  await extraction([], async () => {
    await assert.rejects(() => OrderImportService.extract(businessId, { text: 'Hello' }), /No order items/);
  });
});

test('import route authenticates and validates before extraction, without creating a ledger order', async () => {
  const original = OrderImportService.extract;
  let calls = 0;
  OrderImportService.extract = async (id, input) => {
    assert.equal(id, businessId); assert.equal(input.text, 'Tomato 2 kg'); calls++;
    return { items: [{ productId: catalog[0].id, quantity: 2, inputProduct: 'Tomato', inputQuantity: 2, inputUnit: 'kg' }], warnings: [], provider: 'gemini', model: 'synthetic', wasFallback: false };
  };
  const send = (role: string, body: unknown) => requestInProcess(createApp(), 'POST', '/api/orders/extract', JSON.stringify(body), { authorization: 'Bearer ' + jwt.sign({ userId: 'test', businessId, role }, config.jwtSecret) });
  try {
    assert.equal((await requestInProcess(createApp(), 'POST', '/api/orders/extract', '{}')).status, 401);
    assert.equal((await send('DELIVERY', { text: 'Tomato 2 kg' })).status, 403);
    assert.equal((await send('STAFF', {})).status, 400);
    assert.equal((await send('STAFF', { text: 'Tomato 2 kg', businessId: 'another' })).status, 400);
    assert.equal((await send('STAFF', { text: 'Tomato 2 kg' })).status, 200);
    assert.equal(calls, 1);
  } finally { OrderImportService.extract = original; }
});
