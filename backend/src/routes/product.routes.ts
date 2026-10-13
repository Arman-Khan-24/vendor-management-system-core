import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { createProductSchema, updateProductSchema } from '../validators/schemas.js';
import { ProductRepository } from '../repositories/product.repo.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const search = req.query.search as string | undefined;
    const activeOnly = req.query.all !== 'true';
    const products = await ProductRepository.list({
      businessId: req.businessId!,
      search,
      activeOnly
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.post('/', validateBody(createProductSchema), async (req, res, next) => {
  try {
    const product = await ProductRepository.create({
      businessId: req.businessId!,
      name: req.body.name,
      unit: req.body.unit,
      currentPrice: req.body.currentPrice
    });
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const product = await ProductRepository.findById({
      productId: req.params.id,
      businessId: req.businessId!
    });
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', validateBody(updateProductSchema), async (req, res, next) => {
  try {
    const updated = await ProductRepository.update({
      productId: req.params.id,
      businessId: req.businessId!,
      data: req.body
    });
    if (!updated) {
      throw new AppError('Product not found', 404);
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await ProductRepository.delete({
      productId: req.params.id,
      businessId: req.businessId!
    });
    if (!deleted) {
      throw new AppError('Product not found', 404);
    }
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
