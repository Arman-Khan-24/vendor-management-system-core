import { query } from '../database/connection.js';
import { normalizeBusinessSettings } from './business-settings.service.js';

export interface ReportDateFilter { startDate?: string; endDate?: string; }

/** Timestamped events use UTC calendar dates; payments retain their selected DATE. */
function dateConditions(column: string, params: unknown[], startDate?: string, endDate?: string, dateColumn = false): string[] {
  const conditions: string[] = [];
  if (startDate) {
    params.push(startDate);
    conditions.push(`${column} >= ${dateColumn ? `$${params.length}::date` : `($${params.length}::date::timestamp AT TIME ZONE 'UTC')`}`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`${column} < ${dateColumn ? `($${params.length}::date + 1)` : `(($${params.length}::date + 1)::timestamp AT TIME ZONE 'UTC')`}`);
  }
  return conditions;
}

const cents = (value: unknown) => Math.round(Number(value) * 100);

export class ReportsService {
  static async getCustomerStatement({ customerId, businessId, startDate, endDate }: {
    customerId: string; businessId: string; startDate?: string; endDate?: string;
  }) {
    const customers = await query(`SELECT c.id, c.name, c.phone, c.credit_terms_days, b.name AS business_name,
      b.slug AS business_slug, b.currency, b.settings, b.phone AS business_phone
      FROM customers c JOIN businesses b ON b.id = c.business_id WHERE c.id = $1 AND c.business_id = $2`, [customerId, businessId]);
    const customer = customers.rows[0];
    if (!customer) return null;
    const settings = normalizeBusinessSettings(customer.settings);
    const [billed, paid] = await Promise.all([
      query(`SELECT COALESCE(SUM(total), 0) AS total,
        COALESCE(SUM(total) FILTER (WHERE $3::date IS NOT NULL AND created_at < ($3::date::timestamp AT TIME ZONE 'UTC')), 0) AS prior
        FROM invoices WHERE customer_id = $1 AND business_id = $2`, [customerId, businessId, startDate ?? null]),
      query(`SELECT COALESCE(SUM(amount), 0) AS total,
        COALESCE(SUM(amount) FILTER (WHERE $3::date IS NOT NULL AND date < $3::date), 0) AS prior
        FROM payments WHERE customer_id = $1 AND business_id = $2`, [customerId, businessId, startDate ?? null])
    ]);
    const params: unknown[] = [customerId, businessId];
    const invoiceConditions = ['i.customer_id = $1', 'i.business_id = $2', ...dateConditions('i.created_at', params, startDate, endDate)];
    const paymentConditions = ['p.customer_id = $1', 'p.business_id = $2', ...dateConditions('p.date', params, startDate, endDate, true)];
    const events = await query(`SELECT * FROM (
      SELECT 'INVOICE' AS type, i.id AS reference_id,
        CONCAT(i.invoice_prefix, '-', LPAD(i.invoice_no::text, 4, '0')) AS reference_no,
        i.created_at AS date, i.created_at AS entered_at, i.total AS debit, 0 AS credit, i.status AS status
      FROM invoices i WHERE ${invoiceConditions.join(' AND ')}
      UNION ALL
      SELECT 'PAYMENT' AS type, p.id AS reference_id,
        COALESCE(p.reference, CONCAT('PAY-', p.mode)) AS reference_no,
        p.date::timestamp AT TIME ZONE 'UTC' AS date, p.created_at AS entered_at, 0 AS debit, p.amount AS credit, p.mode AS status
      FROM payments p WHERE ${paymentConditions.join(' AND ')}
    ) ledger ORDER BY date, entered_at, reference_id`, params);
    let runningCents = cents(billed.rows[0].prior) - cents(paid.rows[0].prior);
    const openingBalance = runningCents / 100;
    const entries = events.rows.map(row => {
      runningCents += cents(row.debit) - cents(row.credit);
      return { type: row.type, reference_id: row.reference_id, reference_no: row.reference_no, date: row.date,
        debit: Number(row.debit), credit: Number(row.credit), running_balance: runningCents / 100, status: row.status };
    });
    const periodBilled = entries.reduce((sum, e) => sum + cents(e.debit), 0) / 100;
    const periodPaid = entries.reduce((sum, e) => sum + cents(e.credit), 0) / 100;
    return {
      business: { name: customer.business_name, slug: customer.business_slug, currency: customer.currency,
        phone: customer.business_phone, address: settings.profile.address, footer: settings.billing.footer },
      customer: { id: customer.id, name: customer.name, phone: customer.phone, credit_terms_days: customer.credit_terms_days },
      period: { startDate, endDate, timezone: 'UTC' }, openingBalance, periodBilled, periodPaid,
      closingBalance: runningCents / 100, totalBilled: periodBilled, totalPaid: periodPaid,
      currentOutstanding: (cents(billed.rows[0].total) - cents(paid.rows[0].total)) / 100, entries
    };
  }

