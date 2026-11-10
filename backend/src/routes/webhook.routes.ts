import { Router } from 'express';
import { validateUuidParam } from '../middleware/validate.middleware.js';
import { WhatsAppRepository } from '../repositories/whatsapp.repo.js';
import { MetaWhatsAppProvider, safeEqual } from '../services/whatsapp/whatsapp.provider.js';
import { AppError } from '../middleware/errorHandler.js';
import { ProviderError } from '../services/provider-http.js';
const router = Router();
router.param('businessId', validateUuidParam);
router.get('/:businessId', async (req,res,next) => {
  try {
    const connection = await WhatsAppRepository.runtimeConnection(req.params.businessId);
    if (!connection.verifyToken || req.query['hub.mode'] !== 'subscribe' || typeof req.query['hub.verify_token'] !== 'string'
      || !safeEqual(connection.verifyToken,req.query['hub.verify_token']) || typeof req.query['hub.challenge'] !== 'string') {
      throw new AppError('Webhook verification failed.',403);
    }
    res.type('text/plain').send(req.query['hub.challenge']);
  } catch(error) { next(error); }
});
router.post('/:businessId', async (req,res,next) => {
  try {
    const connection = await WhatsAppRepository.runtimeConnection(req.params.businessId);
    if (!connection.enabled) throw new AppError('WhatsApp ordering is disabled for this business.',503);
    const provider = new MetaWhatsAppProvider(connection);
    if (!Buffer.isBuffer(res.locals.rawBody) || !provider.verifyWebhook(res.locals.rawBody,req.headers['x-hub-signature-256'])) throw new AppError('Invalid webhook signature.',401);
    const parsed = provider.parseInbound(req.body);
    // Recording and enqueueing commit together before acknowledging Meta.
    await WhatsAppRepository.recordInbound(connection,parsed.messages,parsed.statuses);
    res.json({ received: true });
  } catch(error) { next(error instanceof ProviderError ? new AppError('Invalid WhatsApp webhook payload.',400) : error); }
});
export default router;
