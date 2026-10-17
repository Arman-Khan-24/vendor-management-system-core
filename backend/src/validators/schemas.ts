import { z } from 'zod';

const twoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
const money = z.number().finite().min(0).max(9999999999.99).refine(twoDecimals, 'Use at most two decimal places');
const positiveMoney = money.refine(value => value > 0, 'Amount must be greater than zero');
export const dateOnlySchema = z.string().date('Use a valid date in YYYY-MM-DD format');

export const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(100),
  businessSlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase letters, numbers, and hyphens'),
  categoryTemplate: z.enum(['fruits_veg', 'grocery', 'dairy', 'custom']).optional(),
  phone: z.string().min(5).max(20).optional(),
  ownerName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200)
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(5).max(25),
  creditTermsDays: z.number().int().min(0).max(365).optional()
});

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().min(5).max(25).optional(),
  creditTermsDays: z.number().int().min(0).max(365).optional(),
  active: z.boolean().optional()
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(255),
  unit: z.string().trim().min(1).max(50),
  currentPrice: money,
  category: z.string().trim().max(100).optional()
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  unit: z.string().trim().min(1).max(50).optional(),
  currentPrice: money.optional(),
  category: z.string().trim().max(100).optional(),
  active: z.boolean().optional()
});

export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  notes: z.string().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().finite().positive().max(99999999.99).refine(twoDecimals, 'Use at most two decimal places')
  })).min(1, 'Order must contain at least 1 item').max(250)
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['Received', 'Packed', 'Delivered'])
});

export const recordPaymentSchema = z.object({
  customerId: z.string().uuid(),
  amount: positiveMoney,
  mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque']).default('cash'),
  date: dateOnlySchema.optional(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  specificInvoiceAllocations: z.array(z.object({
    invoiceId: z.string().uuid(),
    amount: positiveMoney
  })).max(250).optional()
});

export { updateBusinessSettingsSchema as updateBusinessSchema } from './business-settings.schemas.js';
