import { json, Router } from 'express';
import { Permission } from '../config/permissions.js';
import { approve, detail, list, reject, remove, restore, role, suspend, update } from '../controllers/userController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { emptyBodySchema, listUsersSchema, updateRoleSchema, updateUserSchema, userIdSchema } from '../validators/userValidator.js';

export function createUserRouter() {
  const router = Router();
  const validateId = validate(userIdSchema, 'params');
  const parseBody = json({ limit: '8kb' });

  router.get('/', authenticate, requirePermission(Permission.USER_LIST), validate(listUsersSchema, 'query'), list);
  router.get('/:id', authenticate, validateId, detail);
  router.patch('/:id', authenticate, validateId, parseBody, validate(updateUserSchema), update);
  router.delete('/:id', authenticate, requirePermission(Permission.USER_DELETE), validateId, remove);
  router.patch('/:id/approve', authenticate, requirePermission(Permission.USER_APPROVE), validateId, parseBody, validate(emptyBodySchema), approve);
  router.patch('/:id/reject', authenticate, requirePermission(Permission.USER_REJECT), validateId, parseBody, validate(emptyBodySchema), reject);
  router.patch('/:id/suspend', authenticate, requirePermission(Permission.USER_SUSPEND), validateId, parseBody, validate(emptyBodySchema), suspend);
  router.patch('/:id/restore', authenticate, requirePermission(Permission.USER_RESTORE), validateId, parseBody, validate(emptyBodySchema), restore);
  router.patch('/:id/role', authenticate, requirePermission(Permission.USER_CHANGE_ROLE), validateId, parseBody, validate(updateRoleSchema), role);
  return router;
}
