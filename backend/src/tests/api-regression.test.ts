import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { startIsolatedPostgres } from './helpers/isolated-postgres.js';

let database: Awaited<ReturnType<typeof startIsolatedPostgres>>;
let server: Server;
let base: string;
let owner: any;
let pool: typeof import('../database/connection.js').pool;
let fixtureNo = 0;

async function fixture(price = 100) {
  fixtureNo += 1;
  const number = fixtureNo;
  const customer = await request('/api/customers', { name: `Customer ${number}`, phone: `90000${String(number).padStart(5, '0')}` });
  const product = await request('/api/products', { name: `Product ${number}`, unit: 'kg', currentPrice: price, category: 'Staples' });
  assert.equal(customer.status, 201, JSON.stringify(customer.data));
  assert.equal(product.status, 201, JSON.stringify(product.data));
  return { customer: customer.data, product: product.data };
}

async function makeOrder(customerId: string, productId: string, quantity = 1) {
  const result = await request('/api/orders', { customerId, items: [{ productId, quantity }] });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

async function invoiceFor(orderId: string) {
  const result = await request(`/api/invoices/order/${orderId}/generate`, {}, 'POST');
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}

async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', token = owner?.token) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data: any = await response.json();
  return { status: response.status, data };
}

before(async () => {
  database = await startIsolatedPostgres();
  const { runMigrations } = await import('../database/migrator.js');
  const { createApp } = await import('../app.js');
  ({ pool } = await import('../database/connection.js'));
  await runMigrations();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const registration = await request('/api/auth/register', {
    businessName: 'Ledger Test', businessSlug: 'ledger-test', categoryTemplate: 'custom',
    ownerName: 'Test Owner', email: 'owner@example.test', password: 'isolated-password'
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.data));
  owner = registration.data;
});

after(async () => {
  if (server) await new Promise<void>(done => server.close(() => done()));
  if (pool) await pool.end();
  if (database) await database.stop();
});

test('product price edits accept the public camelCase field and persist it', async () => {
  const created = await request('/api/products', { name: 'Rice', unit: 'kg', currentPrice: 100 });
  assert.equal(created.status, 201);
  const edited = await request(`/api/products/${created.data.id}`, { currentPrice: 125 }, 'PATCH');
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.current_price, 125);
});

test('customer credit edits accept the public camelCase field and persist it', async () => {
  const created = await request('/api/customers', { name: 'Cafe', phone: '9876543210' });
  assert.equal(created.status, 201);
  const edited = await request(`/api/customers/${created.data.id}`, { creditTermsDays: 14 }, 'PATCH');
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.credit_terms_days, 14);
});

test('business invoice trigger edits accept the public camelCase field', async () => {
  const edited = await request('/api/business', { invoiceTrigger: 'Packed' }, 'PATCH');
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.invoice_trigger, 'Packed');
});

