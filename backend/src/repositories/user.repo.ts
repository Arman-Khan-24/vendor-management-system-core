import { query } from '../database/connection.js';
import { User, UserRole } from '../models/types.js';

export class UserRepository {
  static async findById({ userId, businessId }: { userId: string; businessId: string }): Promise<User | null> {
    const res = await query<User>(
      'SELECT * FROM users WHERE id = $1 AND business_id = $2',
      [userId, businessId]
    );
    return res.rows[0] || null;
  }

  static async findByEmail(email: string): Promise<User | null> {
    const res = await query<User>('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0] || null;
  }

  static async findByBusinessAndEmail({ email, businessId }: { email: string; businessId: string }): Promise<User | null> {
    const res = await query<User>(
      'SELECT * FROM users WHERE email = $1 AND business_id = $2',
      [email, businessId]
    );
    return res.rows[0] || null;
  }

  static async listByBusiness(businessId: string): Promise<Omit<User, 'password_hash'>[]> {
    const res = await query<Omit<User, 'password_hash'>>(
      'SELECT id, business_id, name, email, role, created_at, updated_at FROM users WHERE business_id = $1 ORDER BY created_at ASC',
      [businessId]
    );
    return res.rows;
  }

  static async create(data: {
    businessId: string;
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
  }): Promise<User> {
    const res = await query<User>(
      `INSERT INTO users (business_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.businessId, data.name, data.email, data.passwordHash, data.role]
    );
    return res.rows[0];
  }
}
