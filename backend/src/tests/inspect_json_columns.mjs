import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: 'postgresql://postgres:password@localhost:5433/orderledger' });

async function findJsonColumns() {
  const res = await pool.query(`
    SELECT table_name, column_name, data_type, udt_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND (data_type IN ('json', 'jsonb') OR udt_name IN ('json', 'jsonb'))
    ORDER BY table_name, column_name
  `);
  console.log('ALL JSON/JSONB COLUMNS IN ORDERLEDGER:');
  console.table(res.rows);

  console.log('\nCURRENT category_templates CONTENT:');
  const catRes = await pool.query('SELECT id, name, seed_products FROM category_templates');
  for (const row of catRes.rows) {
    console.log(`- [${row.id}] ${row.name}:`, JSON.stringify(row.seed_products));
  }

  await pool.end();
}

findJsonColumns().catch(console.error);
