import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './connection.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function runMigrations() {
    const client = await pool.connect();
    try {
        console.log('🔄 Running database migrations...');
        await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        // In dist or src, look for migrations
        let migrationsDir = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsDir)) {
            migrationsDir = path.join(process.cwd(), 'src', 'database', 'migrations');
        }
        if (!fs.existsSync(migrationsDir)) {
            console.log('No migrations directory found.');
            return;
        }
        const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
        for (const file of files) {
            const existing = await client.query('SELECT id FROM _migrations WHERE filename = $1', [file]);
            if (existing.rows.length === 0) {
                console.log(`Applying migration: ${file}`);
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
                await client.query('COMMIT');
                console.log(`✅ Applied migration: ${file}`);
            }
        }
        console.log('✨ All migrations are up to date.');
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', error);
        throw error;
    }
    finally {
        client.release();
    }
}
// Auto-run if executed as main
if (process.argv[1] && (process.argv[1].endsWith('migrator.ts') || process.argv[1].endsWith('migrator.js'))) {
    runMigrations().then(() => process.exit(0)).catch(() => process.exit(1));
}
