import { getDatabase } from '../config/database.js';

const assignableRoles = new Set(['EMPLOYEE', 'SAFETY_OFFICER']);

export function safeAuditMetadata(action, metadata) {
  // Apply the allowlist on reads as well, including for older records or external writers.
  const safeMetadata = {};
  if (Number.isSafeInteger(metadata?.changedFieldCount) && metadata.changedFieldCount >= 0) {
    safeMetadata.changedFieldCount = metadata.changedFieldCount;
  }
  if (typeof metadata?.automated === 'boolean') {
    safeMetadata.automated = metadata.automated;
  }
  if (action === 'USER_ROLE_CHANGED' &&
      assignableRoles.has(metadata?.previousRole) && assignableRoles.has(metadata?.newRole) &&
      metadata.previousRole !== metadata.newRole) {
    safeMetadata.previousRole = metadata.previousRole;
    safeMetadata.newRole = metadata.newRole;
  }
  return Object.keys(safeMetadata).length ? safeMetadata : null;
}

export function createAuditLog(organizationId, { actorId, action, entityType, entityId, metadata }, db = getDatabase()) {
  return db.auditLog.create({
    data: {
      organizationId,
      actorId,
      action,
      entityType,
      entityId,
      metadata: safeAuditMetadata(action, metadata) ?? undefined,
    },
  });
}

export function listAuditLogs(organizationId, { page, limit, action, entityType, actorId, from, to }) {
  return getDatabase().auditLog.findMany({
    where: {
      organizationId, action, entityType, actorId,
      createdAt: from || to ? { gte: from, lte: to } : undefined,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
  });
}

export function findAuditLog(organizationId, id) {
  return getDatabase().auditLog.findUnique({ where: { id, organizationId } });
}
