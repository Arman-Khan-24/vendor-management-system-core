import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { recordPaymentSchema } from '../validators/schemas.js';
import { PaymentRepository } from '../repositories/payment.repo.js';
const router = Router();
router.use(authenticate);
router.get('/', async (req, res, next) => {
    try {
        const customerId = req.query.customerId;
        const payments = await PaymentRepository.list({
            businessId: req.businessId,
            customerId
        });
        res.json(payments);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', validateBody(recordPaymentSchema), async (req, res, next) => {
    try {
        const payment = await PaymentRepository.recordPayment({
            businessId: req.businessId,
            customerId: req.body.customerId,
            amount: req.body.amount,
            mode: req.body.mode,
            date: req.body.date,
            reference: req.body.reference,
            notes: req.body.notes,
            createdBy: req.user.userId,
            specificInvoiceAllocations: req.body.specificInvoiceAllocations
        });
        res.status(201).json(payment);
    }
    catch (err) {
        next(err);
    }
});
export default router;
