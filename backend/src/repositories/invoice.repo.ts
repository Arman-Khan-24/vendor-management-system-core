import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../database/connection.js';
import { Invoice, InvoiceStatus } from '../models/types.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeBusinessSettings } from '../services/business-settings.service.js';

export interface InvoiceWithDetails extends Invoice {
  customer_name: string;
  customer_phone: string;
  allocated_amount: number;
  remaining_amount: number;
  items: Array<{ product_name: string; quantity: number; unit: string; unit_price: number; total: number }>;
}

const invoiceSelect = `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone,
  COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id AND pa.business_id = i.business_id), 0) AS allocated_amount
  FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id`;

function normalizeInvoice(row: any): InvoiceWithDetails {
  const total = Number(row.total);
  const allocated = Number(row.allocated_amount ?? 0);
  return { ...row, subtotal: Number(row.subtotal), tax: Number(row.tax), tax_rate: Number(row.tax_rate), total,
    allocated_amount: allocated, remaining_amount: Math.round((total - allocated) * 100) / 100, items: [] };
}

export class InvoiceRepository {
  static async list({ businessId, customerId, status, limit = 100, offset = 0 }: {
    businessId: string; customerId?: string; status?: InvoiceStatus; limit?: number; offset?: number;
  }): Promise<InvoiceWithDetails[]> {
    let sql = `${invoiceSelect} WHERE i.business_id = $1`;
    const params: unknown[] = [businessId];
    if (customerId) { params.push(customerId); sql += ` AND i.customer_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND i.status = $${params.length}`; }
    params.push(limit, offset);
    sql += ` ORDER BY i.invoice_no DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const result = await pool.query(sql, params);
    return result.rows.map(normalizeInvoice);
  }

  static async findById({ invoiceId, businessId, client }: {
    invoiceId: string; businessId: string; client?: PoolClient;
  }): Promise<InvoiceWithDetails | null> {
    const db = client ?? pool;
    const result = await db.query(`${invoiceSelect} WHERE i.id = $1 AND i.business_id = $2`, [invoiceId, businessId]);
    const row = result.rows[0];
    if (!row) return null;
    const items = await db.query(
      `SELECT product_name_at_order AS product_name, quantity, unit, unit_price_at_order AS unit_price, total_price AS total
       FROM order_items WHERE order_id = $1 AND business_id = $2 ORDER BY id`, [row.order_id, businessId]);
    return { ...normalizeInvoice(row), items: items.rows.map(item => ({
      ...item, quantity: Number(item.quantity), unit_price: Number(item.unit_price), total: Number(item.total)
    })) };
  }

  static async findByOrderId({ orderId, businessId }: { orderId: string; businessId: string }): Promise<Invoice | null> {
    const result = await pool.query('SELECT * FROM invoices WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
    return result.rows[0] ? normalizeInvoice(result.rows[0]) : null;
  }

  /** Same transaction as the triggering status change, or an independent manual operation. */
  static async generateInvoiceForOrder({ businessId, orderId, client }: {
    businessId: string; orderId: string; client?: PoolClient;
  }): Promise<InvoiceWithDetails> {
    return withTransaction(async tx => {
      // Always acquire the tenant lock first, including manual generation.
      const business = await tx.query('SELECT settings FROM businesses WHERE id = $1 FOR UPDATE', [businessId]);
      if (!business.rows[0]) throw new AppError('Business not found', 404);
      const settings = normalizeBusinessSettings(business.rows[0].settings);
      const orderResult = await tx.query('SELECT * FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE', [orderId, businessId]);
      const order = orderResult.rows[0];
      if (!order) throw new AppError('Order not found', 404);
      // Recheck only after the locks. Concurrent retries return the same invoice.
      const existing = await tx.query('SELECT id FROM invoices WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
      if (existing.rows[0]) return (await this.findById({ invoiceId: existing.rows[0].id, businessId, client: tx }))!;
      const amounts = await tx.query(
        `SELECT COALESCE(SUM(total_price), 0) AS subtotal,
          ROUND(COALESCE(SUM(total_price), 0) * $3::numeric / 100, 2) AS tax
         FROM order_items WHERE order_id = $1 AND business_id = $2`, [orderId, businessId, order.tax_rate]);
      const subtotal = Number(amounts.rows[0].subtotal);
      const tax = Number(amounts.rows[0].tax);
      const total = (Math.round(subtotal * 100) + Math.round(tax * 100)) / 100;
      const sequence = await tx.query('SELECT COALESCE(MAX(invoice_no), 0) + 1 AS next_no FROM invoices WHERE business_id = $1', [businessId]);
      const inserted = await tx.query(
        `INSERT INTO invoices (business_id, order_id, customer_id, invoice_no, subtotal, tax, total, status, invoice_prefix, tax_rate, credit_terms_days, billing_footer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [businessId, orderId, order.customer_id, sequence.rows[0].next_no, subtotal, tax, total, total === 0 ? 'Paid' : 'Pending',
          settings.billing.invoicePrefix, order.tax_rate, order.credit_terms_days, settings.billing.footer]);
      const invoiceId = inserted.rows[0].id;

      // Advance payments are customer credit; apply unused credit when a new invoice is issued.
      let remainingCents = Math.round(total * 100);
      if (remainingCents > 0) {
        const credits = await tx.query(
          `SELECT p.id, p.amount - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
            WHERE pa.payment_id = p.id AND pa.business_id = p.business_id), 0) AS available
           FROM payments p WHERE p.customer_id = $1 AND p.business_id = $2 ORDER BY p.date, p.created_at, p.id FOR UPDATE`,
          [order.customer_id, businessId]);
        for (const credit of credits.rows) {
          const amountCents = Math.min(remainingCents, Math.max(0, Math.round(Number(credit.available) * 100)));
          if (amountCents === 0) continue;
          await tx.query('INSERT INTO payment_allocations (business_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4)',
            [businessId, credit.id, invoiceId, amountCents / 100]);
          remainingCents -= amountCents;
          if (remainingCents === 0) break;
        }
        await this.refreshInvoiceStatus(tx, invoiceId, businessId);
      }
      return (await this.findById({ invoiceId, businessId, client: tx }))!;
    }, client);
  }

  static async refreshInvoiceStatus(client: PoolClient, invoiceId: string, businessId: string): Promise<InvoiceStatus> {
    const invoice = await client.query('SELECT total FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE', [invoiceId, businessId]);
    if (!invoice.rows[0]) throw new AppError('Invoice not found', 404);
    const allocations = await client.query('SELECT COALESCE(SUM(amount), 0) AS allocated FROM payment_allocations WHERE invoice_id = $1 AND business_id = $2', [invoiceId, businessId]);
    const totalCents = Math.round(Number(invoice.rows[0].total) * 100);
    const allocatedCents = Math.round(Number(allocations.rows[0].allocated) * 100);
    const status: InvoiceStatus = allocatedCents >= totalCents ? 'Paid' : allocatedCents > 0 ? 'Partial' : 'Pending';
    await client.query('UPDATE invoices SET status = $1 WHERE id = $2 AND business_id = $3', [status, invoiceId, businessId]);
    return status;
  }
}
