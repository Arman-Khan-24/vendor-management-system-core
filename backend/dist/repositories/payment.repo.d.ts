import { Payment, PaymentMode } from '../models/types.js';
export interface PaymentWithAllocations extends Payment {
    customer_name: string;
    allocations: Array<{
        id: string;
        invoice_id: string;
        invoice_no: number;
        amount: number;
    }>;
}
export declare class PaymentRepository {
    static list({ businessId, customerId }: {
        businessId: string;
        customerId?: string;
    }): Promise<PaymentWithAllocations[]>;
    /**
     * Records a payment and performs strict transactional FIFO allocation
     * across oldest outstanding invoices with row locks.
     */
    static recordPayment({ businessId, customerId, amount, mode, date, reference, notes, createdBy, specificInvoiceAllocations }: {
        businessId: string;
        customerId: string;
        amount: number;
        mode?: PaymentMode;
        date?: string;
        reference?: string;
        notes?: string;
        createdBy?: string;
        specificInvoiceAllocations?: Array<{
            invoiceId: string;
            amount: number;
        }>;
    }): Promise<PaymentWithAllocations>;
    static getCustomerStatement({ customerId, businessId }: {
        customerId: string;
        businessId: string;
    }): Promise<{
        customer: any;
        totalBilled: number;
        totalPaid: number;
        currentOutstanding: number;
        entries: {
            type: any;
            reference_id: any;
            reference_no: any;
            date: any;
            debit: number;
            credit: number;
            running_balance: number;
            status: any;
        }[];
    } | null>;
}
