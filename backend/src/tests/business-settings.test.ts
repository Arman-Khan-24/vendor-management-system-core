import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import businessRoutes from '../routes/business.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import {
  DEFAULT_BUSINESS_SETTINGS, encryptConnectionKey, mergeBusinessSettings,
  normalizeBusinessConnections, normalizeBusinessSettings
} from '../services/business-settings.service.js';
import {
  updateBusinessConnectionsSchema, updateBusinessSettingsSchema
} from '../validators/business-settings.schemas.js';

test('legacy tenants receive independent defaults and public configuration contains only supported fields', () => {
  const first = normalizeBusinessSettings(null);
  const second = normalizeBusinessSettings({});
  assert.deepEqual(first, DEFAULT_BUSINESS_SETTINGS);
  first.catalog.units.push('carton');
  assert.equal(second.catalog.units.includes('carton'), false);
  assert.equal(DEFAULT_BUSINESS_SETTINGS.catalog.units.includes('carton'), false);
  assert.equal(JSON.stringify(normalizeBusinessSettings({ apiKey: 'private-value' })).includes('private-value'), false);
});

test('partial blueprint updates preserve other settings and enforce the default-unit relationship', () => {
  const initial = mergeBusinessSettings({}, {
    branding: { appName: 'Meadow Supply', accent: 'lavender' },
    profile: { address: 'Nagpur' },
    billing: { taxRate: 5, paymentMethods: ['upi'], defaultCreditTermsDays: 14 }
  });
  const updated = mergeBusinessSettings(initial, { branding: { theme: 'dark' }, billing: { invoicePrefix: 'ms' } });
  assert.equal(updated.branding.appName, 'Meadow Supply');
  assert.equal(updated.branding.accent, 'lavender');
  assert.equal(updated.branding.theme, 'dark');
  assert.equal(updated.profile.address, 'Nagpur');
  assert.equal(updated.billing.invoicePrefix, 'MS');
  assert.equal(updated.billing.taxRate, 5);
  assert.deepEqual(updated.billing.paymentMethods, ['upi']);
  assert.equal(updated.billing.defaultCreditTermsDays, 14);
  assert.throws(() => mergeBusinessSettings(initial, { catalog: { units: ['piece'] } }), /Default unit must be included/);
  assert.equal(mergeBusinessSettings(initial, { catalog: { units: ['piece'], defaultUnit: 'piece' } }).catalog.defaultUnit, 'piece');
});

test('business settings reject unknown fields and invalid operational values', () => {
  for (const input of [
    { invoice_trigger: 'Packed' },
    { settings: { branding: { accent: 'neon' } } },
    { settings: { billing: { taxRate: 101 } } },
    { settings: { billing: { taxRate: 5.001 } } },
    { settings: { billing: { defaultCreditTermsDays: -1 } } },
    { settings: { billing: { paymentMethods: [] } } },
    { settings: { billing: { paymentMethods: ['cash', 'cash'] } } },
    { settings: { catalog: { units: ['kg', 'KG'] } } },
    { settings: { modules: { whatsapp: true } } },
    { settings: { apiKey: 'private-value' } },
    { logoUrl: 'javascript:alert(1)' },
    { currency: 'rupees' }
  ]) {
    assert.equal(updateBusinessSettingsSchema.safeParse(input).success, false);
  }
  assert.deepEqual(updateBusinessSettingsSchema.parse({ currency: ' inr ', invoiceTrigger: 'Packed', logoUrl: '' }), {
    currency: 'INR', invoiceTrigger: 'Packed', logoUrl: ''
  });
});

test('provider endpoints reject embedded credentials and secrets in query or fragment', () => {
  for (const endpoint of [
    'https://user:password@api.example.com/v1',
    'https://api.example.com/v1?key=private',
    'https://api.example.com/v1#private',
    'https://api.example.com/v1?',
    'https://api.example.com/v1#',
    'file:///etc/passwd', 'ftp://api.example.com', 'not-a-url'
  ]) {
    assert.equal(updateBusinessConnectionsSchema.safeParse({ primary: { endpoint } }).success, false);
  }
  assert.equal(updateBusinessConnectionsSchema.safeParse({ primary: { endpoint: 'http://127.0.0.1:11434/v1', provider: 'custom' } }).success, true);
  assert.equal(updateBusinessConnectionsSchema.safeParse({ fallback: { endpoint: '', model: '', apiKey: '' } }).success, true);
  assert.equal(updateBusinessConnectionsSchema.safeParse({ primary: { hasApiKey: true } }).success, false);
  assert.equal(updateBusinessConnectionsSchema.safeParse({ primary: { provider: 'unsupported-provider' } }).success, false);
});

