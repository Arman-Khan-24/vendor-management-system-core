import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';

async function recreateDatabaseWithUtf8() {
  console.log('========================================================================');
  console.log('   MIGRATING DATABASE TO NATIVE UTF-8 SERVER ENCODING                  ');
  console.log('========================================================================\n');

  // Step 1: Dump existing data from orderledger
  console.log('1. Dumping existing data from orderledger...');
  const oldPool = new Pool({ connectionString: 'postgresql://postgres:password@localhost:5433/orderledger' });
  
  const backup = {};
  const tablesToBackup = ['businesses', 'users', 'customers', 'category_templates', 'products'];
  
  for (const table of tablesToBackup) {
    try {
      const res = await oldPool.query(`SELECT * FROM "${table}"`);
      backup[table] = res.rows;
      console.log(`   - Backed up ${table}: ${res.rows.length} rows`);
    } catch (e) {
      console.log(`   - Could not dump ${table}: ${e.message}`);
    }
  }
  await oldPool.end();

  // Step 2: Connect to maintenance database 'postgres' to drop & recreate orderledger
  console.log('\n2. Connecting to maintenance database to recreate orderledger with ENCODING UTF8...');
  const maintenancePool = new Pool({ connectionString: 'postgresql://postgres:password@localhost:5433/postgres' });

  // Terminate any active connections to orderledger
  await maintenancePool.query(`
    SELECT pg_terminate_backend(pid) 
    FROM pg_stat_activity 
    WHERE datname = 'orderledger' AND pid <> pg_backend_pid();
  `);
  console.log('   - Terminated existing active connections to orderledger.');

  // Drop orderledger
  await maintenancePool.query('DROP DATABASE IF EXISTS orderledger;');
  console.log('   - Dropped database orderledger.');

  // Create orderledger with explicit UTF8 encoding and C collation from template0
  await maintenancePool.query("CREATE DATABASE orderledger WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;");
  console.log('   - Created database orderledger with ENCODING \'UTF8\' LC_COLLATE \'C\' LC_CTYPE \'C\' TEMPLATE template0.');

  // Check encoding of new database
  const checkRes = await maintenancePool.query("SELECT datname, pg_encoding_to_char(encoding) as encoding, datcollate, datctype FROM pg_database WHERE datname = 'orderledger';");
  console.log('   - Verification from pg_database:', JSON.stringify(checkRes.rows[0]));
  await maintenancePool.end();

  // Step 3: Run migrations on the fresh UTF-8 orderledger database
  console.log('\n3. Running migrations on fresh UTF8 orderledger...');
  const newPool = new Pool({ connectionString: 'postgresql://postgres:password@localhost:5433/orderledger' });

  await newPool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.resolve('src/database/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of migrationFiles) {
    console.log(`   - Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await newPool.query('BEGIN');
    await newPool.query(sql);
    await newPool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    await newPool.query('COMMIT');
    console.log(`     ✅ Applied ${file}`);
  }

  // Step 4: Restore backed up data
  console.log('\n4. Restoring data into fresh UTF8 database...');
  for (const table of tablesToBackup) {
    const rows = backup[table];
    if (!rows || rows.length === 0) continue;

    console.log(`   - Restoring ${table} (${rows.length} rows)...`);
    for (const row of rows) {
      const keys = Object.keys(row);
      const cols = keys.map(k => `"${k}"`).join(', ');
      const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
      
      // Correctly serialize JS objects/arrays to JSON strings for jsonb/json columns
      const values = keys.map(k => {
        const val = row[k];
        if (val !== null && typeof val === 'object' && !(val instanceof Date) && !Buffer.isBuffer(val)) {
          return JSON.stringify(val);
        }
        return val;
      });

      try {
        await newPool.query(
          `INSERT INTO "${table}" (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
      } catch (err) {
        console.error(`❌ CRITICAL: Error restoring row in ${table}:`, err.message);
        throw new Error(`Restore failed on table "${table}": ${err.message}`);
      }
    }
  }

  // Step 5: Verify table counts
  console.log('\n5. Verifying restored table row counts:');
  for (const table of tablesToBackup) {
    const res = await newPool.query(`SELECT count(*) FROM "${table}"`);
    console.log(`   - ${table}: ${res.rows[0].count} rows`);
  }

  await newPool.end();
  console.log('\n========================================================================');
  console.log('   DATABASE SUCCESSFULLY RECREATED IN NATIVE UTF-8                     ');
  console.log('========================================================================\n');
}

recreateDatabaseWithUtf8().catch(err => {
  console.error('Migration to UTF8 failed:', err);
  process.exit(1);
});
