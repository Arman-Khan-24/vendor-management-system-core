import { z } from 'zod';

export const orderImportSchema = z.object({
  text: z.string().trim().max(10000).default(''),
  image: z.object({
    data: z.string().min(1).max(4 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    mimeType: z.enum(['image/jpeg', 'image/png'])
  }).strict().optional()
}).strict().refine(value => !!value.text || !!value.image, 'Paste an order or upload a photo.');

export type OrderImportInput = z.infer<typeof orderImportSchema>;
