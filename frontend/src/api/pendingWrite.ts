// Only hashes and random retry keys are stored, never the submitted financial data.
const memory = new Map<string, string | null>();
const running = new Map<string, Promise<unknown>>();

export async function pendingWrite<T>(scope: string, body: unknown, send: (key: string) => Promise<T>): Promise<T> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([scope, body])));
  const storageKey = 'orderledger_write_' + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const existing = running.get(storageKey);
  if (existing) return existing as Promise<T>;
  let key = memory.get(storageKey);
  if (key === undefined) {
    try { key = sessionStorage.getItem(storageKey); } catch { /* Memory also supports restricted storage. */ }
  }
  key ||= crypto.randomUUID();
  memory.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch { /* Keep the key in this tab's memory. */ }
  const clear = () => {
    memory.set(storageKey, null);
    try { sessionStorage.removeItem(storageKey); } catch { /* Memory remains authoritative in this session. */ }
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
