import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../database/connection.js';
import { AppError } from '../middleware/errorHandler.js';
import { Order, OrderItem, OrderStatus, OrderStatusHistory } from '../models/types.js';
import { normalizeBusinessSettings } from '../services/business-settings.service.js';

export interface OrderWithDetails extends Order {
  customer_name: string;
  customer_phone: string;
  items: (OrderItem & { product_name: string })[];
  history: OrderStatusHistory[];
  subtotal: number;
  tax: number;
  total_amount: number;
  invoice_id: string | null;
  invoice_no: number | null;
  invoice_prefix: string | null;
  invoice_status: string | null;
}

const orderSelect = `
  SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
    amounts.subtotal, ROUND(amounts.subtotal * o.tax_rate / 100, 2) AS tax,
    amounts.subtotal + ROUND(amounts.subtotal * o.tax_rate / 100, 2) AS total_amount,
    i.id AS invoice_id, i.invoice_no, i.invoice_prefix, i.status AS invoice_status
  FROM orders o
  JOIN customers c ON c.id = o.customer_id AND c.business_id = o.business_id
  LEFT JOIN invoices i ON i.order_id = o.id AND i.business_id = o.business_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(oi.total_price), 0) AS subtotal FROM order_items oi
    WHERE oi.order_id = o.id AND oi.business_id = o.business_id
  ) amounts ON TRUE`;

function normalizeOrder(row: any): OrderWithDetails {
  return {
    ...row, subtotal: Number(row.subtotal), tax: Number(row.tax), tax_rate: Number(row.tax_rate),
    total_amount: Number(row.total_amount), items: [], history: []
  };
}

