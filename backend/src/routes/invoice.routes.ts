import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
import { validateUuidParam, getPagination } from '../middleware/validate.middleware.js';
import { InvoiceRepository } from '../repositories/invoice.repo.js';
import { AppError } from '../middleware/errorHandler.js';
import { InvoiceStatus } from '../models/types.js';

const router = Router();
router.use(authenticate, requireRoles('OWNER', 'STAFF'));
router.param('id', validateUuidParam);
router.param('orderId', validateUuidParam);

router.get('/', async (req, res, next) => {
  try {
    const customerId = req.query.customerId as string | undefined;
    const status = req.query.status as InvoiceStatus | undefined;
    if (status && !['Pending', 'Partial', 'Paid'].includes(status)) throw new AppError('Invalid invoice status filter.', 400);
    const invoices = await InvoiceRepository.list({
      businessId: req.businessId!,
      ...getPagination(req.query),
      customerId,
      status
    });
    res.json(invoices);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const invoice = await InvoiceRepository.findById({
      invoiceId: req.params.id,
      businessId: req.businessId!
    });
    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

// Explicit manual invoice generation for an order
router.post('/order/:orderId/generate', async (req, res, next) => {
  try {
    const invoice = await InvoiceRepository.generateInvoiceForOrder({
      businessId: req.businessId!,
      orderId: req.params.orderId
    });
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
});

export default router;
