import type { Request, RequestHandler } from 'express';

export function rateLimit(max: number, windowMs: number, key: (req: Request) => string): RequestHandler {
  const windows = new Map<string, number>();
  let resetAt = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now >= resetAt) {
      windows.clear();
      resetAt = now + windowMs;
    }
    const id = key(req);
    const used = windows.get(id) ?? 0;
    if (used >= max || (!windows.has(id) && windows.size >= 10000)) {
      res.setHeader('Retry-After', Math.ceil((resetAt - now) / 1000));
      res.status(429).json({ error: 'Too many requests. Try again shortly.' });
      return;
    }
    windows.set(id, used + 1);
    next();
  };
}
