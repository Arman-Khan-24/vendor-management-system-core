import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query, withTransaction } from '../database/connection.js';
import { AppError } from '../middleware/errorHandler.js';
import { encryptSecret, decryptSecret } from '../services/business-settings.service.js';
import type { WhatsAppInboundMessage, WhatsAppRuntimeConnection } from '../services/whatsapp/whatsapp.provider.js';
import { whatsappConnectionSchema } from '../validators/whatsapp.schemas.js';

export interface WhatsAppJob {
  id: string; business_id: string; message_id: string; sender_phone: string; kind: 'inbound'|'outbound';
  payload: any; attempts: number; lease_token: string;
}
const secretFields = { accessToken: 'access_token_encrypted', appSecret: 'app_secret_encrypted', verifyToken: 'verify_token_encrypted' } as const;
const publicFields = { phoneNumberId: 'phone_number_id', wabaId: 'waba_id', graphVersion: 'graph_version', defaultCountryCode: 'default_country_code' } as const;

export class WhatsAppRepository {
  static async runtimeConnection(businessId: string, client?: PoolClient): Promise<WhatsAppRuntimeConnection> {
    const row = (await (client || pool).query('SELECT * FROM whatsapp_connections WHERE business_id = $1', [businessId])).rows[0] || {};
    return { businessId, enabled: row.enabled || false, phoneNumberId: row.phone_number_id || '', wabaId: row.waba_id || '',
      graphVersion: row.graph_version || '', defaultCountryCode: row.default_country_code || '91',
      accessToken: decryptSecret(row.access_token_encrypted, businessId, 'whatsapp:accessToken'),
      appSecret: decryptSecret(row.app_secret_encrypted, businessId, 'whatsapp:appSecret'),
      verifyToken: decryptSecret(row.verify_token_encrypted, businessId, 'whatsapp:verifyToken') };
  }
  static async connectionSummary(businessId: string) {
    const connection = await this.runtimeConnection(businessId);
    const { accessToken, appSecret, verifyToken, ...publicConfig } = connection;
    return { ...publicConfig, hasAccessToken: !!accessToken, hasAppSecret: !!appSecret, hasVerifyToken: !!verifyToken };
  }
  static async updateConnection(businessId: string, input: unknown) {
    const patch = whatsappConnectionSchema.parse(input);
    await withTransaction(async client => {
      const business = await client.query('SELECT id FROM businesses WHERE id = $1 FOR UPDATE', [businessId]);
      if (!business.rows[0]) throw new AppError('Business not found', 404);
      await client.query('INSERT INTO whatsapp_connections(business_id) VALUES ($1) ON CONFLICT DO NOTHING', [businessId]);
      const original = (await client.query('SELECT phone_number_id,waba_id FROM whatsapp_connections WHERE business_id=$1',[businessId])).rows[0];
      const fields: string[] = [], values: unknown[] = [businessId];
      for (const [key, column] of Object.entries(publicFields)) {
        if (patch[key as keyof typeof publicFields] !== undefined) { values.push(patch[key as keyof typeof publicFields]); fields.push(`${column} = $${values.length}`); }
      }
      for (const [key, column] of Object.entries(secretFields)) {
        if (patch[key as keyof typeof secretFields] !== undefined) {
          values.push(encryptSecret(patch[key as keyof typeof secretFields]!, businessId, `whatsapp:${key}`)); fields.push(`${column} = $${values.length}`);
        }
      }
      if (patch.enabled !== undefined) { values.push(patch.enabled); fields.push(`enabled = $${values.length}`); }
      if (fields.length) await client.query(`UPDATE whatsapp_connections SET ${fields.join(', ')}, updated_at=NOW() WHERE business_id=$1`, values);
      const connection = await this.runtimeConnection(businessId, client);
      if (connection.enabled && (!connection.phoneNumberId || !connection.wabaId || !connection.graphVersion || !connection.accessToken || !connection.appSecret || !connection.verifyToken)) {
        throw new AppError('Complete all WhatsApp connection fields before enabling ordering.', 400);
      }
      if (original.phone_number_id!==connection.phoneNumberId || original.waba_id!==connection.wabaId) {
        await client.query("UPDATE pending_order_confirmations SET status='expired' WHERE business_id=$1 AND status='pending_confirmation'",[businessId]);
      }
    });
    return this.connectionSummary(businessId);
  }
  static async recordInbound(connection: WhatsAppRuntimeConnection, messages: WhatsAppInboundMessage[], statuses: any[]) {
    await withTransaction(async client => {
      for (const message of messages) {
        const result = await client.query(`INSERT INTO whatsapp_messages
          (business_id,provider,provider_message_id,sender_phone,direction,message_type,message_text,status,provider_timestamp,media_mime_type)
          VALUES ($1,'meta',$2,$3,'inbound',$4,$5,'queued',$6,$7) ON CONFLICT(business_id,provider,provider_message_id) DO NOTHING RETURNING id`,
          [connection.businessId, message.providerMessageId, message.senderPhone, message.messageType, message.messageText, message.providerTimestamp, message.mediaMimeType || null]);
        if (!result.rows[0]) continue;
        await client.query(`INSERT INTO whatsapp_jobs(business_id,message_id,sender_phone,kind,payload)
          VALUES ($1,$2,$3,'inbound',$4)`, [connection.businessId,result.rows[0].id,message.senderPhone,JSON.stringify({...message,phoneNumberId:connection.phoneNumberId,wabaId:connection.wabaId})]);
      }
      for (const status of statuses) {
        await client.query(`INSERT INTO whatsapp_delivery_receipts(business_id,provider_message_id,delivery_status,error_code)
          VALUES($1,$2,$3,$4) ON CONFLICT(business_id,provider_message_id) DO UPDATE SET delivery_status=CASE
            WHEN whatsapp_delivery_receipts.delivery_status='read' THEN 'read'
            WHEN whatsapp_delivery_receipts.delivery_status='delivered' AND EXCLUDED.delivery_status!='read' THEN 'delivered'
            WHEN whatsapp_delivery_receipts.delivery_status='failed' AND EXCLUDED.delivery_status='sent' THEN 'failed'
            ELSE EXCLUDED.delivery_status END,error_code=CASE
              WHEN whatsapp_delivery_receipts.delivery_status='failed' AND EXCLUDED.delivery_status='sent' THEN whatsapp_delivery_receipts.error_code
              ELSE EXCLUDED.error_code END`,
          [connection.businessId,status.id,status.status,status.errors?.[0]?.code ? String(status.errors[0].code).slice(0,100) : null]);
        // Copy the retained receipt so early/late callbacks follow the same status rules.
        await client.query(`UPDATE whatsapp_messages m SET delivery_status=r.delivery_status,error_code=r.error_code
          FROM whatsapp_delivery_receipts r WHERE m.business_id=$1 AND m.provider='meta' AND m.provider_message_id=$2
          AND m.direction='outbound' AND r.business_id=m.business_id AND r.provider_message_id=m.provider_message_id`,
          [connection.businessId,status.id]);
      }
    });
  }
  static async reply(client: PoolClient, businessId: string, phone: string, text: string, customerId?: string, confirmationId?: string) {
    if (!text || text.length > 4096) throw new AppError('The order summary is too long. Split the order into smaller orders.', 400);
    const result = await client.query(`INSERT INTO whatsapp_messages(business_id,provider,sender_phone,customer_id,direction,message_type,message_text,status,delivery_status)
      VALUES($1,'meta',$2,$3,'outbound','text',$4,'queued','queued') RETURNING id`, [businessId,phone,customerId || null,text]);
    const connection = (await client.query('SELECT phone_number_id,waba_id FROM whatsapp_connections WHERE business_id=$1',[businessId])).rows[0];
    await client.query(`INSERT INTO whatsapp_jobs(business_id,message_id,sender_phone,kind,payload) VALUES($1,$2,$3,'outbound',$4)`,
      [businessId,result.rows[0].id,phone,JSON.stringify({ text, confirmationId,phoneNumberId:connection.phone_number_id,wabaId:connection.waba_id })]);
  }
  static async claim(): Promise<WhatsAppJob | null> {
    return withTransaction(async client => {
      // A crashed outbound request has unknown delivery; require manual review rather than resending blindly.
      await client.query(`WITH expired AS (UPDATE whatsapp_jobs SET status='failed',error_code='DELIVERY_UNCONFIRMED'
        WHERE kind='outbound' AND status='processing' AND lease_until < NOW() RETURNING message_id)
        UPDATE whatsapp_messages SET status='failed',error_code='DELIVERY_UNCONFIRMED' WHERE id IN (SELECT message_id FROM expired)`);
      const result = await client.query(`SELECT j.* FROM whatsapp_jobs j JOIN whatsapp_connections c ON c.business_id=j.business_id AND c.enabled
        WHERE ((j.status='queued' AND j.available_at<=NOW()) OR (j.kind='inbound' AND j.status='processing' AND j.lease_until<NOW()))
        AND NOT EXISTS(SELECT 1 FROM whatsapp_jobs earlier WHERE earlier.business_id=j.business_id AND earlier.sender_phone=j.sender_phone
          AND earlier.status IN ('queued','processing') AND earlier.sequence<j.sequence)
        ORDER BY j.sequence FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
      const job = result.rows[0];
      if (!job) return null;
      const token = randomUUID();
      await client.query(`UPDATE whatsapp_jobs SET status='processing',attempts=attempts+1,lease_until=NOW()+INTERVAL '3 minutes',lease_token=$2 WHERE id=$1`, [job.id,token]);
      return { ...job, lease_token: token, attempts: job.attempts + 1 };
    });
  }
  static async complete(client: PoolClient, job: WhatsAppJob) {
    const result = await client.query(`UPDATE whatsapp_jobs SET status='completed',completed_at=NOW(),lease_until=NULL,error_code=NULL
      WHERE id=$1 AND status='processing' AND lease_token=$2 RETURNING id`, [job.id,job.lease_token]);
    if (!result.rows[0]) throw new AppError('This message was claimed by another worker.', 409);
    await client.query("UPDATE whatsapp_messages SET status='processed',error_code=CASE WHEN delivery_status='failed' THEN error_code ELSE NULL END WHERE id=$1", [job.message_id]);
  }
  static async fail(job: WhatsAppJob, code: string, retryable: boolean) {
    const retry = retryable && job.attempts < 4;
    await withTransaction(async client => {
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[job.business_id]);
      const result = await client.query(`UPDATE whatsapp_jobs SET status=$3,error_code=$4,available_at=NOW()+($5::int*INTERVAL '1 second'),lease_until=NULL
        WHERE id=$1 AND lease_token=$2 AND status='processing' RETURNING id`, [job.id,job.lease_token,retry ? 'queued' : 'failed',code,Math.min(60,2 ** job.attempts)]);
      if (result.rows[0]) await client.query('UPDATE whatsapp_messages SET status=$2,error_code=$3,needs_review=needs_review OR $4 WHERE id=$1', [job.message_id,retry ? 'queued' : 'failed',code,!retry && job.kind==='inbound']);
      if (result.rows[0] && !retry && job.kind==='inbound') {
        await client.query(`UPDATE pending_order_confirmations SET status='expired' WHERE business_id=$1 AND status='pending_confirmation'
          AND customer_id=(SELECT customer_id FROM whatsapp_messages WHERE id=$2)
          AND created_at<=(SELECT created_at FROM whatsapp_messages WHERE id=$2)`, [job.business_id,job.message_id]);
      }
    });
  }
  static async list(businessId: string) {
    return (await query(`SELECT m.id,m.sender_phone,m.customer_id,c.name AS customer_name,m.direction,m.message_type,m.message_text,m.status,m.delivery_status,m.error_code,m.needs_review,m.created_at,
      j.id AS job_id,j.status AS job_status,j.error_code AS job_error,a.structured_output,a.success AS ai_success,
      p.id AS confirmation_id,p.status AS confirmation_status,p.extracted_items,p.expires_at
      FROM whatsapp_messages m LEFT JOIN customers c ON c.id=m.customer_id AND c.business_id=m.business_id
      LEFT JOIN whatsapp_jobs j ON j.message_id=m.id
      LEFT JOIN LATERAL(SELECT structured_output,success FROM ai_extraction_audits WHERE inbound_message_id=m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
      LEFT JOIN LATERAL(SELECT * FROM pending_order_confirmations WHERE inbound_message_id=m.id ORDER BY created_at DESC LIMIT 1) p ON TRUE
      WHERE m.business_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 100`, [businessId])).rows;
  }
}