test('catalog category, edit, archive and restore persist without deleting financial history', async () => {
  const { customer, product } = await fixture();
  assert.equal(product.category, 'Staples');
  const order = await makeOrder(customer.id, product.id);
  const invoice = await invoiceFor(order.id);
  assert.equal((await request(`/api/products/${product.id}`, { name: 'Renamed catalog item', currentPrice: 999, unit: 'box', category: 'New' }, 'PATCH')).status, 200);
  const historical = await request(`/api/invoices/${invoice.id}`);
  assert.equal(historical.data.items[0].product_name, product.name);
  assert.equal(historical.data.items[0].unit, 'kg');
  assert.equal(historical.data.total, 100);
  assert.equal((await request(`/api/customers/${customer.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await request(`/api/products/${product.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await request(`/api/invoices/${invoice.id}`)).status, 200);
  assert.equal((await request('/api/customers?all=true&limit=500')).data.find((c: any) => c.id === customer.id).active, false);
  assert.equal((await request('/api/products?all=true&limit=500')).data.find((p: any) => p.id === product.id).active, false);
  assert.equal((await request('/api/orders', { customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] })).status, 400);
  assert.equal((await request(`/api/customers/${customer.id}`, { active: true }, 'PATCH')).status, 200);
  assert.equal((await request(`/api/products/${product.id}`, { active: true }, 'PATCH')).status, 200);
});

test('concurrent orders and invoices have unique tenant numbers; invoice generation is idempotent', async () => {
  const { customer, product } = await fixture();
  const orders = await Promise.all(Array.from({ length: 12 }, () => makeOrder(customer.id, product.id)));
  assert.equal(new Set(orders.map(o => o.order_no)).size, 12);
  const invoices = await Promise.all(orders.map(o => invoiceFor(o.id)));
  assert.equal(new Set(invoices.map(i => i.invoice_no)).size, 12);
  const repeated = await Promise.all(Array.from({ length: 6 }, () => invoiceFor(orders[0].id)));
  assert.equal(new Set(repeated.map(i => i.id)).size, 1);
});

test('delivery and invoice creation roll back together and a repeated status request is safe', async () => {
  await request('/api/business', { invoiceTrigger: 'Delivered' }, 'PATCH');
  const { customer, product } = await fixture();
  const order = await makeOrder(customer.id, product.id);
  assert.equal((await request(`/api/orders/${order.id}/status`, { status: 'Packed' }, 'PATCH')).status, 200);
  await pool.query(`CREATE FUNCTION test_reject_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected invoice failure'; END $$;
    CREATE TRIGGER test_reject_invoice BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION test_reject_invoice()`);
  try {
    assert.equal((await request(`/api/orders/${order.id}/status`, { status: 'Delivered' }, 'PATCH')).status, 500);
    const unchanged = await request(`/api/orders/${order.id}`);
    assert.equal(unchanged.data.status, 'Packed');
    assert.equal(unchanged.data.invoice_id, null);
    assert.equal(unchanged.data.history.length, 2);
  } finally {
    await pool.query('DROP TRIGGER test_reject_invoice ON invoices; DROP FUNCTION test_reject_invoice()');
  }
  const delivered = await request(`/api/orders/${order.id}/status`, { status: 'Delivered' }, 'PATCH');
  assert.equal(delivered.status, 200, JSON.stringify(delivered.data));
  assert.ok(delivered.data.invoice_id);
  const retried = await request(`/api/orders/${order.id}/status`, { status: 'Delivered' }, 'PATCH');
  assert.equal(retried.status, 200);
  assert.equal(retried.data.invoice_id, delivered.data.invoice_id);
  assert.equal(retried.data.history.length, 3);
  assert.equal((await request(`/api/orders/${order.id}/status`, { status: 'Received' }, 'PATCH')).status, 409);
});

test('equal invoices and equal payments are all counted in customer list, detail and statement', async () => {
  const { customer, product } = await fixture();
  await invoiceFor((await makeOrder(customer.id, product.id)).id);
  await invoiceFor((await makeOrder(customer.id, product.id)).id);
  for (let i = 0; i < 2; i += 1) assert.equal((await request('/api/payments', { customerId: customer.id, amount: 25, mode: 'cash' })).status, 201);
  const listed = (await request('/api/customers?all=true&limit=500')).data.find((c: any) => c.id === customer.id);
  const detailed = (await request(`/api/customers/${customer.id}`)).data;
  for (const data of [listed, detailed]) {
    assert.equal(data.total_billed, 200);
    assert.equal(data.total_paid, 50);
    assert.equal(data.outstanding_balance, 150);
  }
  const statement = (await request(`/api/customers/${customer.id}/statement`)).data;
  assert.equal(statement.entries.length, 4);
  assert.equal(statement.currentOutstanding, 150);
});

test('FIFO payments settle oldest invoices first and keep any overpayment as credit', async () => {
  const { customer, product } = await fixture();
  const first = await invoiceFor((await makeOrder(customer.id, product.id)).id);
  const second = await invoiceFor((await makeOrder(customer.id, product.id)).id);
  const payment = await request('/api/payments', { customerId: customer.id, amount: 150 });
  assert.equal(payment.status, 201);
  assert.equal(payment.data.allocations.find((a: any) => a.invoice_id === first.id).amount, 100);
  assert.equal(payment.data.allocations.find((a: any) => a.invoice_id === second.id).amount, 50);
  assert.equal((await request(`/api/invoices/${first.id}`)).data.status, 'Paid');
  assert.equal((await request(`/api/invoices/${second.id}`)).data.status, 'Partial');
  const remainder = await request('/api/payments', { customerId: customer.id, amount: 100 });
  assert.equal(remainder.data.unallocated_amount, 50);
  assert.equal((await request(`/api/invoices/${second.id}`)).data.remaining_amount, 0);
});

test('explicit allocation cannot overpay an invoice or partially save invalid allocations', async () => {
  const { customer, product } = await fixture();
  const invoice = await invoiceFor((await makeOrder(customer.id, product.id)).id);
  assert.equal((await request('/api/payments', { customerId: customer.id, amount: 60, mode: 'cash' })).status, 201);
  const invalid = await request('/api/payments', { customerId: customer.id, amount: 50, specificInvoiceAllocations: [{ invoiceId: invoice.id, amount: 50 }] });
  assert.equal(invalid.status, 400, JSON.stringify(invalid.data));
  assert.equal((await request(`/api/payments?customerId=${customer.id}`)).data.length, 1);
  assert.equal((await request(`/api/invoices/${invoice.id}`)).data.remaining_amount, 40);
  const duplicate = await request('/api/payments', { customerId: customer.id, amount: 20, specificInvoiceAllocations: [{ invoiceId: invoice.id, amount: 10 }, { invoiceId: invoice.id, amount: 10 }] });
  assert.equal(duplicate.status, 400);
  assert.equal((await request(`/api/payments?customerId=${customer.id}`)).data.length, 1);
});

test('concurrent allocations recheck invoice balances under locks', async () => {
  const { customer, product } = await fixture();
  const invoice = await invoiceFor((await makeOrder(customer.id, product.id)).id);
  const responses = await Promise.all(Array.from({ length: 2 }, () => request('/api/payments', {
    customerId: customer.id, amount: 80, specificInvoiceAllocations: [{ invoiceId: invoice.id, amount: 80 }]
  })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 400]);
  const saved = (await request(`/api/invoices/${invoice.id}`)).data;
  assert.equal(saved.allocated_amount, 80);
  assert.equal(saved.remaining_amount, 20);
});

test('advance payments remain credit and settle new invoices without negative invoice balances', async () => {
  const { customer, product } = await fixture();
  const advance = await request('/api/payments', { customerId: customer.id, amount: 150, mode: 'cash' });
  assert.equal(advance.status, 201);
  assert.equal(advance.data.unallocated_amount, 150);
  const invoice = await invoiceFor((await makeOrder(customer.id, product.id)).id);
  assert.equal(invoice.status, 'Paid');
  assert.equal(invoice.remaining_amount, 0);
  assert.equal((await request(`/api/payments?customerId=${customer.id}`)).data[0].unallocated_amount, 50);
  assert.equal((await request(`/api/customers/${customer.id}/statement`)).data.currentOutstanding, -50);
});

test('tax rate, credit terms, item prices and invoice prefix are historical snapshots', async () => {
  const settings = await request('/api/business', { settings: { billing: { taxRate: 18, invoicePrefix: 'SALE', defaultCreditTermsDays: 21 } } }, 'PATCH');
  assert.equal(settings.status, 200);
  const { customer, product } = await fixture();
  assert.equal(customer.credit_terms_days, 21);
  const order = await makeOrder(customer.id, product.id);
  assert.equal(order.subtotal, 100);
  assert.equal(order.tax, 18);
  assert.equal(order.total_amount, 118);
  await request('/api/business', { settings: { billing: { taxRate: 5 } } }, 'PATCH');
  await request(`/api/customers/${customer.id}`, { creditTermsDays: 1 }, 'PATCH');
  const invoice = await invoiceFor(order.id);
  assert.equal(invoice.total, 118);
  assert.equal(invoice.tax_rate, 18);
  assert.equal(invoice.credit_terms_days, 21);
  assert.equal(invoice.invoice_prefix, 'SALE');
  await request('/api/business', { settings: { billing: { taxRate: 0, invoicePrefix: 'INV', defaultCreditTermsDays: 7 } } }, 'PATCH');
  assert.equal((await request(`/api/invoices/${invoice.id}`)).data.invoice_prefix, 'SALE');
});

test('invalid values and unavailable records produce useful client errors', async () => {
  const { customer } = await fixture();
  assert.equal((await request('/api/payments', { customerId: customer.id, amount: 10, date: '2026-02-30' })).status, 400);
  assert.equal((await request('/api/payments', { customerId: customer.id, amount: 0.001 })).status, 400);
  assert.equal((await request('/api/products/not-a-uuid')).status, 400);
  assert.equal((await request('/api/orders?limit=-1')).status, 400);
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal((await request('/api/orders', { customerId: customer.id, items: [{ productId: missing, quantity: 1 }] })).status, 400);
  assert.equal((await request('/api/payments', { customerId: missing, amount: 10 })).status, 400);
});

test('tenant boundaries and role permissions are enforced on ledger mutations', async () => {
  const { customer, product } = await fixture();
  const second = (await request('/api/auth/register', { businessName: 'Second business', businessSlug: 'second-business', categoryTemplate: 'custom', ownerName: 'Second Owner', email: 'second@example.test', password: 'isolated-password' }, 'POST', '')).data;
  assert.equal((await request(`/api/products/${product.id}`, undefined, 'GET', second.token)).status, 404);
  assert.equal((await request(`/api/customers/${customer.id}`, { name: 'Wrong tenant' }, 'PATCH', second.token)).status, 404);
  assert.equal((await request('/api/orders', { customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] }, 'POST', second.token)).status, 400);
  assert.equal((await request(`/api/customers/${customer.id}/statement`, undefined, 'GET', second.token)).status, 404);
  const protectedInvoice = await invoiceFor((await makeOrder(customer.id, product.id)).id);
  const otherCustomer = (await request('/api/customers', { name: 'Other business customer', phone: '9999991111' }, 'POST', second.token)).data;
  const crossAllocation = await request('/api/payments', { customerId: otherCustomer.id, amount: 10,
    specificInvoiceAllocations: [{ invoiceId: protectedInvoice.id, amount: 10 }] }, 'POST', second.token);
  assert.equal(crossAllocation.status, 400);
  assert.equal((await request(`/api/payments?customerId=${otherCustomer.id}`, undefined, 'GET', second.token)).data.length, 0);
  const { default: jwt } = await import('jsonwebtoken');
  const delivery = jwt.sign({ userId: owner.user.id, businessId: owner.business.id, role: 'DELIVERY', email: 'delivery@example.test', name: 'Delivery' }, process.env.JWT_SECRET!);
  assert.equal((await request('/api/products', { name: 'Forbidden', unit: 'kg', currentPrice: 1 }, 'POST', delivery)).status, 403);
  assert.equal((await request('/api/payments', { customerId: customer.id, amount: 10 }, 'POST', delivery)).status, 403);
});

