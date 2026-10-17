import { query } from '../database/connection.js';
export class UserRepository {
    static async findById({ userId, businessId }) {
        const res = await query('SELECT * FROM users WHERE id = $1 AND business_id = $2', [userId, businessId]);
        return res.rows[0] || null;
    }
    static async findByEmail(email) {
        const res = await query('SELECT * FROM users WHERE email = $1', [email]);
        return res.rows[0] || null;
    }
    static async findByBusinessAndEmail({ email, businessId }) {
        const res = await query('SELECT * FROM users WHERE email = $1 AND business_id = $2', [email, businessId]);
        return res.rows[0] || null;
    }
    static async listByBusiness(businessId) {
        const res = await query('SELECT id, business_id, name, email, role, created_at, updated_at FROM users WHERE business_id = $1 ORDER BY created_at ASC', [businessId]);
        return res.rows;
    }
    static async create(data) {
        const res = await query(`INSERT INTO users (business_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`, [data.businessId, data.name, data.email, data.passwordHash, data.role]);
        return res.rows[0];
    }
}
