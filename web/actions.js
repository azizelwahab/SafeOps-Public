import { createNode } from './hazards.js';

export const actionStatuses = {
  OPEN: 'Open', IN_PROGRESS: 'In progress', PENDING_VERIFICATION: 'Pending verification', VERIFIED: 'Verified',
};
const actionEvents = {
  CREATED: 'Created', UPDATED: 'Updated', STARTED: 'Work started',
  SUBMITTED: 'Submitted for verification', VERIFIED: 'Verified', RETURNED: 'Returned to work',
};

export function managesActions(user) {
  return user?.role === 'SAFETY_OFFICER' || user?.role === 'ADMIN';
}

export function actionControls(user, action, hazardStatus) {
  const manager = managesActions(user);
  const assigned = user.role === 'EMPLOYEE' && user.id === action.assigneeId;
  if (hazardStatus === 'CLOSED' || (!manager && !assigned)) return [];
  switch (action.status) {
    case 'OPEN': return manager ? ['plan', 'notes', 'start'] : ['start'];
    case 'IN_PROGRESS': return manager ? ['plan', 'notes', 'submit'] : ['notes', 'submit'];
    case 'PENDING_VERIFICATION':
      if (!manager) return [];
      return user.id === action.assigneeId || user.id === action.submittedById ? ['return'] : ['verify', 'return'];
    default: return [];
  }
}

const uuid = /^(?:[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

function id(value, label) {
  if (!uuid.test(value?.trim())) throw new RangeError('Enter a valid ' + label + ' UUID.');
  return value.trim().toLowerCase();
}

export function actionFilters(values, page = 1) {
  const query = { page: Math.min(10000, Math.max(page, 1)), limit: 10 };
  if (values.hazardId?.trim()) query.hazardId = id(values.hazardId, 'hazard');
  if (values.assigneeId?.trim()) query.assigneeId = id(values.assigneeId, 'assignee');
  if (Object.hasOwn(actionStatuses, values.status)) query.status = values.status;
  if (values.overdue === 'true' || values.overdue === 'false') query.overdue = values.overdue;
  return query;
}

function text(value, label, max, explanation = false) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.length > max || !trimmed.isWellFormed() || trimmed.includes('\0')) {
    throw new RangeError(label + ' must contain 1 to ' + max + ' valid characters.');
  }
  if (explanation && (trimmed.length < 10 || (trimmed.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3)) {
    throw new RangeError(label + ' must contain 10 to 4,000 characters and at least three letters or numbers.');
  }
  return trimmed;
}

export function localDue(iso) {
  const date = new Date(iso);
  const local = new Date(+date - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function actionPayload(mode, values, record) {
  const body = {};
  if (mode !== 'create') {
    if (!Number.isInteger(record?.version) || record.version < 1 || record.version > 2147483646) {
      throw new RangeError('Reload the action before saving.');
    }
    body.version = record.version;
  }
  if (mode === 'create' || mode === 'plan') {
    const plan = {
      title: text(values.title, 'Title', 160), description: text(values.description, 'Action plan', 4000),
      assigneeId: id(values.assigneeId, 'assignee'),
    };
    const due = new Date(values.dueAt);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(values.dueAt) || !Number.isFinite(+due) || localDue(due) !== values.dueAt) {
      throw new RangeError('Enter a valid local due date and time.');
    }
    if (mode === 'create') return { ...plan, dueAt: due.toISOString(), hazardId: id(values.hazardId, 'hazard') };
    for (const key of Object.keys(plan)) if (plan[key] !== record[key]) body[key] = plan[key];
    if (values.dueAt !== localDue(record.dueAt)) body.dueAt = due.toISOString();
    if (Object.keys(body).length === 1) throw new RangeError('Change at least one plan or assignment field.');
  }
  if (mode === 'notes') body.workNotes = text(values.workNotes, 'Work notes', 4000);
  if (mode === 'submit') body.completionDetails = text(values.completionDetails, 'Completion details', 4000, true);
  if (mode === 'return') body.reason = text(values.reason, 'Return reason', 4000, true);
  return body;
}

export function actionError({ status, code }) {
  const businessErrors = {
    STALE_CORRECTIVE_ACTION: 'Someone changed this action after you opened it.',
    INVALID_CORRECTIVE_ACTION_STATE: 'This operation is unavailable in the current state.',
    HAZARD_CLOSED: 'The linked hazard is closed.',
    HAZARD_NOT_ELIGIBLE: 'Choose a confirmed hazard with an existing risk assessment.',
    HAZARD_NOT_FOUND: 'The hazard was not found or is outside your access.',
    ASSIGNEE_NOT_FOUND: 'The assignee was not found in your organization.',
    ASSIGNEE_INELIGIBLE: 'Choose an approved, undeleted assignee.',
    SELF_VERIFICATION_FORBIDDEN: 'The assignee or submitter cannot verify this action.',
  };
  const detail = Object.hasOwn(businessErrors, code) ? businessErrors[code] : undefined;
  if (status === 409 && !['HAZARD_NOT_ELIGIBLE', 'ASSIGNEE_INELIGIBLE'].includes(code)) {
    return { reload: true, message: (detail ?? 'The action changed or is no longer editable.') + ' Reload current data before trying again.' };
  }
  return { reload: false, message: detail ?? (status === 400 ? 'The server rejected the submitted values.'
    : status === 403 || status === 404 ? 'This operation is outside your access.' : 'The action could not be saved. Check its current state before trying again.') };
}

export function renderActionEvent(document, event, formatDate) {
  const row = createNode(document, 'li');
  const add = (tag, value) => row.append(createNode(document, tag, '', value));
  add('strong', 'Version ' + event.version + ' · ' + (actionEvents[event.kind] ?? 'Action updated'));
  const statuses = [event.fromStatus, event.toStatus].filter(Boolean).map((value) => actionStatuses[value]);
  add('span', statuses.join(' → '));
  add('span', formatDate(event.createdAt));
  add('span', 'Actor ID ' + event.actorId);
  if (event.reason) add('span', 'Return reason: ' + event.reason);
  if (event.completionDetails) add('span', 'Completion: ' + event.completionDetails);
  return row;
}
