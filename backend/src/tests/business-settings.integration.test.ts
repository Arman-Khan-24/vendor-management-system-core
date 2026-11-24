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
      billing: { invoicePrefix: 'ML', defaultCreditTermsDays: 14, taxRate: 5, paymentMethods: ['upi', 'cash'], upiId: 'qa@orderledger', upiPayeeName: 'QA Merchant' }
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
  assert.equal(loaded.data.settings.billing.upiId, 'qa@orderledger');
  assert.equal(loaded.data.settings.billing.upiPayeeName, 'QA Merchant');

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
    primary: { provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'business-model', apiKey: 'test-secret-for-integration' },
    fallback: { provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'fallback-model' }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.primary.hasApiKey, true);
  assert.equal(saved.data.fallback.hasApiKey, false);
  assert.deepEqual(Object.keys(saved.data.primary).sort(), ['endpoint', 'hasApiKey', 'model', 'provider', 'source']);
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
  assert.equal(otherConnections.data.primary.provider, 'gemini');
  assert.equal(otherConnections.data.primary.model, 'gemini-2.5-flash');

  const invalid = await request(owner.token, '/api/business/connections', { primary: { endpoint: 'https://ai.example.test/v1?key=hidden' } });
  assert.equal(invalid.status, 400);
  const cleared = await request(owner.token, '/api/business/connections', { primary: { apiKey: '' } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.primary.hasApiKey, false);
  const removed = await pool.query('SELECT api_key_encrypted FROM business_connections WHERE business_id = $1 AND slot = $2', [owner.business.id, 'primary']);
  assert.equal(removed.rows[0].api_key_encrypted, null);

  const reset = await request(owner.token, '/api/business/connections', { primary: null });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.primary.model, 'gemini-2.5-flash');
  const afterReset = await pool.query('SELECT 1 FROM business_connections WHERE business_id = $1 AND slot = $2', [owner.business.id, 'primary']);
  assert.equal(afterReset.rowCount, 0);
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

test('a historical payment without an order still locks the business currency', async () => {
  const owner = await registerTenant('currency-payments');
  const customer = await request(owner.token, '/api/customers', { name: 'Advance customer', phone: '9000000002' }, 'POST');
  assert.equal(customer.status, 201);
  await pool.query('INSERT INTO payments (business_id, customer_id, amount, mode) VALUES ($1, $2, 100, $3)', [owner.business.id, customer.data.id, 'cash']);
  const rejected = await request(owner.token, '/api/business', { currency: 'USD' });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
});

test('shared AI reservations enforce tenant and global caps atomically', async () => {
  const { reserveSharedAiRequest } = await import('../services/ai/shared-ai-budget.js');
  const first = await registerTenant('quota-first');
  const second = await registerTenant('quota-second');
  const settled = await Promise.allSettled(Array.from({ length: 32 }, () => reserveSharedAiRequest(first.business.id)));
  assert.equal(settled.filter(result => result.status === 'fulfilled').length, 30);
  const counters = await pool.query('SELECT requests FROM shared_ai_usage WHERE scope = $1', ['global']);
  assert.equal(counters.rows[0].requests, 30);
  await reserveSharedAiRequest(second.business.id);
  await pool.query('UPDATE shared_ai_usage SET requests = 300 WHERE scope = $1', ['global']);
  await assert.rejects(reserveSharedAiRequest(second.business.id), /SHARED_AI_QUOTA_EXCEEDED/);
  await pool.query('DELETE FROM shared_ai_usage');
});

test('issued sessions recheck membership and reject revoked tokens', async () => {
  const owner = await registerTenant('revocable-session');
  assert.equal((await request(owner.token, '/api/business/connections')).status, 200);
  await pool.query("UPDATE users SET role = 'STAFF' WHERE id = $1", [owner.user.id]);
  assert.equal((await request(owner.token, '/api/business/connections')).status, 403);

  const loggedOut = await fetch(base + '/api/auth/logout', {
    method: 'POST', headers: { Authorization: 'Bearer ' + owner.token },
  });
  assert.equal(loggedOut.status, 204);
  assert.equal((await request(owner.token, '/api/auth/me')).status, 401);
});

