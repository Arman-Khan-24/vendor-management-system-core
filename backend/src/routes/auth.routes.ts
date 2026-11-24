import { withTransaction } from '../database/connection.js';
import jwt from 'jsonwebtoken';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { authenticate, browserSessionRequest, sessionCookie, sessionCookieOptions } from '../middleware/auth.middleware.js';
import { registerSchema, loginSchema } from '../validators/schemas.js';
import { AuthService } from '../services/auth.service.js';
import { BusinessRepository } from '../repositories/business.repo.js';

const router = Router();

function sendSession(req: Request, res: Response, status: number, result: Awaited<ReturnType<typeof AuthService.login>>) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.get('X-OrderLedger-Session') !== 'cookie') {
    res.status(status).json(result);
    return;
  }
  const { token, ...session } = result;
  const claims = jwt.decode(token);
  const expires = typeof claims === 'object' && claims?.exp ? new Date(claims.exp * 1000) : undefined;
  res.cookie(sessionCookie, token, { ...sessionCookieOptions, expires }).status(status).json(session);
}

router.use(['/login', '/register'], (req, res, next) => {
  if (req.get('X-OrderLedger-Session') === 'cookie' && !browserSessionRequest(req)) {
    res.status(403).json({ error: 'Request origin could not be verified.' });
    return;
  }
  next();
});


router.get('/templates', async (req, res, next) => {
  try {
    const templates = await BusinessRepository.listCategoryTemplates();
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

router.post('/register', rateLimit(60, 60000, req => req.ip ?? 'unknown'), validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await AuthService.registerOwnerAndBusiness(req.body);
    sendSession(req, res, 201, result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', rateLimit(120, 60000, req => req.ip ?? 'unknown'), validateBody(loginSchema),
  rateLimit(10, 60000, req => JSON.stringify([req.ip ?? 'unknown', req.body.email.trim().toLowerCase()])), async (req, res, next) => {
  try {
    const result = await AuthService.login(req.body);
    sendSession(req, res, 200, result);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { jti, exp } = req.user!;
    if (jti && exp) {
      await withTransaction(async client => {
        await client.query('DELETE FROM session_revocations WHERE expires_at <= now()');
        await client.query('INSERT INTO session_revocations (id, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING', [jti, exp]);
      });
    }
    res.clearCookie(sessionCookie, sessionCookieOptions).status(204).end();
  } catch (error) { next(error); }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const business = await BusinessRepository.findById(req.businessId!);
    res.setHeader('Cache-Control', 'no-store');
    const { jti, exp, ...user } = req.user!;
    res.json({
      user,
      business
    });
  } catch (err) {
    next(err);
  }
});

export default router;
