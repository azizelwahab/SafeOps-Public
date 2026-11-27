import { Router } from 'express';
import { Permission } from '../config/permissions.js';
import { detail, list } from '../controllers/auditLogController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { auditLogIdSchema, listAuditLogsSchema } from '../validators/auditLogValidator.js';

export function createAuditLogRouter() {
  const router = Router();
  const canRead = requirePermission(Permission.AUDIT_READ);
  router.get('/', authenticate, canRead, validate(listAuditLogsSchema, 'query'), list);
  router.get('/:id', authenticate, canRead, validate(auditLogIdSchema, 'params'), detail);
  return router;
}
