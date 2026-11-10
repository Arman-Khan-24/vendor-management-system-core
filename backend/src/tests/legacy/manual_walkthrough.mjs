import { pool } from '../../dist/database/connection.js';

async function executeFlowAndQuery() {
  const client = await pool.connect();
  try {
    const runId = Date.now().toString().slice(-5);
    
    // 1. Create a tenant and customer
    const bRes = await client.query(
      `INSERT INTO businesses (name, slug, category_template, phone)
       VALUES ($1, $2, 'fruits_veg', '9899001122')
       RETURNING id, name`,
      [`Demo Vendor ${runId}`, `demo-vendor-${runId}`]
    );
    const businessId = bRes.rows[0].id;

    // Seed products
    const p1 = await client.query(
      `INSERT INTO products (business_id, name, unit, current_price)
       VALUES ($1, 'Tomato (Hybrid)', 'kg', 40.00),
              ($1, 'Potato (Jyoti)', 'kg', 30.00),
              ($1, 'Banana', 'dozen', 60.00)
       RETURNING id, name, unit, current_price`,
      [businessId]
    );

    const cRes = await client.query(
      `INSERT INTO customers (business_id, name, phone, credit_terms_days)
       VALUES ($1, 'Spice Garden Hotel', $2, 7)
       RETURNING id, name, phone`,
      [businessId, `98765${runId}`]
    );
    const customer = cRes.rows[0];

    console.log('================================================================');
    console.log('STEP A: INBOUND WHATSAPP MESSAGE SENT BY CUSTOMER');
    console.log('Customer Phone:', customer.phone);
    console.log('Raw Message: "tomato 20kg, potato 10kg, banana 5 dozen"');
    console.log('================================================================');

    // Send Webhook
    const res = await fetch(`http://localhost:5000/webhooks/whatsapp/${businessId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerMessageId: `live_msg_${runId}_1`,
        senderPhone: customer.phone,
        messageText: 'tomato 20kg, potato 10kg, banana 5 dozen'
      })
    });
    const webhookJson = await res.json();
    console.log('\n--- Webhook HTTP Response ---');
    console.log(JSON.stringify(webhookJson, null, 2));

    // Wait for background async extraction job
    await new Promise(r => setTimeout(r, 1200));

    // Query pending_order_confirmations
    console.log('\n================================================================');
    console.log('STEP B: EXACT ROW IN pending_order_confirmations TABLE');
    console.log('================================================================');
    const pendingQuery = await client.query(
      `SELECT id, business_id, customer_id, raw_text, ai_provider, ai_model, status, 
              extracted_items, created_at, confirmed_at
       FROM pending_order_confirmations 
       WHERE business_id = $1 AND customer_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [businessId, customer.id]
    );
    console.log(JSON.stringify(pendingQuery.rows[0], null, 2));

    // Retrieve Outbound WhatsApp confirmation sent to customer
    console.log('\n================================================================');
    console.log('STEP C: CONFIRMATION MESSAGE DELIVERED TO WHATSAPP');
    console.log('================================================================');
    const msgRes = await fetch('http://localhost:5000/api/whatsapp/messages');
    const msgJson = await msgRes.json();
    const sentMsg = msgJson.messages.find(m => m.to === customer.phone && m.text.includes('Order detected:'));
    console.log(`To: ${sentMsg?.to}`);
    console.log(`Message Content:\n${sentMsg?.text}`);

    // Customer sends YES
    console.log('\n================================================================');
    console.log('STEP D: CUSTOMER REPLIES "YES"');
    console.log('================================================================');
    const yesRes = await fetch(`http://localhost:5000/webhooks/whatsapp/${businessId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerMessageId: `live_msg_${runId}_yes`,
        senderPhone: customer.phone,
        messageText: 'YES'
      })
    });
    console.log('Webhook YES Response:', await yesRes.json());

    await new Promise(r => setTimeout(r, 2500));

    // Query resulting row in orders & order_items tables
    console.log('\n================================================================');
    console.log('STEP E: EXACT ROW IN orders TABLE & SNAPSHOTTED order_items');
    console.log('================================================================');
    const orderQuery = await client.query(
      `SELECT id, business_id, customer_id, order_no, status, source, confirmed_at, notes, created_at
       FROM orders
       WHERE business_id = $1 AND customer_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [businessId, customer.id]
    );
    console.log('--- Orders Row ---');
    console.log(JSON.stringify(orderQuery.rows[0], null, 2));

    const itemsQuery = await client.query(
      `SELECT oi.id, oi.order_id, oi.product_id, p.name AS product_name, oi.quantity, oi.unit, oi.unit_price_at_order,
              (oi.quantity * oi.unit_price_at_order) AS line_total
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderQuery.rows[0].id]
    );
    console.log('\n--- Order Items Rows (Snapshotted Unit Prices) ---');
    console.log(JSON.stringify(itemsQuery.rows, null, 2));

  } finally {
    client.release();
    process.exit(0);
  }
}

executeFlowAndQuery().catch(err => {
  console.error('Walkthrough query failed:', err);
  process.exit(1);
});
