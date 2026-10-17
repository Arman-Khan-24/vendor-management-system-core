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
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Handle postgres unique constraint error
  if (err && err.code === '23505') {
    const message = err.constraint === 'uq_products_business_name' ? 'A product with this name already exists, including archived products.'
      : err.constraint === 'uq_customers_business_phone' ? 'A customer with this phone number already exists, including archived customers.'
      : 'A record with these details already exists.';
    res.status(409).json({ error: message });
    return;
  }

  // Handle postgres foreign key constraint error
  if (err && err.code === '23503') {
    res.status(400).json({ error: 'The selected record is unavailable for this business. Refresh and select it again.' });
    return;
  }

  if (['22P02', '22003', '22007', '22008', '23514', '23502'].includes(err?.code)) {
    res.status(400).json({ error: err.code === '22003' ? 'The amount or quantity exceeds the supported range.' : 'Some values are invalid. Check amounts, dates, and selected records.' });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body must contain valid JSON.' });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'The request is too large.' });
    return;
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '57P03', '53300', '08001', '08006'].includes(err?.code)) {
    res.status(503).json({ error: 'The database is temporarily unavailable. Please retry shortly.' });
    return;
  }
  if (['42P01', '42703'].includes(err?.code)) {
    console.error('Database schema is not ready:', { code: err.code });
    res.status(503).json({ error: 'Database setup is incomplete. Restart the API to apply its migrations.' });
    return;
  }

  // Do not log database details or request bodies: they can contain customer data or keys.
  console.error('Unhandled application error:', { name: err?.name, code: err?.code });

  res.status(500).json({ error: 'Internal server error' });
}
