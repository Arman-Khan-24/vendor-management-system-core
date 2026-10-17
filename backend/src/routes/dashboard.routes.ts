import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
import { DashboardService } from '../services/dashboard.service.js';

const router = Router();
router.use(authenticate, requireRoles('OWNER', 'STAFF'));

router.get('/summary', async (req, res, next) => {
  try {
    const summary = await DashboardService.getSummary(req.businessId!);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

export default router;
