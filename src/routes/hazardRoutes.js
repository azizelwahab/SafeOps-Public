import { json, Router } from 'express';
import { Permission } from '../config/permissions.js';
import { completeReview, create, detail, edit, list, review } from '../controllers/hazardController.js';
import { close, closure, createResidual, residual, residualHistory } from '../controllers/hazardClosureController.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { closureSchema, residualHistorySchema, residualRiskSchema } from '../validators/hazardClosureValidator.js';
import {
  createHazardSchema, editHazardSchema, hazardIdSchema, listHazardsSchema, reviewNotesSchema, startReviewSchema,
} from '../validators/hazardValidator.js';

export function createHazardRouter() {
  const router = Router();
  const read = requirePermission(Permission.HAZARD_READ);
  const investigate = requirePermission(Permission.HAZARD_INVESTIGATE);
  const closeHazard = requirePermission(Permission.HAZARD_CLOSE);
  const id = validate(hazardIdSchema, 'params');
  const parseBody = json({ limit: '32kb' });
  const notes = validate(reviewNotesSchema);
  router.use(authenticate);
  router.post('/', requirePermission(Permission.HAZARD_REPORT), parseBody, validate(createHazardSchema), create);
  router.get('/', read, validate(listHazardsSchema, 'query'), list);
  router.get('/:id', read, id, detail);
  router.patch('/:id', requirePermission(Permission.HAZARD_EDIT), id, parseBody, validate(editHazardSchema), edit);
  router.patch('/:id/review', investigate, id, parseBody, validate(startReviewSchema), review);
  router.patch('/:id/confirm', investigate, id, parseBody, notes, completeReview('CONFIRMED'));
  router.patch('/:id/dismiss', investigate, id, parseBody, notes, completeReview('DISMISSED'));
  router.post('/:id/residual-risk', closeHazard, id, parseBody, validate(residualRiskSchema), createResidual);
  router.get('/:id/residual-risk', read, id, residual);
  router.get('/:id/residual-risk/history', read, id, validate(residualHistorySchema, 'query'), residualHistory);
  router.get('/:id/closure', read, id, closure);
  router.patch('/:id/close', closeHazard, id, parseBody, validate(closureSchema), close);
  return router;
}
