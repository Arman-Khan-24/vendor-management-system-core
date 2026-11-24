import { readFileSync } from 'node:fs';
import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

/**
 * Standard PostgreSQL connection pool.
 * OrderLedger strictly uses PostgreSQL as its sole database.
 */
const databaseUrl = new URL(config.databaseUrl);
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname);
const isSupabasePooler = databaseUrl.hostname.endsWith('.pooler.supabase.com');
const ca = process.env.DATABASE_CA_CERT || (isSupabasePooler
  // Published Supabase trust anchor for hosted PostgreSQL.
  ? readFileSync(new URL('../assets/supabase-prod-ca-2021.crt', import.meta.url), 'utf8')
  : undefined);
// pg lets URL SSL parameters replace the explicit verified TLS options.
for (const name of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) databaseUrl.searchParams.delete(name);

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: true, ca },
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
