import { getClient, pool, query } from '../database/connection.js';
import type { PoolClient } from 'pg';
import { Business } from '../models/types.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  encryptConnectionKey, mergeBusinessSettings, normalizeBusinessConnections, normalizeBusinessSettings,
  type ConnectionSummaryRow
} from '../services/business-settings.service.js';
import {
  updateBusinessConnectionsSchema, updateBusinessSettingsSchema,
  type BusinessConnections,
  type UpdateBusinessConnectionsInput, type UpdateBusinessInput
} from '../validators/business-settings.schemas.js';

function normalizeBusiness(business: Business): Business {
  return { ...business, settings: normalizeBusinessSettings(business.settings) };
}

const connectionSummaryColumns = 'slot, provider, endpoint, model, (api_key_encrypted IS NOT NULL) AS has_api_key';

export class BusinessRepository {
  static async findById(id: string): Promise<Business | null> {
    const res = await query<Business>('SELECT * FROM businesses WHERE id = $1', [id]);
    return res.rows[0] ? normalizeBusiness(res.rows[0]) : null;
  }

  static async findBySlug(slug: string): Promise<Business | null> {
    const res = await query<Business>('SELECT * FROM businesses WHERE slug = $1', [slug]);
    return res.rows[0] ? normalizeBusiness(res.rows[0]) : null;
  }

  static async create(data: {
    name: string;
    slug: string;
    categoryTemplate?: string;
    phone?: string;
    currency?: string;
    invoiceTrigger?: 'Packed' | 'Delivered';
  }, client?: PoolClient): Promise<Business> {
    const res = await (client ?? pool).query<Business>(
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
    return normalizeBusiness(res.rows[0]);
  }

  static async update(
    id: string,
    input: UpdateBusinessInput
  ): Promise<Business | null> {
    const data = updateBusinessSettingsSchema.parse(input);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      // Ledger writes take the same business lock before reading financial settings.
      const existing = await client.query<Business>('SELECT * FROM businesses WHERE id = $1 FOR UPDATE', [id]);
      const current = existing.rows[0];
      if (!current) {
        await client.query('COMMIT');
        return null;
      }

      if (data.currency !== undefined && data.currency !== current.currency) {
        const history = await client.query<{ has_history: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM orders WHERE business_id = $1)
               OR EXISTS(SELECT 1 FROM invoices WHERE business_id = $1)
               OR EXISTS(SELECT 1 FROM payments WHERE business_id = $1) AS has_history`, [id]
        );
        if (history.rows[0]?.has_history) {
          throw new AppError('Currency cannot be changed after orders, invoices, or payments have been recorded.', 409);
        }
      }

      const currentSettings = current.settings;
      const mapped: Record<string, unknown> = {
        name: data.name,
        phone: data.phone === undefined ? undefined : data.phone || null,
        currency: data.currency,
        logo_url: data.logoUrl === undefined ? undefined : data.logoUrl || null,
        invoice_trigger: data.invoiceTrigger,
        category_template: data.categoryTemplate,
        settings: data.settings === undefined ? undefined : JSON.stringify(mergeBusinessSettings(currentSettings, data.settings))
      };
      const changes = Object.entries(mapped).filter(([, value]) => value !== undefined);
      if (!changes.length) {
        await client.query('COMMIT');
        return normalizeBusiness(current);
      }

      const fields = changes.map(([column], index) => `${column} = $${index + 1}`);
      const values = changes.map(([, value]) => value);
      values.push(id);
      const updated = await client.query<Business>(
        `UPDATE businesses SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values
      );
      await client.query('COMMIT');
      return normalizeBusiness(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getConnections(businessId: string): Promise<BusinessConnections> {
    const business = await query('SELECT id FROM businesses WHERE id = $1', [businessId]);
    if (!business.rows[0]) throw new AppError('Business not found', 404);
    const rows = await query<ConnectionSummaryRow>(`SELECT ${connectionSummaryColumns} FROM business_connections WHERE business_id = $1`, [businessId]);
    return normalizeBusinessConnections(rows.rows);
  }

  static async updateConnections(businessId: string, input: UpdateBusinessConnectionsInput): Promise<BusinessConnections> {
    const data = updateBusinessConnectionsSchema.parse(input);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const business = await client.query('SELECT id FROM businesses WHERE id = $1 FOR UPDATE', [businessId]);
      if (!business.rows[0]) throw new AppError('Business not found', 404);
      const existing = await client.query<ConnectionSummaryRow>(`SELECT ${connectionSummaryColumns} FROM business_connections WHERE business_id = $1`, [businessId]);
      const connections = normalizeBusinessConnections(existing.rows);
      for (const slot of ['primary', 'fallback'] as const) {
        const patch = data[slot];
        if (!patch) continue;
        const current = connections[slot];
        const keyChanged = patch.apiKey !== undefined;
        const encryptedKey = keyChanged ? encryptConnectionKey(patch.apiKey!, businessId, slot) : null;
        const result = await client.query<ConnectionSummaryRow>(
          `INSERT INTO business_connections (business_id, slot, provider, endpoint, model, api_key_encrypted)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (business_id, slot) DO UPDATE SET
             provider = EXCLUDED.provider, endpoint = EXCLUDED.endpoint, model = EXCLUDED.model,
             api_key_encrypted = CASE WHEN $7 THEN EXCLUDED.api_key_encrypted ELSE business_connections.api_key_encrypted END,
             updated_at = NOW()
           RETURNING ${connectionSummaryColumns}`,
          [businessId, slot, patch.provider ?? current.provider, patch.endpoint ?? current.endpoint, patch.model ?? current.model, encryptedKey, keyChanged]
        );
        connections[slot] = normalizeBusinessConnections(result.rows)[slot];
      }
      await client.query('COMMIT');
      return connections;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getCategoryTemplate(templateId: string, client?: PoolClient) {
    const res = await (client ?? pool).query('SELECT * FROM category_templates WHERE id = $1', [templateId]);
    return res.rows[0] || null;
  }

  static async listCategoryTemplates() {
    const res = await query('SELECT id, name, description, jsonb_array_length(seed_products) as product_count FROM category_templates ORDER BY id');
    return res.rows;
  }
}