test('configured payment methods and module switches control new payment saves', async () => {
  const { customer } = await fixture();
  await request('/api/business', { settings: { billing: { paymentMethods: ['upi'] } } }, 'PATCH');
  assert.equal((await request('/api/payments', { customerId: customer.id, amount: 10, mode: 'cash' })).status, 400);
  assert.equal((await request('/api/payments', { customerId: customer.id, amount: 10, mode: 'upi' })).status, 201);
  await request('/api/business', { settings: { modules: { payments: false } } }, 'PATCH');
  assert.equal((await request('/api/payments', { customerId: customer.id, amount: 10, mode: 'upi' })).status, 403);
  await request('/api/business', { settings: { modules: { payments: true }, billing: { paymentMethods: ['cash', 'upi', 'bank_transfer', 'cheque'] } } }, 'PATCH');
});

test('payment effective dates and inclusive end dates agree across reports and statements', async () => {
  const { customer, product } = await fixture();
  const order = await makeOrder(customer.id, product.id);
  const invoice = await invoiceFor(order.id);
  await pool.query("UPDATE orders SET created_at = '2026-01-31T21:00:00Z' WHERE id = $1", [order.id]);
  await pool.query("UPDATE invoices SET created_at = '2026-01-31T21:00:00Z' WHERE id = $1", [invoice.id]);
  const payment = await request('/api/payments', { customerId: customer.id, amount: 25, date: '2026-01-31', mode: 'cash' });
  assert.equal(payment.status, 201);
  assert.equal(payment.data.date, '2026-01-31');
  const statement = await request(`/api/reports/statement/${customer.id}?startDate=2026-01-31&endDate=2026-01-31`);
  assert.equal(statement.data.entries.length, 2);
  assert.equal(statement.data.totalPaid, 25);
  assert.equal(statement.data.totalBilled, 100);
  const collections = await request('/api/reports/collections?startDate=2026-01-31&endDate=2026-01-31');
  assert.equal(collections.data.totalCollected, 25);
  const sales = await request('/api/reports/sales?startDate=2026-01-31&endDate=2026-01-31');
  assert.equal(sales.data.totalOrders, 1);
  const products = await request('/api/reports/top-products?startDate=2026-01-31&endDate=2026-01-31&limit=500');
  assert.equal(products.data.find((p: any) => p.id === product.id).totalRevenue, 100);
  const outside = await request('/api/reports/top-products?startDate=2026-02-01&endDate=2026-02-28&limit=500');
  assert.equal(outside.data.find((p: any) => p.id === product.id).totalRevenue, 0);
  const feb = await request(`/api/reports/statement/${customer.id}?startDate=2026-02-01&endDate=2026-02-28`);
  assert.equal(feb.data.openingBalance, 75);
  assert.equal(feb.data.entries.length, 0);
});

