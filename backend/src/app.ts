import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import authRoutes from './routes/auth.routes.js';
import businessRoutes from './routes/business.routes.js';
import customerRoutes from './routes/customer.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { checkDatabaseReadiness } from './database/migrator.js';

export function createApp() {
  const app = express();

  // Basic security and parsing
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true, exposedHeaders: ['X-Request-ID'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      await checkDatabaseReadiness();
      res.json({ status: 'ok', service: 'OrderLedger Core API', apiVersion: 2, capabilities: { idempotentWrites: true }, timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unavailable', service: 'OrderLedger Core API', error: 'Database connection or migrations are not ready.' });
    }
  });

  // REST Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/business', businessRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/reports', reportsRoutes);
  // Integration is deferred. Never mount the unauthenticated mock history or ingestion routes.
  app.use(['/api/whatsapp', '/webhooks/whatsapp'], (req, res) => {
    res.status(503).json({ error: 'WhatsApp integration is not enabled.', code: 'INTEGRATION_UNAVAILABLE' });
  });

  app.use((req, res) => { res.status(404).json({ error: 'API route not found.' }); });

  // Central error handler
  app.use(errorHandler);

  return app;
}
