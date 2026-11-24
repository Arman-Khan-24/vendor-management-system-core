import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import { pool } from '../../database/connection.js';

export function mockSessions() {
  const original = pool.query;
  const members = new Map<string, { role: string }>();
  pool.query = (async (sql: string, params: string[]) => {
    if (!sql.includes('session_revocations')) return Reflect.apply(original, pool, [sql, params]);
    const member = members.get(params[2]);
    return { rows: member ? [member] : [] };
  }) as typeof pool.query;

  return {
    token(role: string, businessId: string) {
      const id = randomUUID();
      members.set(id, { role });
      return jwt.sign({ userId: randomUUID(), businessId, role }, config.jwtSecret, { jwtid: id, expiresIn: '1h' });
    },
    restore() { pool.query = original; },
  };
}
