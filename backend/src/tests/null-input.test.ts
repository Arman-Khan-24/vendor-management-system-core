import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { requestInProcess } from './helpers/http.js';

test('null characters are rejected before route database work', async () => {
  for (const path of ['/api/customers?search=%00', '/api/products?search=%00']) {
    assert.equal((await requestInProcess(createApp(), 'GET', path)).status, 400);
  }
  assert.equal((await requestInProcess(createApp(), 'POST', '/api/customers',
    JSON.stringify({ name: 'A\0B', phone: '9000010000' }))).status, 400);
});

test('unsigned webhook requests never load a tenant connection', async () => {
  const { WhatsAppRepository } = await import('../repositories/whatsapp.repo.js');
  const original = WhatsAppRepository.runtimeConnection;
  WhatsAppRepository.runtimeConnection = async () => { throw new Error('Unexpected database lookup'); };
  try {
    const response = await requestInProcess(createApp(), 'POST',
      '/webhooks/whatsapp/10000000-0000-4000-8000-000000000001', '{}');
    assert.equal(response.status, 401);
  } finally { WhatsAppRepository.runtimeConnection = original; }
});
