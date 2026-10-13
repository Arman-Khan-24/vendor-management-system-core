import { Queue, Worker, Job } from 'bullmq';
import { query } from '../database/connection.js';
import { AiOrderExtractionService } from './ai/ai.service.js';
import { CatalogMatcher, MatchedOrderItem } from './ai/catalog.matcher.js';
import { WhatsAppProviderFactory } from './whatsapp/whatsapp.provider.js';

export interface OrderExtractionJobPayload {
  inboundMessageId: string;
  businessId: string;
  customerId: string;
  senderPhone: string;
  messageType?: 'text' | 'image';
  messageText?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimeType?: string;
  providerMessageId?: string;
  isCorrection?: boolean;
  pendingConfirmationId?: string;
}

export class OrderProcessingEngine {
  private static aiService = new AiOrderExtractionService();

  static getAiService() {
    return this.aiService;
  }

  /**
   * Process incoming text or image order synchronously (worker or direct test runner)
   */
  static async processExtraction(payload: OrderExtractionJobPayload) {
    const {
      inboundMessageId,
      businessId,
      customerId,
      senderPhone,
      messageType = 'text',
      messageText = '',
      mediaUrl,
      mediaBase64,
      mediaMimeType = 'image/jpeg',
      isCorrection,
      pendingConfirmationId
    } = payload;

    const whatsapp = WhatsAppProviderFactory.getProvider();

    // 1. Fetch Tenant Catalog
    const catalogRes = await query(
      'SELECT id, name, unit, current_price FROM products WHERE business_id = $1 AND active = true',
      [businessId]
    );
    const catalog = catalogRes.rows.map(r => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      current_price: parseFloat(r.current_price)
    }));

    if (catalog.length === 0) {
      await whatsapp.sendTextMessage(senderPhone, 'Vendor catalog is currently empty. Please contact the vendor directly.');
      return { success: false, reason: 'empty_catalog' };
    }

    // 2. Call AI Extraction Service (Text vs Vision)
    const startTime = Date.now();
    let extraction;
    const isImage = messageType === 'image';
    const auditInputText = isImage ? (messageText ? `[Image]: ${messageText}` : '[Order Photo]') : messageText;

    try {
      if (isImage) {
        let imageBuffer: Buffer;
        let mime = mediaMimeType;

        if (mediaBase64) {
          imageBuffer = Buffer.from(mediaBase64, 'base64');
        } else if (mediaUrl) {
          if (whatsapp.downloadMedia) {
            const downloaded = await whatsapp.downloadMedia(mediaUrl);
            imageBuffer = downloaded.data;
            mime = downloaded.mimeType || mime;
          } else {
            const res = await fetch(mediaUrl);
            imageBuffer = Buffer.from(await res.arrayBuffer());
            mime = res.headers.get('content-type') || mime;
          }
        } else {
          throw new Error('Image message received without mediaUrl or mediaBase64');
        }

        extraction = await this.aiService.extractImage(imageBuffer, mime, catalog, messageText);
      } else {
        extraction = await this.aiService.extract(messageText, catalog);
      }
    } catch (err: any) {
      // Audit failure with duration & input_type
      await query(
        `INSERT INTO ai_extraction_audits 
         (business_id, inbound_message_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, media_url, error_message, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, $12)`,
        [
          businessId,
          inboundMessageId,
          'gemini',
          'gemini-1.5-flash',
          'groq',
          isImage ? 'qwen/qwen3.8-27b' : 'llama-3.3-70b-versatile',
          true,
          auditInputText,
          isImage ? 'image' : 'text',
          mediaUrl || null,
          err.message,
          Date.now() - startTime
        ]
      );
      await whatsapp.sendTextMessage(senderPhone, 'Sorry, we could not read your order image at this moment. Please type your order or send a clearer photo.');
      return { success: false, reason: 'ai_extraction_failed', error: err.message };
    }

    // Helper to sanitize Unicode strings for PostgreSQL databases initialized with WIN1252
    const sanitizeForDb = (str: string) => str ? str.replace(/[^\x00-\x7F]/g, c => `[U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`) : '';

    // 3. Audit Successful Inference with model, duration, and input_type
    await query(
      `INSERT INTO ai_extraction_audits 
       (business_id, inbound_message_id, primary_provider, primary_model, used_provider, used_model, was_fallback, success, input_text, input_type, media_url, raw_response, structured_output, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12, $13)`,
      [
        businessId,
        inboundMessageId,
        'gemini',
        process.env.AI_PRIMARY_MODEL || 'gemini-2.5-flash',
        extraction.provider,
        extraction.model,
        extraction.wasFallback,
        sanitizeForDb(auditInputText),
        isImage ? 'image' : 'text',
        mediaUrl || null,
        sanitizeForDb(extraction.rawResponse || ''),
        sanitizeForDb(JSON.stringify({ items: extraction.items, warnings: extraction.warnings })),
        Date.now() - startTime
      ]
    );

    // 4. Deterministic Catalog Matching & Validation
    const matchResult = CatalogMatcher.match(extraction.items, catalog);

    if (!matchResult.isValid) {
      // Build helpful clarification/warning prompt for customer
      let clarification = isImage
        ? 'Could not fully read or match your order photo:'
        : 'Could not fully understand your order:';

      if (matchResult.unresolvedItems.length > 0) {
        clarification += `\n- Items not found in catalog: ${matchResult.unresolvedItems.join(', ')}`;
      }
      if (matchResult.ambiguousItems.length > 0) {
        for (const amb of matchResult.ambiguousItems) {
          clarification += `\n- "${amb.input}" matches multiple items (${amb.candidates.join(' / ')}). Please clarify.`;
        }
      }
      if (extraction.warnings && extraction.warnings.length > 0) {
        for (const w of extraction.warnings) {
          clarification += `\n- Note: ${w}`;
        }
      }
      clarification += '\nPlease reply with the updated item names and quantities.';

      await whatsapp.sendTextMessage(senderPhone, clarification);
      return { success: false, reason: 'catalog_matching_failed', matchResult, warnings: extraction.warnings };
    }

    // 5. Create or Update Pending Order Confirmation (NOT actual order yet)
    let confirmationId: string;
    const sourceType = isImage ? 'whatsapp_image' : 'whatsapp_text';
    const rawContent = isImage ? (messageText ? `[Photo]: ${messageText}` : '[Order Photo]') : messageText;

    if (isCorrection && pendingConfirmationId) {
      const updateRes = await query(
        `UPDATE pending_order_confirmations 
         SET extracted_items = $1, raw_text = $2, ai_provider = $3, ai_model = $4, source_type = $5, media_url = $6, correction_count = correction_count + 1, updated_at = NOW()
         WHERE id = $7 AND business_id = $8
         RETURNING id`,
        [JSON.stringify(matchResult.matchedItems), rawContent, extraction.provider, extraction.model, sourceType, mediaUrl || null, pendingConfirmationId, businessId]
      );
      confirmationId = updateRes.rows[0]?.id || pendingConfirmationId;
    } else {
      // Invalidate any previously pending confirmations for this customer
      await query(
        `UPDATE pending_order_confirmations SET status = 'expired' WHERE customer_id = $1 AND business_id = $2 AND status = 'pending_confirmation'`,
        [customerId, businessId]
      );

      const insRes = await query(
        `INSERT INTO pending_order_confirmations 
         (business_id, customer_id, inbound_message_id, extracted_items, raw_text, ai_provider, ai_model, source_type, media_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_confirmation')
         RETURNING id`,
        [businessId, customerId, inboundMessageId, JSON.stringify(matchResult.matchedItems), rawContent, extraction.provider, extraction.model, sourceType, mediaUrl || null]
      );
      confirmationId = insRes.rows[0].id;
    }

    // 6. Send Formatted WhatsApp Confirmation Message
    const formattedList = matchResult.matchedItems
      .map(item => `${item.productName} — ${item.quantity} ${item.unit}`)
      .join('\n');

    const confirmationMsg = `Order detected:\n\n${formattedList}\n\nReply YES to confirm or send a correction.`;
    await whatsapp.sendTextMessage(senderPhone, confirmationMsg);

    return {
      success: true,
      confirmationId,
      items: matchResult.matchedItems,
      provider: extraction.provider,
      sourceType
    };
  }

  /**
   * Handle YES confirmation response from customer
   * Idempotent: Converts pending confirmation into confirmed Order with status 'Received'
   */
  static async handleConfirmation(businessId: string, customerId: string, senderPhone: string) {
    const whatsapp = WhatsAppProviderFactory.getProvider();

    // Find active pending confirmation for customer
    const pendRes = await query(
      `SELECT id, extracted_items, raw_text, status 
       FROM pending_order_confirmations 
       WHERE business_id = $1 AND customer_id = $2 AND status = 'pending_confirmation'
       ORDER BY created_at DESC 
       LIMIT 1`,
      [businessId, customerId]
    );

    if (pendRes.rows.length === 0) {
      // Check if already confirmed (idempotency check)
      const recentConfirmed = await query(
        `SELECT id, created_order_id, confirmed_at 
         FROM pending_order_confirmations 
         WHERE business_id = $1 AND customer_id = $2 AND status = 'confirmed' 
           AND confirmed_at >= (NOW() - INTERVAL '1 hour')
         ORDER BY confirmed_at DESC LIMIT 1`,
        [businessId, customerId]
      );
      if (recentConfirmed.rows.length > 0) {
        // Idempotent duplicate YES: inform customer order is already placed
        return { success: true, alreadyConfirmed: true, orderId: recentConfirmed.rows[0].created_order_id };
      }

      await whatsapp.sendTextMessage(senderPhone, 'No pending order found to confirm. Please send your order items first.');
      return { success: false, reason: 'no_pending_order' };
    }

    const pending = pendRes.rows[0];
    const items: MatchedOrderItem[] = typeof pending.extracted_items === 'string'
      ? JSON.parse(pending.extracted_items)
      : pending.extracted_items;

    const { OrderRepository } = await import('../repositories/order.repo.js');

    // Create Order with exact same transactional logic, sequence number, and price snapshots
    const orderSource = pending.source_type === 'whatsapp_image' ? 'whatsapp_image' : 'whatsapp_text';
    const createdOrder = await OrderRepository.createOrderWithItems({
      businessId,
      customerId,
      source: orderSource,
      notes: `WhatsApp ${orderSource === 'whatsapp_image' ? 'Image' : 'Text'} Order: "${pending.raw_text.slice(0, 100)}"`,
      items: items.map(it => ({
        productId: it.productId,
        quantity: it.quantity
      }))
    });

    // Mark pending confirmation as confirmed
    await query(
      `UPDATE pending_order_confirmations 
       SET status = 'confirmed', confirmed_at = NOW(), created_order_id = $1 
       WHERE id = $2`,
      [createdOrder.id, pending.id]
    );

    const totalAmount = createdOrder.total_amount;
    const orderNo = createdOrder.order_no;

    // Send Order Placed confirmation to customer
    await whatsapp.sendTextMessage(
      senderPhone,
      `✅ Order #${orderNo} confirmed! Total: ₹${totalAmount}. Status: Received. Your order is now being processed.`
    );

    return {
      success: true,
      orderId: createdOrder.id,
      orderNo: createdOrder.order_no,
      totalAmount
    };
  }
}

// Background Queue setup with Redis fallback
export const QUEUE_NAME = 'whatsapp-order-extraction';
let extractionQueue: Queue | null = null;

export function getExtractionQueue(): Queue | null {
  if (process.env.REDIS_URL && !extractionQueue) {
    try {
      extractionQueue = new Queue(QUEUE_NAME, {
        connection: { url: process.env.REDIS_URL }
      });
    } catch (e) {
      console.warn('Redis queue connection failed. Running in direct execution mode.');
    }
  }
  return extractionQueue;
}

export async function enqueueExtraction(payload: OrderExtractionJobPayload) {
  const queue = getExtractionQueue();
  if (queue) {
    return queue.add('extract-order', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true
    });
  } else {
    // Immediate async processing without blocking webhook response
    setImmediate(() => {
      OrderProcessingEngine.processExtraction(payload).catch(err => {
        console.error('[Async Order Extraction Error]:', err);
      });
    });
    return { id: `direct_${Date.now()}` };
  }
}
