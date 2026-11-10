import type { PoolClient } from 'pg';
import { query, withTransaction } from '../database/connection.js';
import { WhatsAppRepository, type WhatsAppJob } from '../repositories/whatsapp.repo.js';
import { OrderRepository } from '../repositories/order.repo.js';
import { CatalogMatcher, type MatchedOrderItem } from './ai/catalog.matcher.js';
import { getBusinessAi } from './ai/business-ai.js';
import { MetaWhatsAppProvider,type WhatsAppTransport } from './whatsapp/whatsapp.provider.js';
import { normalizeBusinessSettings } from './business-settings.service.js';
import { ProviderError } from './provider-http.js';
import { AppError } from '../middleware/errorHandler.js';

export const confirmationPattern = /^(yes|confirm|ok|haan|ha|हाँ|हां|ठीक है)[.!]?$/i;
const rejectPattern = /^(no|cancel|reject|नहीं|nahi)[.!]?$/i;

function confirmationText(items: MatchedOrderItem[], taxRate: number, currency: string) {
  const subtotalCents = items.reduce((sum,item) => sum + Math.round(item.totalPrice * 100), 0);
  const taxCents = Math.round(subtotalCents * taxRate / 100);
  if (subtotalCents+taxCents>999999999999) throw new AppError('The order exceeds the supported financial amount.',400);
  const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format((subtotalCents + taxCents) / 100);
  return `Please check your order:\n${items.map(item => `${item.productName} — ${item.quantity} ${item.unit}`).join('\n')}\nTotal: ${money}${taxRate ? ` (includes ${taxRate}% tax)` : ''}\nReply YES to confirm, NO to discard, or send a correction. This quote expires in 30 minutes.`;
}

