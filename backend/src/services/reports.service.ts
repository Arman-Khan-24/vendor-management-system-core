import { query } from '../database/connection.js';

export interface ReportDateFilter {
  startDate?: string;
  endDate?: string;
}

export class ReportsService {
  /**
   * 1. Customer Statement with optional date range filter & opening balance
   */
  static async getCustomerStatement({
    customerId,
    businessId,
    startDate,
    endDate
  }: {
    customerId: string;
    businessId: string;
    startDate?: string;
    endDate?: string;
  }) {
    // 1. Verify customer exists under tenant
    const custRes = await query(
      `SELECT c.id, c.name, c.phone, c.credit_terms_days, b.name as business_name, b.slug as business_slug
       FROM customers c
       JOIN businesses b ON b.id = c.business_id
       WHERE c.id = $1 AND c.business_id = $2`,
      [customerId, businessId]
    );
    if (custRes.rows.length === 0) return null;
    const customer = custRes.rows[0];

    // 2. Compute opening balance prior to startDate if startDate is provided
    let openingBalance = 0;
    if (startDate) {
      const priorBilledRes = await query(
        `SELECT COALESCE(SUM(total), 0) AS prior_billed
         FROM invoices
         WHERE customer_id = $1 AND business_id = $2 AND created_at < $3::timestamptz`,
        [customerId, businessId, startDate]
      );
      const priorPaidRes = await query(
        `SELECT COALESCE(SUM(amount), 0) AS prior_paid
         FROM payments
         WHERE customer_id = $1 AND business_id = $2 AND created_at < $3::timestamptz`,
        [customerId, businessId, startDate]
      );
      const priorBilled = parseFloat(priorBilledRes.rows[0].prior_billed);
      const priorPaid = parseFloat(priorPaidRes.rows[0].prior_paid);
      openingBalance = priorBilled - priorPaid;
    }

    // 3. Query ledger activity (Invoices & Payments) within range
    const conditions = ['customer_id = $1', 'business_id = $2'];
    const params: any[] = [customerId, businessId];

    if (startDate) {
      params.push(startDate);
      conditions.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`created_at <= $${params.length}::timestamptz`);
    }

    const whereClause = conditions.join(' AND ');

    const ledgerSql = `
      SELECT 
        'INVOICE' AS type,
        i.id AS reference_id,
        CONCAT('INV-', LPAD(i.invoice_no::text, 4, '0')) AS reference_no,
        i.created_at AS date,
        i.total AS debit,
        0 AS credit,
        i.status AS status
      FROM invoices i
      WHERE ${whereClause}

      UNION ALL

      SELECT 
        'PAYMENT' AS type,
        p.id AS reference_id,
        COALESCE(p.reference, CONCAT('PAY-', p.mode)) AS reference_no,
        p.created_at AS date,
        0 AS debit,
        p.amount AS credit,
        p.mode AS status
      FROM payments p
      WHERE ${whereClause}

      ORDER BY date ASC
    `;

    const ledgerRes = await query(ledgerSql, params);

    let runningBalance = openingBalance;
    const entries = ledgerRes.rows.map(row => {
      const debit = parseFloat(row.debit);
      const credit = parseFloat(row.credit);
      runningBalance = runningBalance + debit - credit;
      return {
        type: row.type,
        reference_id: row.reference_id,
        reference_no: row.reference_no,
        date: row.date,
        debit,
        credit,
        running_balance: runningBalance,
        status: row.status
      };
    });

    const periodBilled = entries.reduce((s, e) => s + e.debit, 0);
    const periodPaid = entries.reduce((s, e) => s + e.credit, 0);
    const closingBalance = runningBalance;

