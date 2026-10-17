import { OrderRepository } from '../repositories/order.repo.js';
import { InvoiceRepository } from '../repositories/invoice.repo.js';
import { BusinessRepository } from '../repositories/business.repo.js';
import { AppError } from '../middleware/errorHandler.js';
export class OrderService {
    static async createOrder({ businessId, customerId, items, notes, createdBy, source = 'manual' }) {
        if (!items || items.length === 0) {
            throw new AppError('Order must contain at least one item', 400);
        }
        for (const item of items) {
            if (item.quantity <= 0) {
                throw new AppError(`Item quantity must be greater than 0`, 400);
            }
        }
        return await OrderRepository.createOrderWithItems({
            businessId,
            customerId,
            items,
            notes,
            createdBy,
            source
        });
    }
    static async changeStatus({ businessId, orderId, newStatus, changedBy }) {
        // 1. Perform status transition
        const order = await OrderRepository.updateStatus({
            orderId,
            businessId,
            newStatus,
            changedBy
        });
        // 2. Check if invoice trigger is hit for this tenant
        const business = await BusinessRepository.findById(businessId);
        const trigger = business?.invoice_trigger || 'Delivered';
        if (newStatus === trigger) {
            // Automatically generate invoice idempotently
            await InvoiceRepository.generateInvoiceForOrder({
                businessId,
                orderId
            });
        }
        // Refresh and return full order details
        return await OrderRepository.findById({ orderId, businessId });
    }
}
