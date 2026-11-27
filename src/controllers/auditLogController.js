import { getAuditLog, getAuditLogs } from '../services/auditLogService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function list(req, res) {
  return sendSuccess(res, await getAuditLogs(req.auth.organizationId, req.validated.query));
}

export async function detail(req, res) {
  return sendSuccess(res, await getAuditLog(req.auth.organizationId, req.validated.params.id));
}
