import { json, Router } from 'express';
import { Permission } from '../config/permissions.js';
import { create, detail, edit, history, list, transition } from '../controllers/correctiveActionController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  actionHistorySchema, actionIdSchema, actionVersionSchema, createActionSchema, editActionSchema,
  listActionsSchema, returnActionSchema, submitActionSchema,
} from '../validators/correctiveActionValidator.js';

export function createCorrectiveActionRouter() {
  const router = Router();
  const participate = requirePermission(Permission.CORRECTIVE_ACTION_PARTICIPATE);
  const manage = requirePermission(Permission.CORRECTIVE_ACTION_MANAGE);
  const id = validate(actionIdSchema, 'params');
  const parse = json({ limit: '64kb' });
  const version = validate(actionVersionSchema);
  router.use(authenticate);
  router.post('/', manage, parse, validate(createActionSchema), create);
  router.get('/', participate, validate(listActionsSchema, 'query'), list);
  router.get('/:id', participate, id, detail);
  router.get('/:id/history', participate, id, validate(actionHistorySchema, 'query'), history);
  router.patch('/:id', participate, id, parse, validate(editActionSchema), edit);
  router.patch('/:id/start', participate, id, parse, version, transition('STARTED'));
  router.patch('/:id/submit', participate, id, parse, validate(submitActionSchema), transition('SUBMITTED'));
  router.patch('/:id/verify', manage, id, parse, version, transition('VERIFIED'));
  router.patch('/:id/return', manage, id, parse, validate(returnActionSchema), transition('RETURNED'));
  return router;
}
