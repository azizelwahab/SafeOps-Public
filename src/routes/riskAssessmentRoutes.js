import { json, Router } from 'express';
import { Permission } from '../config/permissions.js';
import { create, detail, history, list, update } from '../controllers/riskAssessmentController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  assessmentHistorySchema, assessmentIdSchema, createAssessmentSchema, listAssessmentsSchema, updateAssessmentSchema,
} from '../validators/riskAssessmentValidator.js';

export function createRiskAssessmentRouter() {
  const router = Router();
  const read = requirePermission(Permission.HAZARD_READ);
  const write = requirePermission(Permission.RISK_ASSESSMENT_WRITE);
  const id = validate(assessmentIdSchema, 'params');
  const parseBody = json({ limit: '8kb' });
  router.use(authenticate);
  router.post('/', write, parseBody, validate(createAssessmentSchema), create);
  router.get('/', read, validate(listAssessmentsSchema, 'query'), list);
  router.get('/:id', read, id, detail);
  router.get('/:id/history', read, id, validate(assessmentHistorySchema, 'query'), history);
  router.patch('/:id', write, id, parseBody, validate(updateAssessmentSchema), update);
  return router;
}
