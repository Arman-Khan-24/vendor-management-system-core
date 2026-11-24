import type { RequestHandler } from 'express';

function containsNull(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\0');
  if (Array.isArray(value)) return value.some(containsNull);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) => key.includes('\0') || containsNull(entry));
  }
  return false;
}

export const rejectNullBytes: RequestHandler = (req, res, next) => {
  if (containsNull(req.query) || containsNull(req.body) || req.path.includes('%00')) {
    res.status(400).json({ error: 'Text fields must not contain null characters.' });
    return;
  }
  next();
};
