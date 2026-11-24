import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  businessSettingsPatchSchema,
  businessSettingsSchema,
  type BusinessSettings,
  type BusinessSettingsPatch,
  type BusinessConnections,
  type ConnectionProvider,
  type ConnectionSlot
} from '../validators/business-settings.schemas.js';

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  branding: { appName: 'OrderLedger', tagline: 'Your business, in balance.', accent: 'sage', theme: 'system' },
  profile: { address: '', email: '', taxId: '' },
  catalog: {
    productLabel: 'Products', customerLabel: 'Customers', defaultUnit: 'kg',
    units: ['kg', 'g', 'litre', 'ml', 'piece', 'dozen', 'box', 'bag', 'pack', 'tray', 'tin'],
    categories: []
  },
  billing: {
    invoicePrefix: 'INV', defaultCreditTermsDays: 7,
    paymentMethods: ['cash', 'upi', 'bank_transfer', 'cheque'], taxRate: 0, footer: '', upiId: '', upiPayeeName: ''
  },
  modules: { reports: true, payments: true }
};

function mergeSections(current: BusinessSettings, patch: BusinessSettingsPatch): BusinessSettings {
  return {
    branding: { ...current.branding, ...patch.branding },
    profile: { ...current.profile, ...patch.profile },
    catalog: { ...current.catalog, ...patch.catalog },
    billing: { ...current.billing, ...patch.billing },
    modules: { ...current.modules, ...patch.modules }
  };
}

/** Old tenants start with defaults; only the bounded, public configuration leaves this helper. */
export function normalizeBusinessSettings(value: unknown): BusinessSettings {
  const defaults = structuredClone(DEFAULT_BUSINESS_SETTINGS);
  const parsed = businessSettingsPatchSchema.safeParse(value);
  if (!parsed.success) return defaults;
  const normalized = mergeSections(defaults, parsed.data);
  if (!normalized.catalog.units.includes(normalized.catalog.defaultUnit)) {
    normalized.catalog.defaultUnit = normalized.catalog.units[0];
  }
  return normalized;
}

export function mergeBusinessSettings(value: unknown, patch: BusinessSettingsPatch): BusinessSettings {
  const merged = mergeSections(normalizeBusinessSettings(value), patch);
  const result = businessSettingsSchema.safeParse(merged);
  if (!result.success) {
    throw new AppError(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
  }
  return result.data;
}

export interface ConnectionSummaryRow {
  slot: ConnectionSlot;
  provider: ConnectionProvider;
  endpoint: string;
  model: string;
  has_api_key: boolean;
  vision_model?: string;
}

export function normalizeBusinessConnections(rows: readonly ConnectionSummaryRow[]): BusinessConnections {
  const connections = {} as BusinessConnections;
  for (const slot of ['primary', 'fallback'] as const) {
    const prefix = 'AI_' + slot.toUpperCase();
    const envProvider = process.env[prefix + '_PROVIDER'];
    const provider: ConnectionProvider = envProvider === 'groq' || envProvider === 'gemini'
      ? envProvider : slot === 'primary' ? 'gemini' : 'groq';
    const defaultKey = process.env[prefix + '_API_KEY'] || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY);
    const model = process.env[prefix + '_MODEL'] || (provider === 'gemini' ? 'gemini-2.5-flash' : defaultKey ? 'llama-3.3-70b-versatile' : '');
    const visionModel = process.env[prefix + '_VISION_MODEL'];
    const saved = rows.find(row => row.slot === slot);
    connections[slot] = saved ? {
      provider: saved.provider, endpoint: saved.endpoint, model: saved.model, hasApiKey: saved.has_api_key,
      source: saved.has_api_key ? (saved.model ? 'business' : 'incomplete') : 'disabled',
      ...(saved.vision_model ? { visionModel: saved.vision_model } : {}),
    } : {
      provider, endpoint: provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.groq.com/openai/v1',
      model, hasApiKey: false, source: defaultKey ? 'server' : 'incomplete',
      ...(visionModel ? { visionModel } : {}),
    };
  }
  return connections;
}

function providerEncryptionKey(version: string, legacySecret?: string): Buffer {
  const secret = version === 'v3' ? process.env.AI_PROVIDER_ENCRYPTION_KEY
    : version === 'v2' ? process.env.PROVIDER_ENCRYPTION_KEY : legacySecret || config.jwtSecret;
  if (!secret || (version !== 'v1' && !/^[0-9a-f]{64}$/i.test(secret))) throw new Error('Invalid provider encryption key configuration.');
  return createHash('sha256').update('orderledger:provider-connections:' + version + '\0').update(secret).digest();
}
export function encryptConnectionKey(apiKey: string, businessId: string, slot: ConnectionSlot): string | null {
  return encryptSecret(apiKey, businessId, slot);
}

export function encryptSecret(apiKey: string, businessId: string, purpose: string): string | null {
  if (!apiKey) return null;
  const version = (purpose === 'primary' || purpose === 'fallback') && process.env.AI_PROVIDER_ENCRYPTION_KEY
    ? 'v3' : process.env.PROVIDER_ENCRYPTION_KEY ? 'v2' : 'v1';
  const key = providerEncryptionKey(version);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${businessId}:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return [version, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(value: string | null, businessId: string, purpose: string): string {
  if (!value) return '';
  try {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (!['v1', 'v2', 'v3'].includes(version) || extra !== undefined || !iv || !tag || !ciphertext) throw new Error();
    const key = providerEncryptionKey(version, process.env.LEGACY_PROVIDER_JWT_SECRET);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${businessId}:${purpose}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError('A saved provider key cannot be read. Re-enter it in Connections.', 503);
  }
}
