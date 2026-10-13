import { pool } from '../database/connection.js';
import { Order, OrderItem, OrderStatus, OrderStatusHistory } from '../models/types.js';

export interface OrderWithDetails extends Order {
  customer_name: string;
  customer_phone: string;
  items: (OrderItem & { product_name: string })[];
  history: OrderStatusHistory[];
  total_amount: number;
  invoice_id: string | null;
  invoice_no: number | null;
  invoice_status: string | null;
}

export class OrderRepository {
  static async list({
    businessId,
    status,
    customerId,
    limit = 50,
    offset = 0
  }: {
    businessId: string;
    status?: OrderStatus;
    customerId?: string;
    limit?: number;
    offset?: number;
  }): Promise<OrderWithDetails[]> {
    let sql = `
      SELECT 
        o.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        COALESCE(SUM(oi.quantity * oi.unit_price_at_order), 0) AS total_amount,
        i.id AS invoice_id,
        i.invoice_no AS invoice_no,
        i.status AS invoice_status
      FROM orders o
      JOIN customers c ON c.id = o.customer_id AND c.business_id = o.business_id
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.business_id = o.business_id
      LEFT JOIN invoices i ON i.order_id = o.id AND i.business_id = o.business_id
      WHERE o.business_id = $1
    `;
    const params: any[] = [businessId];

    if (status) {
      params.push(status);
      sql += ` AND o.status = $${params.length}`;
    }

    if (customerId) {
      params.push(customerId);
      sql += ` AND o.customer_id = $${params.length}`;
    }

    sql += ` GROUP BY o.id, c.name, c.phone, i.id, i.invoice_no, i.status ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const client = await pool.connect();
    try {
      const res = await client.query(sql, params);
      const orders: OrderWithDetails[] = [];

      for (const row of res.rows) {
        orders.push({
          ...row,
          total_amount: parseFloat(row.total_amount) || 0,
          items: [],
          history: []
        });
      }
      return orders;
    } finally {
      client.release();
    }
  }

  static async findById({
    orderId,
    businessId
  }: {
    orderId: string;
    businessId: string;
  }): Promise<OrderWithDetails | null> {
    const client = await pool.connect();
    try {
      const orderSql = `
        SELECT 
          o.*,
          c.name AS customer_name,
          c.phone AS customer_phone,
          i.id AS invoice_id,
          i.invoice_no AS invoice_no,
          i.status AS invoice_status
        FROM orders o
        JOIN customers c ON c.id = o.customer_id AND c.business_id = o.business_id
        LEFT JOIN invoices i ON i.order_id = o.id AND i.business_id = o.business_id
        WHERE o.id = $1 AND o.business_id = $2
      `;
      const orderRes = await client.query(orderSql, [orderId, businessId]);
      if (orderRes.rows.length === 0) return null;

      const orderRow = orderRes.rows[0];

      // Fetch items with frozen prices
      const itemsSql = `
        SELECT 
          oi.*,
          p.name AS product_name
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id AND p.business_id = oi.business_id
        WHERE oi.order_id = $1 AND oi.business_id = $2
        ORDER BY oi.id ASC
      `;
      const itemsRes = await client.query(itemsSql, [orderId, businessId]);

      // Fetch history audit trail
      const historySql = `
        SELECT * FROM order_status_history
        WHERE order_id = $1 AND business_id = $2
        ORDER BY changed_at ASC
      `;
      const historyRes = await client.query(historySql, [orderId, businessId]);

      const items = itemsRes.rows.map(item => ({
        ...item,
        quantity: parseFloat(item.quantity),
        unit_price_at_order: parseFloat(item.unit_price_at_order),
        total_price: parseFloat(item.total_price)
      }));

      const total_amount = items.reduce((sum, it) => sum + it.total_price, 0);

      return {
        ...orderRow,
        items,
        history: historyRes.rows,
        total_amount
      };
    } finally {
      client.release();
    }
  }

  static async createOrderWithItems({
    businessId,
    customerId,
    source = 'manual',
    notes,
    createdBy,
    items
  }: {
    businessId: string;
    customerId: string;
    source?: 'manual' | 'whatsapp_text' | 'whatsapp_image';
    notes?: string;
    createdBy?: string;
    items: { productId: string; quantity: number }[];
  }): Promise<OrderWithDetails> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verify customer belongs to same business
      const custCheck = await client.query(
        'SELECT id FROM customers WHERE id = $1 AND business_id = $2',
        [customerId, businessId]
      );
      if (custCheck.rows.length === 0) {
        throw new Error('Customer not found or belongs to another business');
      }

      // 2. Compute next sequential order number for tenant
      const seqRes = await client.query(
        'SELECT COALESCE(MAX(order_no), 0) + 1 AS next_no FROM orders WHERE business_id = $1',
        [businessId]
      );
      const orderNo = parseInt(seqRes.rows[0].next_no, 10);

      // 3. Create order header
      const orderRes = await client.query<Order>(
        `INSERT INTO orders (business_id, customer_id, order_no, status, source, notes, created_by, confirmed_at)
         VALUES ($1, $2, $3, 'Received', $4, $5, $6, NOW())
         RETURNING *`,
        [businessId, customerId, orderNo, source, notes || null, createdBy || null]
      );
      const createdOrder = orderRes.rows[0];

      // 4. Create initial status history entry
      await client.query(
        `INSERT INTO order_status_history (business_id, order_id, from_status, to_status, changed_by)
         VALUES ($1, $2, NULL, 'Received', $3)`,
        [businessId, createdOrder.id, createdBy || null]
      );

      // 5. Freeze product prices and insert items
      for (const item of items) {
        // Enforce same-business product lookup
        const prodRes = await client.query(
          'SELECT id, unit, current_price FROM products WHERE id = $1 AND business_id = $2 AND active = TRUE',
          [item.productId, businessId]
        );
        if (prodRes.rows.length === 0) {
          throw new Error(`Product ${item.productId} not found or inactive for tenant`);
        }
        const product = prodRes.rows[0];
        const frozenPrice = parseFloat(product.current_price);

        await client.query(
          `INSERT INTO order_items (business_id, order_id, product_id, quantity, unit, unit_price_at_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [businessId, createdOrder.id, product.id, item.quantity, product.unit, frozenPrice]
        );
      }

