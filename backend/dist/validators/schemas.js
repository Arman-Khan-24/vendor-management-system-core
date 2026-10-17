import { z } from 'zod';
export const registerSchema = z.object({
    businessName: z.string().min(2).max(100),
    businessSlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase letters, numbers, and hyphens'),
    categoryTemplate: z.enum(['fruits_veg', 'grocery', 'dairy', 'custom']).optional(),
    phone: z.string().min(5).max(20).optional(),
    ownerName: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(6)
});
export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
});
export const createCustomerSchema = z.object({
    name: z.string().min(1).max(255),
    phone: z.string().min(5).max(25),
    creditTermsDays: z.number().int().min(0).max(365).optional()
});
export const updateCustomerSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    phone: z.string().min(5).max(25).optional(),
    creditTermsDays: z.number().int().min(0).max(365).optional(),
    active: z.boolean().optional()
});
export const createProductSchema = z.object({
    name: z.string().min(1).max(255),
    unit: z.string().min(1).max(50),
    currentPrice: z.number().min(0)
});
export const updateProductSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    unit: z.string().min(1).max(50).optional(),
    currentPrice: z.number().min(0).optional(),
    active: z.boolean().optional()
});
export const createOrderSchema = z.object({
    customerId: z.string().uuid(),
    notes: z.string().max(500).optional(),
    items: z.array(z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive()
    })).min(1, 'Order must contain at least 1 item')
});
export const updateOrderStatusSchema = z.object({
    status: z.enum(['Received', 'Packed', 'Delivered'])
});
export const recordPaymentSchema = z.object({
    customerId: z.string().uuid(),
    amount: z.number().positive(),
    mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque']).default('cash'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reference: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
    specificInvoiceAllocations: z.array(z.object({
        invoiceId: z.string().uuid(),
        amount: z.number().positive()
    })).optional()
});
export const updateBusinessSchema = z.object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().max(25).optional(),
    currency: z.string().max(10).optional(),
    invoiceTrigger: z.enum(['Packed', 'Delivered']).optional()
});
