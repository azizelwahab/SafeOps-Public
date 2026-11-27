import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../web/api.js';
import { actionControls, actionError, actionFilters, actionPayload, localDue, renderActionEvent } from '../web/actions.js';

const id = '43dcd60e-036f-4a12-b997-f600824ac109';
const manager = { id: 'officer', role: 'SAFETY_OFFICER' };
const employee = { id: 'assigned', role: 'EMPLOYEE' };
const action = { assigneeId: employee.id, version: 8 };

test('corrective action controls follow status, role, assignment and terminal conditions', () => {
  assert.deepEqual(actionControls(employee, { ...action, status: 'OPEN' }), ['start']);
  assert.deepEqual(actionControls(employee, { ...action, status: 'IN_PROGRESS' }), ['notes', 'submit']);
  assert.deepEqual(actionControls(employee, { ...action, status: 'PENDING_VERIFICATION' }), []);
  assert.deepEqual(actionControls({ ...employee, id: 'reporter' }, { ...action, status: 'IN_PROGRESS' }), []);
  assert.deepEqual(actionControls(manager, { ...action, status: 'OPEN' }, 'CONFIRMED'), ['plan', 'notes', 'start']);
  assert.deepEqual(actionControls(manager, { ...action, status: 'VERIFIED' }), []);
  assert.deepEqual(actionControls(manager, { ...action, status: 'OPEN' }, 'CLOSED'), []);
});

test('assignees and submitters cannot verify even if they are managers', () => {
  const review = { ...action, status: 'PENDING_VERIFICATION', submittedById: manager.id };
  assert.deepEqual(actionControls(manager, review), ['return']);
  assert.deepEqual(actionControls({ ...employee, role: 'ADMIN' }, review), ['return']);
  assert.deepEqual(actionControls({ role: 'ADMIN', id: 'independent' }, review), ['verify', 'return']);
});

test('corrective action filters preserve overdue false and validate UUIDs and pagination', () => {
  assert.deepEqual(actionFilters({ hazardId: id.toUpperCase(), assigneeId: id, status: 'VERIFIED', overdue: 'false' }, 12000),
    { hazardId: id, assigneeId: id, status: 'VERIFIED', overdue: 'false', page: 10000, limit: 10 });
  assert.deepEqual(actionFilters({ overdue: 'true' }), { overdue: 'true', page: 1, limit: 10 });
  assert.throws(() => actionFilters({ hazardId: 'invalid' }), /hazard UUID/);
});

test('corrective action form payloads validate fields and send only allowed values and loaded versions', () => {
  const plan = { hazardId: id, title: ' Repair barrier ', description: 'Replace damaged guard.', assigneeId: id, dueAt: '2026-11-25T12:00' };
  const created = actionPayload('create', { ...plan, organizationId: 'ignored', version: 500 });
  assert.equal(created.title, 'Repair barrier');
  assert.equal(localDue(created.dueAt), plan.dueAt);
  assert.equal(Object.hasOwn(created, 'version'), false);
  assert.throws(() => actionPayload('create', { ...plan, dueAt: '2026-02-30T12:00' }), /due date/);
  assert.throws(() => actionPayload('create', { ...plan, title: 'x'.repeat(161) }), /Title/);
  assert.deepEqual(actionPayload('plan', { ...plan, title: 'Replace barrier' }, { ...created, version: 8 }), { title: 'Replace barrier', version: 8 });
  assert.deepEqual(actionPayload('notes', { workNotes: ' New bracket ', assigneeId: id }, action), { version: 8, workNotes: 'New bracket' });
  assert.deepEqual(actionPayload('start', {}, action), { version: 8 });
  assert.deepEqual(actionPayload('verify', {}, action), { version: 8 });
  assert.deepEqual(actionPayload('submit', { completionDetails: 'Guard fitted and checked' }, action), { version: 8, completionDetails: 'Guard fitted and checked' });
  assert.throws(() => actionPayload('return', { reason: '!!!!!!a!!!' }, action), /letters or numbers/);
  assert.throws(() => actionPayload('notes', { workNotes: 'broken\0text' }, action), /valid characters/);
});

test('history renders event timestamps, actors and untrusted reason text safely', () => {
  const doc = { createElement: () => ({ children: [], append(value) { this.children.push(value); } }) };
  const event = { version: 5, kind: 'RETURNED', actorId: 'reviewer', createdAt: '2026-11-25T12:00:00Z',
    fromStatus: 'PENDING_VERIFICATION', toStatus: 'IN_PROGRESS', reason: '<img src=x>' };
  const row = renderActionEvent(doc, event, (value) => value);
  assert.deepEqual(row.children.map(({ textContent }) => textContent), [
    'Version 5 · Returned to work', 'Pending verification → In progress', event.createdAt, 'Actor ID reviewer', 'Return reason: <img src=x>',
  ]);
});

test('client forwards action queries and versioned transitions, and a stale update requires explicit reload', async () => {
  const calls = [];
  const api = createApiClient(async (path, options) => {
    calls.push([path, options]);
    return options.method === 'PATCH'
      ? Response.json({ error: { code: 'STALE_CORRECTIVE_ACTION' } }, { status: 409 })
      : Response.json({ success: true, data: { events: [] } });
  });
  await api.listActions('token', { overdue: 'false', page: 2 });
  await api.actionHistory('token', id, { page: 1, limit: 10 });
  await assert.rejects(api.updateAction('token', id, { version: 8 }, 'verify'), (error) => {
    assert.equal(actionError(error).reload, true);
    assert.match(actionError(error).message, /Reload current data/);
    return true;
  });
  assert.equal(calls[0][0], '/api/v1/corrective-actions?overdue=false&page=2');
  assert.equal(calls[1][0], '/api/v1/corrective-actions/' + id + '/history?page=1&limit=10');
  assert.equal(calls[2][0], '/api/v1/corrective-actions/' + id + '/verify');
  assert.deepEqual(JSON.parse(calls[2][1].body), { version: 8 });
  assert.equal(calls.length, 3);
  assert.equal(actionError({ status: 409, code: 'ASSIGNEE_INELIGIBLE' }).reload, false);
});
