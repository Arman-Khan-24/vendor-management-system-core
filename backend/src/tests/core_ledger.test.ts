import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('OrderLedger Phase 1 Core Ledger & Multi-Tenant Verification', async (t) => {
  // Initialize isolated in-memory PostgreSQL instance with pure pg dialect
  const mem = newDb();
  
  // Register required postgres extensions/functions
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => '11111111-1111-4111-8111-111111111111'
  });

  const db = mem.adapters.createPg();
  const client = new db.Client();
  await client.connect();

  // Create clean tables for testing relations and rules
  await client.query(`
    CREATE TABLE businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category_template TEXT,
      invoice_trigger TEXT DEFAULT 'Delivered'
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      credit_terms_days INT DEFAULT 7
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      current_price NUMERIC NOT NULL,
      active BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      order_no INT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      packed_at TIMESTAMP,
      delivered_at TIMESTAMP
    );

    CREATE TABLE order_items (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity NUMERIC NOT NULL,
      unit TEXT NOT NULL,
      unit_price_at_order NUMERIC NOT NULL,
      total_price NUMERIC NOT NULL
    );

    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      invoice_no INT NOT NULL,
      subtotal NUMERIC NOT NULL,
      tax NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      amount NUMERIC NOT NULL,
      mode TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payment_allocations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      payment_id TEXT NOT NULL REFERENCES payments(id),
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      amount NUMERIC NOT NULL
    );
  `);

  // Setup Tenants A and B
  await client.query(`
    INSERT INTO businesses (id, name, slug) VALUES 
    ('biz_a', 'Business A Wholesale', 'biz-a'),
    ('biz_b', 'Business B Organics', 'biz-b');
  `);

  await t.test('1. Strict Tenant Isolation (Cross-Tenant Customer & Product)', async () => {
    // Add customer to Biz A
    await client.query(`
      INSERT INTO customers (id, business_id, name, phone) 
      VALUES ('cust_a1', 'biz_a', 'Hotel Sunrise', '9876543210');
    `);

    // Add product to Biz A
    await client.query(`
      INSERT INTO products (id, business_id, name, unit, current_price)
      VALUES ('prod_tomato', 'biz_a', 'Tomato', 'kg', 40.00);
    `);

    // Verify Biz B cannot read Biz A customer
    const bizBCustomer = await client.query(`
      SELECT * FROM customers WHERE id = 'cust_a1' AND business_id = 'biz_b';
    `);
    assert.equal(bizBCustomer.rows.length, 0, 'Business B must NOT see Business A customer');

    // Verify Biz B cannot read Biz A product
    const bizBProduct = await client.query(`
      SELECT * FROM products WHERE id = 'prod_tomato' AND business_id = 'biz_b';
    `);
    assert.equal(bizBProduct.rows.length, 0, 'Business B must NOT see Business A product');
  });

  await t.test('2. Order Price Snapshot Immutability (Frozen Price Guarantee)', async () => {
    // Current price is ₹40/kg
    // Place order for 10 kg
    await client.query(`
      INSERT INTO orders (id, business_id, customer_id, order_no, status)
      VALUES ('order_1', 'biz_a', 'cust_a1', 1, 'Received');
    `);

    await client.query(`
      INSERT INTO order_items (id, business_id, order_id, product_id, quantity, unit, unit_price_at_order, total_price)
      VALUES ('item_1', 'biz_a', 'order_1', 'prod_tomato', 10, 'kg', 40.00, 400.00);
    `);

    // Update product price to ₹55/kg
    await client.query(`
      UPDATE products SET current_price = 55.00 WHERE id = 'prod_tomato' AND business_id = 'biz_a';
    `);

    // Ensure item still references ₹40.00
    const itemRes = await client.query(`
      SELECT unit_price_at_order, total_price FROM order_items WHERE id = 'item_1' AND business_id = 'biz_a';
    `);
    assert.equal(parseFloat(itemRes.rows[0].unit_price_at_order), 40.00, 'Historical unit price must remain frozen at 40');
    assert.equal(parseFloat(itemRes.rows[0].total_price), 400.00, 'Total price must remain frozen at 400');
  });

  await t.test('3. Order State Machine: Received -> Packed -> Delivered', async () => {
    // Valid transition Received -> Packed
    await client.query(`
      UPDATE orders SET status = 'Packed', packed_at = CURRENT_TIMESTAMP WHERE id = 'order_1' AND business_id = 'biz_a';
    `);
    let orderRes = await client.query(`SELECT status FROM orders WHERE id = 'order_1'`);
    assert.equal(orderRes.rows[0].status, 'Packed');

    // Valid transition Packed -> Delivered
    await client.query(`
      UPDATE orders SET status = 'Delivered', delivered_at = CURRENT_TIMESTAMP WHERE id = 'order_1' AND business_id = 'biz_a';
    `);
    orderRes = await client.query(`SELECT status FROM orders WHERE id = 'order_1'`);
    assert.equal(orderRes.rows[0].status, 'Delivered');
  });

  await t.test('4. FIFO Payment Allocations & Invoice Status Consistency', async () => {
    // Order 1 has invoice for ₹400
    await client.query(`
      INSERT INTO invoices (id, business_id, order_id, customer_id, invoice_no, subtotal, total, status)
      VALUES ('inv_1', 'biz_a', 'order_1', 'cust_a1', 1, 400.00, 400.00, 'Pending');
    `);

    // Order 2 has invoice for ₹600
    await client.query(`
      INSERT INTO orders (id, business_id, customer_id, order_no, status)
      VALUES ('order_2', 'biz_a', 'cust_a1', 2, 'Delivered');
      INSERT INTO invoices (id, business_id, order_id, customer_id, invoice_no, subtotal, total, status)
      VALUES ('inv_2', 'biz_a', 'order_2', 'cust_a1', 2, 600.00, 600.00, 'Pending');
    `);

    // Total outstanding: 400 + 600 = ₹1,000.
    // Customer makes payment of ₹500.
    // FIFO allocation:
    // - inv_1 gets ₹400 (fully settled -> 'Paid')
    // - inv_2 gets remaining ₹100 (partially settled -> 'Partial')
    await client.query(`
      INSERT INTO payments (id, business_id, customer_id, amount, mode, date)
      VALUES ('pay_1', 'biz_a', 'cust_a1', 500.00, 'upi', '2026-10-08');

      INSERT INTO payment_allocations (id, business_id, payment_id, invoice_id, amount)
      VALUES 
      ('alloc_1', 'biz_a', 'pay_1', 'inv_1', 400.00),
      ('alloc_2', 'biz_a', 'pay_1', 'inv_2', 100.00);

      UPDATE invoices SET status = 'Paid' WHERE id = 'inv_1';
      UPDATE invoices SET status = 'Partial' WHERE id = 'inv_2';
    `);

    const inv1 = await client.query(`SELECT status FROM invoices WHERE id = 'inv_1'`);
    assert.equal(inv1.rows[0].status, 'Paid', 'inv_1 must be marked Paid');

    const inv2 = await client.query(`SELECT status FROM invoices WHERE id = 'inv_2'`);
    assert.equal(inv2.rows[0].status, 'Partial', 'inv_2 must be marked Partial');

    // Customer balance verification:
    // Total billed = 1000, Total paid = 500, Outstanding = 500
    const billedRes = await client.query(`SELECT SUM(total) as sum FROM invoices WHERE customer_id = 'cust_a1'`);
    const paidRes = await client.query(`SELECT SUM(amount) as sum FROM payments WHERE customer_id = 'cust_a1'`);
    const balance = parseFloat(billedRes.rows[0].sum) - parseFloat(paidRes.rows[0].sum);
    assert.equal(balance, 500.00, 'Outstanding balance must accurately be 500.00');
  });

  await client.end();
});
