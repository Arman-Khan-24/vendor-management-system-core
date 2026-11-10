import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { ProviderError, fetchProviderJson } from '../provider-http.js';

export interface WhatsAppInboundMessage {
  providerMessageId: string; senderPhone: string; messageType: 'text' | 'image' | 'unsupported';
  messageText: string; mediaId?: string; mediaMimeType?: string; providerTimestamp: string;
}
export interface WhatsAppRuntimeConnection {
  businessId: string; enabled: boolean; phoneNumberId: string; wabaId: string; graphVersion: string;
  defaultCountryCode: string; accessToken: string; appSecret: string; verifyToken: string;
}
export interface WhatsAppTransport {
  sendTextMessage(toPhone: string,text: string): Promise<{ success: boolean; messageId: string }>;
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }>;
}
export function safeEqual(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export class MetaWhatsAppProvider {
  readonly name = 'meta';
  constructor(public connection: WhatsAppRuntimeConnection) {}
  verifyWebhook(rawBody: Buffer, signature: unknown): boolean {
    if (!this.connection.appSecret || typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
    const expected = createHmac('sha256', this.connection.appSecret).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
  }
  parseInbound(body: any): { messages: WhatsAppInboundMessage[]; statuses: any[] } {
    const messages: WhatsAppInboundMessage[] = [], statuses: any[] = [];
    if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) throw new ProviderError('INVALID_WEBHOOK', false);
    for (const entry of body.entry) {
      if (!entry || !Array.isArray(entry.changes)) throw new ProviderError('INVALID_WEBHOOK', false);
      if (this.connection.wabaId && String(entry.id) !== this.connection.wabaId) continue;
      for (const change of entry.changes) {
        if (!change || typeof change!=='object') throw new ProviderError('INVALID_WEBHOOK',false);
        const value = change.value;
        if (change.field !== 'messages' || String(value?.metadata?.phone_number_id) !== this.connection.phoneNumberId) continue;
        if ((value.messages && !Array.isArray(value.messages)) || (value.statuses && !Array.isArray(value.statuses))) throw new ProviderError('INVALID_WEBHOOK',false);
        for (const message of value.messages || []) {
          if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 150 || !/^[1-9]\d{7,14}$/.test(message.from)) continue;
          const time = Number(message.timestamp) * 1000;
          if (!Number.isFinite(time) || time <= 0 || time > Date.now() + 300000) continue;
          const type = message.type === 'text' ? 'text' : message.type === 'image' ? 'image' : 'unsupported';
          const text = type === 'text' ? message.text?.body : type === 'image' ? message.image?.caption || '' : '';
          if (typeof text !== 'string' || text.length > 10000) continue;
          if (type === 'image' && !/^\d{5,100}$/.test(message.image?.id || '')) continue;
          messages.push({ providerMessageId: message.id, senderPhone: message.from, messageType: type, messageText: text,
            mediaId: type === 'image' ? message.image.id : undefined,
            mediaMimeType: type === 'image' && typeof message.image.mime_type==='string' ? message.image.mime_type.slice(0,100) : undefined,
            providerTimestamp: new Date(time).toISOString() });
        }
        for (const status of value.statuses || []) {
          if (status && typeof status.id === 'string' && status.id.length>0 && status.id.length<=150 && ['sent','delivered','read','failed'].includes(status.status)) statuses.push(status);
        }
      }
    }
    messages.sort((a,b) => a.providerTimestamp.localeCompare(b.providerTimestamp));
    return { messages, statuses };
  }
  private url(id: string) { return `https://graph.facebook.com/${this.connection.graphVersion}/${encodeURIComponent(id)}`; }
  private headers() { return { Authorization: `Bearer ${this.connection.accessToken}`, 'Content-Type': 'application/json' }; }
  async testConnection() {
    const data = await fetchProviderJson(this.url(this.connection.phoneNumberId) + '?fields=id,display_phone_number', { headers: this.headers() });
    if (String(data.id) !== this.connection.phoneNumberId) throw new ProviderError('PHONE_NUMBER_MISMATCH', false);
    return { phoneNumberId: String(data.id), displayPhoneNumber: data.display_phone_number || '' };
  }
  async sendTextMessage(toPhone: string, text: string) {
    if (!/^[1-9]\d{7,14}$/.test(toPhone) || !text || text.length > 4096) throw new ProviderError('INVALID_OUTBOUND_MESSAGE', false);
    let data: any;
    try { data = await fetchProviderJson(this.url(this.connection.phoneNumberId) + '/messages', {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual',
        to: toPhone, type: 'text', text: { preview_url: false, body: text } })
    }); } catch(error) {
      // Only an explicit rate-limit rejection is safe to retry automatically.
      if (error instanceof ProviderError && error.code==='PROVIDER_HTTP_429') throw error;
      if (error instanceof ProviderError && /^PROVIDER_HTTP_4\d\d$/.test(error.code)) throw error;
      throw new ProviderError('DELIVERY_UNCONFIRMED',false);
    }
    const id = data.messages?.[0]?.id;
    if (typeof id !== 'string' || !id || id.length > 150) throw new ProviderError('DELIVERY_UNCONFIRMED', false);
    return { success: true, messageId: id };
  }
  async downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const metadata = await fetchProviderJson(this.url(mediaId), { headers: this.headers() });
    const allowed = ['image/jpeg','image/png'];
    if (!allowed.includes(metadata.mime_type) || Number(metadata.file_size) > 5 * 1024 * 1024) throw new ProviderError('UNSUPPORTED_IMAGE', false);
    let url: URL;
    try { url = new URL(metadata.url); } catch { throw new ProviderError('INVALID_MEDIA_URL', false); }
    if (url.protocol !== 'https:' || url.hostname !== 'lookaside.fbsbx.com' || url.username || url.password || url.port) throw new ProviderError('INVALID_MEDIA_URL', false);
    let response: Response;
    try { response = await fetch(url, { headers: { Authorization: `Bearer ${this.connection.accessToken}` }, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch { throw new ProviderError('MEDIA_UNAVAILABLE', true); }
    if (!response.ok || !response.body) throw new ProviderError('MEDIA_UNAVAILABLE', true);
    if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024) throw new ProviderError('IMAGE_TOO_LARGE', false);
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as any) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { await response.body.cancel().catch(() => undefined); throw new ProviderError('IMAGE_TOO_LARGE', false); }
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const png = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if ((metadata.mime_type === 'image/jpeg' && !jpeg) || (metadata.mime_type === 'image/png' && !png)) throw new ProviderError('INVALID_IMAGE', false);
    const digest = createHash('sha256').update(data).digest();
    if (metadata.sha256 && digest.toString('hex') !== String(metadata.sha256).toLowerCase() && digest.toString('base64') !== metadata.sha256) throw new ProviderError('MEDIA_CHECKSUM_MISMATCH', false);
    return { data, mimeType: metadata.mime_type };
  }
}
