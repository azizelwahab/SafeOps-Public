import { Router } from 'express';
import { Permission } from '../config/permissions.js';
import { summary } from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { dashboardQuerySchema } from '../validators/dashboardValidator.js';

export function createDashboardRouter() {
  const router = Router();
  router.get('/summary', authenticate, requirePermission(Permission.HAZARD_READ),
    validate(dashboardQuerySchema, 'query'), summary);
  return router;
}
