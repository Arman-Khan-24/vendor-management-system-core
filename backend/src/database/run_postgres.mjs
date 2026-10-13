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
  persistent: false
});

async function main() {
  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('orderledger');
    console.log('✅ Real PostgreSQL daemon active at postgresql://postgres:password@localhost:5433/orderledger');
    console.log('Ready to receive connections.');
  } catch (err) {
    console.error('Failed to start embedded postgres:', err);
    process.exit(1);
  }
}

main();
