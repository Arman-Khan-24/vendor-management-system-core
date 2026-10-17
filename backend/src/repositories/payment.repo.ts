import { pool, withTransaction } from '../database/connection.js';
import { Payment, PaymentMode } from '../models/types.js';
import { InvoiceRepository } from './invoice.repo.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeBusinessSettings } from '../services/business-settings.service.js';
import { ReportsService } from '../services/reports.service.js';

export interface PaymentWithAllocations extends Payment {
  customer_name: string;
  unallocated_amount: number;
  allocations: Array<{ id: string; invoice_id: string; invoice_no: number; invoice_prefix: string; amount: number }>;
}

const allocationSelect = `SELECT pa.id, pa.payment_id, pa.invoice_id, pa.amount, i.invoice_no, i.invoice_prefix
  FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id AND i.business_id = pa.business_id`;

export class PaymentRepository {
  static async list({ businessId, customerId, limit = 100, offset = 0 }: {
    businessId: string; customerId?: string; limit?: number; offset?: number;
  }): Promise<PaymentWithAllocations[]> {
    let sql = `SELECT p.*, p.date::text AS date, c.name AS customer_name FROM payments p
      JOIN customers c ON c.id = p.customer_id AND c.business_id = p.business_id WHERE p.business_id = $1`;
    const params: unknown[] = [businessId];
    if (customerId) { params.push(customerId); sql += ` AND p.customer_id = $${params.length}`; }
    params.push(limit, offset);
    sql += ` ORDER BY p.date DESC, p.created_at DESC, p.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const payments = await pool.query(sql, params);
    if (!payments.rows.length) return [];
    const allocations = await pool.query(`${allocationSelect} WHERE pa.business_id = $1 AND pa.payment_id = ANY($2::uuid[]) ORDER BY i.invoice_no`,
      [businessId, payments.rows.map(p => p.id)]);
    return payments.rows.map(row => {
      const items = allocations.rows.filter(a => a.payment_id === row.id).map(a => ({ ...a, amount: Number(a.amount) }));
      const allocatedCents = items.reduce((sum, a) => sum + Math.round(a.amount * 100), 0);
      return { ...row, amount: Number(row.amount), unallocated_amount: (Math.round(Number(row.amount) * 100) - allocatedCents) / 100, allocations: items };
    });
  }

  /** Customer account payment with bounded explicit allocations or oldest-invoice-first settlement. */
  static async recordPayment({ businessId, customerId, amount, mode = 'cash', date, reference, notes, createdBy, specificInvoiceAllocations }: {
    businessId: string; customerId: string; amount: number; mode?: PaymentMode; date?: string;
    reference?: string; notes?: string; createdBy?: string;
    specificInvoiceAllocations?: Array<{ invoiceId: string; amount: number }>;
  }): Promise<PaymentWithAllocations> {
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
      throw new AppError('Payment must be a positive amount with at most two decimal places.', 400);
    }
    return withTransaction(async client => {
      const business = await client.query('SELECT settings FROM businesses WHERE id = $1 FOR UPDATE', [businessId]);
      if (!business.rows[0]) throw new AppError('Business not found', 404);
      const settings = normalizeBusinessSettings(business.rows[0].settings);
      if (!settings.modules.payments) throw new AppError('Payments are disabled in business settings.', 403);
      if (!settings.billing.paymentMethods.includes(mode)) throw new AppError('This payment method is disabled in business settings.', 400);
      // Archived customers can still settle their historical invoices.
      const customer = await client.query('SELECT id, name FROM customers WHERE id = $1 AND business_id = $2 FOR UPDATE', [customerId, businessId]);
      if (!customer.rows[0]) throw new AppError('Customer not found for this business.', 400);
      const specific = specificInvoiceAllocations?.length ? specificInvoiceAllocations : undefined;
      if (specific) {
        const ids = new Set(specific.map(a => a.invoiceId));
        if (ids.size !== specific.length) throw new AppError('Select each invoice only once.', 400);
        if (specific.some(a => !Number.isFinite(a.amount) || a.amount <= 0 || Math.abs(a.amount * 100 - Math.round(a.amount * 100)) > 0.00001)) {
          throw new AppError('Each allocation must be a positive amount with at most two decimal places.', 400);
        }
        const requestedCents = specific.reduce((sum, a) => sum + Math.round(a.amount * 100), 0);
        if (requestedCents > Math.round(amount * 100)) throw new AppError('Invoice allocations exceed the payment amount.', 400);
      }
      const inserted = await client.query(
        `INSERT INTO payments (business_id, customer_id, amount, mode, date, reference, notes, created_by)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8) RETURNING *, date::text AS date`,
        [businessId, customerId, amount, mode, date ?? null, reference || null, notes || null, createdBy || null]);
      const payment = inserted.rows[0];
      let remainingCents = Math.round(amount * 100);
      const invoiceParams: unknown[] = [customerId, businessId];
      let invoiceFilter = "AND i.status IN ('Pending', 'Partial')";
      if (specific) { invoiceParams.push(specific.map(a => a.invoiceId)); invoiceFilter = 'AND i.id = ANY($3::uuid[])'; }
      const invoices = await client.query(
        `SELECT i.id, i.total, COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
          WHERE pa.invoice_id = i.id AND pa.business_id = i.business_id), 0) AS allocated
         FROM invoices i WHERE i.customer_id = $1 AND i.business_id = $2 ${invoiceFilter}
         ORDER BY i.created_at, i.invoice_no FOR UPDATE`, invoiceParams);
      if (specific && invoices.rows.length !== specific.length) throw new AppError('An invoice is unavailable for this customer.', 400);
      for (const invoice of invoices.rows) {
        const unpaidCents = Math.max(0, Math.round(Number(invoice.total) * 100) - Math.round(Number(invoice.allocated) * 100));
        const requested = specific?.find(a => a.invoiceId === invoice.id);
        const allocationCents = requested ? Math.round(requested.amount * 100) : Math.min(remainingCents, unpaidCents);
        if (allocationCents > unpaidCents) throw new AppError('An allocation exceeds the invoice remaining balance.', 400);
        if (allocationCents === 0) continue;
        await client.query('INSERT INTO payment_allocations (business_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4)',
          [businessId, payment.id, invoice.id, allocationCents / 100]);
        remainingCents -= allocationCents;
        await InvoiceRepository.refreshInvoiceStatus(client, invoice.id, businessId);
      }
      const allocations = await client.query(`${allocationSelect} WHERE pa.payment_id = $1 AND pa.business_id = $2 ORDER BY i.invoice_no`, [payment.id, businessId]);
      return { ...payment, amount: Number(payment.amount), customer_name: customer.rows[0].name,
        unallocated_amount: remainingCents / 100, allocations: allocations.rows.map(a => ({ ...a, amount: Number(a.amount) })) };
    });
  }

  static async getCustomerStatement(input: { customerId: string; businessId: string }) {
    return ReportsService.getCustomerStatement(input);
  }
}
