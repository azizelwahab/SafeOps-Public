import { getDatabase } from '../config/database.js';

const actionFields = {
  id: true, organizationId: true, hazardId: true, assigneeId: true, createdById: true, submittedById: true,
  title: true, description: true, dueAt: true, status: true, workNotes: true, completionDetails: true,
  version: true, createdAt: true, updatedAt: true,
};
const eventFields = {
  version: true, actorId: true, kind: true, fromStatus: true, toStatus: true,
  reason: true, completionDetails: true, createdAt: true,
};

export function findActionHazard(db, organizationId, id) {
  return db.hazard.findUnique({
    where: { organizationId, id },
    select: { status: true, riskAssessment: { select: { id: true } } },
  });
}

export async function lockAssignee(db, organizationId, id) {
  // Keep the eligibility read valid until the assignment or work transition commits.
  const [user] = await db.$queryRaw`
    SELECT status::text AS status, "deletedAt" FROM "User"
    WHERE "organizationId" = ${organizationId}::uuid AND id = ${id}::uuid
    FOR SHARE
  `;
  return user;
}

export function createAction(db, organizationId, creatorId, { hazardId, assigneeId, title, description, dueAt }) {
  return db.correctiveAction.create({
    data: { organizationId, createdById: creatorId, hazardId, assigneeId, title, description, dueAt },
    select: actionFields,
  });
}

export function findAction(scope, id, db = getDatabase()) {
  return db.correctiveAction.findUnique({ where: { ...scope, id }, select: actionFields });
}

export function listActions(scope, { page, limit, hazardId, assigneeId, status, overdue }, now) {
  const overdueRule = { status: { not: 'VERIFIED' }, dueAt: { lt: now } };
  return getDatabase().correctiveAction.findMany({
    where: { ...scope, hazardId, assigneeId, status,
      AND: overdue === undefined ? undefined : overdue ? overdueRule : { NOT: overdueRule },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    select: actionFields,
  });
}

export async function updateAction(db, current, data) {
  const [action] = await db.correctiveAction.updateManyAndReturn({
    where: { id: current.id, organizationId: current.organizationId, version: current.version, status: current.status },
    data: { ...data, version: { increment: 1 } },
    select: actionFields,
  });
  return action;
}

export function appendActionEvent(db, action, actorId, { kind, fromStatus, reason, completionDetails }) {
  return db.correctiveActionEvent.create({ data: {
    organizationId: action.organizationId, actionId: action.id, version: action.version, toStatus: action.status,
    actorId, kind, fromStatus, reason, completionDetails,
  } });
}

export function listActionEvents(db, organizationId, actionId, { page, limit }) {
  return db.correctiveActionEvent.findMany({
    where: { organizationId, actionId },
    orderBy: { version: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    select: eventFields,
  });
}
