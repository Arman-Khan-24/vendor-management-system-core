import { z } from 'zod';
const secret = z.string().trim().max(4096).refine(value => !/[\u0000-\u0020\u007f]/.test(value), 'Remove whitespace from the token');
export const whatsappConnectionSchema = z.object({
  enabled: z.boolean().optional(), phoneNumberId: z.string().regex(/^\d{5,50}$/).optional(),
  wabaId: z.string().regex(/^\d{5,50}$/).optional(), graphVersion: z.string().regex(/^v\d{2,3}\.0$/).optional(),
  defaultCountryCode: z.string().regex(/^[1-9]\d{0,3}$/).optional(),
  accessToken: secret.optional(), appSecret: secret.optional(), verifyToken: secret.optional()
}).strict();
export const reviewOrderSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().finite().positive().max(99999999.99).multipleOf(0.01) }).strict()).min(1).max(100)
}).strict();
