import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { startIsolatedPostgres } from './helpers/isolated-postgres.js';

let database: Awaited<ReturnType<typeof startIsolatedPostgres>>;
let server: Server;
let base: string;
let pool: typeof import('../database/connection.js').pool;

async function request(token: string | undefined, path: string, body?: unknown, method = body === undefined ? 'GET' : 'PATCH') {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json() as Record<string, any>;
  return { status: response.status, data };
}

async function registerTenant(slug: string) {
  const registered = await request(undefined, '/api/auth/register', {
    businessName: `Test ${slug}`, businessSlug: slug, categoryTemplate: 'custom',
    ownerName: 'Settings Owner', email: `${slug}@example.test`, password: 'isolated-password'
  }, 'POST');
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  return registered.data;
}

before(async () => {
  database = await startIsolatedPostgres();
  const { runMigrations } = await import('../database/migrator.js');
  const { createApp } = await import('../app.js');
  ({ pool } = await import('../database/connection.js'));
  await runMigrations();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  if (server) await new Promise<void>(done => server.close(() => done()));
  if (pool) await pool.end();
  if (database) await database.stop();
});

test('business settings persist through partial PATCH requests and cannot change another tenant', async () => {
  const owner = await registerTenant('settings-main');
  const other = await registerTenant('settings-other');
  const initial = await request(owner.token, '/api/business');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.settings.branding.accent, 'sage');
  assert.equal(initial.data.settings.billing.taxRate, 0);

  const saved = await request(owner.token, '/api/business', {
    name: 'Meadow Supply', phone: '9876543210', logoUrl: 'https://example.com/logo.png',
    invoiceTrigger: 'Packed', categoryTemplate: 'dairy',
    settings: {
      branding: { appName: 'Meadow Ledger', accent: 'lavender' },
      profile: { address: 'Nagpur', email: 'hello@example.test' },
      catalog: { defaultUnit: 'litre', categories: ['Milk', 'Eggs'] },
      billing: { invoicePrefix: 'ML', defaultCreditTermsDays: 14, taxRate: 5, paymentMethods: ['upi', 'cash'] }
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.invoice_trigger, 'Packed');
  assert.equal(saved.data.category_template, 'dairy');
  assert.equal(saved.data.logo_url, 'https://example.com/logo.png');
  const changed = await request(owner.token, '/api/business', { settings: { branding: { theme: 'dark' } } });
  assert.equal(changed.status, 200);
  const loaded = await request(owner.token, '/api/business');
  assert.equal(loaded.data.settings.branding.appName, 'Meadow Ledger');
  assert.equal(loaded.data.settings.branding.accent, 'lavender');
  assert.equal(loaded.data.settings.branding.theme, 'dark');
  assert.equal(loaded.data.settings.profile.address, 'Nagpur');
  assert.equal(loaded.data.settings.billing.taxRate, 5);
  assert.equal(loaded.data.settings.billing.defaultCreditTermsDays, 14);

  const invalid = await request(owner.token, '/api/business', { settings: { catalog: { units: ['piece'] } } });
  assert.equal(invalid.status, 400);
  const unchanged = await request(owner.token, '/api/business');
  assert.equal(unchanged.data.settings.catalog.defaultUnit, 'litre');

  const injection = await request(owner.token, '/api/business', { businessId: other.business.id, name: 'Wrong tenant' });
  assert.equal(injection.status, 400);
  const otherSettings = await request(other.token, '/api/business');
  assert.equal(otherSettings.data.name, 'Test settings-other');
  assert.equal(otherSettings.data.settings.branding.appName, 'OrderLedger');
  assert.equal(otherSettings.data.settings.billing.taxRate, 0);
});

test('provider keys stay encrypted, tenant-scoped and unchanged unless explicitly replaced or cleared', async () => {
  const owner = await registerTenant('connections-main');
  const other = await registerTenant('connections-other');
  const saved = await request(owner.token, '/api/business/connections', {
    primary: { provider: 'custom', endpoint: 'https://ai.example.test/v1', model: 'business-model', apiKey: 'test-secret-for-integration' },
    fallback: { provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'fallback-model' }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.primary.hasApiKey, true);
  assert.equal(saved.data.fallback.hasApiKey, false);
  assert.deepEqual(Object.keys(saved.data.primary).sort(), ['endpoint', 'hasApiKey', 'model', 'provider']);
  assert.equal(JSON.stringify(saved.data).includes('test-secret-for-integration'), false);

  const stored = await pool.query('SELECT api_key_encrypted FROM business_connections WHERE business_id = $1 AND slot = $2', [owner.business.id, 'primary']);
  const ciphertext = stored.rows[0].api_key_encrypted;
  assert.equal(typeof ciphertext, 'string');
  assert.equal(ciphertext.startsWith('v1.'), true);
  assert.equal(ciphertext.includes('test-secret-for-integration'), false);

  const changed = await request(owner.token, '/api/business/connections', { primary: { model: 'updated-model' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.primary.hasApiKey, true);
  const preserved = await pool.query('SELECT api_key_encrypted FROM business_connections WHERE business_id = $1 AND slot = $2', [owner.business.id, 'primary']);
  assert.equal(preserved.rows[0].api_key_encrypted, ciphertext);
  const loaded = await request(owner.token, '/api/business/connections');
  assert.equal(loaded.data.primary.model, 'updated-model');
  assert.equal(loaded.data.primary.hasApiKey, true);
  const publicSettings = await request(owner.token, '/api/business');
  assert.equal(JSON.stringify(publicSettings.data).includes('test-secret-for-integration'), false);
  assert.equal('connections' in publicSettings.data, false);

  const otherConnections = await request(other.token, '/api/business/connections');
  assert.equal(otherConnections.data.primary.hasApiKey, false);
  assert.equal(otherConnections.data.primary.provider, 'openai');
  assert.equal(otherConnections.data.primary.model, '');

  const invalid = await request(owner.token, '/api/business/connections', { primary: { endpoint: 'https://ai.example.test/v1?key=hidden' } });
  assert.equal(invalid.status, 400);
  const cleared = await request(owner.token, '/api/business/connections', { primary: { apiKey: '' } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.primary.hasApiKey, false);
  const removed = await pool.query('SELECT api_key_encrypted FROM business_connections WHERE business_id = $1 AND slot = $2', [owner.business.id, 'primary']);
  assert.equal(removed.rows[0].api_key_encrypted, null);
});

test('currency can change before trading and is locked once an order exists', async () => {
  const owner = await registerTenant('currency-orders');
  const changed = await request(owner.token, '/api/business', { currency: 'usd' });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.currency, 'USD');
  const customer = await request(owner.token, '/api/customers', { name: 'Cafe', phone: '9000000001' }, 'POST');
  const product = await request(owner.token, '/api/products', { name: 'Rice', unit: 'kg', currentPrice: 25 }, 'POST');
  assert.equal(customer.status, 201, JSON.stringify(customer.data));
  assert.equal(product.status, 201, JSON.stringify(product.data));
  const order = await request(owner.token, '/api/orders', { customerId: customer.data.id, items: [{ productId: product.data.id, quantity: 1 }] }, 'POST');
  assert.equal(order.status, 201, JSON.stringify(order.data));
  const rejected = await request(owner.token, '/api/business', { currency: 'INR', name: 'Should roll back' });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
  const loaded = await request(owner.token, '/api/business');
  assert.equal(loaded.data.currency, 'USD');
  assert.equal(loaded.data.name, 'Test currency-orders');
  const allowed = await request(owner.token, '/api/business', { currency: 'USD', phone: '9000000099' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.phone, '9000000099');
});

test('a payment without an order also locks the business currency', async () => {
  const owner = await registerTenant('currency-payments');
  const customer = await request(owner.token, '/api/customers', { name: 'Advance customer', phone: '9000000002' }, 'POST');
  assert.equal(customer.status, 201);
  const payment = await request(owner.token, '/api/payments', { customerId: customer.data.id, amount: 100, mode: 'cash' }, 'POST');
  assert.equal(payment.status, 201, JSON.stringify(payment.data));
  const rejected = await request(owner.token, '/api/business', { currency: 'USD' });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
});
