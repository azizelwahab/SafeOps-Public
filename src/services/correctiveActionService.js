import { getDatabase } from '../config/database.js';
import { hasPermission, Permission } from '../config/permissions.js';
import { createAuditLog } from '../models/auditLogModel.js';
import { lockHazard } from '../models/hazardModel.js';
import {
  appendActionEvent, createAction, findAction, findActionHazard, listActionEvents, listActions, lockAssignee, updateAction,
} from '../models/correctiveActionModel.js';
import { ApiError } from '../utils/apiError.js';
import { transitionAction } from './correctiveActionWorkflow.js';

function canManage(auth) {
  return hasPermission(auth, Permission.CORRECTIVE_ACTION_MANAGE);
}

function readScope(auth) {
  return {
    organizationId: auth.organizationId,
    OR: canManage(auth) ? undefined : [
      { assigneeId: auth.id },
      { riskAssessment: { hazard: { reportedById: auth.id } } },
    ],
  };
}

async function requireAction(scope, id, db) {
  const action = await findAction(scope, id, db);
  if (!action) throw new ApiError(404, 'CORRECTIVE_ACTION_NOT_FOUND', 'The corrective action was not found.');
  return action;
}

async function requireEligibleAssignee(db, organizationId, id) {
  const assignee = await lockAssignee(db, organizationId, id);
  if (!assignee) throw new ApiError(404, 'ASSIGNEE_NOT_FOUND', 'The assignee was not found.');
  if (assignee.status !== 'APPROVED' || assignee.deletedAt) {
    throw new ApiError(409, 'ASSIGNEE_INELIGIBLE', 'The assignee must have an approved, undeleted account.');
  }
}

async function recordActionEvent(db, auth, action, event) {
  await appendActionEvent(db, action, auth.id, event);
  await createAuditLog(auth.organizationId, {
    actorId: auth.id, action: `CORRECTIVE_ACTION_${event.kind}`, entityType: 'CorrectiveAction', entityId: action.id,
  }, db);
}

async function lockCorrectiveActionHazard(db, organizationId, hazardId) {
  const hazard = await lockHazard(db, organizationId, hazardId);
  if (!hazard) throw new ApiError(404, 'HAZARD_NOT_FOUND', 'The hazard was not found.');
  if (hazard.status === 'CLOSED') {
    throw new ApiError(409, 'HAZARD_CLOSED', 'Corrective actions cannot change after hazard closure.');
  }
}

export function openCorrectiveAction(auth, input) {
  return getDatabase().$transaction(async (db) => {
    await lockCorrectiveActionHazard(db, auth.organizationId, input.hazardId);
    const hazard = await findActionHazard(db, auth.organizationId, input.hazardId);
    if (!hazard) throw new ApiError(404, 'HAZARD_NOT_FOUND', 'The hazard was not found.');
    if (hazard.status !== 'CONFIRMED' || !hazard.riskAssessment) {
      throw new ApiError(409, 'HAZARD_NOT_ELIGIBLE', 'A confirmed hazard with a risk assessment is required.');
    }
    await requireEligibleAssignee(db, auth.organizationId, input.assigneeId);
    const action = await createAction(db, auth.organizationId, auth.id, input);
    await recordActionEvent(db, auth, action, { kind: 'CREATED' });
    return action;
  }, { isolationLevel: 'ReadCommitted' });
}

export async function getCorrectiveActions(auth, filters) {
  const actions = await listActions(readScope(auth), filters, new Date());
  return { actions, page: filters.page, limit: filters.limit };
}

export function getCorrectiveAction(auth, id) {
  return requireAction(readScope(auth), id);
}

export function getCorrectiveActionHistory(auth, id, pagination) {
  return getDatabase().$transaction(async (db) => {
    await requireAction(readScope(auth), id, db);
    const events = await listActionEvents(db, auth.organizationId, id, pagination);
    return { events, page: pagination.page, limit: pagination.limit };
  }, { isolationLevel: 'RepeatableRead' });
}

function staleVersion() {
  return new ApiError(409, 'STALE_CORRECTIVE_ACTION', 'The action changed. Fetch its latest version and retry.');
}

function changeAction(auth, id, version, prepareChange) {
  return getDatabase().$transaction(async (db) => {
    const current = await requireAction(readScope(auth), id, db);
    const manager = canManage(auth);
    if (!manager && current.assigneeId !== auth.id) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the assignee or a manager can change this action.');
    }
    if (current.version !== version) throw staleVersion();

    await lockCorrectiveActionHazard(db, auth.organizationId, current.hazardId);
    const { data, event } = await prepareChange(db, current, manager);
    const changed = await updateAction(db, current, data);
    if (!changed) throw staleVersion();
    await recordActionEvent(db, auth, changed, event);
    return changed;
  }, { isolationLevel: 'ReadCommitted' });
}

export function editCorrectiveAction(auth, id, { version, title, description, dueAt, assigneeId, workNotes }) {
  return changeAction(auth, id, version, async (db, current, manager) => {
    if (!manager && [title, description, dueAt, assigneeId].some((value) => value !== undefined)) {
      throw new ApiError(403, 'FORBIDDEN', 'Only a manager can change the action plan or assignee.');
    }
    if (current.status !== 'IN_PROGRESS' && !(manager && current.status === 'OPEN')) {
      throw new ApiError(409, 'INVALID_CORRECTIVE_ACTION_STATE', 'The action is not editable in its current state.');
    }
    if (assigneeId !== undefined) await requireEligibleAssignee(db, auth.organizationId, assigneeId);
    if (!manager) await requireEligibleAssignee(db, auth.organizationId, current.assigneeId);
    return { data: { title, description, dueAt, assigneeId, workNotes },
      event: { kind: 'UPDATED', fromStatus: current.status } };
  });
}

export function moveCorrectiveAction(auth, id, kind, { version, completionDetails, reason }) {
  return changeAction(auth, id, version, async (db, current, manager) => {
    if (!manager && (kind === 'VERIFIED' || kind === 'RETURNED')) {
      throw new ApiError(403, 'FORBIDDEN', 'Only a manager can review submitted work.');
    }
    const change = transitionAction(current, kind, auth.id, { completionDetails, reason });
    if (kind === 'STARTED' || kind === 'SUBMITTED') {
      await requireEligibleAssignee(db, auth.organizationId, current.assigneeId);
    }
    return change;
  });
}
