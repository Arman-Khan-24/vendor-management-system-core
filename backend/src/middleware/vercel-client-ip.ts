import { isIP } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

const owner = 'arman-khan-24s-projects';
const project = 'orderledger';
const issuer = 'https://oidc.vercel.com';
const teamIssuer = issuer + '/' + owner;
const globalKeys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), { timeoutDuration: 2500 });
const teamKeys = createRemoteJWKSet(new URL(teamIssuer + '/.well-known/jwks'), { timeoutDuration: 2500 });

export const verifyVercelClientIp: RequestHandler = async (req, res, next) => {
  const ip = req.get('X-OrderLedger-Client-IP');
  const token = req.get('X-OrderLedger-Proxy-Token');
  if (ip && isIP(ip) && token && token.length <= 4096) {
    const options = {
      audience: 'https://vercel.com/' + owner,
      subject: `owner:${owner}:project:${project}:environment:production`,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'nbf'],
    };
    try {
      const tokenIssuer = decodeJwt(token).iss;
      const keys = tokenIssuer === teamIssuer ? teamKeys : tokenIssuer === issuer ? globalKeys : undefined;
      if (!keys) { next(); return; }
      await jwtVerify(token, keys, { ...options, issuer: tokenIssuer });
      res.locals.verifiedClientIp = ip;
      res.setHeader('X-OrderLedger-Rate-Limit-Scope', 'verified-client');
    } catch {
      // An unverified forwarded address cannot control the rate-limit bucket.
    }
  }
  next();
};

export function getAuthClientIp(req: Request): string {
  return req.res?.locals.verifiedClientIp ?? req.ip ?? 'unknown';
}
