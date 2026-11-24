/** Share a pending read across callers and briefly reuse its settled result. */
export function cachedRead<T>(load: () => Promise<T>, ttlMs: number, errorTtlMs = 1000): () => Promise<T> {
  let cached: Promise<T> | undefined;
  let expiresAt = 0;
  return () => {
    if (!cached || Date.now() >= expiresAt) {
      expiresAt = Infinity;
      cached = Promise.resolve().then(load);
      cached.then(
        () => { expiresAt = Date.now() + ttlMs; },
        () => { expiresAt = Date.now() + errorTtlMs; },
      );
    }
    return cached;
  };
}
