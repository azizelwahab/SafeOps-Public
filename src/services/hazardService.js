import { Permission, hasPermission } from '../config/permissions.js';
import { getDatabase } from '../config/database.js';
import { createAuditLog } from '../models/auditLogModel.js';
import { createHazard, findHazard, listHazards, updateHazard } from '../models/hazardModel.js';
import { ApiError } from '../utils/apiError.js';

export function hazardReadScope(auth) {
  return {
    organizationId: auth.organizationId,
    reportedById: hasPermission(auth, Permission.HAZARD_READ_ALL) ? undefined : auth.id,
  };
}

function missingHazard() {
  return new ApiError(404, 'HAZARD_NOT_FOUND', 'The hazard was not found.');
}

function auditChange(db, auth, hazard, action) {
  return createAuditLog(auth.organizationId, {
    actorId: auth.id, action, entityType: 'Hazard', entityId: hazard.id,
  }, db);
}

export function reportHazard(auth, data) {
  return getDatabase().$transaction(async (db) => {
    const hazard = await createHazard(db, { organizationId: auth.organizationId, reportedById: auth.id }, data);
    await auditChange(db, auth, hazard, 'HAZARD_REPORTED');
    return hazard;
  });
}

export async function getHazards(auth, filters) {
  const hazards = await listHazards(hazardReadScope(auth), filters);
  return { hazards, page: filters.page, limit: filters.limit };
}

export async function getHazard(auth, id) {
  const hazard = await findHazard(hazardReadScope(auth), id);
  if (!hazard) throw missingHazard();
  return hazard;
}

function changeHazard(auth, scope, id, from, data, action) {
  return getDatabase().$transaction(async (db) => {
    const hazard = await updateHazard(db, scope, id, from, data);
    if (!hazard) {
      if (!await findHazard(scope, id, db)) throw missingHazard();
      throw new ApiError(409, 'INVALID_HAZARD_STATE', 'The hazard is not eligible for this operation.');
    }
    await auditChange(db, auth, hazard, action);
    return hazard;
  });
}

export function editHazard(auth, id, { title, description, category, location }) {
  return changeHazard(auth, { organizationId: auth.organizationId, reportedById: auth.id },
    id, 'REPORTED', { title, description, category, location }, 'HAZARD_UPDATED');
}

export function startReview(auth, id) {
  return changeHazard(auth, { organizationId: auth.organizationId }, id, 'REPORTED',
    { status: 'UNDER_REVIEW', reviewedById: auth.id }, 'HAZARD_REVIEW_STARTED');
}

export function finishReview(auth, id, reviewNotes, outcome) {
  const actions = { CONFIRMED: 'HAZARD_CONFIRMED', DISMISSED: 'HAZARD_DISMISSED' };
  if (!Object.hasOwn(actions, outcome)) throw new TypeError('Invalid review outcome.');
  return changeHazard(auth, { organizationId: auth.organizationId }, id, 'UNDER_REVIEW',
    { status: outcome, reviewNotes, reviewedById: auth.id, reviewedAt: new Date() }, actions[outcome]);
}
