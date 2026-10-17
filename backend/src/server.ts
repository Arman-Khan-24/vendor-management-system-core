import { createApp } from './app.js';
import { config } from './config/env.js';
import { runMigrations } from './database/migrator.js';

async function bootstrap() {
  try {
    if (config.env === 'production' && (!process.env.JWT_SECRET || !process.env.DATABASE_URL)) {
      throw new Error('Production requires explicit JWT_SECRET and DATABASE_URL configuration.');
    }
    // Do not accept saves until the complete schema is ready.
    await runMigrations();

    const app = createApp();
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`🚀 OrderLedger Backend running at http://0.0.0.0:${config.port}`);
      console.log(`📡 Environment: ${config.env}`);
    });
  } catch (error) {
    console.error('Fatal initialization error:', error);
    process.exit(1);
  }
}

bootstrap();
