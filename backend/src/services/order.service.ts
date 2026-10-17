import { OrderRepository } from '../repositories/order.repo.js';
import { InvoiceRepository } from '../repositories/invoice.repo.js';
import { withTransaction } from '../database/connection.js';
import { AppError } from '../middleware/errorHandler.js';
import { OrderStatus } from '../models/types.js';

export class OrderService {
  static async createOrder({
    businessId,
    customerId,
    items,
    notes,
    createdBy,
    source = 'manual'
  }: {
    businessId: string;
    customerId: string;
    items: { productId: string; quantity: number }[];
    notes?: string;
    createdBy?: string;
    source?: 'manual' | 'whatsapp_text' | 'whatsapp_image';
  }) {
    if (!items || items.length === 0) {
      throw new AppError('Order must contain at least one item', 400);
    }

    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
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

  static async changeStatus({
    businessId,
    orderId,
    newStatus,
    changedBy
  }: {
    businessId: string;
    orderId: string;
    newStatus: OrderStatus;
    changedBy?: string;
  }) {
    return withTransaction(async client => {
      const result = await client.query('SELECT invoice_trigger FROM businesses WHERE id = $1 FOR UPDATE', [businessId]);
      if (!result.rows[0]) throw new AppError('Business not found', 404);
      await OrderRepository.updateStatus({ orderId, businessId, newStatus, changedBy, client });
      const trigger = result.rows[0].invoice_trigger;
      if (newStatus === 'Delivered' || (newStatus === 'Packed' && trigger === 'Packed')) {
        await InvoiceRepository.generateInvoiceForOrder({ businessId, orderId, client });
      }
      return (await OrderRepository.findById({ orderId, businessId, client }))!;
    });
  }
}
