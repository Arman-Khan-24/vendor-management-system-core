import { query } from '../database/connection.js';
import { ReportsService } from './reports.service.js';

export class DashboardService {
  static async getSummary(businessId: string) {
    // 1. Today's sales and order counts
    const todaySql = `
      SELECT 
        COUNT(DISTINCT o.id) AS today_orders_count,
        COALESCE(SUM(oi.quantity * oi.unit_price_at_order), 0) AS today_sales
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.business_id = o.business_id
      WHERE o.business_id = $1 AND o.created_at::date = CURRENT_DATE
    `;
    const todayRes = await query(todaySql, [businessId]);

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
        COALESCE((SELECT SUM(total) FROM invoices WHERE business_id = $1), 0) AS total_billed,
        COALESCE((SELECT SUM(amount) FROM payments WHERE business_id = $1), 0) AS total_collected,
        COALESCE((SELECT SUM(amount) FROM payments WHERE business_id = $1 AND created_at::date = CURRENT_DATE), 0) AS today_collected
    `;
    const balanceRes = await query(balanceSql, [businessId]);
    const totalBilled = parseFloat(balanceRes.rows[0].total_billed);
    const totalCollected = parseFloat(balanceRes.rows[0].total_collected);
    const todayCollected = parseFloat(balanceRes.rows[0].today_collected);
    const totalOutstanding = Math.max(0, totalBilled - totalCollected);

    // 4. Overdue report via ReportsService
    const duesReport = await ReportsService.getOutstandingReport({ businessId });

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
