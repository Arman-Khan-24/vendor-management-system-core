import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

// Execute the actual client and its dependencies with synthetic HTTP responses.
// No server, credentials, browser, or production records are used.
async function client(fetch) {
  const values = new Map([['orderledger_token', 'synthetic-session']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const waits = [], events = [], modules = new Map();
  let now = Date.now();
  const context = vm.createContext({
    fetch, URL, URLSearchParams, Headers, Response, AbortSignal, Event, Blob, TextEncoder,
    Date: class extends Date { static now() { return now; } },
    crypto: webcrypto, atob, localStorage: storage, sessionStorage: storage,
    window: { dispatchEvent: event => events.push(event.type) },
    setTimeout: (callback, delay) => { waits.push(delay); now += delay; queueMicrotask(callback); return 0; }, clearTimeout: () => {},
  });
  async function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const source = await readFile(url, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const module = new vm.SourceTextModule(compiled, { context, identifier: url.href, initializeImportMeta: meta => { meta.env = { VITE_PROXY_API_URL: 'https://orderledger-api.onrender.com' }; } });
    modules.set(url.href, module);
    await module.link((specifier, parent) => load(new URL(specifier + '.ts', parent.identifier)));
    return module;
  }
  const module = await load(new URL('../src/api/client.ts', import.meta.url));
  await module.evaluate();
  return { api: module.namespace.ApiClient, waits, events, storage };
}

test('session reads recover from startup and rate limiting within one timeout', async () => {
  const requests = [];
  const { api, waits, storage } = await client(async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return new Response('Starting', { status: 503 });
    if (requests.length === 2) return new Response('Busy', { status: 429, headers: { 'Retry-After': '2' } });
    return Response.json({ user: { id: 'synthetic-user' }, business: { id: 'synthetic-business' } });
  });
  assert.equal((await api.getMe()).user.id, 'synthetic-user');
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(new Set(requests.map(request => request.options.signal)).size, 1);
  assert.ok(requests.every(request => request.url === 'https://orderledger-api.onrender.com/api/auth/me' && request.options.headers.get('Authorization') === 'Bearer synthetic-session'));
  assert.equal(storage.getItem('orderledger_token'), 'synthetic-session');
});

test('long Retry-After is returned to the user without retrying early', async () => {
  let calls = 0;
  const { api, waits } = await client(async () => { calls++; return new Response('Busy', { status: 429, headers: { 'Retry-After': '120' } }); });
  await assert.rejects(() => api.getTemplates(), error => error.status === 429 && /No API key/.test(error.message));
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('connection tests recover using the configured website server', async () => {
  const urls = [];
  const { api } = await client(async url => {
    urls.push(url);
    if (urls.length === 1) return new Response('Starting', { status: 502 });
    return url.endsWith('/health') ? Response.json({ status: 'ok', service: 'OrderLedger Core API', apiVersion: 2, capabilities: { idempotentWrites: true } }) : Response.json({ templates: [] });
  });
  assert.equal(await api.testConnection('https://orderledger-api.onrender.com/api'), true);
  assert.deepEqual(urls, ['https://orderledger-api.onrender.com/health', 'https://orderledger-api.onrender.com/health', 'https://orderledger-api.onrender.com/api/auth/templates']);
});

test('customer creation and settings saves are never automatically replayed', async () => {
  const requests = [];
  const { api, waits } = await client(async (url, options) => { requests.push({ url, options }); return new Response('Starting', { status: 503 }); });
  await assert.rejects(() => api.createCustomer({ name: 'QA Cafe', phone: '9876543210', creditTermsDays: 7 }), error => error.status === 503);
  await assert.rejects(() => api.updateBusiness({ name: 'QA Business' }), error => error.status === 503);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(request => request.options.method), ['POST', 'PATCH']);
  assert.deepEqual(waits, []);
});

test('persistent startup failure is bounded and keeps the session', async () => {
  let calls = 0;
  const { api, waits, storage } = await client(async () => { calls++; return new Response('Starting', { status: 504 }); });
  await assert.rejects(() => api.getMe(), error => error.status === 504 && /temporarily unavailable/.test(error.message));
  assert.equal(calls, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(storage.getItem('orderledger_token'), 'synthetic-session');
});

test('authentication errors are not retried and sign out the expired session', async () => {
  let calls = 0;
  const { api, waits, storage, events } = await client(async () => { calls++; return Response.json({ error: 'Session expired' }, { status: 401 }); });
  await assert.rejects(() => api.getProducts(), error => error.status === 401);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  assert.equal(storage.getItem('orderledger_token'), null);
  assert.deepEqual(events, ['orderledger:unauthorized']);
});

const ready = () => Response.json({ status: 'ok', service: 'OrderLedger Core API', apiVersion: 2, capabilities: { idempotentWrites: true } });
const session = () => 'synthetic.' + Buffer.from(JSON.stringify({ userId: 'qa-user', businessId: 'qa-business' })).toString('base64url') + '.synthetic';
const payment = { customerId: 'qa-customer', amount: 300, mode: 'upi' };

test('payment readiness survives a startup longer than the old seven-second retry window', async () => {
  const requests = [];
  let probes = 0;
  const { api, storage, waits } = await client(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/health')) return ++probes <= 5 ? new Response('Too Many Requests', { status: 429 }) : ready();
    return Response.json({ id: 'qa-payment', amount: 300 });
  });
  const token = session();
  storage.setItem('orderledger_token', token);
  assert.equal((await api.recordPayment(payment)).id, 'qa-payment');
  assert.equal(probes, 6);
  assert.deepEqual(waits, [1000, 2000, 4000, 5000, 5000]);
  const writes = requests.filter(request => request.options.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, 'https://orderledger-api.onrender.com/api/payments');
  assert.deepEqual(JSON.parse(writes[0].options.body), payment);
  assert.match(writes[0].options.headers.get('Idempotency-Key'), /^[a-f0-9-]{36}$/);
  assert.equal(new Set(requests.filter(request => request.url.endsWith('/health')).map(request => request.options.signal)).size, 1);
  assert.equal(storage.getItem('orderledger_token'), token);
});

test('a database that stays unavailable uses a bounded startup wait and never receives a payment', async () => {
  const requests = [];
  const { api, storage, waits } = await client(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ status: 'unavailable', service: 'OrderLedger Core API' }, { status: 503 });
  });
  storage.setItem('orderledger_token', session());
  await assert.rejects(() => api.recordPayment(payment), error => error.status === 503 && /has not been sent/.test(error.message));
  assert.ok(requests.length > 4);
  assert.ok(waits.reduce((sum, delay) => sum + delay, 0) >= 60000);
  assert.ok(waits.reduce((sum, delay) => sum + delay, 0) < 65000);
  assert.equal(requests.filter(request => request.options.method === 'POST').length, 0);
});

