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
import whatsappRoutes from './routes/whatsapp.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { checkDatabaseReadiness } from './database/migrator.js';
import { config } from './config/env.js';

export function createApp(localDemo?: express.Router) {
  if (localDemo && config.env==='production') throw new Error('Local demo routes are unavailable in production.');
  const app = express();

  // Basic security and parsing
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true, exposedHeaders: ['X-Request-ID'] }));
  if (localDemo) app.use('/api/local-demo',express.json({limit:'8mb'}),localDemo);
  app.use(express.json({ limit: '1mb', verify: (req,res,buffer) => {
    if (req.url?.startsWith('/webhooks/whatsapp/')) (res as any).locals.rawBody = Buffer.from(buffer);
  } }));
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
  app.use('/api/whatsapp',whatsappRoutes);
  app.use('/webhooks/whatsapp',webhookRoutes);

  app.use((req, res) => { res.status(404).json({ error: 'API route not found.' }); });

  // Central error handler
  app.use(errorHandler);

  return app;
}
