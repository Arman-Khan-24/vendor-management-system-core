import { pool, query } from '../database/connection.js';
export class InvoiceRepository {
    static async list({ businessId, customerId, status }) {
        let sql = `
      SELECT 
        i.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        COALESCE(SUM(pa.amount), 0) AS allocated_amount,
        (i.total - COALESCE(SUM(pa.amount), 0)) AS remaining_amount
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id AND pa.business_id = i.business_id
      WHERE i.business_id = $1
    `;
        const params = [businessId];
        if (customerId) {
            params.push(customerId);
            sql += ` AND i.customer_id = $${params.length}`;
        }
        if (status) {
            params.push(status);
            sql += ` AND i.status = $${params.length}`;
        }
        sql += ` GROUP BY i.id, c.name, c.phone ORDER BY i.invoice_no DESC`;
        const res = await query(sql, params);
        return res.rows.map(r => ({
            ...r,
            subtotal: parseFloat(r.subtotal),
            tax: parseFloat(r.tax),
            total: parseFloat(r.total),
            allocated_amount: parseFloat(r.allocated_amount),
            remaining_amount: parseFloat(r.remaining_amount),
            items: []
        }));
    }
    static async findById({ invoiceId, businessId }) {
        const sql = `
      SELECT 
        i.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE invoice_id = i.id AND business_id = i.business_id), 0) AS allocated_amount,
        (i.total - COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE invoice_id = i.id AND business_id = i.business_id), 0)) AS remaining_amount
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      WHERE i.id = $1 AND i.business_id = $2
    `;
        const res = await query(sql, [invoiceId, businessId]);
        if (res.rows.length === 0)
            return null;
        const row = res.rows[0];
        // Fetch order line items
        const itemsSql = `
      SELECT 
        p.name AS product_name,
        oi.quantity,
        oi.unit,
        oi.unit_price_at_order AS unit_price,
        oi.total_price AS total
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id AND p.business_id = oi.business_id
      WHERE oi.order_id = $1 AND oi.business_id = $2
      ORDER BY oi.id ASC
    `;
        const itemsRes = await query(itemsSql, [row.order_id, businessId]);
        return {
            ...row,
            subtotal: parseFloat(row.subtotal),
            tax: parseFloat(row.tax),
            total: parseFloat(row.total),
            allocated_amount: parseFloat(row.allocated_amount),
            remaining_amount: parseFloat(row.remaining_amount),
            items: itemsRes.rows.map(it => ({
                product_name: it.product_name,
                quantity: parseFloat(it.quantity),
                unit: it.unit,
                unit_price: parseFloat(it.unit_price),
                total: parseFloat(it.total)
            }))
        };
    }
    static async findByOrderId({ orderId, businessId }) {
        const res = await query('SELECT * FROM invoices WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
        if (!res.rows[0])
            return null;
        return {
            ...res.rows[0],
            subtotal: parseFloat(res.rows[0].subtotal),
            tax: parseFloat(res.rows[0].tax),
            total: parseFloat(res.rows[0].total)
        };
    }
    /**
     * Generates a sequential invoice for an order within a tenant isolation transaction
     */
    static async generateInvoiceForOrder({ businessId, orderId }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Check if invoice already exists (idempotent)
            const existing = await client.query('SELECT id FROM invoices WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
            if (existing.rows.length > 0) {
                await client.query('COMMIT');
                const inv = await InvoiceRepository.findById({ invoiceId: existing.rows[0].id, businessId });
                return inv;
            }
            // Lock order and ensure it belongs to this business
            const orderRes = await client.query('SELECT * FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE', [orderId, businessId]);
            if (orderRes.rows.length === 0) {
                throw new Error('Order not found for tenant');
            }
            const order = orderRes.rows[0];
            // Sum items from order_items with frozen prices
            const itemsRes = await client.query('SELECT COALESCE(SUM(total_price), 0) AS subtotal FROM order_items WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
            const subtotal = parseFloat(itemsRes.rows[0].subtotal);
            const tax = 0; // Default tax in Phase 1
            const total = subtotal + tax;
            // Sequential tenant-scoped invoice number
            const seqRes = await client.query('SELECT COALESCE(MAX(invoice_no), 0) + 1 AS next_no FROM invoices WHERE business_id = $1', [businessId]);
            const invoiceNo = parseInt(seqRes.rows[0].next_no, 10);
            const insertRes = await client.query(`INSERT INTO invoices (business_id, order_id, customer_id, invoice_no, subtotal, tax, total, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
         RETURNING *`, [businessId, orderId, order.customer_id, invoiceNo, subtotal, tax, total]);
            await client.query('COMMIT');
            const inv = await InvoiceRepository.findById({ invoiceId: insertRes.rows[0].id, businessId });
            if (!inv)
                throw new Error('Failed to retrieve newly created invoice');
            return inv;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    /**
     * Recalculates and updates the invoice status based on payment_allocations
     */
    static async refreshInvoiceStatus(client, invoiceId, businessId) {
        const invRes = await client.query('SELECT total FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE', [invoiceId, businessId]);
        if (invRes.rows.length === 0)
            throw new Error('Invoice not found');
        const total = parseFloat(invRes.rows[0].total);
        const allocRes = await client.query('SELECT COALESCE(SUM(amount), 0) AS allocated FROM payment_allocations WHERE invoice_id = $1 AND business_id = $2', [invoiceId, businessId]);
        const allocated = parseFloat(allocRes.rows[0].allocated);
        let status = 'Pending';
        if (allocated >= total && total > 0) {
            status = 'Paid';
        }
        else if (allocated > 0) {
            status = 'Partial';
        }
        await client.query('UPDATE invoices SET status = $1 WHERE id = $2 AND business_id = $3', [status, invoiceId, businessId]);
        return status;
    }
}