    // Also get all-time outstanding balance
    const allBilledRes = await query(
      `SELECT COALESCE(SUM(total), 0) AS total_billed FROM invoices WHERE customer_id = $1 AND business_id = $2`,
      [customerId, businessId]
    );
    const allPaidRes = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE customer_id = $1 AND business_id = $2`,
      [customerId, businessId]
    );
    const totalBilledAllTime = parseFloat(allBilledRes.rows[0].total_billed);
    const totalPaidAllTime = parseFloat(allPaidRes.rows[0].total_paid);
    const currentOutstanding = Math.max(0, totalBilledAllTime - totalPaidAllTime);

    return {
      business: {
        name: customer.business_name,
        slug: customer.business_slug
      },
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        credit_terms_days: customer.credit_terms_days
      },
      period: {
        startDate,
        endDate
      },
      openingBalance,
      periodBilled,
      periodPaid,
      closingBalance,
      totalBilled: periodBilled,
      totalPaid: periodPaid,
      currentOutstanding,
      entries
    };
  }

  /**
   * 2. Dues / Outstanding Report
   * Includes total outstanding, overdue amount based on credit terms, customer breakdown, invoice breakdown, aging buckets
   */
  static async getOutstandingReport({
    businessId,
    asOfDate
  }: {
    businessId: string;
    asOfDate?: string;
  }) {
    // 1. Invoice-level outstanding calculation
    // A single invoice's outstanding amount = total - SUM(allocations)
    const invoiceSql = `
      SELECT 
        i.id,
        CONCAT('INV-', LPAD(i.invoice_no::text, 4, '0')) AS invoice_no,
        i.order_id,
        i.customer_id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        c.credit_terms_days,
        i.created_at AS invoice_date,
        (i.created_at + (c.credit_terms_days || ' days')::interval) AS due_date,
        i.total,
        COALESCE(SUM(pa.amount), 0) AS allocated_amount,
        (i.total - COALESCE(SUM(pa.amount), 0)) AS outstanding_amount,
        EXTRACT(DAY FROM (NOW() - (i.created_at + (c.credit_terms_days || ' days')::interval))) AS days_overdue,
        i.status
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id AND pa.business_id = i.business_id
      WHERE i.business_id = $1
      GROUP BY i.id, i.invoice_no, i.order_id, i.customer_id, c.name, c.phone, c.credit_terms_days, i.created_at, i.total, i.status
      HAVING (i.total - COALESCE(SUM(pa.amount), 0)) > 0.0001
      ORDER BY i.created_at ASC
    `;
    const invoiceRes = await query(invoiceSql, [businessId]);

    let totalOutstanding = 0;
    let totalOverdue = 0;

    const agingBuckets = {
      current: 0,       // not yet due
      overdue_1_7: 0,   // 1 to 7 days overdue
      overdue_8_15: 0,  // 8 to 15 days overdue
      overdue_16_30: 0, // 16 to 30 days overdue
      overdue_30_plus: 0 // > 30 days overdue
    };

    const customerMap = new Map<string, {
      customerId: string;
      customerName: string;
      customerPhone: string;
      creditTermsDays: number;
      totalOutstanding: number;
      totalOverdue: number;
      oldestInvoiceDate: string;
      invoiceCount: number;
    }>();

    const invoiceList = invoiceRes.rows.map(r => {
      const total = parseFloat(r.total);
      const allocated = parseFloat(r.allocated_amount);
      const outstanding = parseFloat(r.outstanding_amount);
      const daysOverdue = Math.max(0, Math.floor(parseFloat(r.days_overdue || '0')));
      const isOverdue = daysOverdue > 0;

      totalOutstanding += outstanding;
      if (isOverdue) {
        totalOverdue += outstanding;
      }

      // Aging
      if (!isOverdue) {
        agingBuckets.current += outstanding;
      } else if (daysOverdue <= 7) {
        agingBuckets.overdue_1_7 += outstanding;
      } else if (daysOverdue <= 15) {
        agingBuckets.overdue_8_15 += outstanding;
      } else if (daysOverdue <= 30) {
        agingBuckets.overdue_16_30 += outstanding;
      } else {
        agingBuckets.overdue_30_plus += outstanding;
      }

      // Customer rollup
      if (!customerMap.has(r.customer_id)) {
        customerMap.set(r.customer_id, {
          customerId: r.customer_id,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          creditTermsDays: r.credit_terms_days,
          totalOutstanding: 0,
          totalOverdue: 0,
          oldestInvoiceDate: r.invoice_date,
          invoiceCount: 0
        });
      }

      const cData = customerMap.get(r.customer_id)!;
      cData.totalOutstanding += outstanding;
      cData.invoiceCount += 1;
      if (isOverdue) cData.totalOverdue += outstanding;

      return {
        id: r.id,
        invoiceNo: r.invoice_no,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        creditTermsDays: r.credit_terms_days,
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        total,
        allocatedAmount: allocated,
        outstandingAmount: outstanding,
        daysOverdue,
        isOverdue,
        status: r.status
      };
    });

    const customerSummary = Array.from(customerMap.values())
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    return {
      totalOutstanding,
      totalOverdue,
      agingBuckets,
      customerCountWithDues: customerSummary.length,
      unpaidInvoiceCount: invoiceList.length,
      customers: customerSummary,
      invoices: invoiceList
    };
  }

  /**
   * 3. Sales Report with date range & period aggregation (daily/weekly/monthly)
   */
  static async getSalesReport({
    businessId,
    startDate,
    endDate,
    interval = 'day'
  }: {
    businessId: string;
    startDate?: string;
    endDate?: string;
    interval?: 'day' | 'week' | 'month';
  }) {
    const validInterval = ['day', 'week', 'month'].includes(interval) ? interval : 'day';

    const conditions = ['o.business_id = $1'];
    const params: any[] = [businessId];

    if (startDate) {
      params.push(startDate);
      conditions.push(`o.created_at >= $${params.length}::timestamptz`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`o.created_at <= $${params.length}::timestamptz`);
    }

    const whereClause = conditions.join(' AND ');

    // 1. Totals across period
    const totalSql = `
      SELECT 
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(oi.quantity * oi.unit_price_at_order), 0) AS total_sales,
        COUNT(DISTINCT i.id) AS total_invoices
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.business_id = o.business_id
      LEFT JOIN invoices i ON i.order_id = o.id AND i.business_id = o.business_id
      WHERE ${whereClause}
    `;
    const totalRes = await query(totalSql, params);

    // 2. Timeline Aggregation
    const seriesSql = `
      SELECT 
        DATE_TRUNC('${validInterval}', o.created_at) AS period,
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(oi.quantity * oi.unit_price_at_order), 0) AS sales_amount
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.business_id = o.business_id
      WHERE ${whereClause}
      GROUP BY DATE_TRUNC('${validInterval}', o.created_at)
      ORDER BY period ASC
    `;
    const seriesRes = await query(seriesSql, params);

    return {
      totalSales: parseFloat(totalRes.rows[0].total_sales),
      totalOrders: parseInt(totalRes.rows[0].total_orders, 10),
      totalInvoices: parseInt(totalRes.rows[0].total_invoices, 10),
      interval: validInterval,
      series: seriesRes.rows.map(r => ({
        period: r.period,
        orderCount: parseInt(r.order_count, 10),
        salesAmount: parseFloat(r.sales_amount)
      }))
    };
  }

  /**
   * 4. Collection Report with payment mode breakdown & aggregation
   */
  static async getCollectionReport({
    businessId,
    startDate,
    endDate,
    interval = 'day'
  }: {
    businessId: string;
    startDate?: string;
    endDate?: string;
    interval?: 'day' | 'week' | 'month';
  }) {
    const validInterval = ['day', 'week', 'month'].includes(interval) ? interval : 'day';

    const conditions = ['p.business_id = $1'];
    const params: any[] = [businessId];

    if (startDate) {
      params.push(startDate);
      conditions.push(`p.created_at >= $${params.length}::timestamptz`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`p.created_at <= $${params.length}::timestamptz`);
    }

    const whereClause = conditions.join(' AND ');

    // 1. Overall Totals
    const totalSql = `
      SELECT 
        COUNT(p.id) AS payment_count,
        COALESCE(SUM(p.amount), 0) AS total_collected
      FROM payments p
      WHERE ${whereClause}
    `;
    const totalRes = await query(totalSql, params);

    // 2. Mode Breakdown
    const modeSql = `
      SELECT 
        p.mode,
        COUNT(p.id) AS count,
        COALESCE(SUM(p.amount), 0) AS amount
      FROM payments p
      WHERE ${whereClause}
      GROUP BY p.mode
      ORDER BY amount DESC
    `;
    const modeRes = await query(modeSql, params);

    // 3. Time Series
    const seriesSql = `
      SELECT 
        DATE_TRUNC('${validInterval}', p.created_at) AS period,
        COUNT(p.id) AS payment_count,
        COALESCE(SUM(p.amount), 0) AS collected_amount
      FROM payments p
      WHERE ${whereClause}
      GROUP BY DATE_TRUNC('${validInterval}', p.created_at)
      ORDER BY period ASC
    `;
    const seriesRes = await query(seriesSql, params);

    return {
      totalCollected: parseFloat(totalRes.rows[0].total_collected),
      paymentCount: parseInt(totalRes.rows[0].payment_count, 10),
      modeBreakdown: modeRes.rows.map(r => ({
        mode: r.mode,
        count: parseInt(r.count, 10),
        amount: parseFloat(r.amount)
      })),
      series: seriesRes.rows.map(r => ({
        period: r.period,
        paymentCount: parseInt(r.payment_count, 10),
        collectedAmount: parseFloat(r.collected_amount)
      }))
    };
  }

  /**
   * 5. Top Customers Ranked by sales, order count, amount paid, outstanding
   */
  static async getTopCustomers({
    businessId,
    limit = 10,
    startDate,
    endDate
  }: {
    businessId: string;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const params: any[] = [businessId, limit];
    let dateFilter = '';

    if (startDate && endDate) {
      params.push(startDate, endDate);
      dateFilter = `AND o.created_at BETWEEN $3::timestamptz AND $4::timestamptz`;
    }

    const sql = `
      SELECT 
        c.id,
        c.name,
        c.phone,
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(oi.quantity * oi.unit_price_at_order), 0) AS total_sales,
        COALESCE((
          SELECT SUM(p.amount) 
          FROM payments p 
          WHERE p.customer_id = c.id AND p.business_id = c.business_id
        ), 0) AS total_paid,
        COALESCE((
          SELECT SUM(i.total) 
          FROM invoices i 
          WHERE i.customer_id = c.id AND i.business_id = c.business_id
        ), 0) AS total_invoiced
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.business_id = c.business_id ${dateFilter}
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.business_id = o.business_id
      WHERE c.business_id = $1
      GROUP BY c.id, c.name, c.phone
      ORDER BY total_sales DESC
      LIMIT $2
    `;

    const res = await query(sql, params);

    return res.rows.map(r => {
      const sales = parseFloat(r.total_sales);
      const paid = parseFloat(r.total_paid);
      const invoiced = parseFloat(r.total_invoiced);
      const outstanding = Math.max(0, invoiced - paid);

      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        orderCount: parseInt(r.order_count, 10),
        totalSales: sales,
        totalPaid: paid,
        outstandingBalance: outstanding
      };
    });
  }

  /**
   * 6. Top Products Ranked by quantity sold and revenue
   */
  static async getTopProducts({
    businessId,
    limit = 10,
    startDate,
    endDate
  }: {
    businessId: string;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const params: any[] = [businessId, limit];
    let dateFilter = '';

    if (startDate && endDate) {
      params.push(startDate, endDate);
      dateFilter = `AND o.created_at BETWEEN $3::timestamptz AND $4::timestamptz`;
    }

    const sql = `
      SELECT 
        p.id,
        p.name,
        p.unit,
        p.current_price,
        COUNT(DISTINCT oi.order_id) AS order_frequency,
        COALESCE(SUM(oi.quantity), 0) AS total_quantity_sold,
        COALESCE(SUM(oi.quantity * oi.unit_price_at_order), 0) AS total_revenue
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id AND oi.business_id = p.business_id
      LEFT JOIN orders o ON o.id = oi.order_id AND o.business_id = p.business_id ${dateFilter}
      WHERE p.business_id = $1
      GROUP BY p.id, p.name, p.unit, p.current_price
      ORDER BY total_revenue DESC, total_quantity_sold DESC
      LIMIT $2
    `;

    const res = await query(sql, params);

    return res.rows.map(r => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      currentPrice: parseFloat(r.current_price),
      orderFrequency: parseInt(r.order_frequency, 10),
      totalQuantitySold: parseFloat(r.total_quantity_sold),
      totalRevenue: parseFloat(r.total_revenue)
    }));
  }
}
