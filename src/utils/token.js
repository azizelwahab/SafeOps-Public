import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authConfig } from '../config/auth.js';

const claims = z.object({
  sub: z.uuid(),
  organizationId: z.uuid(),
  authVersion: z.number().int().nonnegative(),
  iss: z.string(),
  aud: z.string(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).refine(({ iat, exp }) => iat <= Math.floor(Date.now() / 1000) &&
  exp > iat && exp - iat <= authConfig.expiresIn);

export function signAccessToken({ id, organizationId, authVersion }) {
  return jwt.sign({ organizationId, authVersion }, authConfig.secret, {
    algorithm: 'HS256',
    subject: id,
    issuer: authConfig.issuer,
    audience: authConfig.audience,
    expiresIn: authConfig.expiresIn,
  });
}

export function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, authConfig.secret, {
      algorithms: ['HS256'],
      issuer: authConfig.issuer,
      audience: authConfig.audience,
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) return null;
    throw error;
  }
  const parsed = claims.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
