import { Router } from 'express';
import { getApiInfo, getHealth, getReadiness } from '../controllers/apiController.js';
import { createAuthRouter } from './authRoutes.js';
import { createAuditLogRouter } from './auditLogRoutes.js';
import { createHazardRouter } from './hazardRoutes.js';
import { createRiskAssessmentRouter } from './riskAssessmentRoutes.js';
import { createCorrectiveActionRouter } from './correctiveActionRoutes.js';
import { createDashboardRouter } from './dashboardRoutes.js';
import { createUserRouter } from './userRoutes.js';

export const apiBasePath = '/api/v1';
const healthPath = '/health';

export function createApiRouter(checkReadiness) {
  const apiRouter = Router();
  apiRouter.get('/', getApiInfo(apiBasePath + healthPath));
  apiRouter.get(healthPath, getHealth);
  apiRouter.get('/ready', getReadiness(checkReadiness));
  apiRouter.use('/auth', createAuthRouter());
  apiRouter.use('/users', createUserRouter());
  apiRouter.use('/audit-logs', createAuditLogRouter());
  apiRouter.use('/hazards', createHazardRouter());
  apiRouter.use('/risk-assessments', createRiskAssessmentRouter());
  apiRouter.use('/corrective-actions', createCorrectiveActionRouter());
  apiRouter.use('/dashboard', createDashboardRouter());
  return apiRouter;
}
