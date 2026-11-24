export const config = { matcher: ['/api/auth/login', '/api/auth/register'] };

export default async function middleware(request: Request) {
  const path = new URL(request.url).pathname;
  const headers = new Headers();
  for (const name of ['Origin', 'Content-Type', 'Access-Control-Request-Method', 'Access-Control-Request-Headers', 'X-OrderLedger-Session']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const token = request.headers.get('x-vercel-oidc-token');
  const ip = request.headers.get('x-vercel-forwarded-for');
  if (token && ip) {
    headers.set('X-OrderLedger-Proxy-Token', token);
    headers.set('X-OrderLedger-Client-IP', ip);
  }
  const upstream = await fetch('https://orderledger-api.onrender.com' + path, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });
  // fetch can decode an upstream body. Its original encoded length no longer applies.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-length');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('transfer-encoding');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
