import { z } from 'zod';

const label = z.string().trim().min(1).max(50);
const uniqueValues = (values: string[]) => new Set(values.map(value => value.toLowerCase())).size === values.length;

const brandingSchema = z.object({
  appName: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(140),
  accent: z.enum(['sage', 'lavender', 'peach', 'sky']),
  theme: z.enum(['light', 'dark', 'system'])
}).strict();

const profileSchema = z.object({
  address: z.string().trim().max(1000),
  email: z.string().trim().max(254).refine(value => value === '' || z.string().email().safeParse(value).success, 'Enter a valid email address'),
  taxId: z.string().trim().max(60)
}).strict();

const catalogSchema = z.object({
  productLabel: label,
  customerLabel: label,
  defaultUnit: label,
  units: z.array(label).min(1).max(40).refine(uniqueValues, 'Units must be unique'),
  categories: z.array(label).max(60).refine(uniqueValues, 'Categories must be unique')
}).strict();

const billingSchema = z.object({
  invoicePrefix: z.string().trim().toUpperCase().min(1).max(16).regex(/^[A-Z0-9]+(?:[-/][A-Z0-9]+)*$/, 'Use letters, numbers, and separators between them'),
  defaultCreditTermsDays: z.number().int().min(0).max(365),
  paymentMethods: z.array(z.enum(['cash', 'upi', 'bank_transfer', 'cheque'])).min(1).max(4).refine(uniqueValues, 'Payment methods must be unique'),
  taxRate: z.number().finite().min(0).max(100).multipleOf(0.01),
  footer: z.string().trim().max(1000)
}).strict();

const modulesSchema = z.object({
  reports: z.boolean(),
  payments: z.boolean()
}).strict();

export const businessSettingsSchema = z.object({
  branding: brandingSchema,
  profile: profileSchema,
  catalog: catalogSchema,
  billing: billingSchema,
  modules: modulesSchema
}).strict().superRefine((settings, ctx) => {
  if (!settings.catalog.units.includes(settings.catalog.defaultUnit)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['catalog', 'defaultUnit'], message: 'Default unit must be included in the available units' });
  }
});

export const businessSettingsPatchSchema = z.object({
  branding: brandingSchema.partial().optional(),
  profile: profileSchema.partial().optional(),
  catalog: catalogSchema.partial().optional(),
  billing: billingSchema.partial().optional(),
  modules: modulesSchema.partial().optional()
}).strict();

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const updateBusinessSettingsSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(25).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, such as INR').optional(),
  logoUrl: z.string().trim().max(2048).refine(value => value === '' || isHttpUrl(value), 'Use an HTTP or HTTPS image URL').nullable().optional(),
  invoiceTrigger: z.enum(['Packed', 'Delivered']).optional(),
  categoryTemplate: z.enum(['fruits_veg', 'grocery', 'dairy', 'custom']).optional(),
  settings: businessSettingsPatchSchema.optional()
}).strict();

const connectionPatchSchema = z.object({
  provider: z.enum(['openai', 'gemini', 'groq', 'custom']).optional(),
  endpoint: z.string().trim().max(2048).refine(value => {
    if (value === '') return true;
    return isHttpUrl(value) && !value.includes('?') && !value.includes('#');
  }, 'Use an HTTP or HTTPS endpoint without credentials, query parameters, or fragments').optional(),
  model: z.string().trim().max(150).optional(),
  apiKey: z.string().trim().max(4096).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'API key must not contain control characters').optional()
}).strict();

export const updateBusinessConnectionsSchema = z.object({
  primary: connectionPatchSchema.optional(),
  fallback: connectionPatchSchema.optional()
}).strict();

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type BusinessSettingsPatch = z.infer<typeof businessSettingsPatchSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSettingsSchema>;
export type UpdateBusinessConnectionsInput = z.infer<typeof updateBusinessConnectionsSchema>;
export type ConnectionSlot = 'primary' | 'fallback';
export type ConnectionProvider = 'openai' | 'gemini' | 'groq' | 'custom';

export interface BusinessConnection {
  provider: ConnectionProvider;
  endpoint: string;
  model: string;
  hasApiKey: boolean;
}

export type BusinessConnections = Record<ConnectionSlot, BusinessConnection>;
