import { findAuditLog, listAuditLogs, safeAuditMetadata } from '../models/auditLogModel.js';
import { ApiError } from '../utils/apiError.js';

function publicAuditLog(entry) {
  return { ...entry, metadata: safeAuditMetadata(entry.action, entry.metadata) };
}

export async function getAuditLogs(organizationId, filters) {
  const entries = await listAuditLogs(organizationId, filters);
  return { auditLogs: entries.map(publicAuditLog), page: filters.page, limit: filters.limit };
}

export async function getAuditLog(organizationId, id) {
  const entry = await findAuditLog(organizationId, id);
  if (!entry) throw new ApiError(404, 'AUDIT_LOG_NOT_FOUND', 'The audit log was not found.');
  return publicAuditLog(entry);
}
