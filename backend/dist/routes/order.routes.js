import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/schemas.js';
import { OrderRepository } from '../repositories/order.repo.js';
import { OrderService } from '../services/order.service.js';
import { AppError } from '../middleware/errorHandler.js';
const router = Router();
router.use(authenticate);
router.get('/', async (req, res, next) => {
    try {
        const status = req.query.status;
        const customerId = req.query.customerId;
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
        const orders = await OrderRepository.list({
            businessId: req.businessId,
            status,
            customerId,
            limit,
            offset
        });
        res.json(orders);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', validateBody(createOrderSchema), async (req, res, next) => {
    try {
        const order = await OrderService.createOrder({
            businessId: req.businessId,
            customerId: req.body.customerId,
            items: req.body.items,
            notes: req.body.notes,
            createdBy: req.user.userId,
            source: 'manual'
        });
        res.status(201).json(order);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const order = await OrderRepository.findById({
            orderId: req.params.id,
            businessId: req.businessId
        });
        if (!order) {
            throw new AppError('Order not found', 404);
        }
        res.json(order);
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:id/status', validateBody(updateOrderStatusSchema), async (req, res, next) => {
    try {
        const updated = await OrderService.changeStatus({
            businessId: req.businessId,
            orderId: req.params.id,
            newStatus: req.body.status,
            changedBy: req.user.userId
        });
        res.json(updated);
    }
    catch (err) {
        next(err);
    }
});
export default router;
