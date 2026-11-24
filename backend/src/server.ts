import { createApp } from './app.js';
import { config } from './config/env.js';
import { runMigrations } from './database/migrator.js';
import { startWhatsAppWorker } from './services/whatsapp/whatsapp.worker.js';
import { pool } from './database/connection.js';

async function bootstrap() {
  try {
    if (config.env === 'production' && (!process.env.JWT_SECRET || !process.env.DATABASE_URL)) {
      throw new Error('Production requires explicit JWT_SECRET and DATABASE_URL configuration.');
    }
    // Do not accept saves until the complete schema is ready.
    await runMigrations();

    const app = createApp();
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`🚀 OrderLedger Backend running at http://0.0.0.0:${config.port}`);
      console.log(`📡 Environment: ${config.env}`);
    });
    const stopWorker = process.env.WHATSAPP_WORKER_ENABLED === 'false' ? async () => {} : startWhatsAppWorker();
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return; stopping = true;
      await stopWorker();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await pool.end();
    };
    process.once('SIGTERM',() => void shutdown());
    process.once('SIGINT',() => void shutdown());
  } catch (error) {
    console.error('Fatal initialization error:', error);
    process.exit(1);
  }
}

bootstrap();
