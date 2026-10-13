import assert from 'node:assert/strict';

const API_BASE = 'http://localhost:5000/api';

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

async function runEndToEndJourney() {
  console.log('🚀 STARTING REAL USER JOURNEY & TENANT ISOLATION ACCEPTANCE TEST...');

  // 1. Register Business 1 (Fruits & Veg vendor)
  const runId = Date.now().toString().slice(-6);
  console.log(`\n--- Step 1: Register Business 1 (Greenfield Fresh ${runId}) ---`);
  const reg1 = await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      businessName: `Greenfield Fresh Farm ${runId}`,
      businessSlug: `greenfield-${runId}`,
      categoryTemplate: 'fruits_veg',
      phone: `98${runId}210`,
      ownerName: 'Sunil Rao',
      email: `sunil_${runId}@greenfield.app`,
      password: 'password123'
    })
  });
  const token1 = reg1.token;
  const biz1 = reg1.business;
  console.log('✅ Registered Business 1:', biz1.name, '(ID:', biz1.id, ')');

  // Verify products seeded
  console.log('\n--- Step 2: Verify Fruits & Veg Seeded Catalog ---');
  const prods1 = await req('/products', {}, token1);
  console.log('✅ Seeded Products Count:', prods1.length);
  assert(prods1.length >= 4, 'Must seed fruits & vegetables items');
  const tomato = prods1.find(p => p.name.includes('Tomato'));
  const potato = prods1.find(p => p.name.includes('Potato'));
  assert(tomato, 'Tomato must exist');
  assert(potato, 'Potato must exist');
  console.log(`   Sample item: ${tomato.name} - ₹${tomato.current_price}/${tomato.unit}`);

  // Step 3: Create Customer
  console.log('\n--- Step 3: Create Restaurant Customer ---');
  const cust1 = await req('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Taj Gateway Restaurant',
      phone: '9845012345',
      creditTermsDays: 7
    })
  }, token1);
  console.log('✅ Created Customer:', cust1.name, '(ID:', cust1.id, ')');

  // Step 4: Create Manual Order
  console.log('\n--- Step 4: Create Manual Order with Frozen Prices ---');
  // 10kg Tomato @ 40 + 20kg Potato @ 30 = 400 + 600 = ₹1000
  const order1 = await req('/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerId: cust1.id,
      notes: 'Deliver early morning by 6 AM',
      items: [
        { productId: tomato.id, quantity: 10 },
        { productId: potato.id, quantity: 20 }
      ]
    })
  }, token1);
  console.log('✅ Created Order #', order1.order_no, 'Status:', order1.status, 'Total: ₹', order1.total_amount);
  assert.equal(order1.status, 'Received', 'Initial order status must be Received');
  assert.equal(order1.total_amount, 1000, 'Total amount must equal 1000.00');

  // Step 5: Advance to Packed
  console.log('\n--- Step 5: Advance Status to Packed ---');
  const packedOrder = await req(`/orders/${order1.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Packed' })
  }, token1);
  console.log('✅ Order Status updated to:', packedOrder.status);
  assert.equal(packedOrder.status, 'Packed');

  // Step 6: Advance to Delivered (Triggering Invoice generation)
  console.log('\n--- Step 6: Advance Status to Delivered (Triggering Invoice) ---');
  const deliveredOrder = await req(`/orders/${order1.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Delivered' })
  }, token1);
  console.log('✅ Order Status updated to:', deliveredOrder.status);
  assert.equal(deliveredOrder.status, 'Delivered');

  // Step 7: Verify Invoice Generation
  console.log('\n--- Step 7: Verify Invoice Generated at Trigger ---');
  const invoices = await req('/invoices', {}, token1);
  assert.equal(invoices.length, 1, 'Exactly 1 invoice must be generated');
  const inv1 = invoices[0];
  console.log(`✅ Invoice Generated: INV-${String(inv1.invoice_no).padStart(4, '0')} | Total: ₹${inv1.total} | Status: ${inv1.status}`);
  assert.equal(inv1.total, 1000, 'Invoice total must equal order total');
  assert.equal(inv1.status, 'Pending', 'Initial invoice status must be Pending (₹0 paid)');

  // Step 8: Record Partial Payment (₹400)
  console.log('\n--- Step 8: Record Partial Payment (₹400) ---');
  const pay1 = await req('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customerId: cust1.id,
      amount: 400,
      mode: 'upi',
      reference: 'UPI-TXN-90218'
    })
  }, token1);
  console.log('✅ Recorded Payment ₹400 via UPI');

  // Verify Invoice status is now 'Partial'
  const invAfterPartial = await req(`/invoices/${inv1.id}`, {}, token1);
  console.log(`✅ Invoice status after partial payment: ${invAfterPartial.status} (Allocated: ₹${invAfterPartial.allocated_amount}, Due: ₹${invAfterPartial.remaining_amount})`);
  assert.equal(invAfterPartial.status, 'Partial', 'Invoice must transition to Partial');

  // Step 9: Record Remaining Payment (₹600)
  console.log('\n--- Step 9: Record Remaining Payment (₹600) ---');
  const pay2 = await req('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customerId: cust1.id,
      amount: 600,
      mode: 'cash'
    })
  }, token1);
  console.log('✅ Recorded Payment ₹600 via Cash');

  // Verify Invoice status is now 'Paid'
  const invAfterFull = await req(`/invoices/${inv1.id}`, {}, token1);
  console.log(`✅ Invoice status after full payment: ${invAfterFull.status} (Allocated: ₹${invAfterFull.allocated_amount}, Due: ₹${invAfterFull.remaining_amount})`);
  assert.equal(invAfterFull.status, 'Paid', 'Invoice must transition to Paid');

  // Step 10: Verify Customer Outstanding Balance = 0
  console.log('\n--- Step 10: Verify Customer Outstanding Balance = 0 ---');
  const custAfterPay = await req(`/customers/${cust1.id}`, {}, token1);
  console.log(`✅ Customer Ledger: Billed=₹${custAfterPay.total_billed}, Paid=₹${custAfterPay.total_paid}, Outstanding=₹${custAfterPay.outstanding_balance}`);
  assert.equal(custAfterPay.outstanding_balance, 0, 'Customer outstanding balance must be 0');

  // Step 11: Customer Statement
  console.log('\n--- Step 11: Verify Customer Running Balance Statement ---');
  const statement = await req(`/customers/${cust1.id}/statement`, {}, token1);
  console.log(`✅ Statement entries count: ${statement.entries.length}`);
  statement.entries.forEach(e => {
    console.log(`   ${e.type} | ${e.reference_no} | Debit: ₹${e.debit} | Credit: ₹${e.credit} | Running Balance: ₹${e.running_balance}`);
  });
  assert.equal(statement.currentOutstanding, 0);

  // Step 12: Verify Dashboard Totals
  console.log('\n--- Step 12: Verify Dashboard Summary Aggregation ---');
  const dash = await req('/dashboard/summary', {}, token1);
  console.log(`✅ Dashboard: Today Sales = ₹${dash.todaySales}, Today Orders = ${dash.todayOrdersCount}, Total Collected = ₹${dash.totalCollected}, Outstanding = ₹${dash.totalOutstanding}`);
  assert.equal(dash.todaySales, 1000);
  assert.equal(dash.todayOrdersCount, 1);
  assert.equal(dash.totalCollected, 1000);
  assert.equal(dash.totalOutstanding, 0);

  // Step 13: Strict Multi-Tenant Isolation Test with Business 2
  console.log('\n--- Step 13: Multi-Tenant Isolation with Business 2 ---');
  const reg2 = await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      businessName: `Dairy Express ${runId}`,
      businessSlug: `dairy-express-${runId}`,
      categoryTemplate: 'dairy',
      phone: `91${runId}777`,
      ownerName: 'Vikas Sharma',
      email: `vikas_${runId}@dairyexpress.app`,
      password: 'password123'
    })
  });
  const token2 = reg2.token;
  console.log('✅ Registered Business 2: Dairy Express (Slug:', reg2.business.slug, ')');

  // Verify Business 2 cannot see Business 1 customers
  const biz2Customers = await req('/customers', {}, token2);
  console.log('✅ Business 2 customer count:', biz2Customers.length, '(Must be 0)');
  assert.equal(biz2Customers.length, 0, 'Business 2 must NOT see Business 1 customers');

  // Verify Business 2 cannot access Business 1 order by ID directly
  let crossTenantOrderBlocked = false;
  try {
    await req(`/orders/${order1.id}`, {}, token2);
  } catch (err) {
    crossTenantOrderBlocked = true;
    console.log('✅ Business 2 blocked from accessing Business 1 order:', err.message);
  }
  assert(crossTenantOrderBlocked, 'Accessing cross-tenant order must return 404/403');

  // Verify Business 2 cannot access Business 1 invoice by ID directly
  let crossTenantInvoiceBlocked = false;
  try {
    await req(`/invoices/${inv1.id}`, {}, token2);
  } catch (err) {
    crossTenantInvoiceBlocked = true;
    console.log('✅ Business 2 blocked from accessing Business 1 invoice:', err.message);
  }
  assert(crossTenantInvoiceBlocked, 'Accessing cross-tenant invoice must return 404/403');

  console.log('\n🎉 ALL PHASE 1 ACCEPTANCE CRITERIA TESTS PASSED WITH 100% SUCCESS!');
}

runEndToEndJourney().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
