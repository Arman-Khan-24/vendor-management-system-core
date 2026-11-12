// Only hashes and random retry keys are stored, never the submitted financial data.
const memory = new Map<string, string | null>();
const running = new Map<string, Promise<unknown>>();

export async function pendingWrite<T>(scope: string, body: unknown, send: (key: string) => Promise<T>, previousScopes: string[] = []): Promise<T> {
  const storageKeys = await Promise.all([...new Set([scope, ...previousScopes])].map(async value => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([value, body])));
    return 'orderledger_write_' + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }));
  const storageKey = storageKeys[0];
  const existing = storageKeys.map(key => running.get(key)).find(Boolean);
  if (existing) return existing as Promise<T>;
  let key: string | null | undefined;
  for (const candidate of storageKeys) {
    key = memory.get(candidate);
    if (key === undefined) {
      try { key = sessionStorage.getItem(candidate); } catch { /* Memory also supports restricted storage. */ }
    }
    if (key) break;
  }
  key ||= crypto.randomUUID();
  memory.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch { /* Keep the key in this tab's memory. */ }
  const clear = () => {
    for (const candidate of storageKeys) {
      memory.set(candidate, null);
      try { sessionStorage.removeItem(candidate); } catch { /* Memory remains authoritative in this session. */ }
    }
  };
  const request = (async () => {
    try {
      const result = await send(key);
      clear();
      return result;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      // Network failures, unreadable success responses and 5xx can have committed.
      if (status && status >= 400 && status < 500 && status !== 408) clear();
      throw error;
    } finally { running.delete(storageKey); }
  })();
  running.set(storageKey, request);
  return request;
}
