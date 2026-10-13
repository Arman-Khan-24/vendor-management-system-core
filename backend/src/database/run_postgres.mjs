import defaultExport from 'embedded-postgres';
import path from 'path';
import fs from 'fs';

// Handle commonjs/esm export shape
const EmbeddedPostgres = defaultExport.default || defaultExport;

const dbPath = path.resolve(process.cwd(), '.pgdata');
if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(dbPath, { recursive: true });
}

console.log('🐘 Initializing native PostgreSQL daemon on port 5433...');

const pg = new EmbeddedPostgres({
  databaseDir: dbPath,
  port: 5433,
  user: 'postgres',
  password: 'password',
  persistent: true
});

async function main() {
  try {
    const isInitialized = fs.existsSync(path.join(dbPath, 'PG_VERSION'));
    if (!isInitialized) {
      await pg.initialise();
    }
    await pg.start();
    try {
      const { default: pkg } = await import('pg');
      const { Client } = pkg;
      const client = new Client({ connectionString: 'postgresql://postgres:password@localhost:5433/postgres' });
      await client.connect();
      const dbExists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'orderledger'");
      if (dbExists.rows.length === 0) {
        await client.query("CREATE DATABASE orderledger WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
      }
      await client.end();
    } catch (e) {
      // Database might already exist
    }
    console.log('✅ Real PostgreSQL daemon active at postgresql://postgres:password@localhost:5433/orderledger');
    console.log('Ready to receive connections.');
  } catch (err) {
    console.error('Failed to start embedded postgres:', err);
    process.exit(1);
  }
}

main();
