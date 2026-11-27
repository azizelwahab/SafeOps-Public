import { ApiError } from '../utils/apiError.js';

const transitions = new Map([
  ['STARTED', { from: 'OPEN', to: 'IN_PROGRESS' }],
  ['SUBMITTED', { from: 'IN_PROGRESS', to: 'PENDING_VERIFICATION' }],
  ['VERIFIED', { from: 'PENDING_VERIFICATION', to: 'VERIFIED' }],
  ['RETURNED', { from: 'PENDING_VERIFICATION', to: 'IN_PROGRESS' }],
]);

export function transitionAction(action, kind, actorId, { completionDetails, reason }) {
  const rule = transitions.get(kind);
  if (!rule || action.status !== rule.from) {
    throw new ApiError(409, 'INVALID_CORRECTIVE_ACTION_STATE', 'The action is not in the required state.');
  }
  if (kind === 'VERIFIED' && (actorId === action.assigneeId || actorId === action.submittedById)) {
    throw new ApiError(403, 'SELF_VERIFICATION_FORBIDDEN', 'The assignee or submitter cannot verify this action.');
  }

  const data = { status: rule.to };
  if (kind === 'SUBMITTED') Object.assign(data, { completionDetails, submittedById: actorId });
  if (kind === 'RETURNED') Object.assign(data, { completionDetails: null, submittedById: null });
  return { data, event: { kind, fromStatus: action.status, reason, completionDetails } };
}