test('browser sessions use guarded HttpOnly cookies and revoke on logout', async () => {
  const { config } = await import('../config/env.js');
  const browserHeaders = {
    'Content-Type': 'application/json',
    Origin: new URL(config.publicAppUrl).origin,
    'X-OrderLedger-Session': 'cookie',
  };
  const body = JSON.stringify({
    businessName: 'Cookie test', businessSlug: 'cookie-test', categoryTemplate: 'custom',
    ownerName: 'Owner', email: 'cookie@example.test', password: 'isolated-password',
  });
  const rejected = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { ...browserHeaders, Origin: 'https://foreign.example' }, body,
  });
  assert.equal(rejected.status, 403);
  const registered = await fetch(base + '/api/auth/register', { method: 'POST', headers: browserHeaders, body });
  assert.equal(registered.status, 201);
  assert.equal('token' in await registered.json(), false);
  const setCookie = registered.headers.get('set-cookie')!;
  assert.match(setCookie, /^__Host-orderledger_session=/);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(attribute));
  const Cookie = setCookie.split(';')[0];
  const me = () => fetch(base + '/api/auth/me', { headers: { Cookie } });
  assert.equal((await me()).status, 200);
  const createCustomer = (headers: Record<string, string>) => fetch(base + '/api/customers', {
    method: 'POST', headers: { ...browserHeaders, Cookie, ...headers },
    body: JSON.stringify({ name: 'Cookie customer', phone: '9000010011' }),
  });
  assert.equal((await createCustomer({ Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await createCustomer({ 'X-OrderLedger-Identity': 'different-workspace:other-user' })).status, 401);
  assert.equal((await createCustomer({})).status, 201);
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie } })).status, 403);
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...browserHeaders, Cookie } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /^__Host-orderledger_session=;/);
  assert.equal((await me()).status, 401);
});

test('customer search preserves quoted names as literal data and stays tenant scoped', async () => {
  const first = await registerTenant('quoted-first');
  const second = await registerTenant('quoted-second');
  const name = "O'Brien's Market";
  for (const tenant of [first, second]) {
    assert.equal((await request(tenant.token, '/api/customers', { name, phone: '9000010010' }, 'POST')).status, 201);
  }
  const results = await request(first.token, '/api/customers?search=' + encodeURIComponent("O'Brien"));
  assert.equal(results.status, 200);
  assert.equal(results.data.length, 1);
  assert.equal(results.data[0].name, name);
});

test('AI credential migration preserves saved keys and is idempotent', async t => {
  const owner = await registerTenant('ai-credential-migration');
  const saved = await request(owner.token, '/api/business/connections', {
    primary: { model: 'gemini-2.5-flash', apiKey: 'synthetic-ai-key' },
  });
  assert.equal(saved.status, 200);
  const originalKey = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  process.env.AI_PROVIDER_ENCRYPTION_KEY = '1'.repeat(64);
  t.after(() => {
    if (originalKey === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
    else process.env.AI_PROVIDER_ENCRYPTION_KEY = originalKey;
  });
  const { migrateAiCredentials } = await import('../database/migrate-ai-credentials.js');
  const { decryptSecret } = await import('../services/business-settings.service.js');
  assert.equal(await migrateAiCredentials(), 1);
  assert.equal(await migrateAiCredentials(), 0);
  const stored = await pool.query('SELECT api_key_encrypted FROM business_connections WHERE business_id = $1', [owner.business.id]);
  assert.match(stored.rows[0].api_key_encrypted, /^v3\./);
  assert.equal(decryptSecret(stored.rows[0].api_key_encrypted, owner.business.id, 'primary'), 'synthetic-ai-key');
});
