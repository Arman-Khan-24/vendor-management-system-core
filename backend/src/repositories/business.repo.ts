import { query } from '../database/connection.js';
import { Business } from '../models/types.js';

export class BusinessRepository {
  static async findById(id: string): Promise<Business | null> {
    const res = await query<Business>('SELECT * FROM businesses WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  static async findBySlug(slug: string): Promise<Business | null> {
    const res = await query<Business>('SELECT * FROM businesses WHERE slug = $1', [slug]);
    return res.rows[0] || null;
  }

  static async create(data: {
    name: string;
    slug: string;
    categoryTemplate?: string;
    phone?: string;
    currency?: string;
    invoiceTrigger?: 'Packed' | 'Delivered';
  }): Promise<Business> {
    const res = await query<Business>(
      `INSERT INTO businesses (name, slug, category_template, phone, currency, invoice_trigger)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.name,
        data.slug,
        data.categoryTemplate || 'custom',
        data.phone || null,
        data.currency || 'INR',
        data.invoiceTrigger || 'Delivered'
      ]
    );
    return res.rows[0];
  }

  static async update(
    id: string,
    data: Partial<Pick<Business, 'name' | 'phone' | 'currency' | 'logo_url' | 'invoice_trigger'>>
  ): Promise<Business | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const res = await query<Business>(
      `UPDATE businesses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  static async getCategoryTemplate(templateId: string) {
    const res = await query('SELECT * FROM category_templates WHERE id = $1', [templateId]);
    return res.rows[0] || null;
  }

  static async listCategoryTemplates() {
    const res = await query('SELECT id, name, description, jsonb_array_length(seed_products) as product_count FROM category_templates ORDER BY id');
    return res.rows;
  }
}
