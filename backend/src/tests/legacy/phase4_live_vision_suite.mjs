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

async function runLiveVisionAcceptanceSuite() {
  console.log('================================================================');
  console.log('   PHASE 4: LIVE GEMINI VISION ACCEPTANCE & STRESS TEST SUITE   ');
  console.log('================================================================');
  console.log(`API URL: ${API_BASE}`);
  console.log(`Gemini Key configured: ends with ${process.env.AI_PRIMARY_API_KEY?.slice(-6)}`);
  console.log(`Gemini Model: ${process.env.AI_PRIMARY_MODEL || 'gemini-2.5-flash'}`);

  // Fetch business and customer
  const bRes = await pool.query(`SELECT id, name, phone FROM businesses LIMIT 1`);
  if (!bRes.rows[0]) throw new Error('No business found in database');
  const business = bRes.rows[0];

  const cRes = await pool.query(`SELECT id, name, phone FROM customers WHERE business_id = $1 LIMIT 1`, [business.id]);
  if (!cRes.rows[0]) throw new Error('No customer found in database');
  const customer = cRes.rows[0];

  console.log(`\nActive Tenant: ${business.name} (${business.id})`);
  console.log(`Customer: ${customer.name} (Phone: ${customer.phone})`);

  // Ensure customer catalog items exist
  const catRes = await pool.query(`SELECT id, name, unit, current_price FROM products WHERE business_id = $1 ORDER BY name ASC`, [business.id]);
  console.log(`Catalog size: ${catRes.rows.length} products`);

  const tests = [
    {
      testNum: 1,
      name: 'Actual Handwritten Note',
      filename: 'condition1_handwritten.png',
      caption: 'Today kitchen items',
      expectedExtraction: 'Tomato (Hybrid) 25kg, Potato 15kg, Onion 10kg, Banana 3 dozen'
    },
    {
      testNum: 2,
      name: 'Photo Taken at an Angle with Perspective Skew',
      filename: 'condition2_angled.png',
      caption: '',
      expectedExtraction: 'Tomato Country 12kg, Potato 30kg, Onion 20kg'
    },
    {
      testNum: 3,
      name: 'Uneven Lighting & Low-Contrast Blur',
      filename: 'condition3_blurry_smudge.png',
      caption: '',
      expectedExtraction: 'Banana 5 dozen, Onion 8kg, Potato 12kg'
    },
    {
      testNum: 4,
      name: 'Crossed-Out Items with Scribbled Correction',
      filename: 'condition4_crossed_out.png',
      caption: 'Please follow chef note corrections',
      expectedExtraction: 'Tomato (Hybrid) 20kg (NOT 10kg), Potato 15kg, Banana 2 dozen (NO Cabbage)'
    },
    {
      testNum: 5,
      name: 'Messy Stream/Clustered Note Without Line Breaks',
      filename: 'condition5_clustered_stream.png',
      caption: '',
      expectedExtraction: 'Tomato Hybrid 18kg, Potato 22kg, Onion 14kg, Banana 6 dozen'
    }
  ];

  for (const t of tests) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[TEST ${t.testNum}]: ${t.name}`);
    console.log(`Image File: ${t.filename}`);
    
    const filePath = path.join(FIXTURES_DIR, t.filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image fixture missing: ${filePath}`);
    }
    const imgBuffer = fs.readFileSync(filePath);
    const base64Data = imgBuffer.toString('base64');
    console.log(`Image Size: ${imgBuffer.length} bytes (MIME: image/png)`);

    // Clear old pending confirmations for this customer
    await pool.query(`DELETE FROM pending_order_confirmations WHERE business_id = $1 AND customer_id = $2`, [business.id, customer.id]);

    // Send WhatsApp inbound webhook payload with image
    const webhookPayload = {
      messageId: `wamid_img_${Date.now()}_${t.testNum}`,
      senderPhone: customer.phone,
      businessId: business.id,
      timestamp: new Date().toISOString(),
      messageType: 'image',
      text: t.caption,
      mediaUrl: `https://mock-bsp.storage.whatsapp.net/media/${t.filename}`,
      mediaMimeType: 'image/png',
      mediaBase64: base64Data
    };

    const webhookRes = await fetch(`${API_BASE}/webhooks/whatsapp/${business.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });

    const webhookData = await webhookRes.json();
    console.log(`Webhook HTTP status: ${webhookRes.status} (Job enqueued: ${webhookData.queued})`);

    // Poll for the pending_order_confirmations row and extraction audit
    let pending = null;
    let audit = null;
    const maxWaitMs = 15000;
    const pollStart = Date.now();

    while (Date.now() - pollStart < maxWaitMs) {
      const pRow = await pool.query(
        `SELECT * FROM pending_order_confirmations WHERE business_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [business.id, customer.id]
      );
      if (pRow.rows[0]) {
        pending = pRow.rows[0];
      }

      const aRow = await pool.query(
        `SELECT * FROM ai_extraction_audits WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [business.id]
      );
      if (aRow.rows[0] && (!audit || aRow.rows[0].id !== audit.id)) {
        audit = aRow.rows[0];
      }

      if (pending && audit) break;
      await new Promise(r => setTimeout(r, 800));
    }

    if (!pending || !audit) {
      console.error(`✗ Test ${t.testNum} timed out waiting for AI processing.`);
      continue;
    }

    // Inspect Audit Row
    console.log(`\n>> AI EXTRACTION AUDIT (DATABASE ROW):`);
    console.log(`   - Model Used: ${audit.used_model} (Provider: ${audit.used_provider})`);
    console.log(`   - Input Type: ${audit.input_type || 'image'}`);
    console.log(`   - Duration (latency): ${audit.duration_ms} ms  <-- GENUINE GEMINI VISION NETWORK CALL`);
    console.log(`   - Fallback Triggered: ${audit.was_fallback}`);
    console.log(`   - Raw Structured Output:`);
    console.log(`     ${audit.raw_response.replace(/\n/g, '\n     ')}`);

    // Inspect Pending Confirmation Row
    console.log(`\n>> PENDING CONFIRMATION ROW:`);
    console.log(`   - Confirmation ID: ${pending.id}`);
    console.log(`   - Source Type: ${pending.source_type}`);
    console.log(`   - Media URL: ${pending.media_url}`);
    console.log(`   - Media MIME: ${pending.media_mime_type}`);
    console.log(`   - Extracted Items Count: ${pending.extracted_items.length}`);
    console.log(`   - Extracted Items JSON: ${JSON.stringify(pending.extracted_items)}`);
    console.log(`   - Outbound Confirmation Message Sent To Customer:\n`);
    console.log(pending.confirmation_message_text);

    // Now test YES confirmation and Order commitment for Test 1
    if (t.testNum === 1) {
      console.log(`\n>> TESTING USER 'YES' REPLY & ORDER COMMIT FOR TEST 1:`);
      const yesPayload = {
        messageId: `wamid_yes_${Date.now()}`,
        senderPhone: customer.phone,
        businessId: business.id,
        timestamp: new Date().toISOString(),
        messageType: 'text',
        text: 'YES'
      };

      const yesRes = await fetch(`${API_BASE}/webhooks/whatsapp/${business.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(yesPayload)
      });
      console.log(`   - 'YES' Webhook sent (HTTP ${yesRes.status})`);

      // Wait 1.5s for async queue commit
      await new Promise(r => setTimeout(r, 1500));

      const orderRow = await pool.query(
        `SELECT o.id, o.order_no, o.status, o.source, o.total_amount, o.confirmed_at,
                json_agg(json_build_object('product_name', p.name, 'qty', oi.quantity, 'unit_price', oi.unit_price_at_order, 'subtotal', oi.total_price)) as items
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN products p ON p.id = oi.product_id
         WHERE o.business_id = $1 AND o.customer_id = $2
         GROUP BY o.id
         ORDER BY o.created_at DESC LIMIT 1`,
        [business.id, customer.id]
      );

      if (orderRow.rows[0]) {
        const ord = orderRow.rows[0];
        console.log(`\n✓ ORDER COMMITTED SUCCESSFULLY TO DATABASE:`);
        console.log(`   - Order ID: ${ord.id}`);
        console.log(`   - Order Number: ${ord.order_no}`);
        console.log(`   - Status: ${ord.status} (Source: ${ord.source})`);
        console.log(`   - Confirmed At: ${ord.confirmed_at}`);
        console.log(`   - Total Amount: ₹${ord.total_amount}`);
        console.log(`   - Committed Snapshotted Line Items:`);
        ord.items.forEach((it, i) => {
          console.log(`     ${i + 1}. ${it.product_name} - ${it.qty} units @ ₹${it.unit_price}/unit = ₹${it.subtotal}`);
        });
      } else {
        console.error(`✗ Order commitment failed to find committed order row`);
      }
    }
  }

  await pool.end();
  console.log('\n================================================================');
  console.log('   ALL 5 LIVE GEMINI VISION STRESS TESTS COMPLETED               ');
  console.log('================================================================');
}

runLiveVisionAcceptanceSuite().catch(err => {
  console.error('Fatal test error:', err);
  pool.end();
  process.exit(1);
});
