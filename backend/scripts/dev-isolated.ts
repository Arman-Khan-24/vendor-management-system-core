import { startIsolatedPostgres } from '../src/tests/helpers/isolated-postgres.js';

const database = await startIsolatedPostgres();
const { runMigrations } = await import('../src/database/migrator.js');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/database/connection.js');
await runMigrations();
const server = createApp().listen(5100, '127.0.0.1', () => {
  console.log('Disposable OrderLedger API ready at http://127.0.0.1:5100. Register a test business; all data is isolated.');
});
async function shutdown() {
  await new Promise<void>(done => server.close(() => done()));
  await pool.end();
  await database.stop();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
