import { Customer } from '../models/types.js';
export interface CustomerWithBalance extends Customer {
    total_billed: number;
    total_paid: number;
    outstanding_balance: number;
    last_order_date: string | null;
    last_payment_date: string | null;
}
export declare class CustomerRepository {
    static list({ businessId, search, activeOnly }: {
        businessId: string;
        search?: string;
        activeOnly?: boolean;
    }): Promise<CustomerWithBalance[]>;
    static findById({ customerId, businessId }: {
        customerId: string;
        businessId: string;
    }): Promise<CustomerWithBalance | null>;
    static findByPhone({ phone, businessId }: {
        phone: string;
        businessId: string;
    }): Promise<Customer | null>;
    static create(data: {
        businessId: string;
        name: string;
        phone: string;
        creditTermsDays?: number;
    }): Promise<Customer>;
    static update({ customerId, businessId, data }: {
        customerId: string;
        businessId: string;
        data: Partial<Pick<Customer, 'name' | 'phone' | 'credit_terms_days' | 'active'>>;
    }): Promise<Customer | null>;
    static delete({ customerId, businessId }: {
        customerId: string;
        businessId: string;
    }): Promise<boolean>;
}
