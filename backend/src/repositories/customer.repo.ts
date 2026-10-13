import { query } from '../database/connection.js';
import { Customer } from '../models/types.js';

export interface CustomerWithBalance extends Customer {
  total_billed: number;
  total_paid: number;
  outstanding_balance: number;
  last_order_date: string | null;
  last_payment_date: string | null;
}

export class CustomerRepository {
  static async list({
    businessId,
    search,
    activeOnly = true
  }: {
    businessId: string;
    search?: string;
    activeOnly?: boolean;
  }): Promise<CustomerWithBalance[]> {
    let sql = `
      SELECT 
        c.*,
        COALESCE(SUM(DISTINCT i.total), 0) AS total_billed,
        COALESCE(SUM(DISTINCT p.amount), 0) AS total_paid,
        (COALESCE(SUM(DISTINCT i.total), 0) - COALESCE(SUM(DISTINCT p.amount), 0)) AS outstanding_balance,
        MAX(o.created_at) AS last_order_date,
        MAX(p.created_at) AS last_payment_date
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.business_id = c.business_id
      LEFT JOIN invoices i ON i.customer_id = c.id AND i.business_id = c.business_id
      LEFT JOIN payments p ON p.customer_id = c.id AND p.business_id = c.business_id
      WHERE c.business_id = $1
    `;
    const params: any[] = [businessId];

    if (activeOnly) {
      sql += ` AND c.active = TRUE`;
    }

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
    }

    sql += ` GROUP BY c.id ORDER BY c.name ASC`;

    const res = await query(sql, params);
    return res.rows.map(r => ({
      ...r,
      total_billed: parseFloat(r.total_billed) || 0,
      total_paid: parseFloat(r.total_paid) || 0,
      outstanding_balance: parseFloat(r.outstanding_balance) || 0,
    }));
  }

  static async findById({
    customerId,
    businessId
  }: {
    customerId: string;
    businessId: string;
  }): Promise<CustomerWithBalance | null> {
    const sql = `
      SELECT 
        c.*,
        COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.customer_id = c.id AND i.business_id = c.business_id), 0) AS total_billed,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id = c.id AND p.business_id = c.business_id), 0) AS total_paid,
        COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.customer_id = c.id AND i.business_id = c.business_id), 0) -
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id = c.id AND p.business_id = c.business_id), 0) AS outstanding_balance,
        (SELECT MAX(created_at) FROM orders WHERE customer_id = c.id AND business_id = c.business_id) AS last_order_date,
        (SELECT MAX(created_at) FROM payments WHERE customer_id = c.id AND business_id = c.business_id) AS last_payment_date
      FROM customers c
      WHERE c.id = $1 AND c.business_id = $2
    `;
    const res = await query(sql, [customerId, businessId]);
    if (!res.rows[0]) return null;

    const r = res.rows[0];
    return {
      ...r,
      total_billed: parseFloat(r.total_billed) || 0,
      total_paid: parseFloat(r.total_paid) || 0,
      outstanding_balance: parseFloat(r.outstanding_balance) || 0,
    };
  }

  static async findByPhone({
    phone,
    businessId
  }: {
    phone: string;
    businessId: string;
  }): Promise<Customer | null> {
    const res = await query<Customer>(
      'SELECT * FROM customers WHERE phone = $1 AND business_id = $2',
      [phone, businessId]
    );
    return res.rows[0] || null;
  }

  static async create(data: {
    businessId: string;
    name: string;
    phone: string;
    creditTermsDays?: number;
  }): Promise<Customer> {
    const res = await query<Customer>(
      `INSERT INTO customers (business_id, name, phone, credit_terms_days)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.businessId, data.name, data.phone, data.creditTermsDays ?? 7]
    );
    return res.rows[0];
  }

  static async update({
    customerId,
    businessId,
    data
  }: {
    customerId: string;
    businessId: string;
    data: Partial<Pick<Customer, 'name' | 'phone' | 'credit_terms_days' | 'active'>>;
  }): Promise<Customer | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }

    if (fields.length === 0) return this.findById({ customerId, businessId });

    fields.push(`updated_at = NOW()`);
    values.push(customerId, businessId);

    const res = await query<Customer>(
      `UPDATE customers SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  static async delete({
    customerId,
    businessId
  }: {
    customerId: string;
    businessId: string;
  }): Promise<boolean> {
    const res = await query(
      'DELETE FROM customers WHERE id = $1 AND business_id = $2 RETURNING id',
      [customerId, businessId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