async function customerFor(businessId: string, phone: string, countryCode: string) {
  const rows = (await query(`SELECT id,name FROM customers WHERE business_id=$1 AND active
    AND CASE WHEN length(regexp_replace(phone,'[^0-9]','','g'))=10 THEN $3 || regexp_replace(phone,'[^0-9]','','g')
      ELSE regexp_replace(phone,'[^0-9]','','g') END = $2 LIMIT 2`, [businessId,phone,countryCode])).rows;
  return rows.length === 1 ? rows[0] : null;
}
async function lockedJob(client: PoolClient, job: WhatsAppJob) {
  await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [job.business_id]);
  const enabled = await client.query('SELECT enabled,phone_number_id,waba_id FROM whatsapp_connections WHERE business_id=$1', [job.business_id]);
  if (!enabled.rows[0]?.enabled) throw new ProviderError('WHATSAPP_DISABLED', false);
  if (enabled.rows[0].phone_number_id!==job.payload.phoneNumberId || enabled.rows[0].waba_id!==job.payload.wabaId) throw new ProviderError('WHATSAPP_CONNECTION_CHANGED',false);
  const result = await client.query("SELECT id FROM whatsapp_jobs WHERE id=$1 AND status='processing' AND lease_token=$2 FOR UPDATE", [job.id,job.lease_token]);
  if (!result.rows[0]) throw new AppError('Message lease changed.', 409);
}
async function savePending(client: PoolClient, businessId: string, customerId: string, phone: string, messageId: string, items: MatchedOrderItem[], rawText: string, sourceType: string, provider: string, model: string) {
  const business = (await client.query('SELECT currency,settings FROM businesses WHERE id=$1', [businessId])).rows[0];
  const taxRate = normalizeBusinessSettings(business.settings).billing.taxRate;
  const text = confirmationText(items, taxRate, business.currency);
  if (text.length > 4096) throw new AppError('This order is too long for a confirmation. Split it into smaller orders.', 400);
  await client.query("UPDATE pending_order_confirmations SET status='expired' WHERE business_id=$1 AND customer_id=$2 AND status='pending_confirmation'", [businessId,customerId]);
  const result = await client.query(`INSERT INTO pending_order_confirmations(business_id,customer_id,inbound_message_id,extracted_items,raw_text,ai_provider,ai_model,source_type,quote_context)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [businessId,customerId,messageId,JSON.stringify(items),rawText,provider,model,sourceType,JSON.stringify({ taxRate, currency: business.currency })]);
  await WhatsAppRepository.reply(client,businessId,phone,text,customerId,result.rows[0].id);
}

export class OrderProcessingEngine {
  static async processJob(job: WhatsAppJob,transport?: WhatsAppTransport) {
    const connection = await WhatsAppRepository.runtimeConnection(job.business_id);
    if (!connection.enabled) throw new ProviderError('WHATSAPP_DISABLED', false);
    if (connection.phoneNumberId!==job.payload.phoneNumberId || connection.wabaId!==job.payload.wabaId) throw new ProviderError('WHATSAPP_CONNECTION_CHANGED',false);
    const provider = transport || new MetaWhatsAppProvider(connection);
    if (job.kind === 'outbound') {
      if (job.payload.confirmationId) {
        const active = await query("SELECT id FROM pending_order_confirmations WHERE id=$1 AND business_id=$2 AND status='pending_confirmation' AND expires_at>NOW()", [job.payload.confirmationId,job.business_id]);
        if (!active.rows[0]) return withTransaction(client => WhatsAppRepository.complete(client,job));
      }
      const lastInbound = (await query(`SELECT MAX(provider_timestamp) AS last FROM whatsapp_messages WHERE business_id=$1 AND sender_phone=$2 AND direction='inbound'`, [job.business_id,job.sender_phone])).rows[0].last;
      if (!lastInbound || Date.now() - new Date(lastInbound).getTime() >= 24*60*60*1000) throw new ProviderError('CUSTOMER_SERVICE_WINDOW_CLOSED', false);
      const sent = await provider.sendTextMessage(job.sender_phone, job.payload.text);
      try { await withTransaction(async client => {
        await lockedJob(client,job);
        await client.query("UPDATE whatsapp_messages SET provider_message_id=$2,delivery_status=CASE WHEN delivery_status IN ('read','delivered','failed') THEN delivery_status ELSE 'sent' END WHERE id=$1", [job.message_id,sent.messageId]);
        await client.query(`UPDATE whatsapp_messages m SET delivery_status=r.delivery_status,error_code=r.error_code FROM whatsapp_delivery_receipts r
          WHERE m.id=$1 AND r.business_id=m.business_id AND r.provider_message_id=m.provider_message_id`,[job.message_id]);
        await WhatsAppRepository.complete(client,job);
      }); } catch { throw new ProviderError('DELIVERY_UNCONFIRMED',false); }
      return;
    }
    const customer = await customerFor(job.business_id,job.sender_phone,connection.defaultCountryCode);
    const text = job.payload.messageText || '';
    if (!customer || job.payload.messageType === 'unsupported') {
      return withTransaction(async client => {
        await lockedJob(client,job);
        await client.query('UPDATE whatsapp_messages SET needs_review=true WHERE id=$1',[job.message_id]);
        await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,customer ? 'Please send a typed order or a JPEG/PNG order photo.' : 'Your number is not registered for ordering. Please contact the vendor to add your customer account.');
        await WhatsAppRepository.complete(client,job);
      });
    }
    await query('UPDATE whatsapp_messages SET customer_id=$2 WHERE id=$1', [job.message_id,customer.id]);
    const newer = await query(`SELECT id FROM whatsapp_messages WHERE business_id=$1 AND sender_phone=$2
      AND direction='inbound' AND status='processed' AND provider_timestamp>$3 LIMIT 1`,
      [job.business_id,job.sender_phone,job.payload.providerTimestamp]);
    if (newer.rows.length) return withTransaction(async client => {
      await lockedJob(client,job);
      await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,'A newer message was already processed. Please resend your current order or confirmation.',customer.id);
      await WhatsAppRepository.complete(client,job);
    });
    if (job.payload.messageType === 'text' && (confirmationPattern.test(text.trim()) || rejectPattern.test(text.trim()))) {
      return this.handleConfirmation(job,customer.id,rejectPattern.test(text.trim()));
    }
    const pending = (await query("SELECT * FROM pending_order_confirmations WHERE business_id=$1 AND customer_id=$2 AND status='pending_confirmation'", [job.business_id,customer.id])).rows[0];
    const previous = pending && new Date(pending.expires_at).getTime()>Date.now()
      ? pending.extracted_items.map((item: MatchedOrderItem) => ({ product: item.productName, quantity: item.quantity, unit: item.unit })) : undefined;
    const catalog = (await query('SELECT id,name,unit,current_price FROM products WHERE business_id=$1 AND active', [job.business_id])).rows.map(row => ({ ...row, current_price: Number(row.current_price) }));
    const ai = await getBusinessAi(job.business_id);
    const started = Date.now();
    const image = job.payload.messageType === 'image' ? await provider.downloadMedia(job.payload.mediaId) : null;
    const extraction = image ? await ai.extractImage(image.data,image.mimeType,catalog,text,previous) : await ai.extract(text,catalog,previous);
    const match = CatalogMatcher.match(extraction.items,catalog);
    const valid = match.isValid && extraction.warnings.length === 0;
    await withTransaction(async client => {
      await lockedJob(client,job);
      // Owner review or a later draft must not be overwritten by an inference started earlier.
      const current = (await client.query("SELECT id FROM pending_order_confirmations WHERE business_id=$1 AND customer_id=$2 AND status='pending_confirmation'", [job.business_id,customer.id])).rows[0];
      if ((current?.id || null) !== (pending?.id || null)) throw new ProviderError('ORDER_CHANGED_DURING_EXTRACTION', false);
      await client.query(`INSERT INTO ai_extraction_audits(business_id,inbound_message_id,primary_provider,primary_model,used_provider,used_model,was_fallback,success,input_text,input_type,structured_output,duration_ms)
        VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11)`, [job.business_id,job.message_id,ai.primaryMetadata.provider,ai.primaryMetadata.model,extraction.provider,extraction.model,extraction.wasFallback,
          text, image ? 'image' : 'text',JSON.stringify({ items: extraction.items, warnings: extraction.warnings, match }),Date.now()-started]);
      if (valid) {
        await client.query('UPDATE whatsapp_messages SET needs_review=false WHERE id=$1',[job.message_id]);
        await savePending(client,job.business_id,customer.id,job.sender_phone,job.message_id,match.matchedItems,text,image ? 'whatsapp_image' : 'whatsapp_text',extraction.provider,extraction.model);
      } else {
        await client.query('UPDATE whatsapp_messages SET needs_review=true WHERE id=$1',[job.message_id]);
        // A failed correction invalidates the old quote: YES must not confirm stale quantities.
        await client.query("UPDATE pending_order_confirmations SET status='expired' WHERE business_id=$1 AND customer_id=$2 AND status='pending_confirmation'", [job.business_id,customer.id]);
        const details = [...match.unresolvedItems,...match.ambiguousItems.map(item => `${item.input}: choose ${item.candidates.join(' / ')}`),...extraction.warnings];
        const explanation = ('Please clarify your complete order:\n' + (details.length ? details.join('\n') : 'No readable order items were found.')).slice(0,3500);
        await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,explanation,customer.id);
      }
      await WhatsAppRepository.complete(client,job);
    });
  }
  static async handleConfirmation(job: WhatsAppJob, customerId: string, reject = false) {
    return withTransaction(async client => {
      await lockedJob(client,job);
      const pending = (await client.query(`SELECT * FROM pending_order_confirmations WHERE business_id=$1 AND customer_id=$2 AND status='pending_confirmation' FOR UPDATE`, [job.business_id,customerId])).rows[0];
      if (!pending) {
        const recent = (await client.query("SELECT created_order_id FROM pending_order_confirmations WHERE business_id=$1 AND customer_id=$2 AND status='confirmed' AND confirmed_at>NOW()-INTERVAL '1 hour' ORDER BY confirmed_at DESC LIMIT 1", [job.business_id,customerId])).rows[0];
        await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,recent && !reject ? 'Your order is already confirmed. Send a new order to place another.' : 'No pending order found. Please send your complete order first.',customerId);
      } else if (new Date(job.payload.providerTimestamp).getTime() < new Date(pending.created_at).getTime()-1000) {
        await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,'Please check the latest order summary and reply again after receiving it.',customerId);
      } else if (reject) {
        await client.query("UPDATE pending_order_confirmations SET status='rejected' WHERE id=$1", [pending.id]);
        await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,'Pending order discarded. No order was placed.',customerId);
      } else {
        const quoteTime = new Date(pending.created_at).getTime();
        const incomingTime = new Date(job.payload.providerTimestamp).getTime();
        const unsent = await client.query(`SELECT j.id FROM whatsapp_jobs j JOIN whatsapp_messages m ON m.id=j.message_id
          WHERE j.business_id=$1 AND j.kind='outbound' AND j.payload->>'confirmationId'=$2
          AND (j.status!='completed' OR m.delivery_status NOT IN ('sent','delivered','read'))`, [job.business_id,pending.id]);
        const catalog = (await client.query('SELECT id,name,unit,current_price FROM products WHERE business_id=$1 AND active FOR SHARE', [job.business_id])).rows;
        const business = (await client.query('SELECT currency,settings FROM businesses WHERE id=$1', [job.business_id])).rows[0];
        const items: MatchedOrderItem[] = pending.extracted_items;
        const changed = items.some(item => { const product = catalog.find(row => row.id===item.productId); return !product || product.unit!==item.unit || Number(product.current_price)!==item.unitPrice || product.name!==item.productName; })
          || pending.quote_context.currency!==business.currency || pending.quote_context.taxRate!==normalizeBusinessSettings(business.settings).billing.taxRate;
        if (new Date(pending.expires_at).getTime()<=Date.now() || changed) {
          await client.query("UPDATE pending_order_confirmations SET status='expired' WHERE id=$1", [pending.id]);
          await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,'This quote expired or the catalog/prices changed. Please resend your complete order for a fresh confirmation.',customerId);
        } else if (incomingTime < quoteTime-1000 || unsent.rows.length) {
          await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,'Please check the latest order summary and reply YES again after receiving it.',customerId);
        } else {
          const order = await OrderRepository.createOrderWithItems({ businessId: job.business_id,customerId,source: pending.source_type,
            notes: `WhatsApp order (${pending.id})`,items: items.map(item => ({ productId: item.productId,quantity: item.quantity })),idempotencyKey: pending.id,client });
          await client.query("UPDATE pending_order_confirmations SET status='confirmed',confirmed_at=NOW(),created_order_id=$2 WHERE id=$1", [pending.id,order.id]);
          const total = new Intl.NumberFormat('en-IN',{ style: 'currency',currency: business.currency }).format(order.total_amount);
          await WhatsAppRepository.reply(client,job.business_id,job.sender_phone,`Order #${order.order_no} confirmed. Total: ${total}. Status: Received.`,customerId);
        }
      }
      await WhatsAppRepository.complete(client,job);
    });
  }
  static async review(businessId: string, messageId: string, items: { productId: string; quantity: number }[]) {
    await withTransaction(async client => {
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId]);
      const connection = await WhatsAppRepository.runtimeConnection(businessId,client);
      if (!connection.enabled) throw new AppError('Enable WhatsApp before sending a reviewed summary.',400);
      const message = (await client.query("SELECT * FROM whatsapp_messages WHERE id=$1 AND business_id=$2 AND direction='inbound' FOR UPDATE", [messageId,businessId])).rows[0];
      if (!message?.customer_id) throw new AppError('This message needs a unique, active registered customer before review.', 400);
      const customer = await client.query('SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND active FOR SHARE',[message.customer_id,businessId]);
      if (!customer.rows.length) throw new AppError('Choose an active registered customer.',400);
      const activeJob = await client.query("SELECT id FROM whatsapp_jobs WHERE message_id=$1 AND status IN ('queued','processing')", [messageId]);
      if (activeJob.rows.length) throw new AppError('Wait for message processing to finish before reviewing it.',409);
      const confirmed = await client.query("SELECT id FROM pending_order_confirmations WHERE inbound_message_id=$1 AND status='confirmed'", [messageId]);
      if (confirmed.rows.length) throw new AppError('This message already created an order.',409);
      const products = (await client.query('SELECT id,name,unit,current_price FROM products WHERE business_id=$1 AND active FOR SHARE', [businessId])).rows;
      const requested = items.map(item => { const product = products.find(row => row.id===item.productId); if (!product) throw new AppError('Choose active products from this business.',400); return { product: product.name,quantity: item.quantity,unit: product.unit }; });
      const match = CatalogMatcher.match(requested,products.map(row => ({ ...row,current_price: Number(row.current_price) })));
      if (!match.isValid) throw new AppError('Check the reviewed quantities and products.',400);
      await savePending(client,businessId,message.customer_id,message.sender_phone,messageId,match.matchedItems,message.message_text || '',message.message_type==='image' ? 'whatsapp_image' : 'whatsapp_text','human','owner-review');
      await client.query('UPDATE whatsapp_messages SET needs_review=false WHERE id=$1',[messageId]);
    });
  }
}
