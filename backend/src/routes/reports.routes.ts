import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
import { ReportsService } from '../services/reports.service.js';
import { PdfService } from '../services/pdf.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { dateOnlySchema } from '../validators/schemas.js';
import { getPagination, validateUuidParam } from '../middleware/validate.middleware.js';
import { BusinessRepository } from '../repositories/business.repo.js';

const router = Router();
router.use(authenticate, requireRoles('OWNER', 'STAFF'));
router.param('customerId', validateUuidParam);
router.use(async (req, res, next) => {
  try {
    for (const key of ['startDate', 'endDate', 'asOfDate']) {
      if (req.query[key] !== undefined && !dateOnlySchema.safeParse(req.query[key]).success) throw new AppError(`${key} must be a valid YYYY-MM-DD date.`, 400);
    }
    if (req.query.startDate && req.query.endDate && String(req.query.startDate) > String(req.query.endDate)) throw new AppError('Start date must be on or before end date.', 400);
    if (req.query.interval && !['day', 'week', 'month'].includes(String(req.query.interval))) throw new AppError('Report interval must be day, week or month.', 400);
    if (req.query.limit !== undefined) getPagination(req.query);
    const business = await BusinessRepository.findById(req.businessId!);
    if (!business?.settings.modules.reports) throw new AppError('Reports are disabled in business settings.', 403);
    next();
  } catch (error) { next(error); }
});

/**
 * 1. GET /api/reports/statement/:customerId
 * Customer ledger statement with optional date range query (?startDate=&endDate=)
 */
router.get('/statement/:customerId', async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const statement = await ReportsService.getCustomerStatement({
      customerId,
      businessId: req.businessId!,
      startDate,
      endDate
    });

    if (!statement) {
      throw new AppError('Customer not found', 404);
    }

    res.json(statement);
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/reports/statement/:customerId/pdf
 * Export the customer ledger statement as a PDF.
 */
router.get('/statement/:customerId/pdf', async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const statement = await ReportsService.getCustomerStatement({
      customerId,
      businessId: req.businessId!,
      startDate,
      endDate
    });

    if (!statement) {
      throw new AppError('Customer not found', 404);
    }

    const pdfBuffer = await PdfService.generateStatementPdf(statement);

    const safeCustomerName = statement.customer.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Statement_${safeCustomerName}_${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

/**
 * 3. GET /api/reports/dues
 * Outstanding & overdue receivables report with aging brackets & credit terms
 */
router.get('/dues', async (req, res, next) => {
  try {
    const asOfDate = req.query.asOfDate as string | undefined;
    const report = await ReportsService.getOutstandingReport({
      businessId: req.businessId!,
      asOfDate
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * 4. GET /api/reports/sales
 * Aggregated sales report with optional intervals (day, week, month) & date ranges
 */
router.get('/sales', async (req, res, next) => {
  try {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const interval = (req.query.interval as 'day' | 'week' | 'month') || 'day';

    const report = await ReportsService.getSalesReport({
      businessId: req.businessId!,
      startDate,
      endDate,
      interval
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * 5. GET /api/reports/collections
 * Aggregated collections report with payment mode breakdown & timeline series
 */
router.get('/collections', async (req, res, next) => {
  try {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const interval = (req.query.interval as 'day' | 'week' | 'month') || 'day';

    const report = await ReportsService.getCollectionReport({
      businessId: req.businessId!,
      startDate,
      endDate,
      interval
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * 6. GET /api/reports/top-customers
 * Ranked customers by sales volume, order count, amount paid, and outstanding
 */
router.get('/top-customers', async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const customers = await ReportsService.getTopCustomers({
      businessId: req.businessId!,
      limit,
      startDate,
      endDate
    });
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

/**
 * 7. GET /api/reports/top-products
 * Ranked products by revenue and quantities sold
 */
router.get('/top-products', async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const products = await ReportsService.getTopProducts({
      businessId: req.businessId!,
      limit,
      startDate,
      endDate
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

export default router;
