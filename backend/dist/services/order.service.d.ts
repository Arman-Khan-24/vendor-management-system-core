import { OrderStatus } from '../models/types.js';
export declare class OrderService {
    static createOrder({ businessId, customerId, items, notes, createdBy, source }: {
        businessId: string;
        customerId: string;
        items: {
            productId: string;
            quantity: number;
        }[];
        notes?: string;
        createdBy?: string;
        source?: 'manual' | 'whatsapp_text' | 'whatsapp_image';
    }): Promise<import("../repositories/order.repo.js").OrderWithDetails>;
    static changeStatus({ businessId, orderId, newStatus, changedBy }: {
        businessId: string;
        orderId: string;
        newStatus: OrderStatus;
        changedBy?: string;
    }): Promise<import("../repositories/order.repo.js").OrderWithDetails | null>;
}
