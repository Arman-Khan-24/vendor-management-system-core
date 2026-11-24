import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../database/connection.js';
import { config } from '../config/env.js';
import { UserRole } from '../models/types.js';

export interface AuthUserPayload {
  userId: string;
  businessId: string;
  email: string;
  role: UserRole;
  name: string;
  jti?: string;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
      businessId?: string;
    }
  }
}

export const sessionCookie = '__Host-orderledger_session';
export const sessionCookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

export function browserSessionRequest(req: Request): boolean {
  return req.get('X-OrderLedger-Session') === 'cookie' &&
    req.get('Origin') === new URL(config.publicAppUrl).origin;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const cookie = req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
  const token = bearer || cookie;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
    return;
  }
  if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !browserSessionRequest(req)) {
    res.status(403).json({ error: 'Request origin could not be verified.' });
    return;
  }

  let decoded: AuthUserPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as AuthUserPayload;
    if (!decoded.userId || !decoded.businessId || !decoded.jti || !Number.isFinite(decoded.exp)) throw new Error();
  } catch {
    res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
    return;
  }

  try {
    if (!req.user) {
      const result = await query<{ role: UserRole; name: string; email: string }>(
        `SELECT role, name, email FROM users WHERE id = $1 AND business_id = $2
         AND NOT EXISTS (SELECT 1 FROM session_revocations WHERE id = $3)`,
        [decoded.userId, decoded.businessId, decoded.jti]
      );
      const member = result.rows[0];
      if (!member) {
        res.status(401).json({ error: 'Unauthorized: session ended' });
        return;
      }
      decoded = { ...decoded, ...member };
    }
    const expected = req.get('X-OrderLedger-Identity');
    if (!bearer && expected && expected !== decoded.businessId + ':' + decoded.userId) {
      res.status(401).json({ error: 'Your session changed. Reload the workspace before continuing.' });
      return;
    }
    if (!req.user) req.user = decoded;
    req.businessId = req.user.businessId;
    res.setHeader('Cache-Control', 'no-store');
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient role privileges' });
      return;
    }

    next();
  };
}
