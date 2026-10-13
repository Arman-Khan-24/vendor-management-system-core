import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { updateBusinessSchema } from '../validators/schemas.js';
import { BusinessRepository } from '../repositories/business.repo.js';
import { UserRepository } from '../repositories/user.repo.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const business = await BusinessRepository.findById(req.businessId!);
    res.json(business);
  } catch (err) {
    next(err);
  }
});

router.patch('/', validateBody(updateBusinessSchema), async (req, res, next) => {
  try {
    const updated = await BusinessRepository.update(req.businessId!, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get('/team', async (req, res, next) => {
  try {
    const team = await UserRepository.listByBusiness(req.businessId!);
    res.json(team);
  } catch (err) {
    next(err);
  }
});

export default router;
