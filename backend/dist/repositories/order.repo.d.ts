import { Order, OrderItem, OrderStatus, OrderStatusHistory } from '../models/types.js';
export interface OrderWithDetails extends Order {
    customer_name: string;
    customer_phone: string;
    items: (OrderItem & {
        product_name: string;
    })[];
    history: OrderStatusHistory[];
    total_amount: number;
    invoice_id: string | null;
    invoice_no: number | null;
    invoice_status: string | null;
}
export declare class OrderRepository {
    static list({ businessId, status, customerId, limit, offset }: {
        businessId: string;
        status?: OrderStatus;
        customerId?: string;
        limit?: number;
        offset?: number;
    }): Promise<OrderWithDetails[]>;
    static findById({ orderId, businessId }: {
        orderId: string;
        businessId: string;
    }): Promise<OrderWithDetails | null>;
    static createOrderWithItems({ businessId, customerId, source, notes, createdBy, items }: {
        businessId: string;
        customerId: string;
        source?: 'manual' | 'whatsapp_text' | 'whatsapp_image';
        notes?: string;
        createdBy?: string;
        items: {
            productId: string;
            quantity: number;
        }[];
    }): Promise<OrderWithDetails>;
    static updateStatus({ orderId, businessId, newStatus, changedBy }: {
        orderId: string;
        businessId: string;
        newStatus: OrderStatus;
        changedBy?: string;
    }): Promise<OrderWithDetails>;
}