export class OrderRepository {
  static async list({ businessId, status, customerId, limit = 50, offset = 0 }: {
    businessId: string; status?: OrderStatus; customerId?: string; limit?: number; offset?: number;
  }): Promise<OrderWithDetails[]> {
    let sql = `${orderSelect} WHERE o.business_id = $1`;
    const params: unknown[] = [businessId];
    if (status) { params.push(status); sql += ` AND o.status = $${params.length}`; }
    if (customerId) { params.push(customerId); sql += ` AND o.customer_id = $${params.length}`; }
    params.push(limit, offset);
    sql += ` ORDER BY o.created_at DESC, o.order_no DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const result = await pool.query(sql, params);
    return result.rows.map(normalizeOrder);
  }

  static async findById({ orderId, businessId, client }: {
    orderId: string; businessId: string; client?: PoolClient;
  }): Promise<OrderWithDetails | null> {
    const db = client ?? pool;
    const result = await db.query(`${orderSelect} WHERE o.id = $1 AND o.business_id = $2`, [orderId, businessId]);
    if (!result.rows[0]) return null;
    const items = await db.query(
      `SELECT oi.*, oi.product_name_at_order AS product_name FROM order_items oi
       WHERE oi.order_id = $1 AND oi.business_id = $2 ORDER BY oi.id`, [orderId, businessId]);
    const history = await db.query(
      `SELECT * FROM order_status_history WHERE order_id = $1 AND business_id = $2 ORDER BY changed_at, id`,
      [orderId, businessId]);
    return {
      ...normalizeOrder(result.rows[0]),
      items: items.rows.map(item => ({
        ...item, quantity: Number(item.quantity), unit_price_at_order: Number(item.unit_price_at_order), total_price: Number(item.total_price)
      })),
      history: history.rows
    };
  }

  static async createOrderWithItems({ businessId, customerId, source = 'manual', notes, createdBy, items }: {
    businessId: string; customerId: string; source?: 'manual' | 'whatsapp_text' | 'whatsapp_image';
    notes?: string; createdBy?: string; items: { productId: string; quantity: number }[];
  }): Promise<OrderWithDetails> {
    return withTransaction(async client => {
      // The tenant lock serializes number allocation and billing-setting changes.
      const business = await client.query('SELECT settings FROM businesses WHERE id = $1 FOR UPDATE', [businessId]);
      if (!business.rows[0]) throw new AppError('Business not found', 404);
      const settings = normalizeBusinessSettings(business.rows[0].settings);
      const customer = await client.query(
        'SELECT id, credit_terms_days FROM customers WHERE id = $1 AND business_id = $2 AND active = TRUE FOR SHARE',
        [customerId, businessId]);
      if (!customer.rows[0]) throw new AppError('Customer not found or archived. Choose an active customer.', 400);
      if (!items.length) throw new AppError('Order must contain at least one item', 400);
      const sequence = await client.query(
        'SELECT COALESCE(MAX(order_no), 0) + 1 AS next_no FROM orders WHERE business_id = $1', [businessId]);
      const order = await client.query<Order>(
        `INSERT INTO orders (business_id, customer_id, order_no, status, source, notes, created_by, confirmed_at, tax_rate, credit_terms_days)
         VALUES ($1, $2, $3, 'Received', $4, $5, $6, NOW(), $7, $8) RETURNING *`,
        [businessId, customerId, sequence.rows[0].next_no, source, notes || null, createdBy || null,
          settings.billing.taxRate, customer.rows[0].credit_terms_days]);
      const orderId = order.rows[0].id;
      await client.query(
        `INSERT INTO order_status_history (business_id, order_id, from_status, to_status, changed_by)
         VALUES ($1, $2, NULL, 'Received', $3)`, [businessId, orderId, createdBy || null]);
      for (const item of items) {
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new AppError('Item quantity must be greater than zero', 400);
        const productResult = await client.query(
          'SELECT id, name, unit, current_price FROM products WHERE id = $1 AND business_id = $2 AND active = TRUE FOR SHARE',
          [item.productId, businessId]);
        const product = productResult.rows[0];
        if (!product) throw new AppError('A selected product is missing or archived. Refresh the catalog.', 400);
        await client.query(
          `INSERT INTO order_items (business_id, order_id, product_id, quantity, unit, unit_price_at_order, product_name_at_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [businessId, orderId, product.id, item.quantity, product.unit, product.current_price, product.name]);
      }
      const details = (await this.findById({ orderId, businessId, client }))!;
      if (details.total_amount > 9999999999.99) throw new AppError('Order total exceeds the supported amount.', 400);
      return details;
    });
  }

  static async updateStatus({ orderId, businessId, newStatus, changedBy, client }: {
    orderId: string; businessId: string; newStatus: OrderStatus; changedBy?: string; client?: PoolClient;
  }): Promise<OrderWithDetails> {
    return withTransaction(async tx => {
      const result = await tx.query<Order>('SELECT * FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE', [orderId, businessId]);
      const order = result.rows[0];
      if (!order) throw new AppError('Order not found', 404);
      // A repeated request is safe to retry after a timeout; do not duplicate history.
      if (order.status === newStatus) return (await this.findById({ orderId, businessId, client: tx }))!;
      const next: Record<OrderStatus, OrderStatus | null> = { Received: 'Packed', Packed: 'Delivered', Delivered: null };
      if (next[order.status] !== newStatus) throw new AppError(`Cannot change ${order.status} to ${newStatus}. Follow Received -> Packed -> Delivered.`, 409);
      const timestamp = newStatus === 'Packed' ? 'packed_at' : 'delivered_at';
      await tx.query(`UPDATE orders SET status = $1, ${timestamp} = NOW() WHERE id = $2 AND business_id = $3`, [newStatus, orderId, businessId]);
      await tx.query(
        `INSERT INTO order_status_history (business_id, order_id, from_status, to_status, changed_by)
         VALUES ($1, $2, $3, $4, $5)`, [businessId, orderId, order.status, newStatus, changedBy || null]);
      return (await this.findById({ orderId, businessId, client: tx }))!;
    }, client);
  }
}
