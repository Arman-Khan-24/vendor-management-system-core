import { query } from '../database/connection.js';
export class ProductRepository {
    static async list({ businessId, search, activeOnly = true }) {
        let sql = 'SELECT * FROM products WHERE business_id = $1';
        const params = [businessId];
        if (activeOnly) {
            sql += ' AND active = TRUE';
        }
        if (search) {
            params.push(`%${search}%`);
            sql += ` AND name ILIKE $${params.length}`;
        }
        sql += ' ORDER BY name ASC';
        const res = await query(sql, params);
        return res.rows.map(r => ({ ...r, current_price: parseFloat(r.current_price) }));
    }
    static async findById({ productId, businessId }) {
        const res = await query('SELECT * FROM products WHERE id = $1 AND business_id = $2', [productId, businessId]);
        if (!res.rows[0])
            return null;
        return { ...res.rows[0], current_price: parseFloat(res.rows[0].current_price) };
    }
    static async create(data) {
        const res = await query(`INSERT INTO products (business_id, name, unit, current_price)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [data.businessId, data.name, data.unit, data.currentPrice]);
        const r = res.rows[0];
        return { ...r, current_price: parseFloat(r.current_price) };
    }
    static async bulkCreate(businessId, items) {
        if (items.length === 0)
            return [];
        const results = [];
        for (const item of items) {
            const res = await query(`INSERT INTO products (business_id, name, unit, current_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (business_id, name) DO UPDATE SET current_price = EXCLUDED.current_price
         RETURNING *`, [businessId, item.name, item.unit, item.current_price]);
            results.push({ ...res.rows[0], current_price: parseFloat(res.rows[0].current_price) });
        }
        return results;
    }
    static async update({ productId, businessId, data }) {
        const fields = [];
        const values = [];
        let idx = 1;
        for (const [key, val] of Object.entries(data)) {
            if (val !== undefined) {
                fields.push(`${key} = $${idx++}`);
                values.push(val);
            }
        }
        if (fields.length === 0)
            return this.findById({ productId, businessId });
        fields.push(`updated_at = NOW()`);
        values.push(productId, businessId);
        const res = await query(`UPDATE products SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`, values);
        if (!res.rows[0])
            return null;
        return { ...res.rows[0], current_price: parseFloat(res.rows[0].current_price) };
    }
    static async delete({ productId, businessId }) {
        const res = await query('DELETE FROM products WHERE id = $1 AND business_id = $2 RETURNING id', [productId, businessId]);
        return (res.rowCount ?? 0) > 0;
    }
}
