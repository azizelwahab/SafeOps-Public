import { ApiError } from '../utils/apiError.js';

export function closureOutcome(level, decision, canAccept) {
  if (level === 'LOW' || level === 'MEDIUM') {
    if (decision !== undefined) {
      throw new ApiError(409, 'RISK_DECISION_NOT_APPLICABLE', 'Low or medium residual risk does not require an acceptance or escalation decision.');
    }
    return 'NOT_REQUIRED';
  }
  if (decision === 'ESCALATED') return decision;
  if (decision === 'ACCEPTED') {
    if (!canAccept) throw new ApiError(403, 'RISK_ACCEPTANCE_FORBIDDEN', 'Only an administrator can accept high or critical residual risk.');
    return decision;
  }
  throw new ApiError(409, 'RISK_DECISION_REQUIRED', 'High or critical residual risk requires explicit acceptance or escalation.');
}