test('all collections use stable limit/offset paging and validate report date ranges', async () => {
  for (const endpoint of ['products', 'customers', 'orders', 'invoices', 'payments']) {
    const first = await request(`/api/${endpoint}?all=true&limit=1&offset=0`);
    const next = await request(`/api/${endpoint}?all=true&limit=1&offset=1`);
    assert.equal(first.status, 200);
    assert.equal(next.status, 200);
    assert.equal(first.data.length, 1);
    assert.equal(next.data.length, 1);
    assert.notEqual(first.data[0].id, next.data[0].id);
    assert.equal((await request(`/api/${endpoint}?limit=501`)).status, 400);
  }
  assert.equal((await request('/api/reports/sales?startDate=2026-02-30')).status, 400);
  assert.equal((await request('/api/reports/collections?startDate=2026-03-01&endDate=2026-02-28')).status, 400);
});

test('health reports pending migrations and becomes ready only when all are recorded', async () => {
  const healthy = await request('/health', undefined, 'GET', '');
  assert.equal(healthy.status, 200);
  assert.equal(healthy.data.apiVersion, 2);
  await pool.query("DELETE FROM _migrations WHERE filename = '005_ledger_snapshots.sql'");
  try {
    assert.equal((await request('/health', undefined, 'GET', '')).status, 503);
  } finally {
    await pool.query("INSERT INTO _migrations (filename) VALUES ('005_ledger_snapshots.sql')");
  }
  assert.equal((await request('/health', undefined, 'GET', '')).status, 200);
});

test('deferred WhatsApp endpoints expose neither message history nor ingestion', async () => {
  assert.equal((await request('/api/whatsapp/messages', undefined, 'GET', '')).status, 503);
  assert.equal((await request('/api/whatsapp/clear', {}, 'POST', '')).status, 503);
  assert.equal((await request('/webhooks/whatsapp', {}, 'POST', '')).status, 503);
});

test('PDF endpoint returns a real document without a browser runtime', async () => {
  const { customer } = await fixture();
  const response = await fetch(`${base}/api/reports/statement/${customer.id}/pdf`, { headers: { Authorization: `Bearer ${owner.token}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/pdf/);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});
