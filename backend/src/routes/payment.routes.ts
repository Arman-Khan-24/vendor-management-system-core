import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
import { validateBody, getPagination } from '../middleware/validate.middleware.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordPaymentSchema } from '../validators/schemas.js';
import { PaymentRepository } from '../repositories/payment.repo.js';

const router = Router();
router.use(authenticate, requireRoles('OWNER', 'STAFF'));

router.get('/', async (req, res, next) => {
  try {
    const customerId = req.query.customerId as string | undefined;
    const payments = await PaymentRepository.list({
      businessId: req.businessId!,
      ...getPagination(req.query),
      customerId
    });
    res.json(payments);
  } catch (err) {
    next(err);
  }
});

router.post('/', validateBody(recordPaymentSchema), async (req, res, next) => {
  try {
    if (req.body.specificInvoiceAllocations?.length && req.user!.role !== 'OWNER') throw new AppError('Only an owner can choose specific invoice allocations.', 403);
    const payment = await PaymentRepository.recordPayment({
      businessId: req.businessId!,
      customerId: req.body.customerId,
      amount: req.body.amount,
      mode: req.body.mode,
      date: req.body.date,
      reference: req.body.reference,
      notes: req.body.notes,
      createdBy: req.user!.userId,
      specificInvoiceAllocations: req.body.specificInvoiceAllocations,
      idempotencyKey: req.get('Idempotency-Key')
    });
    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
});

export default router;
