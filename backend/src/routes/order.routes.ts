import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
import { validateBody, validateUuidParam, getPagination } from '../middleware/validate.middleware.js';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/schemas.js';
import { OrderRepository } from '../repositories/order.repo.js';
import { OrderService } from '../services/order.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { OrderStatus } from '../models/types.js';

const router = Router();
router.use(authenticate);
router.param('id', validateUuidParam);

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as OrderStatus | undefined;
    const customerId = req.query.customerId as string | undefined;
    const { limit, offset } = getPagination(req.query, 50);
    if (status && !['Received', 'Packed', 'Delivered'].includes(status)) throw new AppError('Invalid order status filter.', 400);

    const orders = await OrderRepository.list({
      businessId: req.businessId!,
      status,
      customerId,
      limit,
      offset
    });
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRoles('OWNER', 'STAFF'), validateBody(createOrderSchema), async (req, res, next) => {
  try {
    const order = await OrderService.createOrder({
      businessId: req.businessId!,
      customerId: req.body.customerId,
      items: req.body.items,
      notes: req.body.notes,
      createdBy: req.user!.userId,
      source: 'manual'
    });
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await OrderRepository.findById({
      orderId: req.params.id,
      businessId: req.businessId!
    });
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', validateBody(updateOrderStatusSchema), async (req, res, next) => {
  try {
    if (req.user!.role === 'DELIVERY' && req.body.status !== 'Delivered') throw new AppError('Delivery users can only mark packed orders as delivered.', 403);
    const updated = await OrderService.changeStatus({
      businessId: req.businessId!,
      orderId: req.params.id,
      newStatus: req.body.status,
      changedBy: req.user!.userId
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
