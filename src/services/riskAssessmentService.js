import { getDatabase } from '../config/database.js';
import { createAuditLog } from '../models/auditLogModel.js';
import { findHazard, lockHazard } from '../models/hazardModel.js';
import {
  advanceAssessment, createAssessment, createRevision, findAssessment, listAssessments, listRevisions,
} from '../models/riskAssessmentModel.js';
import { ApiError } from '../utils/apiError.js';
import { hazardReadScope } from './hazardService.js';

const consistentSnapshot = { isolationLevel: 'RepeatableRead' };

export function calculateRisk(likelihood, severity) {
  const score = likelihood * severity;
  const level = score <= 4 ? 'LOW' : score <= 9 ? 'MEDIUM' : score <= 16 ? 'HIGH' : 'CRITICAL';
  return { likelihood, severity, score, level };
}

function publicAssessment(assessment, revision) {
  const { id, organizationId, hazardId, version, createdAt, updatedAt } = assessment;
  const { assessedById, likelihood, severity, score, level } = revision;
  return { id, organizationId, hazardId, version, assessedById, likelihood, severity, score, level,
    assessedAt: revision.createdAt, createdAt, updatedAt };
}

function assessableScope(auth) {
  return { organizationId: auth.organizationId, hazard: hazardReadScope(auth) };
}

async function requireAssessment(scope, id, db) {
  const assessment = await findAssessment(scope, id, db);
  if (!assessment) throw new ApiError(404, 'RISK_ASSESSMENT_NOT_FOUND', 'The risk assessment was not found.');
  return assessment;
}

async function recordRevision(db, auth, assessment, rating, action) {
  const revision = await createRevision(db, assessment, auth.id, rating);
  await createAuditLog(auth.organizationId, {
    actorId: auth.id, entityType: 'RiskAssessment', entityId: assessment.id, action,
  }, db);
  return publicAssessment(assessment, revision);
}

export function assessRisk(auth, { hazardId, likelihood, severity }) {
  return getDatabase().$transaction(async (db) => {
    const hazard = await findHazard({ organizationId: auth.organizationId }, hazardId, db);
    if (!hazard) throw new ApiError(404, 'HAZARD_NOT_FOUND', 'The hazard was not found.');
    if (hazard.status !== 'CONFIRMED') {
      throw new ApiError(409, 'HAZARD_NOT_CONFIRMED', 'Only confirmed hazards can be assessed.');
    }
    const assessment = await createAssessment(db, auth.organizationId, hazardId).catch((error) => {
      if (error.code === 'P2002') {
        throw new ApiError(409, 'RISK_ASSESSMENT_EXISTS', 'This hazard already has a risk assessment.');
      }
      throw error;
    });
    return recordRevision(db, auth, assessment, calculateRisk(likelihood, severity), 'RISK_ASSESSMENT_CREATED');
  });
}

export function getRiskAssessment(auth, id) {
  return getDatabase().$transaction(async (db) => {
    const assessment = await requireAssessment(assessableScope(auth), id, db);
    return publicAssessment(assessment, assessment.revisions[0]);
  }, consistentSnapshot);
}

export function getRiskAssessments(auth, filters) {
  return getDatabase().$transaction(async (db) => {
    const scope = assessableScope(auth);
    if (filters.hazardId && !await findHazard(scope.hazard, filters.hazardId, db)) {
      throw new ApiError(404, 'HAZARD_NOT_FOUND', 'The hazard was not found.');
    }
    const entries = await listAssessments(db, scope, filters);
    const assessments = entries.map((entry) => publicAssessment(entry, entry.revisions[0]));
    return { assessments, page: filters.page, limit: filters.limit };
  }, consistentSnapshot);
}

export function getRiskHistory(auth, id, pagination) {
  return getDatabase().$transaction(async (db) => {
    await requireAssessment(assessableScope(auth), id, db);
    const revisions = await listRevisions(db, auth.organizationId, id, pagination);
    return { revisions, page: pagination.page, limit: pagination.limit };
  }, consistentSnapshot);
}

export function reviseRisk(auth, id, { version, likelihood, severity }) {
  return getDatabase().$transaction(async (db) => {
    const current = await requireAssessment({ organizationId: auth.organizationId }, id, db);
    const hazard = await lockHazard(db, auth.organizationId, current.hazardId);
    if (hazard?.status === 'CLOSED') {
      throw new ApiError(409, 'HAZARD_CLOSED', 'The baseline assessment cannot change after hazard closure.');
    }
    // Claim the caller's expected version before reading the previous ratings.
    const assessment = await advanceAssessment(db, auth.organizationId, id, version);
    if (!assessment) {
      throw new ApiError(409, 'STALE_RISK_ASSESSMENT', 'The assessment changed. Fetch its latest version and retry.');
    }
    const previous = await listRevisions(db, auth.organizationId, id, { page: 1, limit: 1 });
    const rating = calculateRisk(likelihood ?? previous[0].likelihood, severity ?? previous[0].severity);
    return recordRevision(db, auth, assessment, rating, 'RISK_ASSESSMENT_UPDATED');
  });
}
