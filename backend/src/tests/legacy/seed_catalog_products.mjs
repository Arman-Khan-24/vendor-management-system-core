import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/orderledger'
});

async function run() {
  const b = await pool.query('SELECT id FROM businesses LIMIT 1');
  const bizId = b.rows[0].id;
  await pool.query(
    'INSERT INTO products (business_id, name, unit, current_price, active) VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING',
    [bizId, 'Banana (Robusta)', 'dozen', 50.00]
  );
  await pool.query(
    'INSERT INTO products (business_id, name, unit, current_price, active) VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING',
    [bizId, 'Tomato (Country/Naati)', 'kg', 45.00]
  );
  console.log('Catalog updated successfully with Banana and Tomato Country!');
  await pool.end();
}

run().catch(err => {
  console.error(err);
  pool.end();
});
