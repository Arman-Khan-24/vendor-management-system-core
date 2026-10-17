import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { InvoiceRepository } from '../repositories/invoice.repo.js';
import { AppError } from '../middleware/errorHandler.js';
const router = Router();
router.use(authenticate);
router.get('/', async (req, res, next) => {
    try {
        const customerId = req.query.customerId;
        const status = req.query.status;
        const invoices = await InvoiceRepository.list({
            businessId: req.businessId,
            customerId,
            status
        });
        res.json(invoices);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const invoice = await InvoiceRepository.findById({
            invoiceId: req.params.id,
            businessId: req.businessId
        });
        if (!invoice) {
            throw new AppError('Invoice not found', 404);
        }
        res.json(invoice);
    }
    catch (err) {
        next(err);
    }
});
// Explicit manual invoice generation for an order
router.post('/order/:orderId/generate', async (req, res, next) => {
    try {
        const invoice = await InvoiceRepository.generateInvoiceForOrder({
            businessId: req.businessId,
            orderId: req.params.orderId
        });
        res.status(201).json(invoice);
    }
    catch (err) {
        next(err);
    }
});
export default router;
