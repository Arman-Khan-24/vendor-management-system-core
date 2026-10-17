import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  console.error('Unhandled Application Error:', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Handle postgres unique constraint error
  if (err && err.code === '23505') {
    res.status(409).json({ error: 'Conflict: a record with these unique details already exists' });
    return;
  }

  // Handle postgres foreign key constraint error
  if (err && err.code === '23503') {
    res.status(400).json({ error: 'Constraint violation: referenced entity does not exist or belongs to another tenant' });
    return;
  }

  res.status(500).json({ error: 'Internal server error', details: err?.message, code: err?.code });
}