  static async getOutstandingReport({ businessId, asOfDate = new Date().toISOString().slice(0, 10) }: { businessId: string; asOfDate?: string }) {
    const result = await query(`SELECT i.id, CONCAT(i.invoice_prefix, '-', LPAD(i.invoice_no::text, 4, '0')) AS invoice_no,
      i.order_id, i.customer_id, c.name AS customer_name, c.phone AS customer_phone, i.credit_terms_days,
      i.created_at AS invoice_date, ((i.created_at AT TIME ZONE 'UTC')::date + i.credit_terms_days)::text AS due_date,
      i.total, paid.allocated AS allocated_amount, i.total - paid.allocated AS outstanding_amount,
      $2::date - ((i.created_at AT TIME ZONE 'UTC')::date + i.credit_terms_days) AS days_overdue,
      CASE WHEN paid.allocated >= i.total THEN 'Paid' WHEN paid.allocated > 0 THEN 'Partial' ELSE 'Pending' END AS status
      FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pa.amount), 0) AS allocated FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id AND p.business_id = pa.business_id
        WHERE pa.invoice_id = i.id AND pa.business_id = i.business_id AND p.date <= $2::date
      ) paid ON TRUE
      WHERE i.business_id = $1 AND i.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
        AND i.total - paid.allocated > 0
      ORDER BY i.created_at, i.invoice_no`, [businessId, asOfDate]);
    let totalOutstandingCents = 0;
    let totalOverdueCents = 0;
    const agingBuckets = { current: 0, overdue_1_7: 0, overdue_8_15: 0, overdue_16_30: 0, overdue_30_plus: 0 };
    const customerMap = new Map<string, { customerId: string; customerName: string; customerPhone: string; creditTermsDays: number;
      totalOutstanding: number; totalOverdue: number; oldestInvoiceDate: string; invoiceCount: number }>();
    const invoices = result.rows.map(row => {
      const outstandingCents = cents(row.outstanding_amount);
      const outstanding = outstandingCents / 100;
      const daysOverdue = Math.max(0, Number(row.days_overdue));
      const isOverdue = daysOverdue > 0;
      totalOutstandingCents += outstandingCents;
      if (isOverdue) totalOverdueCents += outstandingCents;
      const bucket = !isOverdue ? 'current' : daysOverdue <= 7 ? 'overdue_1_7' : daysOverdue <= 15 ? 'overdue_8_15' : daysOverdue <= 30 ? 'overdue_16_30' : 'overdue_30_plus';
      agingBuckets[bucket] = (cents(agingBuckets[bucket]) + outstandingCents) / 100;
      const summary = customerMap.get(row.customer_id) ?? { customerId: row.customer_id, customerName: row.customer_name,
        customerPhone: row.customer_phone, creditTermsDays: row.credit_terms_days, totalOutstanding: 0, totalOverdue: 0,
        oldestInvoiceDate: row.invoice_date, invoiceCount: 0 };
      summary.totalOutstanding = (cents(summary.totalOutstanding) + outstandingCents) / 100;
      if (isOverdue) summary.totalOverdue = (cents(summary.totalOverdue) + outstandingCents) / 100;
      summary.invoiceCount += 1;
      customerMap.set(row.customer_id, summary);
      return { id: row.id, invoiceNo: row.invoice_no, customerId: row.customer_id, customerName: row.customer_name,
        customerPhone: row.customer_phone, creditTermsDays: row.credit_terms_days, invoiceDate: row.invoice_date, dueDate: row.due_date,
        total: Number(row.total), allocatedAmount: Number(row.allocated_amount), outstandingAmount: outstanding, daysOverdue, isOverdue, status: row.status };
    });
    const customers = [...customerMap.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    return { asOfDate, totalOutstanding: totalOutstandingCents / 100, totalOverdue: totalOverdueCents / 100, agingBuckets,
      customerCountWithDues: customers.length, unpaidInvoiceCount: invoices.length, customers, invoices };
  }

  static async getSalesReport({ businessId, startDate, endDate, interval = 'day' }: {
    businessId: string; startDate?: string; endDate?: string; interval?: 'day' | 'week' | 'month';
  }) {
    const validInterval = ['day', 'week', 'month'].includes(interval) ? interval : 'day';
    const params: unknown[] = [businessId];
    const conditions = ['o.business_id = $1', ...dateConditions('o.created_at', params, startDate, endDate)];
    const orders = `SELECT o.id, o.created_at, i.id AS invoice_id,
      lines.subtotal + ROUND(lines.subtotal * o.tax_rate / 100, 2) AS total
      FROM orders o LEFT JOIN invoices i ON i.order_id = o.id AND i.business_id = o.business_id
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(oi.total_price), 0) AS subtotal FROM order_items oi
        WHERE oi.order_id = o.id AND oi.business_id = o.business_id) lines ON TRUE WHERE ${conditions.join(' AND ')}`;
    const [totals, series] = await Promise.all([
      query(`SELECT COUNT(*) AS total_orders, COUNT(invoice_id) AS total_invoices, COALESCE(SUM(total), 0) AS total_sales FROM (${orders}) filtered`, params),
      query(`SELECT DATE_TRUNC('${validInterval}', created_at AT TIME ZONE 'UTC')::date::text AS period,
        COUNT(*) AS order_count, SUM(total) AS sales_amount FROM (${orders}) filtered GROUP BY period ORDER BY period`, params)
    ]);
    return { totalSales: Number(totals.rows[0].total_sales), totalOrders: Number(totals.rows[0].total_orders),
      totalInvoices: Number(totals.rows[0].total_invoices), interval: validInterval,
      series: series.rows.map(row => ({ period: row.period, orderCount: Number(row.order_count), salesAmount: Number(row.sales_amount) })) };
  }

  static async getCollectionReport({ businessId, startDate, endDate, interval = 'day' }: {
    businessId: string; startDate?: string; endDate?: string; interval?: 'day' | 'week' | 'month';
  }) {
    const validInterval = ['day', 'week', 'month'].includes(interval) ? interval : 'day';
    const params: unknown[] = [businessId];
    const conditions = ['p.business_id = $1', ...dateConditions('p.date', params, startDate, endDate, true)].join(' AND ');
    const [totals, modes, series] = await Promise.all([
      query(`SELECT COUNT(*) AS payment_count, COALESCE(SUM(p.amount), 0) AS total_collected FROM payments p WHERE ${conditions}`, params),
      query(`SELECT p.mode, COUNT(*) AS count, SUM(p.amount) AS amount FROM payments p WHERE ${conditions} GROUP BY p.mode ORDER BY amount DESC`, params),
      query(`SELECT DATE_TRUNC('${validInterval}', p.date::timestamp)::date::text AS period, COUNT(*) AS payment_count,
        SUM(p.amount) AS collected_amount FROM payments p WHERE ${conditions} GROUP BY period ORDER BY period`, params)
    ]);
    return { totalCollected: Number(totals.rows[0].total_collected), paymentCount: Number(totals.rows[0].payment_count),
      modeBreakdown: modes.rows.map(row => ({ mode: row.mode, count: Number(row.count), amount: Number(row.amount) })),
      series: series.rows.map(row => ({ period: row.period, paymentCount: Number(row.payment_count), collectedAmount: Number(row.collected_amount) })) };
  }

  static async getTopCustomers({ businessId, limit = 10, startDate, endDate }: {
    businessId: string; limit?: number; startDate?: string; endDate?: string;
  }) {
    const params: unknown[] = [businessId, limit];
    const orderFilter = dateConditions('o.created_at', params, startDate, endDate);
    const paymentFilter = dateConditions('p.date', params, startDate, endDate, true);
    const result = await query(`SELECT c.id, c.name, c.phone, sales.order_count, sales.total_sales,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id = c.id AND p.business_id = c.business_id
        ${paymentFilter.length ? 'AND ' + paymentFilter.join(' AND ') : ''}), 0) AS total_paid,
      COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.customer_id = c.id AND i.business_id = c.business_id), 0) -
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id = c.id AND p.business_id = c.business_id), 0) AS outstanding
      FROM customers c LEFT JOIN LATERAL (
        SELECT COUNT(*) AS order_count, COALESCE(SUM(lines.subtotal + ROUND(lines.subtotal * o.tax_rate / 100, 2)), 0) AS total_sales
        FROM orders o LEFT JOIN LATERAL (SELECT COALESCE(SUM(oi.total_price), 0) AS subtotal FROM order_items oi
          WHERE oi.order_id = o.id AND oi.business_id = o.business_id) lines ON TRUE
        WHERE o.customer_id = c.id AND o.business_id = c.business_id ${orderFilter.length ? 'AND ' + orderFilter.join(' AND ') : ''}
      ) sales ON TRUE WHERE c.business_id = $1 ORDER BY total_sales DESC, c.id LIMIT $2`, params);
    return result.rows.map(row => ({ id: row.id, name: row.name, phone: row.phone, orderCount: Number(row.order_count),
      totalSales: Number(row.total_sales), totalPaid: Number(row.total_paid), outstandingBalance: Number(row.outstanding) }));
  }

  static async getTopProducts({ businessId, limit = 10, startDate, endDate }: {
    businessId: string; limit?: number; startDate?: string; endDate?: string;
  }) {
    const params: unknown[] = [businessId, limit];
    const filter = dateConditions('o.created_at', params, startDate, endDate);
    const result = await query(`SELECT p.id, p.name, p.unit, p.current_price, sold.order_frequency,
      sold.total_quantity_sold, sold.total_revenue FROM products p LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT oi.order_id) AS order_frequency, COALESCE(SUM(oi.quantity), 0) AS total_quantity_sold,
          COALESCE(SUM(oi.total_price), 0) AS total_revenue FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.business_id = oi.business_id
        WHERE oi.product_id = p.id AND oi.business_id = p.business_id ${filter.length ? 'AND ' + filter.join(' AND ') : ''}
      ) sold ON TRUE WHERE p.business_id = $1 ORDER BY total_revenue DESC, total_quantity_sold DESC, p.id LIMIT $2`, params);
    return result.rows.map(row => ({ id: row.id, name: row.name, unit: row.unit, currentPrice: Number(row.current_price),
      orderFrequency: Number(row.order_frequency), totalQuantitySold: Number(row.total_quantity_sold), totalRevenue: Number(row.total_revenue) }));
  }
}
