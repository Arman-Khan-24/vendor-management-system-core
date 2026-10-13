export type WhatsAppMessageType = 'text' | 'image';

export interface WhatsAppInboundMessage {
  providerMessageId: string;
  senderPhone: string;
  messageType: WhatsAppMessageType;
  messageText?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaBase64?: string;
  rawPayload?: any;
}

export interface IWhatsAppProvider {
  readonly name: string;
  verifyWebhook(req: any): boolean;
  parseInbound(req: any): WhatsAppInboundMessage | null;
  downloadMedia?(mediaUrl: string): Promise<{ data: Buffer; mimeType: string }>;
  sendTextMessage(toPhone: string, text: string): Promise<{ success: boolean; messageId: string }>;
}

export class MockWhatsAppProvider implements IWhatsAppProvider {
  readonly name = 'mock';
  public sentMessages: Array<{ to: string; text: string; messageId: string; timestamp: Date }> = [];

  verifyWebhook(_req: any): boolean {
    return true;
  }

  parseInbound(req: any): WhatsAppInboundMessage | null {
    const body = req.body || {};
    const senderPhone = (body.senderPhone || '').replace(/\D/g, '').slice(-10);
    const providerMessageId = body.providerMessageId || `mock_msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Image attachment simulation
    if (body.image || body.imageUrl || body.mediaUrl || body.imageBase64 || body.messageType === 'image') {
      return {
        providerMessageId,
        senderPhone,
        messageType: 'image',
        messageText: (body.caption || body.messageText || '').trim(),
        mediaUrl: body.imageUrl || body.mediaUrl,
        mediaMimeType: body.mediaMimeType || 'image/jpeg',
        mediaBase64: body.imageBase64 || body.image,
        rawPayload: body
      };
    }

    // Direct text payload
    if (body.senderPhone && body.messageText) {
      return {
        providerMessageId,
        senderPhone,
        messageType: 'text',
        messageText: body.messageText.trim(),
        rawPayload: body
      };
    }
    // Gupshup format simulation
    if (body.payload && body.payload.payload) {
      const gupSender = (body.payload.sender?.phone || '').replace(/\D/g, '').slice(-10);
      const gupId = body.payload.id || `gup_${Date.now()}`;
      if (body.payload.type === 'image' || body.payload.payload.url) {
        return {
          providerMessageId: gupId,
          senderPhone: gupSender,
          messageType: 'image',
          messageText: (body.payload.payload.caption || '').trim(),
          mediaUrl: body.payload.payload.url,
          mediaMimeType: body.payload.payload.contentType || 'image/jpeg',
          rawPayload: body
        };
      }
      if (body.payload.payload.text) {
        return {
          providerMessageId: gupId,
          senderPhone: gupSender,
          messageType: 'text',
          messageText: body.payload.payload.text.trim(),
          rawPayload: body
        };
      }
    }
    return null;
  }

  async downloadMedia(mediaUrl: string): Promise<{ data: Buffer; mimeType: string }> {
    if (mediaUrl.startsWith('data:')) {
      const match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return {
          data: Buffer.from(match[2], 'base64'),
          mimeType: match[1]
        };
      }
    }
    const res = await fetch(mediaUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { data: buf, mimeType };
  }

  async sendTextMessage(toPhone: string, text: string): Promise<{ success: boolean; messageId: string }> {
    const messageId = `mock_out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.sentMessages.push({
      to: toPhone,
      text,
      messageId,
      timestamp: new Date()
    });
    console.log(`[WhatsApp Mock Provider] Outbound to ${toPhone}:\n"${text}"`);
    return { success: true, messageId };
  }
}

export class GenericBspWhatsAppProvider implements IWhatsAppProvider {
  readonly name: string;
  private apiKey: string;
  private webhookSecret?: string;

  constructor(name: string, apiKey: string, webhookSecret?: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.webhookSecret = webhookSecret;
  }

  verifyWebhook(req: any): boolean {
    if (!this.webhookSecret) return true;
    const sig = req.headers['x-hub-signature'] || req.headers['x-bsp-signature'] || req.headers['authorization'];
    return Boolean(sig);
  }

  parseInbound(req: any): WhatsAppInboundMessage | null {
    const b = req.body || {};
    const msgObj = b.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const imageObj = b.image || msgObj?.image;
    const text = b.text || b.message || msgObj?.text?.body || imageObj?.caption;
    const phone = b.from || b.senderPhone || msgObj?.from;
    const id = b.id || b.messageId || msgObj?.id;

    if (imageObj && phone) {
      return {
        providerMessageId: id || `bsp_${Date.now()}`,
        senderPhone: String(phone).replace(/\D/g, '').slice(-10),
        messageType: 'image',
        messageText: text ? String(text).trim() : '',
        mediaUrl: imageObj.url || imageObj.link,
        mediaMimeType: imageObj.mime_type || 'image/jpeg',
        rawPayload: b
      };
    }

    if (text && phone) {
      return {
        providerMessageId: id || `bsp_${Date.now()}`,
        senderPhone: String(phone).replace(/\D/g, '').slice(-10),
        messageType: 'text',
        messageText: String(text).trim(),
        rawPayload: b
      };
    }
    return null;
  }

  async sendTextMessage(toPhone: string, text: string): Promise<{ success: boolean; messageId: string }> {
    console.log(`[${this.name} Provider] Sending to ${toPhone}: ${text.slice(0, 40)}...`);
    return { success: true, messageId: `${this.name}_${Date.now()}` };
  }
}

export class WhatsAppProviderFactory {
  private static instance: IWhatsAppProvider | null = null;

  static getProvider(): IWhatsAppProvider {
    if (!this.instance) {
      const providerType = (process.env.WHATSAPP_PROVIDER || 'mock').toLowerCase();
      if (providerType === 'mock') {
        this.instance = new MockWhatsAppProvider();
      } else {
        const apiKey = process.env.WHATSAPP_API_KEY || 'test_key';
        const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
        this.instance = new GenericBspWhatsAppProvider(providerType, apiKey, secret);
      }
    }
    return this.instance;
  }

  static setProvider(provider: IWhatsAppProvider) {
    this.instance = provider;
  }
}
