import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

/**
 * Standard PostgreSQL connection pool.
 * OrderLedger strictly uses PostgreSQL as its sole database.
 */
const isLocal = config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1');

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (config.env === 'development' && duration > 500) {
    console.warn(`Slow query executed in ${duration}ms: ${text}`);
  }
  return res;
}

export async function getClient() {
  return await pool.connect();
}

/** Join an existing unit of work or own its complete commit/rollback lifecycle. */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>, existingClient?: pg.PoolClient): Promise<T> {
  if (existingClient) return work(existingClient);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
