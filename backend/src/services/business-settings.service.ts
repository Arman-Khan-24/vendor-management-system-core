import { createCipheriv, createHash, randomBytes } from 'node:crypto';
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
    paymentMethods: ['cash', 'upi', 'bank_transfer', 'cheque'], taxRate: 0, footer: ''
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
}

export function normalizeBusinessConnections(rows: readonly ConnectionSummaryRow[]): BusinessConnections {
  const connections: BusinessConnections = {
    primary: { provider: 'openai', endpoint: 'https://api.openai.com/v1', model: '', hasApiKey: false },
    fallback: { provider: 'groq', endpoint: 'https://api.groq.com/openai/v1', model: '', hasApiKey: false }
  };
  for (const row of rows) {
    if (row.slot === 'primary' || row.slot === 'fallback') {
      connections[row.slot] = { provider: row.provider, endpoint: row.endpoint, model: row.model, hasApiKey: row.has_api_key };
    }
  }
  return connections;
}

/** Ciphertext is tenant/slot-bound. Keep JWT_SECRET stable or re-enter saved provider keys after rotation. */
export function encryptConnectionKey(apiKey: string, businessId: string, slot: ConnectionSlot): string | null {
  if (!apiKey) return null;
  const key = createHash('sha256').update('orderledger:provider-connections:v1\0').update(config.jwtSecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${businessId}:${slot}`));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
