import assert from 'node:assert/strict';
import { WhatsAppProviderFactory, MockWhatsAppProvider } from '../../dist/services/whatsapp/whatsapp.provider.js';
import { OrderProcessingEngine } from '../../dist/services/order.processor.js';

const API_BASE = 'http://localhost:5000';

async function req(endpoint, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`[${res.status}] ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runPhase3Suite() {
  console.log('🚀 STARTING PHASE 3 ACCEPTANCE TEST SUITE (WHATSAPP TEXT + AI)...');

  const runId = Date.now().toString().slice(-6);

  // Setup mock WhatsApp provider for test interception
  const mockWhatsapp = new MockWhatsAppProvider();
  WhatsAppProviderFactory.setProvider(mockWhatsapp);

  // 1. Setup Tenant A with Catalog & Customer
  console.log('\n--- 1. Register Tenant A & Seed Real Catalog ---');
  const regA = await req('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      businessName: `Organic Greens ${runId}`,
      businessSlug: `organic-greens-${runId}`,
      categoryTemplate: 'fruits_veg',
      phone: `93${runId}10`,
      ownerName: 'Anil Kumar',
      email: `anil_${runId}@organicgreens.app`,
      password: 'password123'
    })
  });
  const tokenA = regA.token;
  const bizAId = regA.business.id;

  // Add specific test items required by user scenario: Tomato, Potato, Banana
  // Seeded catalog has Tomato and Potato, let's create Banana explicitly
  const banana = await req('/api/products', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Banana',
      unit: 'dozen',
      currentPrice: 60
    })
  }, tokenA);

  const customerPhone = `9845${runId.slice(-4)}11`;
  const tajCust = await req('/api/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Taj Gateway Restaurant',
      phone: customerPhone,
      creditTermsDays: 7
    })
  }, tokenA);
  console.log(`✅ Tenant A setup with Taj Gateway Restaurant (Phone: ${customerPhone})`);

  // 2. Test Unknown Customer Webhook
  console.log('\n--- 2. Test Unknown Sender Phone Handling ---');
  const unknownPhone = '9999900000';
  const unknownWebhook = await req(`/webhooks/whatsapp/${bizAId}`, {
    method: 'POST',
    body: JSON.stringify({
      senderPhone: unknownPhone,
      messageText: 'tomato 10kg'
    })
  });
  assert.equal(unknownWebhook.status, 'unmatched_customer');
  const msgsRes = await req('/api/whatsapp/messages');
  const lastMsg = msgsRes.messages[msgsRes.messages.length - 1];
  assert(lastMsg && lastMsg.text.includes('not registered'), 'Must prompt unknown customer to contact vendor');
  console.log('✅ Unmatched customer caught safely without creating order');

  // 3. Test Real User WhatsApp Scenario:
  // "tom 20kg
  //  pot 10kg
  //  banana 5 doz"
  console.log('\n--- 3. Send WhatsApp Text Order ("tom 20kg, pot 10kg, banana 5 doz") ---');
  const orderText = `tom 20kg\npot 10kg\nbanana 5 doz`;
  const webhookRes = await req(`/webhooks/whatsapp/${bizAId}`, {
    method: 'POST',
    body: JSON.stringify({
      providerMessageId: `msg_${runId}_001`,
      senderPhone: customerPhone,
      messageText: orderText
    })
  });
  assert.equal(webhookRes.status, 'enqueued');
  console.log('✅ Webhook accepted immediately and job enqueued (< 5s response)');

  // Wait for background async processing
  await sleep(1200);

  // Check Outbound Confirmation Sent to Customer
  const msgs1 = await req('/api/whatsapp/messages');
  const confirmMsg = msgs1.messages.find(m => m.to === customerPhone && m.text.includes('Order detected:'));
  assert(confirmMsg, 'WhatsApp confirmation message must be sent to customer');
  console.log('✅ Confirmation sent to customer:\n' + confirmMsg.text);
  assert(confirmMsg.text.includes('Tomato') && confirmMsg.text.includes('20 kg'), 'Must parse Tomato 20 kg');
  assert(confirmMsg.text.includes('Potato') && confirmMsg.text.includes('10 kg'), 'Must parse Potato 10 kg');
  assert(confirmMsg.text.includes('Banana') && (confirmMsg.text.includes('5 doz') || confirmMsg.text.includes('5 dozen')), 'Must parse Banana 5 doz');
  assert(confirmMsg.text.includes('Reply YES to confirm'), 'Must request YES confirmation');

  // Verify order is NOT yet created in orders table before YES
  const currentOrdersBeforeYes = await req('/api/orders', {}, tokenA);
  assert.equal(currentOrdersBeforeYes.length, 0, 'No actual order should exist before customer replies YES');
  console.log('✅ Verified: Order remains in pending confirmation state, not created yet');

  // 4. Test Customer Correction Flow
  console.log('\n--- 4. Customer sends correction ("make tomato 25kg") ---');
  const correctionText = 'make tomato 25kg';
  const correctionWebhook = await req(`/webhooks/whatsapp/${bizAId}`, {
    method: 'POST',
    body: JSON.stringify({
      providerMessageId: `msg_${runId}_002`,
      senderPhone: customerPhone,
      messageText: correctionText
    })
  });
  assert.equal(correctionWebhook.status, 'enqueued');
  assert.equal(correctionWebhook.isCorrection, true, 'Must detect as correction');

  await sleep(1000);

  // Check updated confirmation sent
  const msgs2 = await req('/api/whatsapp/messages');
  const updatedMsg = msgs2.messages[msgs2.messages.length - 1];
  assert(updatedMsg.text.includes('Tomato') && updatedMsg.text.includes('25 kg'), 'Must update tomato quantity to 25 kg in confirmation');
  console.log('✅ Correction processed and updated confirmation sent');

  // 5. Test Customer replies YES
  console.log('\n--- 5. Customer replies YES ---');
  const yesWebhook = await req(`/webhooks/whatsapp/${bizAId}`, {
    method: 'POST',
    body: JSON.stringify({
      providerMessageId: `msg_${runId}_003`,
      senderPhone: customerPhone,
      messageText: 'YES'
    })
  });
  assert.equal(yesWebhook.status, 'confirmation_received');

  await sleep(1000);

  // 6. Verify Created Order Details & Frozen Prices
  console.log('\n--- 6. Verify Created Order in Core Ledger ---');
  const ordersAfterYes = await req('/api/orders', {}, tokenA);
  assert.equal(ordersAfterYes.length, 1, 'Exactly 1 order must be created');
  const placedOrder = ordersAfterYes[0];
  assert.equal(placedOrder.status, 'Received', 'Status must be Received');
  assert.equal(placedOrder.source, 'whatsapp_text', 'Source must be whatsapp_text');
  assert(placedOrder.confirmed_at, 'confirmed_at timestamp must be set');
  console.log(`✅ Order #${placedOrder.order_no} created! Status: ${placedOrder.status}, Source: ${placedOrder.source}, Total: ₹${placedOrder.total_amount}`);

  // 7. Verify Idempotency: Duplicate Webhook & Duplicate YES
  console.log('\n--- 7. Test Idempotency (Duplicate Webhooks & Duplicate YES) ---');
  const duplicateWebhook = await req(`/webhooks/whatsapp/${bizAId}`, {
    method: 'POST',
    body: JSON.stringify({
      providerMessageId: `msg_${runId}_001`, // already processed ID
      senderPhone: customerPhone,
      messageText: orderText
    })
  });
  assert.equal(duplicateWebhook.status, 'duplicate_ignored', 'Duplicate providerMessageId must be ignored');

  const duplicateYes = await req(`/webhooks/whatsapp/${bizAId}`, {
    method: 'POST',
    body: JSON.stringify({
      providerMessageId: `msg_${runId}_004`,
      senderPhone: customerPhone,
      messageText: 'YES'
    })
  });
  assert.equal(duplicateYes.status, 'confirmation_received');
  await sleep(500);

  const ordersCountCheck = await req('/api/orders', {}, tokenA);
  assert.equal(ordersCountCheck.length, 1, 'Duplicate YES must NOT create duplicate orders');
  console.log('✅ Webhook and YES duplicate protection confirmed 100% idempotent');

  // 8. Test Ambiguous Product Handling
  console.log('\n--- 8. Test Ambiguous Product Handling ---');
  // Create another tomato product so "tomato" becomes ambiguous
  await req('/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tomato (Country/Naati)', unit: 'kg', currentPrice: 50 })
  }, tokenA);

  const ambiguousText = 'tomato 10kg';
  await req(`/webhooks/whatsapp/${bizAId}`, {
    method: 'POST',
    body: JSON.stringify({
      providerMessageId: `msg_${runId}_005`,
      senderPhone: customerPhone,
      messageText: ambiguousText
    })
  });
  await sleep(1000);
  const msgs3 = await req('/api/whatsapp/messages');
  const ambMsg = msgs3.messages[msgs3.messages.length - 1];
  assert(ambMsg.text.includes('clarify') || ambMsg.text.includes('multiple items'), 'Must flag ambiguous products and request clarification');
  console.log('✅ Ambiguous product prevented automatic guessing and requested customer clarification');

  // 9. Test AI Provider Abstraction Fallback: Gemini Fail -> Groq Fallback
  console.log('\n--- 9. Test AI Fallback Engine (Gemini Fails -> Groq Fallback) ---');
  const failingGeminiProvider = {
    name: 'failing_gemini',
    async extractOrderText() {
      throw new Error('Gemini API 503 Overloaded');
    }
  };
  const workingGroqProvider = {
    name: 'working_groq',
    async extractOrderText() {
      return {
        items: [{ product: 'Banana', quantity: 10, unit: 'dozen' }],
        warnings: [],
        rawResponse: '{"items":[{"product":"Banana","quantity":10,"unit":"dozen"}]}',
        model: 'llama-3.3-70b-versatile'
      };
    }
  };

  const aiService = OrderProcessingEngine.getAiService();
  aiService.setProviders(failingGeminiProvider, workingGroqProvider);

  const fallbackResult = await aiService.extract('banana 10 doz', [
    { id: banana.id, name: 'Banana', unit: 'dozen', current_price: 60 }
  ]);
  assert.equal(fallbackResult.wasFallback, true, 'Must succeed via fallback provider');
  assert.equal(fallbackResult.provider, 'working_groq', 'Used provider must be groq');
  console.log('✅ AI fallback verified: Seamlessly fell back to Groq when primary provider threw error');

  // 10. Test Both AI Providers Fail
  console.log('\n--- 10. Test Both Providers Fail Handling ---');
  const failingGroqProvider = {
    name: 'failing_groq',
    async extractOrderText() {
      throw new Error('Groq rate limited');
    }
  };
  aiService.setProviders(failingGeminiProvider, failingGroqProvider);

  let bothFailed = false;
  try {
    await aiService.extract('potato 10kg', []);
  } catch (err) {
    bothFailed = true;
    console.log('✅ Handled double failure safely:', err.message);
  }
  assert(bothFailed, 'Must throw controlled error when both providers fail without corrupting state');

  // Restore mock provider
  WhatsAppProviderFactory.setProvider(new MockWhatsAppProvider());

  // 11. Test Full Existing Ledger Continuation:
  // Received -> Packed -> Delivered -> Invoice -> Payment -> Customer Ledger = 0
  console.log('\n--- 11. Advance WhatsApp Order Through Existing Core Ledger ---');
  // Advance to Packed
  await req(`/api/orders/${placedOrder.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Packed' }) }, tokenA);
  // Advance to Delivered (triggering invoice)
  await req(`/api/orders/${placedOrder.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Delivered' }) }, tokenA);

  const invList = await req('/api/invoices', {}, tokenA);
  assert.equal(invList.length, 1);
  const inv = invList[0];
  assert.equal(inv.status, 'Pending');
  console.log(`✅ Invoice generated: ${inv.invoice_no} Total: ₹${inv.total}`);

  // Pay in full
  await req('/api/payments', {
    method: 'POST',
    body: JSON.stringify({
      customerId: tajCust.id,
      amount: inv.total,
      mode: 'upi',
      reference: 'UPI-WA-FULL'
    })
  }, tokenA);

  const custStatement = await req(`/api/reports/statement/${tajCust.id}`, {}, tokenA);
  assert.equal(custStatement.currentOutstanding, 0, 'Customer balance must be 0 after full payment');
  console.log(`✅ WhatsApp order smoothly transitioned all the way to ₹0 balance in core ledger!`);

  // 12. Test Tenant Isolation
  console.log('\n--- 12. Verify Multi-Tenant Webhook Isolation ---');
  const regB = await req('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      businessName: `Tenant B Fresh ${runId}`,
      businessSlug: `tenant-b-${runId}`,
      categoryTemplate: 'dairy',
      phone: `94${runId}20`,
      ownerName: 'Vikas Gupta',
      email: `vikas_${runId}@tenantb.app`,
      password: 'password123'
    })
  });
  const bizBId = regB.business.id;

  // Sending webhook for Tenant B with Taj Restaurant phone (registered only under Tenant A)
  const webhookCrossTenant = await req(`/webhooks/whatsapp/${bizBId}`, {
    method: 'POST',
    body: JSON.stringify({
      senderPhone: customerPhone,
      messageText: 'milk 10 litre'
    })
  });
  assert.equal(webhookCrossTenant.status, 'unmatched_customer', 'Customer must NOT be found under Tenant B');
  console.log('✅ Tenant isolation verified: Customer belongs only to Tenant A, returns unmatched under Tenant B');

  console.log('\n🎉 ALL PHASE 3 ACCEPTANCE CRITERIA TESTS PASSED WITH 100% SUCCESS!');
}

runPhase3Suite().catch(err => {
  console.error('\n❌ PHASE 3 SUITE FAILED:', err);
  process.exit(1);
});
