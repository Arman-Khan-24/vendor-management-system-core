export interface WhatsAppInboundMessage {
  providerMessageId: string;
  senderPhone: string;
  messageText: string;
  rawPayload?: any;
}

export interface IWhatsAppProvider {
  readonly name: string;
  verifyWebhook(req: any): boolean;
  parseInbound(req: any): WhatsAppInboundMessage | null;
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
    // Direct or generic simulated payload
    if (body.senderPhone && body.messageText) {
      return {
        providerMessageId: body.providerMessageId || `mock_msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        senderPhone: body.senderPhone.replace(/\D/g, '').slice(-10),
        messageText: body.messageText.trim(),
        rawPayload: body
      };
    }
    // Gupshup format simulation
    if (body.payload && body.payload.payload && body.payload.payload.text) {
      return {
        providerMessageId: body.payload.id || `gup_${Date.now()}`,
        senderPhone: (body.payload.sender?.phone || '').replace(/\D/g, '').slice(-10),
        messageText: body.payload.payload.text.trim(),
        rawPayload: body
      };
    }
    return null;
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
    const text = b.text || b.message || b.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;
    const phone = b.from || b.senderPhone || b.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    const id = b.id || b.messageId || b.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;

    if (text && phone) {
      return {
        providerMessageId: id || `bsp_${Date.now()}`,
        senderPhone: String(phone).replace(/\D/g, '').slice(-10),
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
