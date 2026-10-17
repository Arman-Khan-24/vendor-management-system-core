import { Invoice, InvoiceStatus } from '../models/types.js';
export interface InvoiceWithDetails extends Invoice {
    customer_name: string;
    customer_phone: string;
    allocated_amount: number;
    remaining_amount: number;
    items: Array<{
        product_name: string;
        quantity: number;
        unit: string;
        unit_price: number;
        total: number;
    }>;
}
export declare class InvoiceRepository {
    static list({ businessId, customerId, status }: {
        businessId: string;
        customerId?: string;
        status?: InvoiceStatus;
    }): Promise<InvoiceWithDetails[]>;
    static findById({ invoiceId, businessId }: {
        invoiceId: string;
        businessId: string;
    }): Promise<InvoiceWithDetails | null>;
    static findByOrderId({ orderId, businessId }: {
        orderId: string;
        businessId: string;
    }): Promise<Invoice | null>;
    /**
     * Generates a sequential invoice for an order within a tenant isolation transaction
     */
    static generateInvoiceForOrder({ businessId, orderId }: {
        businessId: string;
        orderId: string;
    }): Promise<InvoiceWithDetails>;
    /**
     * Recalculates and updates the invoice status based on payment_allocations
     */
    static refreshInvoiceStatus(client: any, invoiceId: string, businessId: string): Promise<InvoiceStatus>;
}
