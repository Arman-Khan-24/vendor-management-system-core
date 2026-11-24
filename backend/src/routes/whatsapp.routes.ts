import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Router } from 'express';
import { rateLimit } from '../middleware/rate-limit.js';
import { authenticate,requireRoles } from '../middleware/auth.middleware.js';
import { validateBody,validateUuidParam } from '../middleware/validate.middleware.js';
import { whatsappConnectionSchema,reviewOrderSchema } from '../validators/whatsapp.schemas.js';
import { WhatsAppRepository } from '../repositories/whatsapp.repo.js';
import { MetaWhatsAppProvider } from '../services/whatsapp/whatsapp.provider.js';
import { getBusinessAi } from '../services/ai/business-ai.js';
import { OrderProcessingEngine } from '../services/order.processor.js';
import { AppError } from '../middleware/errorHandler.js';
import { query,withTransaction } from '../database/connection.js';
import { ProviderError } from '../services/provider-http.js';
const router = Router();
router.use(authenticate,requireRoles('OWNER','STAFF'));
router.param('id',validateUuidParam);
router.get('/connection',requireRoles('OWNER'),async (req,res,next) => {
  try { res.json(await WhatsAppRepository.connectionSummary(req.businessId!)); } catch(error) { next(error); }
});
router.patch('/connection',requireRoles('OWNER'),validateBody(whatsappConnectionSchema),async (req,res,next) => {
  try {
    if (req.body.enabled === true) await getBusinessAi(req.businessId!);
    res.json(await WhatsAppRepository.updateConnection(req.businessId!,req.body));
  } catch(error) { next(error); }
});
router.post('/connection/test',requireRoles('OWNER'),async (req,res,next) => {
  try {
    const connection = await WhatsAppRepository.runtimeConnection(req.businessId!);
    if (!connection.phoneNumberId || !connection.accessToken || !connection.graphVersion) throw new AppError('Save the phone number ID, API version and token first.',400);
    res.json(await new MetaWhatsAppProvider(connection).testConnection());
  } catch(error) { next(error instanceof ProviderError ? new AppError('Meta connection failed ('+error.code+'). Check the saved ID, API version and token.',400) : error); }
});
router.post('/ai/test', requireRoles('OWNER'), rateLimit(12, 60000, req => req.businessId!),
  validateBody(z.object({ slot: z.enum(['primary', 'fallback']).optional(), mode: z.enum(['text', 'photo']).default('text') }).strict()), async (req,res,next) => {
  try {
    const ai = await getBusinessAi(req.businessId!, req.body.slot);
    const catalog = [{ id: 'synthetic', name: 'Test Product', unit: 'kg', current_price: 1 }];
    const result = req.body.mode === 'photo'
      ? await ai.extractImage(await readFile(new URL('../assets/ai-test-order.png', import.meta.url)), 'image/png', catalog)
      : await ai.extract('Test Product 2 kg', catalog);
    if (result.warnings.length || result.items.length !== 1 || result.items[0].product.toLowerCase() !== 'test product' || result.items[0].quantity !== 2 || result.items[0].unit.toLowerCase() !== 'kg') throw new AppError('The provider responded but the sample order was not extracted correctly. Check the selected model.',400);
    res.json({ provider: result.provider,model: result.model,wasFallback: result.wasFallback,items: result.items,warnings: result.warnings });
  } catch(error) { next(error instanceof ProviderError ? new AppError('AI test failed ('+error.code + (error.fallbackCode ? ', fallback: ' + error.fallbackCode : '') + '). Check provider, model and key.', error.code === 'SHARED_AI_QUOTA_EXCEEDED' ? 429 : error.code === 'SHARED_AI_DISABLED' ? 403 : 400) : error); }
});
router.get('/revision',async (req,res,next) => {
  try {
    const result=await query('SELECT COALESCE(MAX(completed_at)::text,\'\') AS revision FROM whatsapp_jobs WHERE business_id=$1',[req.businessId!]);
    res.json(result.rows[0]);
  } catch(error) { next(error); }
});
router.get('/messages',async (req,res,next) => {
  try { res.json(await WhatsAppRepository.list(req.businessId!)); } catch(error) { next(error); }
});
router.post('/messages/:id/review',requireRoles('OWNER'),validateBody(reviewOrderSchema),async (req,res,next) => {
  try {
    const connection = await WhatsAppRepository.runtimeConnection(req.businessId!);
    if (!connection.enabled) throw new AppError('Enable WhatsApp ordering before sending a reviewed summary.',400);
    await OrderProcessingEngine.review(req.businessId!,req.params.id,req.body.items);
    res.json({ queued: true });
  } catch(error) { next(error); }
});
router.post('/jobs/:id/retry',requireRoles('OWNER'),async (req,res,next) => {
  try {
    if (req.body?.acknowledgeDuplicateRisk !== true) throw new AppError('A previously unconfirmed reply may have been delivered. Acknowledge this before retrying.',400);
    await withTransaction(async client => {
      const result = await client.query("UPDATE whatsapp_jobs SET status='queued',attempts=0,error_code=NULL,available_at=NOW(),lease_token=NULL WHERE id=$1 AND business_id=$2 AND status='failed' RETURNING message_id", [req.params.id,req.businessId!]);
      if (!result.rows[0]) throw new AppError('No failed job found for this business.',404);
      await client.query("UPDATE whatsapp_messages SET status='queued',error_code=NULL WHERE id=$1", [result.rows[0].message_id]);
    });
    res.json({ queued: true });
  } catch(error) { next(error); }
});
export default router;
