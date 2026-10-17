import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './connection.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(directory, 'migrations');
const migrationLock = 8739132;

function migrationFiles() {
  if (!fs.existsSync(migrationsDir)) throw new Error('Migration assets are missing. Run the backend build before starting.');
  const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
  if (!files.length) throw new Error('No database migrations found.');
  return files;
}

export async function checkDatabaseReadiness() {
  const required = migrationFiles();
  const result = await pool.query('SELECT filename FROM _migrations');
  const applied = new Set(result.rows.map(row => row.filename));
  if (required.some(file => !applied.has(file))) throw new Error('Database migrations are incomplete.');
}

export async function runMigrations() {
  const files = migrationFiles();
  const client = await pool.connect();
  let locked = false;
  try {
    // Multiple API instances may start together. Only one may migrate this database.
    await client.query('SELECT pg_advisory_lock($1)', [migrationLock]);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY, filename VARCHAR(255) NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    for (const file of files) {
      const existing = await client.query('SELECT id FROM _migrations WHERE filename = $1', [file]);
      if (existing.rows.length) continue;
      console.log(`Applying migration: ${file}`);
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [migrationLock]).catch(() => undefined);
    client.release();
  }
}

if (process.argv[1] && ['migrator.ts', 'migrator.js'].includes(path.basename(process.argv[1]))) {
  runMigrations().then(() => pool.end()).catch(error => {
    console.error('Database migration failed:', error instanceof Error ? error.message : 'unknown failure');
    process.exitCode = 1;
    return pool.end();
  });
}

