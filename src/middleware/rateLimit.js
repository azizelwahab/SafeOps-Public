import { rateLimit } from 'express-rate-limit';
import { authConfig } from '../config/auth.js';
import { sendError } from '../views/jsonResponse.js';

export function authRateLimit(limit) {
  return rateLimit({
    windowMs: authConfig.rateWindowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Express uses the socket address. Forwarded IPs are not trusted.
    validate: { xForwardedForHeader: false },
    handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Try again later.'),
  });
}
