import { pool, query } from '../database/connection.js';
import { InvoiceRepository } from './invoice.repo.js';
export class PaymentRepository {
    static async list({ businessId, customerId }) {
        let sql = `
      SELECT 
        p.*,
        c.name AS customer_name
      FROM payments p
      JOIN customers c ON c.id = p.customer_id AND c.business_id = p.business_id
      WHERE p.business_id = $1
    `;
        const params = [businessId];
        if (customerId) {
            params.push(customerId);
            sql += ` AND p.customer_id = $${params.length}`;
        }
        sql += ` ORDER BY p.date DESC, p.created_at DESC`;
        const res = await query(sql, params);
        const payments = [];
        for (const r of res.rows) {
            const allocSql = `
        SELECT pa.id, pa.invoice_id, pa.amount, i.invoice_no
        FROM payment_allocations pa
        JOIN invoices i ON i.id = pa.invoice_id AND i.business_id = pa.business_id
        WHERE pa.payment_id = $1 AND pa.business_id = $2
      `;
            const allocRes = await query(allocSql, [r.id, businessId]);
            payments.push({
                ...r,
                amount: parseFloat(r.amount),
                customer_name: r.customer_name,
                allocations: allocRes.rows.map(a => ({
                    ...a,
                    amount: parseFloat(a.amount)
                }))
            });
        }
        return payments;
    }
    /**
     * Records a payment and performs strict transactional FIFO allocation
     * across oldest outstanding invoices with row locks.
     */
    static async recordPayment({ businessId, customerId, amount, mode = 'cash', date = new Date().toISOString().split('T')[0], reference, notes, createdBy, specificInvoiceAllocations }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // 1. Verify customer belongs to this business
            const custRes = await client.query('SELECT id, name FROM customers WHERE id = $1 AND business_id = $2 FOR UPDATE', [customerId, businessId]);
            if (custRes.rows.length === 0) {
                throw new Error('Customer not found for tenant');
            }
            // 2. Insert payment record
            const payRes = await client.query(`INSERT INTO payments (business_id, customer_id, amount, mode, date, reference, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`, [businessId, customerId, amount, mode, date, reference || null, notes || null, createdBy || null]);
            const payment = payRes.rows[0];
            let remainingPayment = amount;
            const touchedInvoiceIds = new Set();
            // 3. Owner Override / Specific allocation OR FIFO
            if (specificInvoiceAllocations && specificInvoiceAllocations.length > 0) {
                // Explicit allocation specified
                for (const alloc of specificInvoiceAllocations) {
                    if (remainingPayment <= 0)
                        break;
                    const allocAmount = Math.min(alloc.amount, remainingPayment);
                    // Lock invoice
                    const invRes = await client.query('SELECT id, total FROM invoices WHERE id = $1 AND customer_id = $2 AND business_id = $3 FOR UPDATE', [alloc.invoiceId, customerId, businessId]);
                    if (invRes.rows.length === 0) {
                        throw new Error(`Invoice ${alloc.invoiceId} does not exist for customer`);
                    }
                    await client.query(`INSERT INTO payment_allocations (business_id, payment_id, invoice_id, amount)
             VALUES ($1, $2, $3, $4)`, [businessId, payment.id, alloc.invoiceId, allocAmount]);
                    remainingPayment -= allocAmount;
                    touchedInvoiceIds.add(alloc.invoiceId);
                }
            }
            else {
                // Automatic FIFO Allocation:
                // 1. Select and lock open invoices for this customer ordered by created_at ASC
                const openInvoicesRes = await client.query(`SELECT i.id, i.total
           FROM invoices i
           WHERE i.customer_id = $1 AND i.business_id = $2 AND i.status IN ('Pending', 'Partial')
           ORDER BY i.created_at ASC, i.invoice_no ASC
           FOR UPDATE`, [customerId, businessId]);
                for (const inv of openInvoicesRes.rows) {
                    if (remainingPayment <= 0.0001)
                        break;
                    // Fetch current allocations for this locked invoice
                    const allocCheck = await client.query(`SELECT COALESCE(SUM(amount), 0) AS already_allocated
             FROM payment_allocations
             WHERE invoice_id = $1 AND business_id = $2`, [inv.id, businessId]);
                    const invoiceTotal = parseFloat(inv.total);
                    const alreadyAllocated = parseFloat(allocCheck.rows[0].already_allocated);
                    const unpaidBalance = Math.max(0, invoiceTotal - alreadyAllocated);
                    if (unpaidBalance <= 0)
                        continue;
                    const allocationAmount = Math.min(remainingPayment, unpaidBalance);
                    await client.query(`INSERT INTO payment_allocations (business_id, payment_id, invoice_id, amount)
             VALUES ($1, $2, $3, $4)`, [businessId, payment.id, inv.id, allocationAmount]);
                    remainingPayment -= allocationAmount;
                    touchedInvoiceIds.add(inv.id);
                }
            }
            // 4. Update status for all touched invoices
            for (const invId of touchedInvoiceIds) {
                await InvoiceRepository.refreshInvoiceStatus(client, invId, businessId);
            }
            await client.query('COMMIT');
            // Fetch resulting allocations
            const allocRes = await client.query(`SELECT pa.id, pa.invoice_id, pa.amount, i.invoice_no
         FROM payment_allocations pa
         JOIN invoices i ON i.id = pa.invoice_id AND i.business_id = pa.business_id
         WHERE pa.payment_id = $1 AND pa.business_id = $2`, [payment.id, businessId]);
            return {
                ...payment,
                amount: parseFloat(payment.amount),
                customer_name: custRes.rows[0].name,
                allocations: allocRes.rows.map(a => ({
                    ...a,
                    amount: parseFloat(a.amount)
                }))
            };
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    static async getCustomerStatement({ customerId, businessId }) {
        const cust = await clientQuery('SELECT id, name, phone, credit_terms_days FROM customers WHERE id = $1 AND business_id = $2', [customerId, businessId]);
        if (cust.rows.length === 0)
            return null;
        // Union ledger events: invoices (+) and payments (-)
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
      WHERE i.customer_id = $1 AND i.business_id = $2

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
      WHERE p.customer_id = $1 AND p.business_id = $2

      ORDER BY date ASC
    `;
        const ledgerRes = await query(ledgerSql, [customerId, businessId]);
        let runningBalance = 0;
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
        const totalBilled = entries.reduce((s, e) => s + e.debit, 0);
        const totalPaid = entries.reduce((s, e) => s + e.credit, 0);
        const currentOutstanding = totalBilled - totalPaid;
        return {
            customer: cust.rows[0],
            totalBilled,
            totalPaid,
            currentOutstanding,
            entries
        };
    }
}
async function clientQuery(sql, params) {
    return query(sql, params);
}
