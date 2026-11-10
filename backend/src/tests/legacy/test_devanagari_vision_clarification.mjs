import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/orderledger'
});

const API_BASE = process.env.API_BASE_URL || 'http://localhost:5000';

async function testDevanagariVisionWebhook() {
  console.log('================================================================');
  console.log('RE-RUNNING TEST 1: DEVANAGARI VISION WEBHOOK END-TO-END FLOW');
  console.log('================================================================');

  const bRes = await pool.query('SELECT id, name FROM businesses LIMIT 1');
  const business = bRes.rows[0];

  const cRes = await pool.query('SELECT id, name, phone FROM customers WHERE business_id = $1 LIMIT 1', [business.id]);
  const customer = cRes.rows[0];

  console.log(`Tenant: ${business.name} (${business.id})`);
  console.log(`Customer: ${customer.name} (Phone: ${customer.phone})`);

  // Clear previous pending confirmations
  await pool.query('DELETE FROM pending_order_confirmations WHERE business_id = $1 AND customer_id = $2', [business.id, customer.id]);

  const devImgPath = path.join(FIXTURES_DIR, 'devanagari_handwritten.png');
  const imgBuffer = fs.readFileSync(devImgPath);
  const base64Data = imgBuffer.toString('base64');
  console.log(`Image Size: ${imgBuffer.length} bytes (image/png)`);

  const payload = {
    messageId: `wamid_dev_vis_${Date.now()}`,
    senderPhone: customer.phone,
    businessId: business.id,
    timestamp: new Date().toISOString(),
    messageType: 'image',
    text: '',
    mediaUrl: 'https://mock-bsp.storage.whatsapp.net/media/devanagari_handwritten.png',
    mediaMimeType: 'image/png',
    mediaBase64: base64Data
  };

  console.log('\nPosting image to WhatsApp Webhook: POST /webhooks/whatsapp/' + business.id);
  const start = Date.now();
  const res = await fetch(`${API_BASE}/webhooks/whatsapp/${business.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  console.log(`Webhook HTTP status: ${res.status}`, data);

  console.log('Polling for asynchronous AI extraction and WhatsApp message dispatch...');
  let audit = null;
  const maxWait = 25000;
  const pollStart = Date.now();

  while (Date.now() - pollStart < maxWait) {
    const aRes = await pool.query(
      `SELECT * FROM ai_extraction_audits WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [business.id]
    );
    if (aRes.rows[0] && new Date(aRes.rows[0].created_at).getTime() >= start - 1000) {
      audit = aRes.rows[0];
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!audit) {
    console.error('Timed out waiting for AI extraction audit row in DB');
    await pool.end();
    return;
  }

  console.log(`\n>> LIVE GEMINI VISION EXTRACTION AUDIT:`);
  console.log(`   - Model: ${audit.used_model} (Provider: ${audit.used_provider})`);
  console.log(`   - Duration: ${audit.duration_ms} ms`);
  console.log(`   - Raw Structured Output:`);
  console.log(`     ${audit.raw_response.replace(/\n/g, '\n     ')}`);

  // Fetch the outbound message delivered to the customer via MockWhatsAppProvider
  await new Promise(r => setTimeout(r, 800));
  const msgRes = await pool.query(
    `SELECT * FROM whatsapp_messages WHERE business_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 2`,
    [business.id, customer.id]
  );
  console.log(`\n>> MESSAGES IN WHATSAPP_MESSAGES TABLE:`);
  for (const m of msgRes.rows) {
    console.log(`   [${m.direction.toUpperCase()} - ${m.message_type}]: ${m.message_text}`);
  }

  await pool.end();
}

testDevanagariVisionWebhook().catch(err => {
  console.error('Test error:', err);
  pool.end();
});
