import { query } from '../database/connection.js';
import { Product } from '../models/types.js';

export class ProductRepository {
  static async list({
    businessId,
    search,
    activeOnly = true,
    limit = 100,
    offset = 0
  }: {
    businessId: string;
    search?: string;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Product[]> {
    let sql = 'SELECT * FROM products WHERE business_id = $1';
    const params: any[] = [businessId];

    if (activeOnly) {
      sql += ' AND active = TRUE';
    }

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND name ILIKE $${params.length}`;
    }

    params.push(limit, offset);
    sql += ` ORDER BY name ASC, id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const res = await query<Product>(sql, params);
    return res.rows.map(r => ({ ...r, current_price: parseFloat(r.current_price as any) }));
  }

  static async findById({
    productId,
    businessId
  }: {
    productId: string;
    businessId: string;
  }): Promise<Product | null> {
    const res = await query<Product>(
      'SELECT * FROM products WHERE id = $1 AND business_id = $2',
      [productId, businessId]
    );
    if (!res.rows[0]) return null;
    return { ...res.rows[0], current_price: parseFloat(res.rows[0].current_price as any) };
  }

  static async create(data: {
    businessId: string;
    name: string;
    unit: string;
    currentPrice: number;
    category?: string;
  }): Promise<Product> {
    const res = await query<Product>(
      `INSERT INTO products (business_id, name, unit, current_price, category)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.businessId, data.name, data.unit, data.currentPrice, data.category ?? '']
    );
    const r = res.rows[0];
    return { ...r, current_price: parseFloat(r.current_price as any) };
  }

  static async bulkCreate(
    businessId: string,
    items: { name: string; unit: string; current_price: number }[]
  ): Promise<Product[]> {
    if (items.length === 0) return [];

    const results: Product[] = [];
    for (const item of items) {
      const res = await query<Product>(
        `INSERT INTO products (business_id, name, unit, current_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (business_id, name) DO UPDATE SET current_price = EXCLUDED.current_price
         RETURNING *`,
        [businessId, item.name, item.unit, item.current_price]
      );
      results.push({ ...res.rows[0], current_price: parseFloat(res.rows[0].current_price as any) });
    }
    return results;
  }

  static async update({
    productId,
    businessId,
    data
  }: {
    productId: string;
    businessId: string;
    data: { name?: string; unit?: string; currentPrice?: number; category?: string; active?: boolean };
  }): Promise<Product | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const columns = { name: 'name', unit: 'unit', currentPrice: 'current_price', category: 'category', active: 'active' } as const;
    for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
      const val = data[key];
      if (val !== undefined) {
        fields.push(`${columns[key]} = $${idx++}`);
        values.push(val);
      }
    }

    if (fields.length === 0) return this.findById({ productId, businessId });

    fields.push(`updated_at = NOW()`);
    values.push(productId, businessId);

    const res = await query<Product>(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
      values
    );
    if (!res.rows[0]) return null;
    return { ...res.rows[0], current_price: parseFloat(res.rows[0].current_price as any) };
  }

  static async delete({
    productId,
    businessId
  }: {
    productId: string;
    businessId: string;
  }): Promise<boolean> {
    const res = await query(
      'UPDATE products SET active = FALSE, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id',
      [productId, businessId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
