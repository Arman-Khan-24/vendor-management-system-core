import { Router } from 'express';
import { validateBody } from '../middleware/validate.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { registerSchema, loginSchema } from '../validators/schemas.js';
import { AuthService } from '../services/auth.service.js';
import { BusinessRepository } from '../repositories/business.repo.js';
const router = Router();
router.get('/templates', async (req, res, next) => {
    try {
        const templates = await BusinessRepository.listCategoryTemplates();
        res.json({ templates });
    }
    catch (err) {
        next(err);
    }
});
router.post('/register', validateBody(registerSchema), async (req, res, next) => {
    try {
        const result = await AuthService.registerOwnerAndBusiness(req.body);
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/login', validateBody(loginSchema), async (req, res, next) => {
    try {
        const result = await AuthService.login(req.body);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/me', authenticate, async (req, res, next) => {
    try {
        const business = await BusinessRepository.findById(req.businessId);
        res.json({
            user: req.user,
            business
        });
    }
    catch (err) {
        next(err);
    }
});
export default router;
