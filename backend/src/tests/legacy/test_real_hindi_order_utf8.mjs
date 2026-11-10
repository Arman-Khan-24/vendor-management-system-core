import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import { OrderProcessingEngine } from '../../dist/services/order.processor.js';
import { InvoiceRepository } from '../../dist/repositories/invoice.repo.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/orderledger'
});

async function runRealHindiOrderTest() {
  console.log('========================================================================');
  console.log('   TESTING REAL HINDI ORDER ON NATIVE UTF-8 DATABASE                   ');
  console.log('========================================================================\n');

  // 1. Verify database encoding
  const encRes = await pool.query("SELECT datname, pg_encoding_to_char(encoding) as encoding, datcollate, datctype FROM pg_database WHERE datname = 'orderledger'");
  console.log('1. Database Server Encoding:');
  console.log(JSON.stringify(encRes.rows[0], null, 2));

  // 2. Fetch business and customer
  const bRes = await pool.query('SELECT id, name FROM businesses LIMIT 1');
  const business = bRes.rows[0];

  const cRes = await pool.query('SELECT id, name, phone FROM customers WHERE business_id = $1 LIMIT 1', [business.id]);
  const customer = cRes.rows[0];

  console.log(`\n2. Context: Business="${business.name}" (${business.id}), Customer="${customer.name}" (${customer.phone})`);

  // Ensure products exist in catalog
  const pRes = await pool.query('SELECT id, name, unit, current_price FROM products WHERE business_id = $1 AND name LIKE $2 LIMIT 1', [business.id, '%Tomato (Hybrid)%']);
  const potatoRes = await pool.query('SELECT id, name, unit, current_price FROM products WHERE business_id = $1 AND name LIKE $2 LIMIT 1', [business.id, '%Potato%']);

  console.log(`   - Product 1: ${pRes.rows[0]?.name}`);
  console.log(`   - Product 2: ${potatoRes.rows[0]?.name}`);

  // ----------------------------------------------------------------------------------
  // STEP 1: Customer sends ambiguous Hindi order note:
  // "टमाटर 10 किलो और आलू 15 किलो"
  // System must catch ambiguity without guessing and request clarification.
  // ----------------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 1: INGEST AMBIGUOUS HINDI MESSAGE');
  console.log('------------------------------------------------------------------------');
  const msg1Text = 'टमाटर 10 किलो और आलू 15 किलो';
  const msg1Res = await pool.query(
    `INSERT INTO whatsapp_messages 
     (business_id, customer_id, sender_phone, direction, message_type, message_text, status)
     VALUES ($1, $2, $3, 'inbound', 'text', $4, 'received')
     RETURNING id`,
    [business.id, customer.id, customer.phone, msg1Text]
  );
  const msg1Id = msg1Res.rows[0].id;

  console.log(`Inbound Message #1 ID: ${msg1Id}`);
  console.log(`Content: "${msg1Text}"`);

  const step1Result = await OrderProcessingEngine.processExtraction({
    inboundMessageId: msg1Id,
    businessId: business.id,
    customerId: customer.id,
    senderPhone: customer.phone,
    messageType: 'text',
    messageText: msg1Text
  });

  console.log('Result 1 (Ambiguity Caught?):', step1Result.success === false ? 'YES - HELD FOR CLARIFICATION' : 'UNEXPECTED');
  console.log('Reason:', step1Result.reason);

  // ----------------------------------------------------------------------------------
  // STEP 2: Customer clarifies with variety in Hindi:
  // "10 किलो Tomato (Hybrid) और 15 किलो आलू"
  // System successfully matches catalog and sends confirmation prompt.
  // ----------------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 2: CUSTOMER CLARIFIES VARIETY');
  console.log('------------------------------------------------------------------------');
  const msg2Text = '10 किलो Tomato (Hybrid) और 15 किलो आलू';
  const msg2Res = await pool.query(
    `INSERT INTO whatsapp_messages 
     (business_id, customer_id, sender_phone, direction, message_type, message_text, status)
     VALUES ($1, $2, $3, 'inbound', 'text', $4, 'received')
     RETURNING id`,
    [business.id, customer.id, customer.phone, msg2Text]
  );
  const msg2Id = msg2Res.rows[0].id;

  console.log(`Inbound Message #2 ID: ${msg2Id}`);
  console.log(`Content: "${msg2Text}"`);

  const step2Result = await OrderProcessingEngine.processExtraction({
    inboundMessageId: msg2Id,
    businessId: business.id,
    customerId: customer.id,
    senderPhone: customer.phone,
    messageType: 'text',
    messageText: msg2Text
  });

  console.log('Result 2 Success:', step2Result.success);
  console.log('Pending Confirmation ID:', step2Result.confirmationId);
  console.log('Matched Items:', JSON.stringify(step2Result.items, null, 2));

  // ----------------------------------------------------------------------------------
  // STEP 3: Customer replies "YES" to confirm order
  // ----------------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('STEP 3: CUSTOMER CONFIRMS WITH "YES"');
  console.log('------------------------------------------------------------------------');
  const confirmResult = await OrderProcessingEngine.handleConfirmation(
    business.id,
    customer.id,
    customer.phone
  );

  console.log('Confirmation Result:');
  console.log(JSON.stringify(confirmResult, null, 2));

  const orderId = confirmResult.orderId;

  // ----------------------------------------------------------------------------------
  // STEP 4: Generate Invoice
  // ----------------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log(`STEP 4: GENERATE INVOICE FOR ORDER #${confirmResult.orderNo}`);
  console.log('------------------------------------------------------------------------');
  const invoice = await InvoiceRepository.generateInvoiceForOrder({
    businessId: business.id,
    orderId
  });
  console.log(`Invoice #${invoice.invoice_no} Generated! Total: ₹${invoice.total}`);

  // ----------------------------------------------------------------------------------
  // STEP 5: DIRECT DATABASE READ-BACK: VERIFY REAL DEVANAGARI HINDI (NO ESCAPE CODES)
  // ----------------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('   STEP 5: DIRECT POSTGRESQL READ-BACK VERIFICATION                    ');
  console.log('========================================================================\n');

  // Read orders
  const orderRow = await pool.query(
    'SELECT id, order_no, status, notes, created_at FROM orders WHERE id = $1',
    [orderId]
  );
  console.log('>> TABLE: orders');
  console.log(JSON.stringify(orderRow.rows[0], null, 2));

  // Read order_items joined with products
  const itemsRows = await pool.query(
    `SELECT oi.id, p.name as product_name, oi.quantity, oi.unit, oi.unit_price_at_order, oi.total_price 
     FROM order_items oi 
     JOIN products p ON oi.product_id = p.id 
     WHERE oi.order_id = $1`,
    [orderId]
  );
  console.log('\n>> TABLE: order_items');
  console.log(JSON.stringify(itemsRows.rows, null, 2));

  // Read invoices
  const invoiceRow = await pool.query(
    'SELECT id, invoice_no, subtotal, tax, total, status, created_at FROM invoices WHERE order_id = $1',
    [orderId]
  );
  console.log('\n>> TABLE: invoices');
  console.log(JSON.stringify(invoiceRow.rows[0], null, 2));

  // Read whatsapp_messages
  const msgRow = await pool.query(
    'SELECT id, sender_phone, direction, message_text, created_at FROM whatsapp_messages WHERE id IN ($1, $2) ORDER BY created_at ASC',
    [msg1Id, msg2Id]
  );
  console.log('\n>> TABLE: whatsapp_messages');
  console.log(JSON.stringify(msgRow.rows, null, 2));

  // Read ai_extraction_audits (raw response & structured output)
  const auditRows = await pool.query(
    `SELECT id, primary_model, used_model, was_fallback, input_text, raw_response, structured_output 
     FROM ai_extraction_audits 
     WHERE inbound_message_id IN ($1, $2)
     ORDER BY created_at ASC`,
    [msg1Id, msg2Id]
  );
  console.log('\n>> TABLE: ai_extraction_audits');
  console.log(JSON.stringify(auditRows.rows, null, 2));

  await pool.end();
}

runRealHindiOrderTest().catch(console.error);
