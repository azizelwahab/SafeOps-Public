import { findUserById } from '../models/userModel.js';
import { verifyAccessToken } from '../utils/token.js';
import { sendError } from '../views/jsonResponse.js';

export async function authenticate(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const header = req.get('authorization') ?? '';
  const match = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(header);
  const claims = match && verifyAccessToken(match[1]);
  const user = claims && await findUserById(claims.organizationId, claims.sub);
  if (!user || user.status !== 'APPROVED' || user.authVersion !== claims.authVersion) {
    res.set('WWW-Authenticate', 'Bearer');
    return sendError(res, 401, 'UNAUTHENTICATED', 'Valid authentication is required.');
  }
  req.auth = { id: user.id, organizationId: user.organizationId, role: user.role, authVersion: user.authVersion };
  next();
}
