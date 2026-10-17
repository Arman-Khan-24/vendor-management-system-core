import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { updateBusinessConnectionsSchema, updateBusinessSettingsSchema } from '../validators/business-settings.schemas.js';
import { BusinessRepository } from '../repositories/business.repo.js';
import { UserRepository } from '../repositories/user.repo.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const business = await BusinessRepository.findById(req.businessId!);
    if (!business) throw new AppError('Business not found', 404);
    res.json(business);
  } catch (err) {
    next(err);
  }
});

router.patch('/', requireRoles('OWNER'), validateBody(updateBusinessSettingsSchema), async (req, res, next) => {
  try {
    const updated = await BusinessRepository.update(req.businessId!, req.body);
    if (!updated) throw new AppError('Business not found', 404);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get('/connections', requireRoles('OWNER'), async (req, res, next) => {
  try {
    res.json(await BusinessRepository.getConnections(req.businessId!));
  } catch (err) {
    next(err);
  }
});

router.patch('/connections', requireRoles('OWNER'), validateBody(updateBusinessConnectionsSchema), async (req, res, next) => {
  try {
    res.json(await BusinessRepository.updateConnections(req.businessId!, req.body));
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
