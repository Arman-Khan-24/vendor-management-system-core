import { query } from '../database/connection.js';
export class BusinessRepository {
    static async findById(id) {
        const res = await query('SELECT * FROM businesses WHERE id = $1', [id]);
        return res.rows[0] || null;
    }
    static async findBySlug(slug) {
        const res = await query('SELECT * FROM businesses WHERE slug = $1', [slug]);
        return res.rows[0] || null;
    }
    static async create(data) {
        const res = await query(`INSERT INTO businesses (name, slug, category_template, phone, currency, invoice_trigger)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`, [
            data.name,
            data.slug,
            data.categoryTemplate || 'custom',
            data.phone || null,
            data.currency || 'INR',
            data.invoiceTrigger || 'Delivered'
        ]);
        return res.rows[0];
    }
    static async update(id, data) {
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
            return this.findById(id);
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const res = await query(`UPDATE businesses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        return res.rows[0] || null;
    }
    static async getCategoryTemplate(templateId) {
        const res = await query('SELECT * FROM category_templates WHERE id = $1', [templateId]);
        return res.rows[0] || null;
    }
    static async listCategoryTemplates() {
        const res = await query('SELECT id, name, description, jsonb_array_length(seed_products) as product_count FROM category_templates ORDER BY id');
        return res.rows;
    }
}