test('an unconfirmed payment is not automatically replayed and manual retry keeps the same key', async () => {
  const keys = [];
  const { api, storage } = await client(async (url, options) => {
    if (url.endsWith('/health')) return ready();
    keys.push(options.headers.get('Idempotency-Key'));
    if (keys.length === 1) throw new Error('Connection lost after sending');
    return Response.json({ id: 'qa-payment' });
  });
  storage.setItem('orderledger_token', session());
  await assert.rejects(() => api.recordPayment(payment), error => error.status === 0 && /unconfirmed/.test(error.message));
  assert.equal(keys.length, 1);
  assert.equal((await api.recordPayment(payment)).id, 'qa-payment');
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test('direct transport preserves a retry key created by the earlier website proxy version', async () => {
  let sentKey;
  const { api, storage } = await client(async (url, options) => {
    if (url.endsWith('/health')) return ready();
    sentKey = options.headers.get('Idempotency-Key');
    return Response.json({ id: 'qa-payment' });
  });
  storage.setItem('orderledger_token', session());
  const oldScope = JSON.stringify(['/api', 'qa-business', 'qa-user', '/payments']);
  const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([oldScope, payment])));
  const storageKey = 'orderledger_write_' + Buffer.from(hash).toString('hex');
  const oldKey = webcrypto.randomUUID();
  storage.setItem(storageKey, oldKey);
  assert.equal((await api.recordPayment(payment)).id, 'qa-payment');
  assert.equal(sentKey, oldKey);
  assert.equal(storage.getItem(storageKey), null);
});

test('the default direct server preserves login and custom servers still use their own address', async () => {
  const { api, storage, events } = await client(async () => ready());
  api.setConnection('https://orderledger-api.onrender.com/api');
  assert.equal(api.getBase(), 'https://orderledger-api.onrender.com/api');
  assert.equal(storage.getItem('orderledger_token'), 'synthetic-session');
  assert.deepEqual(events, []);
  api.setConnection('http://127.0.0.1:5100');
  assert.equal(api.getBase(), 'http://127.0.0.1:5100/api');
  assert.equal(storage.getItem('orderledger_token'), null);
});
