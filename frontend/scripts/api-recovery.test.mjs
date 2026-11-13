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
  const context = vm.createContext({
    fetch, URL, URLSearchParams, Headers, Response, AbortSignal, Event, Blob,
    crypto: webcrypto, atob, localStorage: storage, sessionStorage: storage,
    window: { dispatchEvent: event => events.push(event.type) },
    setTimeout: (callback, delay) => { waits.push(delay); queueMicrotask(callback); return 0; }, clearTimeout: () => {},
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
  assert.ok(requests.every(request => request.url === '/api/auth/me' && request.options.headers.get('Authorization') === 'Bearer synthetic-session'));
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
    return url === '/health' ? Response.json({ status: 'ok', service: 'OrderLedger Core API', apiVersion: 2, capabilities: { idempotentWrites: true } }) : Response.json({ templates: [] });
  });
  assert.equal(await api.testConnection('https://orderledger-api.onrender.com/api'), true);
  assert.deepEqual(urls, ['/health', '/health', '/api/auth/templates']);
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
