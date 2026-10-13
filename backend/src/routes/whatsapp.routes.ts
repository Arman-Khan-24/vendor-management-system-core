import { Router } from 'express';
import { query } from '../database/connection.js';
import { WhatsAppProviderFactory } from '../services/whatsapp/whatsapp.provider.js';

const router = Router();

/**
 * GET /api/whatsapp/messages
 * Retrieve recent outbound messages sent by mock/test provider
 */
router.get('/messages', (req, res) => {
  const provider: any = WhatsAppProviderFactory.getProvider();
  res.json({
    provider: provider.name,
    messages: provider.sentMessages || []
  });
});

/**
 * POST /api/whatsapp/messages/clear
 */
router.post('/messages/clear', (req, res) => {
  const provider: any = WhatsAppProviderFactory.getProvider();
  if (provider.sentMessages) {
    provider.sentMessages = [];
  }
  res.json({ success: true });
});

export default router;
