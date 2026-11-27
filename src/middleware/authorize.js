import { hasPermission } from '../config/permissions.js';
import { sendError } from '../views/jsonResponse.js';

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.auth, permission)) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission for this operation.');
    }
    next();
  };
}
