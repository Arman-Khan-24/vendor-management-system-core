import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createCustomerSchema, updateCustomerSchema } from '../validators/schemas.js';
import { CustomerRepository } from '../repositories/customer.repo.js';
import { PaymentRepository } from '../repositories/payment.repo.js';
import { AppError } from '../middleware/errorHandler.js';
const router = Router();
router.use(authenticate);
router.get('/', async (req, res, next) => {
    try {
        const search = req.query.search;
        const activeOnly = req.query.all !== 'true';
        const customers = await CustomerRepository.list({
            businessId: req.businessId,
            search,
            activeOnly
        });
        res.json(customers);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', validateBody(createCustomerSchema), async (req, res, next) => {
    try {
        const customer = await CustomerRepository.create({
            businessId: req.businessId,
            name: req.body.name,
            phone: req.body.phone,
            creditTermsDays: req.body.creditTermsDays
        });
        res.status(201).json(customer);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const customer = await CustomerRepository.findById({
            customerId: req.params.id,
            businessId: req.businessId
        });
        if (!customer) {
            throw new AppError('Customer not found', 404);
        }
        res.json(customer);
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:id', validateBody(updateCustomerSchema), async (req, res, next) => {
    try {
        const updated = await CustomerRepository.update({
            customerId: req.params.id,
            businessId: req.businessId,
            data: req.body
        });
        if (!updated) {
            throw new AppError('Customer not found', 404);
        }
        res.json(updated);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', async (req, res, next) => {
    try {
        const deleted = await CustomerRepository.delete({
            customerId: req.params.id,
            businessId: req.businessId
        });
        if (!deleted) {
            throw new AppError('Customer not found', 404);
        }
        res.json({ success: true, message: 'Customer deleted' });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id/statement', async (req, res, next) => {
    try {
        const statement = await PaymentRepository.getCustomerStatement({
            customerId: req.params.id,
            businessId: req.businessId
        });
        if (!statement) {
            throw new AppError('Customer not found', 404);
        }
        res.json(statement);
    }
    catch (err) {
        next(err);
    }
});
export default router;
