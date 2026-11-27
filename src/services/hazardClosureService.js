import { getDatabase } from '../config/database.js';
import { hasPermission, Permission } from '../config/permissions.js';
import { createAuditLog } from '../models/auditLogModel.js';
import { findHazard, lockHazard, updateHazard } from '../models/hazardModel.js';
import {
  countCorrectiveActionsByStatus, createClosureDecision, createResidualRevision, findBaseline,
  findClosureDecision, listResidualRevisions, lockDecisionActor,
} from '../models/hazardClosureModel.js';
import { ApiError } from '../utils/apiError.js';
import { hazardReadScope } from './hazardService.js';
import { calculateRisk } from './riskAssessmentService.js';
import { closureOutcome } from './hazardClosurePolicy.js';

function missingHazard() {
  return new ApiError(404, 'HAZARD_NOT_FOUND', 'The hazard was not found.');
}

async function requireClosurePrerequisites(db, auth, hazardId) {
  const { organizationId, id, authVersion } = auth;
  const hazard = await lockHazard(db, organizationId, hazardId);
  if (!hazard) throw missingHazard();
  const account = await lockDecisionActor(db, organizationId, id);
  if (!account || account.status !== 'APPROVED' || account.deletedAt || account.authVersion !== authVersion) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Valid authentication is required.');
  }
  const actor = { id, organizationId, role: account.role };
  if (!hasPermission(actor, Permission.HAZARD_CLOSE)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this operation.');
  }
  if (hazard.status !== 'CONFIRMED') {
    throw new ApiError(409, 'HAZARD_NOT_CONFIRMED', 'Only confirmed hazards can be assessed for closure.');
  }
  const baseline = await findBaseline(db, organizationId, hazardId);
  if (!baseline) throw new ApiError(409, 'BASELINE_REQUIRED', 'A baseline risk assessment is required.');
  const counts = await countCorrectiveActionsByStatus(db, organizationId, hazardId);
  if (counts.length !== 1 || counts[0].status !== 'VERIFIED') {
    throw new ApiError(409, 'VERIFIED_ACTIONS_REQUIRED', 'At least one corrective action is required and all actions must be verified.');
  }
  return { actor, baselineVersion: baseline.version, verifiedActionCount: counts[0]._count._all };
}

async function latestResidual(db, organizationId, hazardId) {
  const [revision] = await listResidualRevisions(db, organizationId, hazardId, { page: 1, limit: 1 });
  return revision;
}

function auditHazard(db, auth, hazardId, action) {
  return createAuditLog(auth.organizationId, {
    actorId: auth.id, action, entityType: 'Hazard', entityId: hazardId,
  }, db);
}

export function recordResidualRisk(auth, hazardId, { version, likelihood, severity, rationale }) {
  return getDatabase().$transaction(async (db) => {
    const { organizationId, id } = auth;
    const { baselineVersion, verifiedActionCount } = await requireClosurePrerequisites(db, auth, hazardId);
    const latest = await latestResidual(db, organizationId, hazardId);
    if ((latest?.version ?? 0) !== version) {
      throw new ApiError(409, 'STALE_RESIDUAL_RISK', 'Fetch the latest residual-risk version and retry.');
    }
    const revision = await createResidualRevision(db, {
      organizationId, hazardId, version: version + 1, assessedById: id, rationale, baselineVersion, verifiedActionCount,
      ...calculateRisk(likelihood, severity),
    });
    await auditHazard(db, auth, hazardId, 'RESIDUAL_RISK_RECORDED');
    return revision;
  }, { isolationLevel: 'ReadCommitted' });
}

function readForVisibleHazard(auth, hazardId, read) {
  return getDatabase().$transaction(async (db) => {
    if (!await findHazard(hazardReadScope(auth), hazardId, db)) throw missingHazard();
    return read(db, auth.organizationId, hazardId);
  }, { isolationLevel: 'RepeatableRead' });
}

export function getResidualRisk(auth, hazardId) {
  return readForVisibleHazard(auth, hazardId, async (db, organizationId, id) => {
    const revision = await latestResidual(db, organizationId, id);
    if (!revision) throw new ApiError(404, 'RESIDUAL_RISK_NOT_FOUND', 'The residual-risk assessment was not found.');
    return revision;
  });
}

export function getResidualRiskHistory(auth, hazardId, pagination) {
  return readForVisibleHazard(auth, hazardId, async (db, organizationId, id) => {
    const revisions = await listResidualRevisions(db, organizationId, id, pagination);
    return { revisions, page: pagination.page, limit: pagination.limit };
  });
}

export function getClosureDecision(auth, hazardId) {
  return readForVisibleHazard(auth, hazardId, async (db, organizationId, id) => {
    const decision = await findClosureDecision(db, organizationId, id);
    if (!decision) throw new ApiError(404, 'CLOSURE_DECISION_NOT_FOUND', 'The closure decision was not found.');
    return publicDecision(decision);
  });
}

function publicDecision(record) {
  return { ...record, status: record.outcome === 'ESCALATED' ? 'CONFIRMED' : 'CLOSED' };
}

export function decideHazardClosure(auth, hazardId, { residualVersion, rationale, decision }) {
  return getDatabase().$transaction(async (db) => {
    const { organizationId, id } = auth;
    const { actor, baselineVersion, verifiedActionCount } = await requireClosurePrerequisites(db, auth, hazardId);
    const latest = await latestResidual(db, organizationId, hazardId);
    if (!latest) throw new ApiError(409, 'RESIDUAL_RISK_REQUIRED', 'Document residual risk before closing this hazard.');
    if (latest.version !== residualVersion || latest.baselineVersion !== baselineVersion ||
      latest.verifiedActionCount !== verifiedActionCount) {
      throw new ApiError(409, 'STALE_RESIDUAL_RISK', 'Review the latest residual risk and reassess if the baseline or actions changed.');
    }
    if (await findClosureDecision(db, organizationId, hazardId, residualVersion)) {
      throw new ApiError(409, 'CLOSURE_ALREADY_DECIDED', 'This residual-risk version already has a decision. Record a new assessment to proceed.');
    }
    const outcome = closureOutcome(latest.level, decision, hasPermission(actor, Permission.HAZARD_ACCEPT_RISK));
    const closed = outcome !== 'ESCALATED';
    if (closed && !await updateHazard(db, { organizationId }, hazardId, 'CONFIRMED', { status: 'CLOSED' })) {
      throw new ApiError(409, 'HAZARD_NOT_CONFIRMED', 'Only confirmed hazards can be closed.');
    }
    const record = await createClosureDecision(db, { organizationId, hazardId, residualVersion, decidedById: id, outcome, rationale });
    await auditHazard(db, auth, hazardId, closed ? 'HAZARD_CLOSED' : 'HAZARD_CLOSURE_ESCALATED');
    return publicDecision(record);
  }, { isolationLevel: 'ReadCommitted' });
}
