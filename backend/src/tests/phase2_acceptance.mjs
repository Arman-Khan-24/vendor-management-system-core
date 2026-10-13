import assert from 'node:assert/strict';

const API_BASE = 'http://localhost:5000/api';

async function req(endpoint, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  
  if (options.asBuffer) {
    if (!res.ok) throw new Error(`[${res.status}] PDF request failed`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`[${res.status}] ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

async function runPhase2Tests() {
  console.log('🚀 STARTING PHASE 2 AUTOMATED TEST SUITE (REPORTS, STATEMENTS & PDF)...');

  const runId = Date.now().toString().slice(-6);

  // 1. Setup Tenant A
  console.log('\n--- 1. Register Tenant A & Seed Data ---');
  const regA = await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      businessName: `Fresh Farms ${runId}`,
      businessSlug: `fresh-farms-${runId}`,
      categoryTemplate: 'fruits_veg',
      phone: `99${runId}11`,
      ownerName: 'Ramesh Patel',
      email: `ramesh_${runId}@freshfarms.app`,
      password: 'password123'
    })
  });
  const tokenA = regA.token;
  console.log('✅ Registered Tenant A:', regA.business.name);

  // Fetch seeded products
  const prodsA = await req('/products', {}, tokenA);
  const tomato = prodsA[0];
  const potato = prodsA[1];

  // Create Customers: Cust 1 (Taj Hotel - 7 days credit), Cust 2 (Green Leaf Cafe - 1 day credit)
  const cust1 = await req('/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Taj Hotel Resort', phone: `91${runId}01`, creditTermsDays: 7 })
  }, tokenA);

  const cust2 = await req('/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Green Leaf Cafe', phone: `91${runId}02`, creditTermsDays: 0 })
  }, tokenA);
  console.log('✅ Created 2 Customers for Tenant A');

  // 2. Create Orders & advance to trigger Invoices
  console.log('\n--- 2. Create Orders & Generate Invoices ---');
  // Order 1 for Cust 1: 50kg Tomatoes @ price
  const ord1 = await req('/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerId: cust1.id,
      items: [{ productId: tomato.id, quantity: 50 }]
    })
  }, tokenA);
  await req(`/orders/${ord1.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Packed' }) }, tokenA);
  await req(`/orders/${ord1.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Delivered' }) }, tokenA);

  // Order 2 for Cust 1: 20kg Potatoes
  const ord2 = await req('/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerId: cust1.id,
      items: [{ productId: potato.id, quantity: 20 }]
    })
  }, tokenA);
  await req(`/orders/${ord2.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Packed' }) }, tokenA);
  await req(`/orders/${ord2.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Delivered' }) }, tokenA);

  // Order 3 for Cust 2: 10kg Tomatoes
  const ord3 = await req('/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerId: cust2.id,
      items: [{ productId: tomato.id, quantity: 10 }]
    })
  }, tokenA);
  await req(`/orders/${ord3.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Packed' }) }, tokenA);
  await req(`/orders/${ord3.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Delivered' }) }, tokenA);

  const ord1Total = ord1.total_amount;
  const ord2Total = ord2.total_amount;
  const ord3Total = ord3.total_amount;
  const cust1TotalBilled = ord1Total + ord2Total;
  console.log(`✅ Created 3 orders & invoices. Cust 1 total: ₹${cust1TotalBilled}, Cust 2 total: ₹${ord3Total}`);

  // 3. Record Partial Payments
  console.log('\n--- 3. Record Partial Collections ---');
  // Pay ₹500 against Cust 1
  const pay1 = await req('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customerId: cust1.id,
      amount: 500,
      mode: 'upi',
      reference: 'UPI-REF-001'
    })
  }, tokenA);
  console.log('✅ Recorded ₹500 payment for Cust 1');

  // 4. Test Customer Statement API
  console.log('\n--- 4. Verify Customer Statement (Ledger & Running Balance) ---');
  const stmt = await req(`/reports/statement/${cust1.id}`, {}, tokenA);
  assert.equal(stmt.customer.id, cust1.id);
  assert.equal(stmt.entries.length, 3, 'Must have 2 invoices and 1 payment');
  assert.equal(stmt.totalBilled, cust1TotalBilled);
  assert.equal(stmt.totalPaid, 500);
  assert.equal(stmt.currentOutstanding, cust1TotalBilled - 500);
  assert.equal(stmt.entries[stmt.entries.length - 1].running_balance, cust1TotalBilled - 500);
  console.log(`✅ Statement verified: Total Billed ₹${stmt.totalBilled}, Paid ₹${stmt.totalPaid}, Running Bal ₹${stmt.closingBalance}`);

  // 5. Test Statement PDF Generation Endpoint
  console.log('\n--- 5. Verify PDF Generation via Puppeteer ---');
  const pdfBuffer = await req(`/reports/statement/${cust1.id}/pdf`, { asBuffer: true }, tokenA);
  assert(pdfBuffer.length > 1000, 'PDF buffer must be valid size');
  const pdfHeader = pdfBuffer.slice(0, 5).toString('ascii');
  assert.equal(pdfHeader, '%PDF-', 'Must return authentic PDF signature %PDF-');
  console.log(`✅ PDF statement generated successfully! Size: ${pdfBuffer.length} bytes, Header: ${pdfHeader}`);

  // 6. Test Dues / Outstanding & Overdue Report
  console.log('\n--- 6. Verify Dues & Outstanding Report ---');
  const dues = await req('/reports/dues', {}, tokenA);
  assert(dues.totalOutstanding >= cust1TotalBilled - 500 + ord3Total);
  assert(dues.customers.length >= 2, 'Must list both customers with open balances');
  assert(dues.invoices.length >= 3, 'Must list all 3 open invoices');
  assert(dues.agingBuckets, 'Must have aging buckets breakdown');
  console.log(`✅ Dues report verified: Total Outstanding ₹${dues.totalOutstanding}, Customers with dues: ${dues.customerCountWithDues}`);

  // 7. Test Sales Report
  console.log('\n--- 7. Verify Sales Report Aggregations ---');
  const sales = await req('/reports/sales?interval=day', {}, tokenA);
  assert.equal(sales.totalOrders, 3);
  assert.equal(sales.totalSales, cust1TotalBilled + ord3Total);
  assert(sales.series.length >= 1, 'Series must have at least 1 day entry');
  console.log(`✅ Sales report verified: Orders ${sales.totalOrders}, Sales ₹${sales.totalSales}`);

  // 8. Test Collection Report
  console.log('\n--- 8. Verify Collection Report Aggregations ---');
  const coll = await req('/reports/collections?interval=day', {}, tokenA);
  assert.equal(coll.paymentCount, 1);
  assert.equal(coll.totalCollected, 500);
  assert.equal(coll.modeBreakdown[0].mode, 'upi');
  assert.equal(coll.modeBreakdown[0].amount, 500);
  console.log(`✅ Collection report verified: Count ${coll.paymentCount}, Amount ₹${coll.totalCollected}`);

  // 9. Test Top Customers
  console.log('\n--- 9. Verify Top Customers Ranking ---');
  const topCust = await req('/reports/top-customers?limit=5', {}, tokenA);
  assert.equal(topCust[0].id, cust1.id, 'Cust 1 must rank highest by sales');
  assert.equal(topCust[0].totalSales, cust1TotalBilled);
  assert.equal(topCust[0].totalPaid, 500);
  console.log(`✅ Top Customers verified: #1 ${topCust[0].name} (₹${topCust[0].totalSales})`);

  // 10. Test Top Products
  console.log('\n--- 10. Verify Top Products Ranking ---');
  const topProd = await req('/reports/top-products?limit=5', {}, tokenA);
  assert(topProd.length >= 2);
  console.log(`✅ Top Products verified: #1 ${topProd[0].name} (${topProd[0].totalQuantitySold} ${topProd[0].unit}, ₹${topProd[0].totalRevenue})`);

  // 11. Test Refined Dashboard Summary
  console.log('\n--- 11. Verify Refined Dashboard Summary Integration ---');
  const dash = await req('/dashboard/summary', {}, tokenA);
  assert.equal(dash.todaySales, cust1TotalBilled + ord3Total);
  assert.equal(dash.todayCollected, 500);
  assert.equal(dash.totalCollected, 500);
  assert(dash.salesTrend.length >= 1);
  assert(dash.topCustomers.length >= 1);
  assert(dash.topProducts.length >= 1);
  console.log('✅ Refined Dashboard summary returned complete trends & top lists');

  // 12. Test Cross-Tenant Isolation for All Phase 2 Endpoints
  console.log('\n--- 12. Verify Strict Tenant Isolation across Phase 2 Endpoints ---');
  const regB = await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      businessName: `Isolated Tenant B ${runId}`,
      businessSlug: `tenant-b-${runId}`,
      categoryTemplate: 'dairy',
      phone: `92${runId}22`,
      ownerName: 'Vikas Gupta',
      email: `vikas_${runId}@tenantb.app`,
      password: 'password123'
    })
  });
  const tokenB = regB.token;

  // Tenant B cannot access Tenant A's customer statement
  let blockedStatement = false;
  try {
    await req(`/reports/statement/${cust1.id}`, {}, tokenB);
  } catch (err) {
    blockedStatement = true;
    console.log('✅ Blocked Tenant B from Tenant A statement:', err.message);
  }
  assert(blockedStatement, 'Cross-tenant customer statement must return 404');

  // Tenant B cannot access Tenant A's statement PDF
  let blockedPdf = false;
  try {
    await req(`/reports/statement/${cust1.id}/pdf`, { asBuffer: true }, tokenB);
  } catch (err) {
    blockedPdf = true;
    console.log('✅ Blocked Tenant B from Tenant A statement PDF:', err.message);
  }
  assert(blockedPdf, 'Cross-tenant PDF statement must be blocked');

  // Tenant B reports must be completely empty / zero
  const duesB = await req('/reports/dues', {}, tokenB);
  assert.equal(duesB.totalOutstanding, 0, 'Tenant B total outstanding must be 0');
  assert.equal(duesB.customers.length, 0, 'Tenant B must see 0 customer dues');

  const salesB = await req('/reports/sales', {}, tokenB);
  assert.equal(salesB.totalSales, 0, 'Tenant B sales must be 0');
  assert.equal(salesB.totalOrders, 0, 'Tenant B orders must be 0');

  const collB = await req('/reports/collections', {}, tokenB);
  assert.equal(collB.totalCollected, 0, 'Tenant B collections must be 0');

  const topCustB = await req('/reports/top-customers', {}, tokenB);
  assert.equal(topCustB.length, 0, 'Tenant B top customers must be empty');

  const topProdB = await req('/reports/top-products', {}, tokenB);
  assert(topProdB.every(p => p.totalRevenue === 0), 'Tenant B top products must have 0 revenue');

  console.log('✅ All Phase 2 report endpoints verified 100% tenant-isolated!');

  console.log('\n🎉 ALL PHASE 2 TESTS (REPORTS, DUES, AGING, STATEMENTS, PDF, TENANT ISOLATION) PASSED!');
}

runPhase2Tests().catch(err => {
  console.error('\n❌ PHASE 2 TEST FAILED:', err);
  process.exit(1);
});
