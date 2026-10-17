import { createApp } from './app.js';
import { config } from './config/env.js';
import { runMigrations } from './database/migrator.js';
async function bootstrap() {
    try {
        // Run database migrations on start if DB connected
        try {
            await runMigrations();
        }
        catch (migErr) {
            console.warn('⚠️ Warning: Migrations failed or database not reachable at startup:', migErr.message);
        }
        const app = createApp();
        app.listen(config.port, '0.0.0.0', () => {
            console.log(`🚀 OrderLedger Backend running at http://0.0.0.0:${config.port}`);
            console.log(`📡 Environment: ${config.env}`);
        });
    }
    catch (error) {
        console.error('Fatal initialization error:', error);
        process.exit(1);
    }
}
bootstrap();
