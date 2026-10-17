import { z } from 'zod';
export declare const registerSchema: z.ZodObject<{
    businessName: z.ZodString;
    businessSlug: z.ZodString;
    categoryTemplate: z.ZodOptional<z.ZodEnum<["fruits_veg", "grocery", "dairy", "custom"]>>;
    phone: z.ZodOptional<z.ZodString>;
    ownerName: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    businessName: string;
    businessSlug: string;
    ownerName: string;
    email: string;
    password: string;
    categoryTemplate?: "fruits_veg" | "grocery" | "dairy" | "custom" | undefined;
    phone?: string | undefined;
}, {
    businessName: string;
    businessSlug: string;
    ownerName: string;
    email: string;
    password: string;
    categoryTemplate?: "fruits_veg" | "grocery" | "dairy" | "custom" | undefined;
    phone?: string | undefined;
}>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const createCustomerSchema: z.ZodObject<{
    name: z.ZodString;
    phone: z.ZodString;
    creditTermsDays: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    phone: string;
    name: string;
    creditTermsDays?: number | undefined;
}, {
    phone: string;
    name: string;
    creditTermsDays?: number | undefined;
}>;
export declare const updateCustomerSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    creditTermsDays: z.ZodOptional<z.ZodNumber>;
    active: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    phone?: string | undefined;
    name?: string | undefined;
    creditTermsDays?: number | undefined;
    active?: boolean | undefined;
}, {
    phone?: string | undefined;
    name?: string | undefined;
    creditTermsDays?: number | undefined;
    active?: boolean | undefined;
}>;
export declare const createProductSchema: z.ZodObject<{
    name: z.ZodString;
    unit: z.ZodString;
    currentPrice: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    name: string;
    unit: string;
    currentPrice: number;
}, {
    name: string;
    unit: string;
    currentPrice: number;
}>;
export declare const updateProductSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    unit: z.ZodOptional<z.ZodString>;
    currentPrice: z.ZodOptional<z.ZodNumber>;
    active: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    active?: boolean | undefined;
    unit?: string | undefined;
    currentPrice?: number | undefined;
}, {
    name?: string | undefined;
    active?: boolean | undefined;
    unit?: string | undefined;
    currentPrice?: number | undefined;
}>;
export declare const createOrderSchema: z.ZodObject<{
    customerId: z.ZodString;
    notes: z.ZodOptional<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        productId: z.ZodString;
        quantity: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        productId: string;
        quantity: number;
    }, {
        productId: string;
        quantity: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    customerId: string;
    items: {
        productId: string;
        quantity: number;
    }[];
    notes?: string | undefined;
}, {
    customerId: string;
    items: {
        productId: string;
        quantity: number;
    }[];
    notes?: string | undefined;
}>;
export declare const updateOrderStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["Received", "Packed", "Delivered"]>;
}, "strip", z.ZodTypeAny, {
    status: "Packed" | "Delivered" | "Received";
}, {
    status: "Packed" | "Delivered" | "Received";
}>;
export declare const recordPaymentSchema: z.ZodObject<{
    customerId: z.ZodString;
    amount: z.ZodNumber;
    mode: z.ZodDefault<z.ZodEnum<["cash", "upi", "bank_transfer", "cheque"]>>;
    date: z.ZodOptional<z.ZodString>;
    reference: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    specificInvoiceAllocations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        invoiceId: z.ZodString;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        amount: number;
        invoiceId: string;
    }, {
        amount: number;
        invoiceId: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    customerId: string;
    amount: number;
    mode: "cash" | "upi" | "bank_transfer" | "cheque";
    notes?: string | undefined;
    date?: string | undefined;
    reference?: string | undefined;
    specificInvoiceAllocations?: {
        amount: number;
        invoiceId: string;
    }[] | undefined;
}, {
    customerId: string;
    amount: number;
    notes?: string | undefined;
    date?: string | undefined;
    mode?: "cash" | "upi" | "bank_transfer" | "cheque" | undefined;
    reference?: string | undefined;
    specificInvoiceAllocations?: {
        amount: number;
        invoiceId: string;
    }[] | undefined;
}>;
export declare const updateBusinessSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    currency: z.ZodOptional<z.ZodString>;
    invoiceTrigger: z.ZodOptional<z.ZodEnum<["Packed", "Delivered"]>>;
}, "strip", z.ZodTypeAny, {
    phone?: string | undefined;
    name?: string | undefined;
    currency?: string | undefined;
    invoiceTrigger?: "Packed" | "Delivered" | undefined;
}, {
    phone?: string | undefined;
    name?: string | undefined;
    currency?: string | undefined;
    invoiceTrigger?: "Packed" | "Delivered" | undefined;
}>;
