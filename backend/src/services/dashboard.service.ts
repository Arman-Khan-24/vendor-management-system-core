import { query } from '../database/connection.js';
import { ReportsService } from './reports.service.js';

export class DashboardService {
  static async getSummary(businessId: string) {
    const today = new Date().toISOString().slice(0, 10);
    // 1. Today's sales and order counts
    const todaySql = `
      SELECT 
        COUNT(o.id) AS today_orders_count,
        COALESCE(SUM(lines.subtotal + ROUND(lines.subtotal * o.tax_rate / 100, 2)), 0) AS today_sales
      FROM orders o
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(oi.total_price), 0) AS subtotal FROM order_items oi
        WHERE oi.order_id = o.id AND oi.business_id = o.business_id) lines ON TRUE
      WHERE o.business_id = $1 AND (o.created_at AT TIME ZONE 'UTC')::date = $2::date
    `;
    const todayRes = await query(todaySql, [businessId, today]);

    // 2. Order status breakdown
    const statusSql = `
      SELECT status, COUNT(*) AS count
      FROM orders
      WHERE business_id = $1
      GROUP BY status
    `;
    const statusRes = await query(statusSql, [businessId]);
    const statusCounts: Record<string, number> = {
      Received: 0,
      Packed: 0,
      Delivered: 0
    };
    for (const r of statusRes.rows) {
      statusCounts[r.status] = parseInt(r.count, 10);
    }

    // 3. Outstanding balance and collections
    const balanceSql = `
      SELECT 
        COALESCE((SELECT SUM(amount) FROM payments WHERE business_id = $1), 0) AS total_collected,
        COALESCE((SELECT SUM(amount) FROM payments WHERE business_id = $1 AND date = $2::date), 0) AS today_collected
    `;
    const balanceRes = await query(balanceSql, [businessId, today]);
    const totalCollected = parseFloat(balanceRes.rows[0].total_collected);
    const todayCollected = parseFloat(balanceRes.rows[0].today_collected);

    // 4. Overdue report via ReportsService
    const duesReport = await ReportsService.getOutstandingReport({ businessId });
    // One customer's credit must not cancel another customer's debt.
    const totalOutstanding = duesReport.totalOutstanding;

    // 5. Recent 7-day Sales & Collections Trends
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startDateStr = sevenDaysAgo.toISOString().slice(0, 10);

    const [salesReport, collectionReport, topCustomers, topProducts] = await Promise.all([
      ReportsService.getSalesReport({ businessId, startDate: startDateStr, interval: 'day' }),
      ReportsService.getCollectionReport({ businessId, startDate: startDateStr, interval: 'day' }),
      ReportsService.getTopCustomers({ businessId, limit: 5 }),
      ReportsService.getTopProducts({ businessId, limit: 5 })
    ]);

    return {
      todaySales: parseFloat(todayRes.rows[0].today_sales),
      todayOrdersCount: parseInt(todayRes.rows[0].today_orders_count, 10),
      todayCollected,
      totalOutstanding,
      totalCollected,
      totalOverdue: duesReport.totalOverdue,
      agingBuckets: duesReport.agingBuckets,
      statusCounts,
      overdueCustomers: duesReport.customers.filter(c => c.totalOverdue > 0).slice(0, 5).map(c => ({
        id: c.customerId,
        name: c.customerName,
        phone: c.customerPhone,
        creditTermsDays: c.creditTermsDays,
        balance: c.totalOutstanding,
        overdueAmount: c.totalOverdue,
        oldestInvoiceDate: c.oldestInvoiceDate
      })),
      salesTrend: salesReport.series,
      collectionTrend: collectionReport.series,
      topCustomers,
      topProducts
    };
  }
}
