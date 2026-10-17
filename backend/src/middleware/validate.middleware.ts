import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, z } from 'zod';
import { AppError } from './errorHandler.js';

export function getPagination(query: { limit?: unknown; offset?: unknown }, defaultLimit = 100) {
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) {
    throw new AppError('Use a limit between 1 and 500 and a nonnegative offset.', 400);
  }
  return { limit, offset };
}

export function validateUuidParam(req: Request, res: Response, next: NextFunction, value: string): void {
  if (!z.string().uuid().safeParse(value).success) {
    res.status(400).json({ error: 'Invalid record identifier' });
    return;
  }
  next();
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
        });
        return;
      }
      next(error);
    }
  };
}