      await client.query('COMMIT');

      const details = await OrderRepository.findById({ orderId: createdOrder.id, businessId });
      if (!details) throw new Error('Failed to retrieve newly created order');
      return details;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async updateStatus({
    orderId,
    businessId,
    newStatus,
    changedBy
  }: {
    orderId: string;
    businessId: string;
    newStatus: OrderStatus;
    changedBy?: string;
  }): Promise<OrderWithDetails> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch current status with lock
      const curRes = await client.query<Order>(
        'SELECT * FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [orderId, businessId]
      );
      if (curRes.rows.length === 0) {
        throw new Error('Order not found');
      }
      const order = curRes.rows[0];

      // Enforce strict state machine transitions:
      // Received -> Packed -> Delivered
      const validTransitions: Record<OrderStatus, OrderStatus[]> = {
        'Received': ['Packed'],
        'Packed': ['Delivered'],
        'Delivered': []
      };

      if (!validTransitions[order.status]?.includes(newStatus)) {
        throw new Error(`Invalid status transition from '${order.status}' to '${newStatus}'. Allowed: ${validTransitions[order.status]?.join(', ') || 'None'}`);
      }

      let timestampField = '';
      if (newStatus === 'Packed') timestampField = ', packed_at = NOW()';
      if (newStatus === 'Delivered') timestampField = ', delivered_at = NOW()';

      await client.query(
        `UPDATE orders SET status = $1 ${timestampField} WHERE id = $2 AND business_id = $3`,
        [newStatus, orderId, businessId]
      );

      // Audit status transition
      await client.query(
        `INSERT INTO order_status_history (business_id, order_id, from_status, to_status, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [businessId, orderId, order.status, newStatus, changedBy || null]
      );

      await client.query('COMMIT');

      const updated = await OrderRepository.findById({ orderId, businessId });
      if (!updated) throw new Error('Order lookup failed after status change');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