test('connection summaries omit credentials and defaults make no active model claim', () => {
  const row = { slot: 'primary' as const, provider: 'custom' as const, endpoint: 'https://ai.example.com/v1', model: 'tenant-model', has_api_key: true, api_key_encrypted: 'must-not-leak' };
  const connections = normalizeBusinessConnections([row]);
  assert.equal(connections.primary.hasApiKey, true);
  assert.equal(connections.primary.model, 'tenant-model');
  assert.equal(connections.fallback.hasApiKey, false);
  assert.equal(connections.fallback.model, '');
  assert.equal(JSON.stringify(connections).includes('must-not-leak'), false);
  assert.deepEqual(Object.keys(connections.primary).sort(), ['endpoint', 'hasApiKey', 'model', 'provider']);
});

test('stored provider keys use randomized authenticated encryption bound to tenant and slot', () => {
  const tenant = 'tenant-a';
  const secret = 'test-provider-key';
  const first = encryptConnectionKey(secret, tenant, 'primary')!;
  const second = encryptConnectionKey(secret, tenant, 'primary')!;
  assert.notEqual(first, second);
  assert.equal(first.includes(secret), false);
  assert.equal(encryptConnectionKey('', tenant, 'primary'), null);

  const [version, iv, tag, ciphertext] = first.split('.');
  assert.equal(version, 'v1');
  const key = createHash('sha256').update('orderledger:provider-connections:v1\0').update(config.jwtSecret).digest();
  const decrypt = (businessId: string, slot: string) => {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${businessId}:${slot}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  };
  assert.equal(decrypt(tenant, 'primary'), secret);
  assert.throws(() => decrypt('tenant-b', 'primary'));
  assert.throws(() => decrypt(tenant, 'fallback'));
});

test('settings routes require owner authorization and validate before database access', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/business', businessRoutes);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/business`;
  const tokenFor = (role: string) => jwt.sign({ userId: 'user', businessId: 'tenant', role }, config.jwtSecret);
  try {
    for (const role of ['STAFF', 'DELIVERY']) {
      for (const [method, path, body] of [
        ['PATCH', '', { invoiceTrigger: 'Packed' }],
        ['GET', '/connections', undefined],
        ['PATCH', '/connections', { primary: { apiKey: 'test-key' } }]
      ] as const) {
        const response = await fetch(`${baseUrl}${path}`, {
          method, headers: { Authorization: `Bearer ${tokenFor(role)}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        assert.equal(response.status, 403, `${role} ${method} ${path}`);
      }
    }
    const unauthenticated = await fetch(`${baseUrl}/connections`);
    assert.equal(unauthenticated.status, 401);
    const invalid = await fetch(`${baseUrl}/connections`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tokenFor('OWNER')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary: { endpoint: 'https://api.example.com?secret=value' } })
    });
    assert.equal(invalid.status, 400);
    const invalidError = await invalid.json() as { details: { path: string }[] };
    assert.equal(invalidError.details[0].path, 'primary.endpoint');
    const unavailableModule = await fetch(baseUrl, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tokenFor('OWNER')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { modules: { whatsapp: true } } })
    });
    assert.equal(unavailableModule.status, 400);
    const unavailableError = await unavailableModule.json() as { error: string; details: { path: string }[] };
    assert.equal(unavailableError.error, 'Validation error');
    assert.equal(unavailableError.details[0].path, 'settings.modules');
    const unsupportedProvider = await fetch(`${baseUrl}/connections`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tokenFor('OWNER')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary: { provider: 'unsupported-provider' } })
    });
    assert.equal(unsupportedProvider.status, 400);
    const providerError = await unsupportedProvider.json() as { details: { path: string }[] };
    assert.equal(providerError.details[0].path, 'primary.provider');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
