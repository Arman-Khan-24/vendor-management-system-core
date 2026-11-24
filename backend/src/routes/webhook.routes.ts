import { rateLimit } from '../middleware/rate-limit.js';
import { Router } from 'express';
import { validateUuidParam } from '../middleware/validate.middleware.js';
import { WhatsAppRepository } from '../repositories/whatsapp.repo.js';
import { MetaWhatsAppProvider, safeEqual } from '../services/whatsapp/whatsapp.provider.js';
import { AppError } from '../middleware/errorHandler.js';
import { ProviderError } from '../services/provider-http.js';
const router = Router();
router.param('businessId', validateUuidParam);
// Bound pre-authentication database work even when requests name many businesses.
router.use(rateLimit(120, 60000, () => 'webhook'));
let inFlight = 0;
router.use((_req, res, next) => {
  if (inFlight >= 4) { res.status(429).json({ error: 'Webhook is busy. Retry shortly.' }); return; }
  inFlight++;
  let released = false;
  const release = () => { if (!released) { released = true; inFlight--; } };
  res.once('finish', release);
  res.once('close', release);
  next();
});
router.get('/:businessId', async (req,res,next) => {
  try {
    if (req.query['hub.mode'] !== 'subscribe' || typeof req.query['hub.verify_token'] !== 'string'
      || typeof req.query['hub.challenge'] !== 'string') throw new AppError('Webhook verification failed.', 403);
    const current = await WhatsAppRepository.runtimeConnection(req.params.businessId);
    if (!current.verifyToken || req.query['hub.mode'] !== 'subscribe' || typeof req.query['hub.verify_token'] !== 'string'
      || !safeEqual(current.verifyToken,req.query['hub.verify_token']) || typeof req.query['hub.challenge'] !== 'string') {
      throw new AppError('Webhook verification failed.',403);
    }
    res.type('text/plain').send(req.query['hub.challenge']);
  } catch(error) { next(error); }
});
router.post('/:businessId', async (req,res,next) => {
  try {
    if (!/^sha256=[a-f0-9]{64}$/i.test(req.get('x-hub-signature-256') || '')) {
      throw new AppError('Invalid webhook signature.', 401);
    }
    const current = await WhatsAppRepository.runtimeConnection(req.params.businessId);
    if (!current.enabled) throw new AppError('WhatsApp ordering is disabled for this business.',503);
    const provider = new MetaWhatsAppProvider(current);
    if (!Buffer.isBuffer(res.locals.rawBody) || !provider.verifyWebhook(res.locals.rawBody,req.headers['x-hub-signature-256'])) throw new AppError('Invalid webhook signature.',401);
    const parsed = provider.parseInbound(req.body);
    // Recording and enqueueing commit together before acknowledging Meta.
    await WhatsAppRepository.recordInbound(current,parsed.messages,parsed.statuses);
    res.json({ received: true });
  } catch(error) { next(error instanceof ProviderError ? new AppError('Invalid WhatsApp webhook payload.',400) : error); }
});
export default router;
