import { Router } from 'express';
import { query } from '../database/connection.js';
import { WhatsAppProviderFactory } from '../services/whatsapp/whatsapp.provider.js';
import { enqueueExtraction, OrderProcessingEngine } from '../services/order.processor.js';
const router = Router();
/**
 * POST /webhooks/whatsapp/:businessId
 * Webhook responsibilities ONLY:
 * 1. Verify provider request
 * 2. Extract sender phone and message text
 * 3. Verify business tenant exists
 * 4. Match customer or create unmatched record
 * 5. Create idempotent inbound event in whatsapp_messages
 * 6. Enqueue extraction job (or process YES confirmation)
 * 7. Return immediately (< 5s target response)
 */
router.post('/:businessId', async (req, res) => {
    const { businessId } = req.params;
    try {
        const provider = WhatsAppProviderFactory.getProvider();
        // 1. Verify provider request signature/token
        if (!provider.verifyWebhook(req)) {
            return res.status(401).json({ error: 'Unauthorized webhook signature' });
        }
        // 2. Extract inbound payload
        const inbound = provider.parseInbound(req);
        if (!inbound || !inbound.senderPhone || (!inbound.messageText && !inbound.mediaUrl && !inbound.mediaBase64)) {
            return res.status(200).json({ status: 'ignored', message: 'No actionable text or image content found' });
        }
        // 3. Identify Business Tenant
        const bizRes = await query('SELECT id, name FROM businesses WHERE id = $1', [businessId]);
        if (bizRes.rows.length === 0) {
            return res.status(404).json({ error: 'Business tenant not found' });
        }
        // 4. Match sender phone to tenant's customer
        const custRes = await query(`SELECT id, name, phone, credit_terms_days 
       FROM customers 
       WHERE business_id = $1 AND (phone = $2 OR phone LIKE $3)
       LIMIT 1`, [businessId, inbound.senderPhone, `%${inbound.senderPhone.slice(-10)}`]);
        const customer = custRes.rows[0] || null;
        // 5. Idempotent Inbound Event Log
        let messageRecordId;
        try {
            const insMsg = await query(`INSERT INTO whatsapp_messages 
         (business_id, provider, provider_message_id, sender_phone, customer_id, direction, message_type, message_text, raw_payload, status)
         VALUES ($1, $2, $3, $4, $5, 'inbound', $6, $7, $8, $9)
         ON CONFLICT (business_id, provider, provider_message_id) DO NOTHING
         RETURNING id`, [
                businessId,
                provider.name,
                inbound.providerMessageId,
                inbound.senderPhone,
                customer?.id || null,
                inbound.messageType || 'text',
                inbound.messageText || (inbound.messageType === 'image' ? '[Image Attachment]' : ''),
                JSON.stringify(inbound.rawPayload || {}),
                customer ? 'queued' : 'received'
            ]);
            if (insMsg.rows.length === 0) {
                // Already processed this provider event!
                return res.status(200).json({ status: 'duplicate_ignored', messageId: inbound.providerMessageId });
            }
            messageRecordId = insMsg.rows[0].id;
        }
        catch (e) {
            console.error('Failed to log inbound message:', e);
            return res.status(500).json({ error: 'Failed to record inbound message' });
        }
        // Customer Not Found Handling
        if (!customer) {
            console.warn(`[WhatsApp Webhook] Message from unregistered phone ${inbound.senderPhone} for business ${bizRes.rows[0].name}`);
            await provider.sendTextMessage(inbound.senderPhone, `Hello! Your phone (${inbound.senderPhone}) is not registered with ${bizRes.rows[0].name}. Please reach out to the vendor to set up your wholesale account.`);
            return res.status(200).json({ status: 'unmatched_customer', senderPhone: inbound.senderPhone });
        }
        // 6. Check if this is a YES confirmation
        const normalizedText = (inbound.messageText || '').trim().toUpperCase();
        if (inbound.messageType === 'text' && (normalizedText === 'YES' || normalizedText === 'CONFIRM' || normalizedText === 'OK')) {
            // Process confirmation idempotently
            setImmediate(async () => {
                try {
                    await OrderProcessingEngine.handleConfirmation(businessId, customer.id, inbound.senderPhone);
                }
                catch (err) {
                    console.error('[Confirmation Flow Error]:', err);
                }
            });
            return res.status(200).json({ status: 'confirmation_received', customerId: customer.id });
        }
        // 7. Check if this is a correction against an existing pending order
        const pendingCheck = await query(`SELECT id FROM pending_order_confirmations 
       WHERE business_id = $1 AND customer_id = $2 AND status = 'pending_confirmation' 
       ORDER BY created_at DESC LIMIT 1`, [businessId, customer.id]);
        const isCorrection = pendingCheck.rows.length > 0;
        const pendingConfirmationId = pendingCheck.rows[0]?.id;
        // 8. Enqueue Extraction Job
        await enqueueExtraction({
            inboundMessageId: messageRecordId,
            businessId,
            customerId: customer.id,
            senderPhone: inbound.senderPhone,
            messageType: inbound.messageType,
            messageText: inbound.messageText,
            mediaUrl: inbound.mediaUrl,
            mediaBase64: inbound.mediaBase64,
            mediaMimeType: inbound.mediaMimeType,
            providerMessageId: inbound.providerMessageId,
            isCorrection,
            pendingConfirmationId
        });
        // 9. Return immediately to provider (< 5s response)
        return res.status(200).json({
            status: 'enqueued',
            messageId: inbound.providerMessageId,
            customerId: customer.id,
            isCorrection
        });
    }
    catch (err) {
        console.error('[WhatsApp Webhook Route Error]:', err);
        return res.status(500).json({ error: 'Internal webhook error' });
    }
});
export default router;
