/** Only codes leave this layer: upstream bodies may contain customer data or keys. */
export class ProviderError extends Error {
  constructor(public code: string, public retryable: boolean) { super(code); }
}
export async function fetchProviderJson(url: string, init: RequestInit): Promise<any> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
  catch { throw new ProviderError('PROVIDER_RESPONSE_UNCONFIRMED', false); }
  if (!response.ok) throw new ProviderError(`PROVIDER_HTTP_${response.status}`, response.status === 429 || response.status >= 500);
  try { return await response.json(); }
  catch { throw new ProviderError('INVALID_PROVIDER_RESPONSE', false); }
}
